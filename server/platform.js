// Salon registry for the multi-salon platform: create salons, find them, index staff logins.
import fs from 'node:fs';
import path from 'node:path';
import { pall, pget, prun, DATA_DIR, IS_REMOTE, REMOTE_MAIN_URL, nowStamp, runInTenant, forgetTenant, tenantDbUrl, openDatabase } from './db.js';
import { HttpError } from './lib/util.js';

export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'salon';
const RESERVED = new Set(['api', 'admin', 'platform', 'login', 'signup', 'book', 'app', 'www', 'demo-salon', 's', 'i', 'uploads']);

export const listTenants = () => pall('SELECT * FROM tenants ORDER BY id');
export const tenantById = (id) => pget('SELECT * FROM tenants WHERE id=?', Number(id));
export const tenantBySlug = (slug) => pget('SELECT * FROM tenants WHERE slug=?', String(slug || '').toLowerCase());

export function uniqueSlug(base) {
  let slug = slugify(base), n = 1;
  while (RESERVED.has(slug) || tenantBySlug(slug)) slug = `${slugify(base)}-${++n}`;
  return slug;
}

/** Create a hosted database for a new salon through the Turso Platform API. */
async function createHostedDatabase(slug) {
  const org = process.env.TURSO_ORG, token = process.env.TURSO_API_TOKEN;
  if (!org || !token) {
    throw new HttpError(400, 'Adding more salons on a hosted database needs TURSO_ORG and TURSO_API_TOKEN (plus TURSO_GROUP_TOKEN) in the environment.');
  }
  const name = `salon-${slug}`.slice(0, 60);
  const r = await fetch(`https://api.turso.tech/v1/organizations/${org}/databases`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, group: process.env.TURSO_GROUP || 'default' }), signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, `Couldn't create the salon database (${data.error || r.status})`);
  // New databases can take a moment to accept connections
  const url = `libsql://${data.database.Hostname}`;
  for (let i = 0; i < 10; i++) {
    try { openDatabase(url, process.env.TURSO_GROUP_TOKEN || process.env.TURSO_AUTH_TOKEN).prepare('SELECT 1').get(); return url; }
    catch { await new Promise((res) => setTimeout(res, 1000)); }
  }
  return url;
}

/**
 * Register a salon and create its database. The first salon on a hosted database shares the
 * main database (so a single-salon setup needs no extra Turso configuration).
 */
export async function createTenant({ name, slug, ownerName, ownerEmail, phone, city, plan = 'trial' }) {
  slug = uniqueSlug(slug || name);
  let dbUrl = null;
  if (IS_REMOTE) dbUrl = listTenants().length === 0 ? REMOTE_MAIN_URL : await createHostedDatabase(slug);
  const now = nowStamp();
  const id = Number(prun(`INSERT INTO tenants (slug,name,owner_name,owner_email,phone,city,plan,db_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    slug, name, ownerName || null, ownerEmail || null, phone || null, city || null, plan, dbUrl, now, now).lastInsertRowid);
  return tenantById(id);
}

export function updateTenant(id, fields) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  prun(`UPDATE tenants SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`, ...keys.map((k) => fields[k]), nowStamp(), id);
}

/** Remove a salon from the registry and delete its local database file (hosted databases are kept). */
export function deleteTenant(id) {
  const t = tenantById(id);
  if (!t) return;
  forgetTenant(t.id);
  prun('DELETE FROM user_index WHERE tenant_id=?', t.id);
  prun('DELETE FROM tenants WHERE id=?', t.id);
  if (!t.db_url) for (const ext of ['', '-wal', '-shm']) fs.rmSync(`${tenantDbUrl(t)}${ext}`, { force: true });
}

// ---- login index: which salons an email can sign in to --------------------------------------
export const indexUser = (email, tenantId) => prun('INSERT OR IGNORE INTO user_index (email, tenant_id) VALUES (?,?)', String(email).toLowerCase(), tenantId);
export const unindexUser = (email, tenantId) => prun('DELETE FROM user_index WHERE email=? AND tenant_id=?', String(email).toLowerCase(), tenantId);
export const tenantsForEmail = (email) => pall(`SELECT t.* FROM user_index u JOIN tenants t ON t.id=u.tenant_id WHERE u.email=? ORDER BY t.name`, String(email).toLowerCase());

/** Rebuild a salon's login index from its users table (after seeding or migration). */
export function reindexTenant(t) {
  return runInTenant(t, async () => {
    const { all } = await import('./db.js');
    prun('DELETE FROM user_index WHERE tenant_id=?', t.id);
    for (const u of all('SELECT email FROM users')) indexUser(u.email, t.id);
  });
}

/**
 * One-time upgrade from the single-salon version: register the existing data/salon.db
 * (or, on a hosted database, the salon tables already in the main database) as the first salon.
 */
export async function migrateLegacySalon() {
  if (listTenants().length) return null;
  let legacyUrl = null;
  if (IS_REMOTE) {
    const hasUsers = pget(`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`);
    if (hasUsers) legacyUrl = REMOTE_MAIN_URL;
  } else {
    const f = path.join(DATA_DIR, 'salon.db');
    if (fs.existsSync(f)) legacyUrl = `file:${f}`;
  }
  if (!legacyUrl) return null;
  const probe = openDatabase(legacyUrl);
  let name = 'My Salon';
  try {
    if (!probe.prepare('SELECT id FROM users LIMIT 1').get()) return null;
    const row = probe.prepare(`SELECT value FROM settings WHERE key='salon'`).get();
    if (row) name = JSON.parse(row.value).name || name;
  } catch { return null; }
  finally { if (!IS_REMOTE) probe.close(); }
  const now = nowStamp(), slug = uniqueSlug(name);
  const id = Number(prun(`INSERT INTO tenants (slug,name,plan,db_url,created_at,updated_at) VALUES (?,?,?,?,?,?)`, slug, name, 'active', legacyUrl, now, now).lastInsertRowid);
  const t = tenantById(id);
  await reindexTenant(t);
  return t;
}
