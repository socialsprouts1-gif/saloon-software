import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { all, get, insert, update, run, getSettings, setSetting, DEFAULT_SETTINGS, UPLOAD_DIR, IS_VERCEL, IS_REMOTE } from '../db.js';
import { requirePerm, MODULES, ROLES, DEFAULT_PERMISSIONS, randomToken } from '../lib/auth.js';
import { h, parse, HttpError, audit, paginate } from '../lib/util.js';
import { runJobsIfDue } from '../lib/jobs.js';

const r = Router();

// ---- uploads ------------------------------------------------------------------
// Local install: files go to data/uploads. Vercel: files go to Vercel Blob
// (images public, receipts private). Receipts stored in Blob are kept as "blob:<pathname>".
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const PUBLIC_DIR = path.join(UPLOAD_DIR, 'public');
const PRIVATE_DIR = path.join(UPLOAD_DIR, 'private');
if (!IS_VERCEL) { fs.mkdirSync(PUBLIC_DIR, { recursive: true }); fs.mkdirSync(PRIVATE_DIR, { recursive: true }); }
const ALLOWED = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'application/pdf': '.pdf' };
const MAX_MB = IS_VERCEL ? 4 : 5; // Vercel caps request bodies at 4.5 MB
const makeUploader = (types) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_q, f, cb) => (types.includes(f.mimetype) ? cb(null, true) : cb(new HttpError(400, `File type not allowed (${types.map((t) => ALLOWED[t]).join(', ')})`))),
});
// SVG excluded from public images: it can carry script
const imageUpload = makeUploader(['image/png', 'image/jpeg', 'image/webp']);
const receiptUpload = makeUploader(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
const fileName = (f) => `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ALLOWED[f.mimetype]}`;

async function saveUpload(file, kind) {
  if (!file) throw new HttpError(400, 'No file uploaded');
  const name = fileName(file);
  if (USE_BLOB) {
    const { put } = await import('@vercel/blob');
    const access = kind === 'public' ? 'public' : 'private';
    const b = await put(`${kind === 'public' ? 'images' : 'receipts'}/${name}`, file.buffer, { access, contentType: file.mimetype, addRandomSuffix: true });
    return kind === 'public' ? b.url : `blob:${b.pathname}`;
  }
  if (IS_VERCEL) throw new HttpError(400, 'File uploads need a Vercel Blob store: Vercel → Storage → Blob → Connect to this project, then redeploy.');
  fs.writeFileSync(path.join(kind === 'public' ? PUBLIC_DIR : PRIVATE_DIR, name), file.buffer);
  return kind === 'public' ? `/uploads/${name}` : name;
}

r.post('/uploads/image', imageUpload.single('file'), h(async (req, res) => {
  res.json({ url: await saveUpload(req.file, 'public') });
}));
r.post('/uploads/receipt', requirePerm('expenses'), receiptUpload.single('file'), h(async (req, res) => {
  res.json({ file: await saveUpload(req.file, 'private') });
}));
r.get('/files/:name', requirePerm('expenses'), h(async (req, res) => {
  const name = String(req.params.name);
  if (name.startsWith('blob:')) {
    if (!USE_BLOB) throw new HttpError(404, 'File not found');
    const { get: getBlob } = await import('@vercel/blob');
    const b = await getBlob(name.slice(5), { access: 'private' });
    if (!b?.stream) throw new HttpError(404, 'File not found');
    res.setHeader('Content-Type', b.blob?.contentType || 'application/octet-stream');
    return Readable.fromWeb(b.stream).pipe(res);
  }
  const f = path.join(PRIVATE_DIR, path.basename(name));
  if (!fs.existsSync(f)) throw new HttpError(404, 'File not found');
  res.sendFile(f);
}));
export { PUBLIC_DIR };

// ---- branches ------------------------------------------------------------------
const branchSchema = z.object({ name: z.string().trim().min(2), address: z.string().optional().nullable(), phone: z.string().optional().nullable(), email: z.string().optional().nullable(), is_active: z.boolean().optional() });
r.get('/branches', h((req, res) => {
  const rows = all(`SELECT b.*, (SELECT COUNT(*) FROM employees e WHERE e.branch_id=b.id AND e.status='active') employees FROM branches b ${req.user.branch_id ? 'WHERE b.id=' + Number(req.user.branch_id) : ''} ORDER BY b.id`);
  res.json(rows);
}));
r.post('/branches', requirePerm('branches'), h((req, res) => {
  const b = parse(branchSchema, req.body);
  const id = insert('branches', b);
  audit(req, 'create', 'branch', id, b);
  res.json({ id });
}));
r.put('/branches/:id', requirePerm('branches'), h((req, res) => {
  const b = parse(branchSchema.partial(), req.body);
  if (b.is_active === false && get('SELECT COUNT(*) n FROM branches WHERE is_active=1').n <= 1) throw new HttpError(400, 'At least one active branch is required');
  update('branches', Number(req.params.id), b);
  audit(req, 'update', 'branch', Number(req.params.id), b);
  res.json({ ok: true });
}));

// ---- settings --------------------------------------------------------------------
const SECRET_PATHS = [['whatsapp', 'access_token'], ['ai', 'api_key']];
function redact(s) {
  const out = structuredClone(s);
  for (const [k, f] of SECRET_PATHS) if (out[k]?.[f]) out[k][f] = '••••••••';
  return out;
}
r.get('/settings', requirePerm('settings', 'booking'), h((_req, res) => {
  const s = getSettings();
  s.permissions = Object.fromEntries(ROLES.map((role) => [role, role === 'owner' ? MODULES : (s.permissions?.[role] ?? DEFAULT_PERMISSIONS[role])]));
  res.json({ settings: redact(s), modules: MODULES, roles: ROLES });
}));
r.put('/settings/:key', h((req, res) => {
  const key = req.params.key;
  if (!(key in DEFAULT_SETTINGS)) throw new HttpError(400, 'Unknown settings section');
  // QR booking managers may edit only the booking section
  const allowed = req.user.permissions.includes('settings') || (key === 'booking' && req.user.permissions.includes('booking'));
  if (!allowed) throw new HttpError(403, 'No permission to change settings');
  const current = getSettings()[key];
  let value = req.body;
  if (key === 'permissions') {
    if (req.user.role !== 'owner') throw new HttpError(403, 'Only the owner can change role permissions');
    value = Object.fromEntries(ROLES.filter((r2) => r2 !== 'owner').map((role) => [role, (req.body[role] || []).filter((m) => MODULES.includes(m))]));
  } else if (typeof value === 'object' && !Array.isArray(value)) {
    value = { ...current, ...value };
    for (const [k, f] of SECRET_PATHS) if (k === key && value[f] === '••••••••') value[f] = current[f]; // keep stored secret
  }
  if (key === 'tax') { const rate = Number(value.rate); if (!(rate >= 0 && rate <= 50)) throw new HttpError(400, 'Tax rate must be 0–50%'); value.rate = rate; }
  if (key === 'opening_hours') for (const d of Object.values(value)) if (!d.closed && d.open >= d.close) throw new HttpError(400, 'Opening time must be before closing time');
  setSetting(key, value);
  audit(req, 'update', 'settings', null, { key });
  res.json({ ok: true, value: redact({ [key]: value })[key] });
}));
r.post('/settings/booking/regenerate', requirePerm('booking', 'settings'), h((req, res) => {
  const s = getSettings();
  const token = randomToken(9);
  setSetting('booking', { ...s.booking, token, active: true });
  audit(req, 'regenerate', 'booking_link', null);
  res.json({ token });
}));

// ---- notifications ---------------------------------------------------------------
r.get('/notifications', h((req, res) => {
  runJobsIfDue(); // keeps reminders and recurring expenses current on serverless hosts
  const { limit, offset, page, pageSize } = paginate(req.query);
  const where = `WHERE (branch_id IS NULL OR ? IS NULL OR branch_id=?)${req.query.unread ? ' AND is_read=0' : ''}${req.query.type ? ' AND type=?' : ''}`;
  const p = [req.branchId, req.branchId, ...(req.query.type ? [req.query.type] : [])];
  // Self-service employees only see operational notices, never financial ones
  const restrict = req.user.permissions.includes('finance') ? '' : ` AND type NOT IN ('payment','salary')`;
  const rows = all(`SELECT * FROM notifications ${where}${restrict} ORDER BY id DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  const total = get(`SELECT COUNT(*) n FROM notifications ${where}${restrict}`, ...p).n;
  const unread = get(`SELECT COUNT(*) n FROM notifications WHERE is_read=0 AND (branch_id IS NULL OR ? IS NULL OR branch_id=?)${restrict}`, req.branchId, req.branchId).n;
  res.json({ data: rows, total, unread, page, pageSize });
}));
r.post('/notifications/read', h((req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : null;
  if (ids?.length) run(`UPDATE notifications SET is_read=1 WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  else run('UPDATE notifications SET is_read=1');
  res.json({ ok: true });
}));

// ---- audit log & export -------------------------------------------------------------
r.get('/audit-logs', requirePerm('settings'), h((req, res) => {
  const { limit, offset, page, pageSize } = paginate(req.query);
  const q = req.query.q ? `%${req.query.q}%` : null;
  const where = q ? `WHERE action LIKE ? OR entity LIKE ? OR user_name LIKE ? OR details LIKE ?` : '';
  const p = q ? [q, q, q, q] : [];
  res.json({ data: all(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...p, limit, offset), total: get(`SELECT COUNT(*) n FROM audit_logs ${where}`, ...p).n, page, pageSize });
}));

r.get('/export', requirePerm('settings'), h((req, res) => {
  if (req.user.role !== 'owner') throw new HttpError(403, 'Only the owner can export all data');
  const tables = all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).map((t) => t.name);
  const out = { exported_at: new Date().toISOString(), version: 1, tables: {} };
  for (const t of tables) {
    let rows = all(`SELECT * FROM ${t}`);
    if (t === 'users') rows = rows.map(({ password_hash, ...u }) => u);
    if (t === 'settings') rows = rows.map((s) => (['whatsapp', 'ai'].includes(s.key) ? { ...s, value: '(redacted)' } : s));
    out.tables[t] = rows;
  }
  audit(req, 'export', 'data', null);
  res.setHeader('Content-Disposition', `attachment; filename="salon-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(out);
}));

r.get('/meta/db-check', requirePerm('settings'), h((_req, res) => {
  let integrity;
  try { integrity = get('PRAGMA integrity_check'); } catch { integrity = { integrity_check: IS_REMOTE ? 'managed by host' : 'unavailable' }; }
  res.json({ integrity });
}));

export default r;
