// Platform owner panel: manage every salon on the platform.
import { Router } from 'express';
import { z } from 'zod';
import { pall, pget, prun, nowStamp, runInTenant, get, DEMO_MODE } from '../db.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../lib/auth.js';
import { h, parse, HttpError, audit, localISO, startOfMonth, today } from '../lib/util.js';
import { listTenants, tenantById, updateTenant, deleteTenant } from '../platform.js';
import { createSalon } from './auth.js';

const r = Router();

r.get('/status', h((_req, res) => {
  res.json({ hasAdmin: !!pget('SELECT id FROM platform_admins LIMIT 1'), demo: DEMO_MODE });
}));

/** First visit: create the platform owner account. */
r.post('/setup', h((req, res) => {
  if (pget('SELECT id FROM platform_admins LIMIT 1')) throw new HttpError(400, 'Platform already set up — sign in instead');
  const b = parse(z.object({ name: z.string().trim().min(2), email: z.string().email(), password: z.string().min(8, 'Password must be at least 8 characters') }), req.body);
  const id = Number(prun('INSERT INTO platform_admins (name,email,password_hash,created_at) VALUES (?,?,?,?)', b.name, b.email, hashPassword(b.password), nowStamp()).lastInsertRowid);
  res.json({ token: signToken({ pid: id }) });
}));

const fails = new Map();
r.post('/login', h((req, res) => {
  const b = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  const key = `${req.ip}|${b.email.toLowerCase()}`, f = fails.get(key);
  if (f && f.count >= 8 && Date.now() - f.at < 15 * 60 * 1000) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const a = pget('SELECT * FROM platform_admins WHERE email=?', b.email);
  if (!a || !verifyPassword(b.password, a.password_hash)) { fails.set(key, { count: (f?.count || 0) + 1, at: Date.now() }); throw new HttpError(401, 'Incorrect email or password'); }
  fails.delete(key);
  prun('UPDATE platform_admins SET last_login=? WHERE id=?', localISO(), a.id);
  res.json({ token: signToken({ pid: a.id }) });
}));

// Everything below needs a platform-admin token
r.use((req, _res, next) => {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const p = verifyToken(t);
  const admin = p?.pid && pget('SELECT id,name,email FROM platform_admins WHERE id=?', p.pid);
  if (!admin) return next(new HttpError(401, 'Please sign in to the platform panel'));
  req.admin = admin;
  next();
});

r.get('/me', (req, res) => res.json({ admin: req.admin }));

/** Live figures for one salon, read from its own database. */
function salonStats(t) {
  try {
    return runInTenant(t, () => {
      const m = startOfMonth(), d = today();
      return {
        users: get('SELECT COUNT(*) n FROM users WHERE is_active=1').n,
        staff: get(`SELECT COUNT(*) n FROM employees WHERE status='active'`).n,
        branches: get('SELECT COUNT(*) n FROM branches WHERE is_active=1').n,
        customers: get('SELECT COUNT(*) n FROM customers').n,
        appointments_month: get('SELECT COUNT(*) n FROM appointments WHERE substr(start_at,1,10) BETWEEN ? AND ?', m, d).n,
        invoices_month: get(`SELECT COUNT(*) n FROM invoices WHERE status<>'void' AND date BETWEEN ? AND ?`, m, d).n,
        revenue_month: get(`SELECT COALESCE(SUM(total),0) v FROM invoices WHERE status<>'void' AND date BETWEEN ? AND ?`, m, d).v,
        loyalty_cards: get(`SELECT COUNT(*) n FROM loyalty_cards WHERE status='active'`).n,
        last_activity: get('SELECT MAX(created_at) v FROM audit_logs').v,
      };
    });
  } catch (e) { return { error: e.message }; }
}

r.get('/salons', h((_req, res) => {
  const salons = listTenants().map((t) => ({ ...t, db_url: undefined, hosted: !!t.db_url, stats: salonStats(t) }));
  const totals = salons.reduce((a, s) => ({
    salons: a.salons + 1, active: a.active + (s.status === 'active' ? 1 : 0),
    revenue_month: a.revenue_month + (s.stats.revenue_month || 0), customers: a.customers + (s.stats.customers || 0),
    appointments_month: a.appointments_month + (s.stats.appointments_month || 0),
  }), { salons: 0, active: 0, revenue_month: 0, customers: 0, appointments_month: 0 });
  res.json({ salons, totals });
}));

const createSchema = z.object({
  salonName: z.string().trim().min(2).max(80), slug: z.string().trim().max(40).optional(), ownerName: z.string().trim().min(2), email: z.string().email(),
  password: z.string().min(8), phone: z.string().optional(), city: z.string().optional(), address: z.string().optional(),
  plan: z.enum(['trial', 'basic', 'pro', 'enterprise']).default('trial'), demo: z.boolean().optional(),
});
r.post('/salons', h(async (req, res) => {
  const b = parse(createSchema, req.body);
  const { tenant } = await createSalon(b, { plan: b.plan });
  res.json({ id: tenant.id, slug: tenant.slug });
}));

r.put('/salons/:id', h((req, res) => {
  const t = tenantById(req.params.id);
  if (!t) throw new HttpError(404, 'Salon not found');
  const b = parse(z.object({ name: z.string().trim().min(2).optional(), status: z.enum(['active', 'suspended']).optional(), plan: z.enum(['trial', 'basic', 'pro', 'enterprise', 'active']).optional(), notes: z.string().max(2000).optional().nullable(), city: z.string().optional().nullable(), phone: z.string().optional().nullable() }), req.body);
  updateTenant(t.id, b);
  res.json({ ok: true });
}));

r.delete('/salons/:id', h((req, res) => {
  const t = tenantById(req.params.id);
  if (!t) throw new HttpError(404, 'Salon not found');
  if (req.body?.confirm !== t.slug) throw new HttpError(400, `Type the salon ID "${t.slug}" to confirm`);
  deleteTenant(t.id);
  res.json({ ok: true });
}));

/** Support access: open a salon's admin panel as its owner (recorded in the salon's audit log). */
r.post('/salons/:id/open', h((req, res) => {
  const t = tenantById(req.params.id);
  if (!t) throw new HttpError(404, 'Salon not found');
  const token = runInTenant(t, () => {
    const owner = get(`SELECT * FROM users WHERE role='owner' AND is_active=1 ORDER BY id LIMIT 1`);
    if (!owner) throw new HttpError(400, 'This salon has no active owner');
    audit({ user: { id: owner.id, name: `${req.admin.name} (platform support)` }, ip: req.ip }, 'support_access', 'salon', t.id);
    return signToken({ uid: owner.id, tid: t.id, imp: req.admin.id });
  });
  res.json({ token, slug: t.slug });
}));

r.get('/admins', h((_req, res) => res.json(pall('SELECT id,name,email,last_login,created_at FROM platform_admins ORDER BY id'))));
r.post('/admins', h((req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2), email: z.string().email(), password: z.string().min(8) }), req.body);
  if (pget('SELECT id FROM platform_admins WHERE email=?', b.email)) throw new HttpError(409, 'Email already in use');
  prun('INSERT INTO platform_admins (name,email,password_hash,created_at) VALUES (?,?,?,?)', b.name, b.email, hashPassword(b.password), nowStamp());
  res.json({ ok: true });
}));

export default r;
