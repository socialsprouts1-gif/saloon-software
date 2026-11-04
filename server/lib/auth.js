import crypto from 'node:crypto';
import { get, getSettings, DEMO_MODE, pgetMeta, prun, runInTenant } from '../db.js';
import { tenantById } from '../platform.js';
import { HttpError } from './util.js';

// ---- secret -----------------------------------------------------------------
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // Demo mode: every server instance builds its own sample database, so share one fixed key
  // to keep the demo signed in when Vercel moves it to another instance.
  if (DEMO_MODE) return 'salon-studio-public-demo';
  // Generated once and kept in the platform database, so it survives restarts and serverless cold starts
  prun('INSERT OR IGNORE INTO platform_meta(key,value) VALUES(?,?)', 'jwt_secret', crypto.randomBytes(48).toString('hex'));
  return pgetMeta('jwt_secret');
}
const SECRET = loadSecret();
const TOKEN_TTL_SEC = 60 * 60 * 12;

// ---- passwords (scrypt) -----------------------------------------------------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

// ---- signed tokens (HMAC-SHA256, JWT-like) -----------------------------------
const b64 = (s) => Buffer.from(s).toString('base64url');
export function signToken(payload) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}
export const randomToken = (n = 12) => crypto.randomBytes(n).toString('base64url');

// ---- permissions ------------------------------------------------------------
export const MODULES = [
  'dashboard', 'appointments', 'booking', 'customers', 'billing', 'services', 'packages', 'coupons',
  'employees', 'attendance', 'payroll', 'inventory', 'expenses', 'reports', 'finance', 'notifications',
  'branches', 'settings', 'ai', 'loyalty',
];
export const ROLES = ['owner', 'manager', 'receptionist', 'accountant', 'employee'];
// Modules that existed before role permissions could be customised; anything newer falls back to
// its default until the owner saves permissions again.
const LEGACY_MODULES = ['dashboard', 'appointments', 'booking', 'customers', 'billing', 'services', 'packages', 'coupons', 'employees', 'attendance', 'payroll', 'inventory', 'expenses', 'reports', 'finance', 'notifications', 'branches', 'settings', 'ai'];
export const DEFAULT_PERMISSIONS = {
  owner: MODULES,
  manager: ['dashboard', 'appointments', 'booking', 'customers', 'billing', 'services', 'packages', 'coupons', 'employees', 'attendance', 'inventory', 'reports', 'finance', 'notifications', 'ai', 'loyalty'],
  receptionist: ['dashboard', 'appointments', 'booking', 'customers', 'billing', 'packages', 'notifications', 'loyalty'],
  accountant: ['dashboard', 'billing', 'expenses', 'payroll', 'reports', 'finance', 'notifications', 'ai'],
  employee: ['dashboard', 'appointments', 'attendance', 'notifications'],
};
export function permissionsFor(role) {
  if (role === 'owner') return MODULES; // owner can never be locked out
  const custom = getSettings().permissions;
  const defaults = DEFAULT_PERMISSIONS[role] || [];
  if (!custom || !Array.isArray(custom[role])) return defaults;
  const known = custom._modules || LEGACY_MODULES;
  return [...custom[role], ...defaults.filter((m) => !known.includes(m) && !custom[role].includes(m))];
}

// ---- middleware --------------------------------------------------------------
/**
 * Signed-in salon staff: verify the token, select that salon's database for the rest of the
 * request, and load the user. Platform-admin tokens (pid) are handled by the platform routes.
 */
export function authenticate(req, res, next) {
  const h = req.headers.authorization || '';
  const payload = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : null);
  if (!payload?.tid) return next(new HttpError(401, 'Please sign in again'));
  const tenant = tenantById(payload.tid);
  if (!tenant) return next(new HttpError(401, 'This salon no longer exists'));
  if (tenant.status !== 'active') return next(new HttpError(403, 'This salon account is suspended. Contact the platform administrator.'));
  runInTenant(tenant, () => {
    try { loadUser(req, payload); next(); } catch (e) { next(e); }
  });
}
function loadUser(req, payload) {
  const user = get('SELECT id,name,email,role,employee_id,branch_id,is_active FROM users WHERE id=?', payload.uid);
  if (!user || !user.is_active) throw new HttpError(401, 'Account disabled');
  user.permissions = permissionsFor(user.role);
  user.impersonated_by = payload.imp || null;
  req.user = user;
  // Branch scope: users pinned to a branch always see that branch. Owners/unpinned users may pick one or "all".
  const requested = req.headers['x-branch-id'];
  if (user.branch_id) req.branchId = user.branch_id;
  else if (requested && requested !== 'all') req.branchId = Number(requested) || null;
  else req.branchId = null; // consolidated
}

export const can = (user, mod) => user.permissions.includes(mod);
export const requirePerm = (...mods) => (req, _res, next) =>
  mods.some((m) => can(req.user, m)) ? next() : next(new HttpError(403, `You don't have permission for ${mods.join('/')}`));

/** Employees (self-service role) only see their own records. */
export const selfEmployeeId = (req) => (req.user.role === 'employee' ? req.user.employee_id || -1 : null);
