import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, update, tx, setSetting, getSettings } from '../db.js';
import { hashPassword, verifyPassword, signToken, authenticate, requirePerm, permissionsFor, ROLES, randomToken } from '../lib/auth.js';
import { h, parse, HttpError, audit, localISO } from '../lib/util.js';

const r = Router();

// naive in-memory login throttling: 8 failures / 15 min per email+ip
const fails = new Map();
const throttleKey = (req, email) => `${req.ip}|${String(email).toLowerCase()}`;

r.get('/setup-status', h((_req, res) => {
  res.json({ needsSetup: !get('SELECT id FROM users LIMIT 1'), salon: getSettings().salon.name });
}));

r.post('/setup', h(async (req, res) => {
  if (get('SELECT id FROM users LIMIT 1')) throw new HttpError(400, 'Setup already completed');
  const b = parse(z.object({
    salonName: z.string().trim().min(2), ownerName: z.string().trim().min(2), email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'), phone: z.string().optional(), address: z.string().optional(),
    demo: z.boolean().optional(),
  }), req.body);
  if (b.demo) {
    const { seedDemo } = await import('../seed.js');
    seedDemo({ salonName: b.salonName, ownerName: b.ownerName, email: b.email, password: b.password });
  } else {
    tx(() => {
      const branchId = insert('branches', { name: 'Main Branch', address: b.address, phone: b.phone, email: b.email });
      insert('users', { name: b.ownerName, email: b.email, password_hash: hashPassword(b.password), role: 'owner' });
      const s = getSettings();
      setSetting('salon', { ...s.salon, name: b.salonName, phone: b.phone || '', address: b.address || '', email: b.email });
      setSetting('booking', { ...s.booking, token: randomToken(9) });
      for (const [i, c] of ['Haircut', 'Hair Styling', 'Hair Colouring', 'Facial', 'Cleanup', 'Waxing', 'Manicure', 'Pedicure', 'Spa', 'Bridal Makeup'].entries())
        insert('service_categories', { name: c, sort: i });
      return branchId;
    });
  }
  const user = get('SELECT * FROM users WHERE email=?', b.email);
  res.json({ token: signToken({ uid: user.id }) });
}));

r.post('/login', h((req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  const key = throttleKey(req, email);
  const f = fails.get(key);
  if (f && f.count >= 8 && Date.now() - f.at < 15 * 60 * 1000) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const user = get('SELECT * FROM users WHERE email=?', email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    fails.set(key, { count: (f?.count || 0) + 1, at: Date.now() });
    throw new HttpError(401, 'Incorrect email or password');
  }
  if (!user.is_active) throw new HttpError(403, 'This account is disabled');
  fails.delete(key);
  run('UPDATE users SET last_login=? WHERE id=?', localISO(), user.id);
  audit({ user, ip: req.ip }, 'login', 'user', user.id);
  res.json({ token: signToken({ uid: user.id }) });
}));

r.get('/me', authenticate, h((req, res) => {
  const s = getSettings();
  res.json({
    user: req.user,
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
  update('users', id, { ...rest, ...(password ? { password_hash: hashPassword(password) } : {}) });
  audit(req, 'update', 'user', id, { ...rest, password: password ? '(changed)' : undefined });
  res.json({ ok: true });
}));

r.get('/permissions', authenticate, h((_req, res) => {
  res.json(Object.fromEntries(ROLES.map((role) => [role, permissionsFor(role)])));
}));

export default r;
