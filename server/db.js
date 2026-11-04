import './tz.js';
import Database from 'libsql';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const IS_VERCEL = !!process.env.VERCEL;
// A hosted libSQL/Turso database is used when its URL is set (required on Vercel); otherwise a local file.
const REMOTE_URL = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL;
export const IS_REMOTE = !!REMOTE_URL;
// Demo mode: on Vercel without a hosted database the app runs on a throwaway copy in /tmp,
// filled with sample data and opened straight into the admin panel. Changes made during a
// demo can reset when Vercel recycles the server. Set DEMO_MODE=0 to require a real database.
export const DEMO_MODE = process.env.DEMO_MODE === '1' || (IS_VERCEL && !IS_REMOTE && process.env.DEMO_MODE !== '0');
if (IS_VERCEL && !IS_REMOTE && !DEMO_MODE) {
  throw new Error('Database not configured: add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel → Settings → Environment Variables.');
}
/** Whether local disk can be written (false only on Vercel with a hosted database). */
export const DISK_OK = !IS_VERCEL || DEMO_MODE;
export const DATA_DIR = process.env.DATA_DIR || (IS_VERCEL ? '/tmp/salon-data' : path.join(__dirname, '..', 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (DISK_OK) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'salon.db');
export let db = IS_REMOTE
  ? new Database(REMOTE_URL, { authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN })
  : new Database(DB_FILE);
if (!IS_REMOTE) db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
try { db.exec('PRAGMA foreign_keys = ON;'); } catch { /* not supported by every host */ }

const TS = `created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))`;

const schema = `
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, address TEXT, phone TEXT, email TEXT,
  is_active INTEGER NOT NULL DEFAULT 1, ${TS});

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, ${TS});

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL, photo TEXT, phone TEXT, email TEXT, address TEXT,
  joining_date TEXT, designation TEXT, department TEXT,
  role TEXT NOT NULL DEFAULT 'stylist',
  salary_type TEXT NOT NULL DEFAULT 'fixed_monthly',
  base_salary REAL NOT NULL DEFAULT 0, daily_rate REAL NOT NULL DEFAULT 0, hourly_rate REAL NOT NULL DEFAULT 0,
  service_commission_pct REAL NOT NULL DEFAULT 0, product_commission_pct REAL NOT NULL DEFAULT 0,
  work_start TEXT NOT NULL DEFAULT '10:00', work_end TEXT NOT NULL DEFAULT '19:00',
  weekly_off INTEGER, status TEXT NOT NULL DEFAULT 'active', ${TS});

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL,
  employee_id INTEGER REFERENCES employees(id), branch_id INTEGER REFERENCES branches(id),
  is_active INTEGER NOT NULL DEFAULT 1, last_login TEXT, ${TS});

CREATE TABLE IF NOT EXISTS service_categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, sort INTEGER DEFAULT 0, ${TS});

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY, category_id INTEGER REFERENCES service_categories(id),
  name TEXT NOT NULL, description TEXT, price REAL NOT NULL, duration_min INTEGER NOT NULL DEFAULT 30,
  commission_pct REAL, image TEXT, is_active INTEGER NOT NULL DEFAULT 1, online_bookable INTEGER NOT NULL DEFAULT 1, ${TS});

CREATE TABLE IF NOT EXISTS employee_services (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, service_id));

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, branch_id INTEGER REFERENCES branches(id),
  name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, email TEXT, birthday TEXT, gender TEXT, notes TEXT,
  preferred_employee_id INTEGER REFERENCES employees(id), loyalty_points INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'walk_in', ${TS});

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL REFERENCES branches(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id), employee_id INTEGER REFERENCES employees(id),
  start_at TEXT NOT NULL, end_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'manual', notes TEXT, total_price REAL NOT NULL DEFAULT 0,
  cancel_reason TEXT, invoice_id INTEGER, ${TS});
CREATE INDEX IF NOT EXISTS idx_appt_emp ON appointments(employee_id, start_at);
CREATE INDEX IF NOT EXISTS idx_appt_start ON appointments(branch_id, start_at);

CREATE TABLE IF NOT EXISTS appointment_services (
  id INTEGER PRIMARY KEY, appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id), price REAL NOT NULL, duration_min INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact_person TEXT, phone TEXT, email TEXT, address TEXT, gstin TEXT,
  is_active INTEGER NOT NULL DEFAULT 1, ${TS});

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL, category TEXT, brand TEXT, sku TEXT, barcode TEXT,
  purchase_price REAL NOT NULL DEFAULT 0, selling_price REAL NOT NULL DEFAULT 0,
  stock REAL NOT NULL DEFAULT 0, min_stock REAL NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id), purchase_date TEXT, expiry_date TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0, ${TS});

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), branch_id INTEGER NOT NULL,
  type TEXT NOT NULL, qty REAL NOT NULL, unit_cost REAL, reason TEXT, invoice_id INTEGER,
  supplier_id INTEGER REFERENCES suppliers(id), user_id INTEGER, balance_after REAL, ${TS});

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'prepaid', description TEXT,
  price REAL NOT NULL, validity_days INTEGER NOT NULL DEFAULT 30, discount_pct REAL NOT NULL DEFAULT 0,
  online_purchasable INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 1, ${TS});

CREATE TABLE IF NOT EXISTS package_items (
  id INTEGER PRIMARY KEY, package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id), credits INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT,
  discount_type TEXT NOT NULL DEFAULT 'percent', value REAL NOT NULL,
  applies_to TEXT NOT NULL DEFAULT 'all', service_id INTEGER REFERENCES services(id), product_id INTEGER REFERENCES products(id),
  min_invoice REAL NOT NULL DEFAULT 0, max_discount REAL, valid_from TEXT, valid_to TEXT,
  usage_limit INTEGER, per_customer_limit INTEGER, customer_id INTEGER REFERENCES customers(id),
  used_count INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, ${TS});

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL REFERENCES branches(id), invoice_no TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE, customer_id INTEGER REFERENCES customers(id), appointment_id INTEGER,
  date TEXT NOT NULL, subtotal REAL NOT NULL DEFAULT 0, item_discount REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0, coupon_id INTEGER REFERENCES coupons(id), coupon_discount REAL NOT NULL DEFAULT 0,
  loyalty_redeemed INTEGER NOT NULL DEFAULT 0, loyalty_value REAL NOT NULL DEFAULT 0, membership_discount REAL NOT NULL DEFAULT 0,
  taxable_amount REAL NOT NULL DEFAULT 0, tax_rate REAL NOT NULL DEFAULT 0, tax_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0, paid_amount REAL NOT NULL DEFAULT 0, balance REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid', notes TEXT, source TEXT NOT NULL DEFAULT 'pos', created_by INTEGER,
  loyalty_earned INTEGER NOT NULL DEFAULT 0, void_reason TEXT, ${TS});
CREATE INDEX IF NOT EXISTS idx_inv_date ON invoices(branch_id, date);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL, ref_id INTEGER, name TEXT NOT NULL, qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, total REAL NOT NULL,
  employee_id INTEGER REFERENCES employees(id), commission_amount REAL NOT NULL DEFAULT 0,
  package_credit_id INTEGER);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL, method TEXT NOT NULL, reference TEXT, paid_at TEXT NOT NULL, user_id INTEGER, ${TS});

CREATE TABLE IF NOT EXISTS coupon_usages (
  id INTEGER PRIMARY KEY, coupon_id INTEGER NOT NULL REFERENCES coupons(id), invoice_id INTEGER NOT NULL,
  customer_id INTEGER, discount REAL NOT NULL, invoice_total REAL NOT NULL, ${TS});

CREATE TABLE IF NOT EXISTS customer_packages (
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), package_id INTEGER NOT NULL REFERENCES packages(id),
  invoice_id INTEGER, purchased_at TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  price REAL NOT NULL DEFAULT 0, ${TS});

CREATE TABLE IF NOT EXISTS customer_package_credits (
  id INTEGER PRIMARY KEY, customer_package_id INTEGER NOT NULL REFERENCES customer_packages(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id), total INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), appointment_id INTEGER,
  employee_id INTEGER REFERENCES employees(id), rating INTEGER NOT NULL, comment TEXT, ${TS});

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL REFERENCES branches(id), category TEXT NOT NULL,
  amount REAL NOT NULL, date TEXT NOT NULL, payment_method TEXT NOT NULL DEFAULT 'cash', description TEXT,
  receipt TEXT, is_recurring INTEGER NOT NULL DEFAULT 0, recurrence TEXT, next_due TEXT,
  recurring_parent_id INTEGER, payroll_id INTEGER, created_by INTEGER, ${TS});
CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(branch_id, date);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), date TEXT NOT NULL,
  check_in TEXT, check_out TEXT, status TEXT NOT NULL DEFAULT 'present',
  work_minutes INTEGER NOT NULL DEFAULT 0, late_minutes INTEGER NOT NULL DEFAULT 0,
  early_minutes INTEGER NOT NULL DEFAULT 0, overtime_minutes INTEGER NOT NULL DEFAULT 0, notes TEXT, ${TS},
  UNIQUE(employee_id, date));

CREATE TABLE IF NOT EXISTS attendance_audit (
  id INTEGER PRIMARY KEY, attendance_id INTEGER NOT NULL, employee_id INTEGER NOT NULL, user_id INTEGER,
  old_value TEXT, new_value TEXT, reason TEXT NOT NULL, ${TS});

CREATE TABLE IF NOT EXISTS leaves (
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), from_date TEXT NOT NULL, to_date TEXT NOT NULL,
  leave_type TEXT NOT NULL DEFAULT 'paid', reason TEXT, status TEXT NOT NULL DEFAULT 'pending', approved_by INTEGER, ${TS});

CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY, branch_id INTEGER REFERENCES branches(id), date TEXT NOT NULL, name TEXT NOT NULL, ${TS});

CREATE TABLE IF NOT EXISTS salary_advances (
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), amount REAL NOT NULL, date TEXT NOT NULL,
  note TEXT, recovered_month TEXT, ${TS});

CREATE TABLE IF NOT EXISTS payroll (
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), month TEXT NOT NULL,
  salary_type TEXT, days_in_month INTEGER, working_days REAL, present_days REAL, absent_days REAL, leave_days REAL,
  half_days REAL, weekly_offs REAL, holidays REAL, worked_hours REAL, overtime_hours REAL,
  base_salary REAL NOT NULL DEFAULT 0, earned_base REAL NOT NULL DEFAULT 0, overtime_pay REAL NOT NULL DEFAULT 0,
  service_commission REAL NOT NULL DEFAULT 0, product_commission REAL NOT NULL DEFAULT 0,
  incentives REAL NOT NULL DEFAULT 0, bonus REAL NOT NULL DEFAULT 0, deductions REAL NOT NULL DEFAULT 0,
  advance REAL NOT NULL DEFAULT 0, net_payable REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', paid_at TEXT, payment_method TEXT, notes TEXT, ${TS},
  UNIQUE(employee_id, month));

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, branch_id INTEGER, type TEXT NOT NULL, title TEXT NOT NULL, message TEXT,
  link TEXT, is_read INTEGER NOT NULL DEFAULT 0, dedupe_key TEXT UNIQUE, audience TEXT NOT NULL DEFAULT 'staff', ${TS});

CREATE TABLE IF NOT EXISTS booking_events (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, token TEXT, appointment_id INTEGER, visitor TEXT, ${TS});

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY, user_id INTEGER, user_name TEXT, action TEXT NOT NULL, entity TEXT NOT NULL,
  entity_id INTEGER, details TEXT, branch_id INTEGER, ip TEXT, ${TS});

CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS message_log (
  id INTEGER PRIMARY KEY, channel TEXT NOT NULL, recipient TEXT, body TEXT, status TEXT, error TEXT, ${TS});
`;
db.exec(schema);

// Lightweight forward migrations: add columns introduced after a database was created
const ensureColumns = {
  invoices: { loyalty_earned: 'INTEGER NOT NULL DEFAULT 0', loyalty_value: 'REAL NOT NULL DEFAULT 0', void_reason: 'TEXT' },
};
for (const [table, cols] of Object.entries(ensureColumns)) {
  const have = new Set(db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((c) => c.name));
  for (const [col, def] of Object.entries(cols)) if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

// ---- tiny query helpers -------------------------------------------------
// Prepared statements are cached (saves a round trip per query on a hosted database).
const stmts = new Map();
const stmt = (sql) => {
  let s = stmts.get(sql);
  if (!s) { if (stmts.size > 500) stmts.clear(); s = db.prepare(sql); stmts.set(sql, s); }
  return s;
};
const bind = (p) => p.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v));
// libsql attaches a _metadata field to each row; drop it so rows stay plain records
const clean = (r) => { if (r && '_metadata' in r) delete r._metadata; return r; };
export const all = (sql, ...p) => { const rows = stmt(sql).all(...bind(p)); for (const r of rows) clean(r); return rows; };
export const get = (sql, ...p) => clean(stmt(sql).get(...bind(p)));
export const run = (sql, ...p) => stmt(sql).run(...bind(p));
export const scalar = (sql, ...p) => { const r = get(sql, ...p); return r ? Object.values(r)[0] : null; };

/**
 * Run fn against a fresh in-memory database (all helpers point at it meanwhile) and return it.
 * Used to build demo data quickly before copying it to a hosted database in bulk.
 */
export function withScratchDatabase(fn) {
  const target = db;
  const scratch = new Database(':memory:');
  scratch.exec(schema);
  db = scratch; stmts.clear();
  try { fn(); } finally { db = target; stmts.clear(); }
  return scratch;
}

/** Copy every row from another database into the current one using multi-row inserts. */
export function copyDatabaseFrom(source, { skip = ['app_meta'] } = {}) {
  const tables = source.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid`).all().map((t) => t.name).filter((t) => !skip.includes(t));
  tx(() => {
    for (const t of tables) {
      const rows = source.prepare(`SELECT * FROM ${t}`).all();
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]).filter((c) => c !== '_metadata');
      const per = Math.max(1, Math.min(500, Math.floor(2000 / cols.length))); // keep each request small
      for (let i = 0; i < rows.length; i += per) {
        const chunk = rows.slice(i, i + per);
        const sql = `INSERT OR REPLACE INTO ${t} (${cols.join(',')}) VALUES ${chunk.map(() => `(${cols.map(() => '?').join(',')})`).join(',')}`;
        db.prepare(sql).run(...chunk.flatMap((r) => cols.map((c) => r[c] ?? null)));
      }
    }
  });
}

/** Small key/value store for internal state (signing secret, job timestamps). Never exposed via settings. */
export const getMeta = (key) => get('SELECT value FROM app_meta WHERE key=?', key)?.value ?? null;
export const setMeta = (key, value) => run('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));

let txDepth = 0;
/** Runs fn inside a transaction (nesting-safe). The driver is synchronous, so this is atomic. */
export function tx(fn) {
  if (txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { txDepth--; }
}

/**
 * Current salon-local time as 'YYYY-MM-DD HH:MM:SS'. Timestamps are always set from here rather
 * than SQLite's datetime('now','localtime'), because a hosted database runs on UTC.
 */
export function nowStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const colCache = new Map();
const hasCol = (table, col) => {
  if (!colCache.has(table)) colCache.set(table, new Set(all(`SELECT name FROM pragma_table_info('${table}')`).map((c) => c.name)));
  return colCache.get(table).has(col);
};

/** Build an INSERT from an object; returns new id. */
export function insert(table, obj) {
  if (hasCol(table, 'created_at')) obj = { created_at: nowStamp(), updated_at: nowStamp(), ...obj };
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return Number(run(sql, ...keys.map((k) => norm(obj[k]))).lastInsertRowid);
}
/** UPDATE by id from an object (undefined keys skipped), bumps updated_at. */
export function update(table, id, obj) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`, ...keys.map((k) => norm(obj[k])), nowStamp(), id);
}
const norm = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === '' ? null : v);

// ---- settings --------------------------------------------------------------
export const DEFAULT_SETTINGS = {
  salon: { name: 'My Salon', tagline: '', logo: null, address: '', phone: '', email: '', website: '', currency: 'INR', currency_symbol: '₹' },
  opening_hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: '10:00', close: '20:00', closed: false }])),
  tax: { enabled: true, rate: 18, gstin: '', inclusive: false, label: 'GST' },
  invoice: { prefix: 'INV', footer: 'Thank you for visiting! See you again soon.', terms: '', show_gstin: true },
  appointments: { slot_interval: 15, buffer_min: 0, auto_confirm_online: false, max_advance_days: 30, min_notice_min: 60, allow_any_stylist: true },
  booking: { token: null, active: true, theme_color: '#7c2d5b', welcome: 'Book your next appointment in seconds.', show_prices: true, allow_packages: true, logo_in_qr: true },
  notifications: { new_booking: true, cancellations: true, low_stock: true, absences: true, salary_due: true, membership_expiry: true, birthdays: true, pending_payments: true, upcoming: true },
  whatsapp: { enabled: false, provider: 'link', phone_number_id: '', access_token: '', send_booking_confirmation: true, send_invoice: true },
  loyalty: { enabled: true, points_per_100: 1, point_value: 1, min_redeem: 50 },
  attendance: { grace_min: 10, half_day_ratio: 0.5, overtime_rate: 1 },
  crm: { vip_spend: 20000, vip_visits: 10, inactive_days: 60, regular_visits: 3 },
  ai: { enabled: true, api_key: '', model: 'claude-opus-5-5' },
  permissions: null, // filled from DEFAULT_PERMISSIONS on read
};

export function getSettings() {
  const rows = all('SELECT key, value FROM settings');
  const s = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    try { const v = JSON.parse(r.value); s[r.key] = (v && typeof v === 'object' && !Array.isArray(v) && s[r.key] && typeof s[r.key] === 'object') ? { ...s[r.key], ...v } : v; } catch { /* ignore */ }
  }
  return s;
}
export function setSetting(key, value) {
  run(`INSERT INTO settings(key,value,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`, key, JSON.stringify(value), nowStamp(), nowStamp());
}
