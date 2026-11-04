import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, update, tx, setSetting, getSettings, DEMO_MODE, runInTenant, currentTenant } from '../db.js';
import { listTenants, tenantBySlug, tenantsForEmail, createTenant, deleteTenant, reindexTenant, indexUser, unindexUser } from '../platform.js';
import { hashPassword, verifyPassword, signToken, authenticate, requirePerm, permissionsFor, ROLES, randomToken } from '../lib/auth.js';
import { h, parse, HttpError, audit, localISO } from '../lib/util.js';

const r = Router();

// naive in-memory login throttling: 8 failures / 15 min per email+ip
const fails = new Map();
const throttleKey = (req, email) => `${req.ip}|${String(email).toLowerCase()}`;

// Auto-login for local testing: signs in as the owner without a password, but only for
// requests from this same computer (or when AUTO_LOGIN=1). Set AUTO_LOGIN=0 to turn it off.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const autoLoginAllowed = (req) => process.env.AUTO_LOGIN !== '0' && (process.env.AUTO_LOGIN === '1' || DEMO_MODE || LOOPBACK.has(req.ip));

/** The salon used for automatic sign-in: the demo salon, or the first salon on a local install. */
export const defaultTenant = () => tenantBySlug(process.env.DEMO_TENANT || 'lumiere') || listTenants().find((t) => t.status === 'active') || null;

r.get('/setup-status', h((req, res) => {
  const t = defaultTenant();
  res.json({ hasSalons: listTenants().length > 0, salon: t?.name || null, autoLogin: autoLoginAllowed(req) && !!t, demo: DEMO_MODE, signup: process.env.ALLOW_SIGNUP !== '0' });
}));

r.post('/auto-login', h(async (req, res) => {
  if (!autoLoginAllowed(req)) throw new HttpError(403, 'Automatic sign-in is only available on this computer');
  const t = defaultTenant();
  if (!t) throw new HttpError(404, 'No salon yet');
  const token = await runInTenant(t, () => {
    const user = get(`SELECT * FROM users WHERE role='owner' AND is_active=1 ORDER BY id LIMIT 1`);
    if (!user) throw new HttpError(404, 'No owner account yet');
    run('UPDATE users SET last_login=? WHERE id=?', localISO(), user.id);
    audit({ user, ip: req.ip }, 'auto_login', 'user', user.id);
    return signToken({ uid: user.id, tid: t.id });
  });
  res.json({ token });
}));

/** Fill a new salon's database: owner, first branch, default categories and settings. */
export function initialiseSalon({ salonName, ownerName, email, password, phone, address, city }) {
  return tx(() => {
    insert('branches', { name: city ? `${city} — Main` : 'Main Branch', address, phone, email });
    const uid = insert('users', { name: ownerName, email, password_hash: hashPassword(password), role: 'owner' });
    const s = getSettings();
    setSetting('salon', { ...s.salon, name: salonName, phone: phone || '', address: address || '', email });
    setSetting('booking', { ...s.booking, token: randomToken(9) });
    for (const [i, c] of ['Haircut', 'Hair Styling', 'Hair Colouring', 'Facial', 'Cleanup', 'Waxing', 'Manicure', 'Pedicure', 'Spa', 'Bridal Makeup'].entries())
      insert('service_categories', { name: c, sort: i });
    return uid;
  });
}

const signupSchema = z.object({
  salonName: z.string().trim().min(2).max(80), slug: z.string().trim().max(40).optional(), ownerName: z.string().trim().min(2), email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'), phone: z.string().optional(), address: z.string().optional(), city: z.string().optional(),
  demo: z.boolean().optional(),
});
const signupHits = new Map();
/** Self-service salon sign-up: creates the salon, its database and the owner login. */
r.post('/signup', h(async (req, res) => {
  if (process.env.ALLOW_SIGNUP === '0') throw new HttpError(403, 'New salon sign-ups are closed. Contact the platform administrator.');
  const now = Date.now(), recent = (signupHits.get(req.ip) || []).filter((t) => now - t < 3600000);
  if (recent.length >= 5) throw new HttpError(429, 'Too many sign-ups from this network. Try again later.');
  signupHits.set(req.ip, [...recent, now]);
  const b = parse(signupSchema, req.body);
  const result = await createSalon(b);
  await runInTenant(result.tenant, () => audit({ user: { id: result.uid, name: b.ownerName }, ip: req.ip }, 'signup', 'salon', result.tenant.id));
  res.json({ token: signToken({ uid: result.uid, tid: result.tenant.id }), salon: { slug: result.tenant.slug, name: result.tenant.name } });
}));

/** Shared by sign-up and the platform admin panel. */
export async function createSalon(b, { plan } = {}) {
  const tenant = await createTenant({ name: b.salonName, slug: b.slug, ownerName: b.ownerName, ownerEmail: b.email, phone: b.phone, city: b.city, plan });
  try {
    const uid = await runInTenant(tenant, async () => {
      if (b.demo) {
        const { seedDemo } = await import('../seed.js');
        seedDemo({ salonName: b.salonName, ownerName: b.ownerName, email: b.email, password: b.password });
        return get('SELECT id FROM users WHERE email=?', b.email).id;
      }
      return initialiseSalon(b);
    });
    await reindexTenant(tenant);
    return { tenant, uid };
  } catch (e) { deleteTenant(tenant.id); throw e; }
}

r.post('/login', h(async (req, res) => {
  const { email, password, salon } = parse(z.object({ email: z.string().email(), password: z.string().min(1), salon: z.string().optional() }), req.body);
  const key = throttleKey(req, email);
  const f = fails.get(key);
  if (f && f.count >= 8 && Date.now() - f.at < 15 * 60 * 1000) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  // A person can work at more than one salon: check every salon this email belongs to
  const matches = [];
  for (const t of tenantsForEmail(email).filter((x) => !salon || x.slug === salon)) {
    const u = await runInTenant(t, () => get('SELECT * FROM users WHERE email=?', email));
    if (u && verifyPassword(password, u.password_hash)) matches.push({ t, u });
  }
  if (!matches.length) {
    fails.set(key, { count: (f?.count || 0) + 1, at: Date.now() });
    throw new HttpError(401, 'Incorrect email or password');
  }
  if (matches.length > 1) return res.status(300).json({ choose: matches.map(({ t }) => ({ slug: t.slug, name: t.name })) });
  const { t, u } = matches[0];
  if (t.status !== 'active') throw new HttpError(403, 'This salon account is suspended. Contact the platform administrator.');
  if (!u.is_active) throw new HttpError(403, 'This account is disabled');
  fails.delete(key);
  await runInTenant(t, () => { run('UPDATE users SET last_login=? WHERE id=?', localISO(), u.id); audit({ user: u, ip: req.ip }, 'login', 'user', u.id); });
  res.json({ token: signToken({ uid: u.id, tid: t.id }) });
}));

r.get('/me', authenticate, h((req, res) => {
  const s = getSettings();
  res.json({
    user: req.user,
    tenant: { id: currentTenant().id, slug: currentTenant().slug, name: currentTenant().name, plan: currentTenant().plan },
    salon: { name: s.salon.name, logo: s.salon.logo, currency_symbol: s.salon.currency_symbol, tax: s.tax },
    branches: req.user.branch_id ? all('SELECT id,name FROM branches WHERE id=?', req.user.branch_id) : all('SELECT id,name FROM branches WHERE is_active=1 ORDER BY id'),
    aiEnabled: s.ai.enabled,
  });
}));

r.post('/change-password', authenticate, h((req, res) => {
  const b = parse(z.object({ current: z.string(), next: z.string().min(8) }), req.body);
  const u = get('SELECT * FROM users WHERE id=?', req.user.id);
  if (!verifyPassword(b.current, u.password_hash)) throw new HttpError(400, 'Current password is incorrect');
  run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(b.next), u.id);
  audit(req, 'change_password', 'user', u.id);
  res.json({ ok: true });
}));

// ---- user accounts (owner/settings permission) ---------------------------------
const userSchema = z.object({
  name: z.string().trim().min(2), email: z.string().email(), role: z.enum(ROLES),
  password: z.string().min(8).optional().or(z.literal('')), employee_id: z.coerce.number().int().nullable().optional(),
  branch_id: z.coerce.number().int().nullable().optional(), is_active: z.boolean().optional(),
});
r.get('/users', authenticate, requirePerm('settings'), h((_req, res) => {
  res.json(all(`SELECT u.id,u.name,u.email,u.role,u.employee_id,u.branch_id,u.is_active,u.last_login,e.name employee_name,b.name branch_name
    FROM users u LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN branches b ON b.id=u.branch_id ORDER BY u.id`));
}));
r.post('/users', authenticate, requirePerm('settings'), h((req, res) => {
  const b = parse(userSchema, req.body);
  if (!b.password) throw new HttpError(400, 'Password is required (min 8 characters)');
  if (get('SELECT id FROM users WHERE email=?', b.email)) throw new HttpError(409, 'Email already in use');
  if (b.role === 'owner' && req.user.role !== 'owner') throw new HttpError(403, 'Only owners can create owners');
  if (b.role === 'employee' && !b.employee_id) throw new HttpError(400, 'Link the login to an employee profile');
  const id = insert('users', { name: b.name, email: b.email, role: b.role, password_hash: hashPassword(b.password), employee_id: b.employee_id ?? null, branch_id: b.branch_id ?? null });
  indexUser(b.email, currentTenant().id);
  audit(req, 'create', 'user', id, { email: b.email, role: b.role });
  res.json({ id });
}));
r.put('/users/:id', authenticate, requirePerm('settings'), h((req, res) => {
  const id = Number(req.params.id);
  const b = parse(userSchema.partial(), req.body);
  const target = get('SELECT * FROM users WHERE id=?', id);
  if (!target) throw new HttpError(404, 'User not found');
  if ((target.role === 'owner' || b.role === 'owner') && req.user.role !== 'owner') throw new HttpError(403, 'Only owners can modify owner accounts');
  if (id === req.user.id && (b.is_active === false || (b.role && b.role !== target.role))) throw new HttpError(400, "You can't disable or change the role of your own account");
  if (target.role === 'owner' && (b.is_active === false || (b.role && b.role !== 'owner'))) {
    if (get(`SELECT COUNT(*) n FROM users WHERE role='owner' AND is_active=1`).n <= 1) throw new HttpError(400, 'At least one active owner is required');
  }
  const { password, ...rest } = b;
  if (rest.email && rest.email.toLowerCase() !== target.email.toLowerCase()) {
    if (get('SELECT id FROM users WHERE email=? AND id<>?', rest.email, id)) throw new HttpError(409, 'Email already in use');
    unindexUser(target.email, currentTenant().id); indexUser(rest.email, currentTenant().id);
  }
  update('users', id, { ...rest, ...(password ? { password_hash: hashPassword(password) } : {}) });
  audit(req, 'update', 'user', id, { ...rest, password: password ? '(changed)' : undefined });
  res.json({ ok: true });
}));

r.get('/permissions', authenticate, h((_req, res) => {
  res.json(Object.fromEntries(ROLES.map((role) => [role, permissionsFor(role)])));
}));

export default r;
