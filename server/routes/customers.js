import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, update, getSettings } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { h, parse, HttpError, audit, paginate, today, addDays } from '../lib/util.js';
import { segmentOf } from '../lib/analytics.js';
import { resolveBranch } from './appointments.js';

const r = Router();
r.use(requirePerm('customers', 'billing', 'appointments'));

const STATS = `(SELECT COUNT(*) FROM invoices i WHERE i.customer_id=c.id AND i.status<>'void') visits,
  (SELECT COALESCE(SUM(total),0) FROM invoices i WHERE i.customer_id=c.id AND i.status<>'void') spent,
  (SELECT MAX(date) FROM invoices i WHERE i.customer_id=c.id AND i.status<>'void') last_visit,
  (SELECT COALESCE(SUM(balance),0) FROM invoices i WHERE i.customer_id=c.id AND i.status IN ('unpaid','partial')) due`;

r.get('/', h((req, res) => {
  const { limit, offset, page, pageSize } = paginate(req.query);
  const w = ['1=1'], p = [];
  if (req.query.q) { w.push('(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)'); p.push(...Array(3).fill(`%${req.query.q}%`)); }
  const crm = getSettings().crm;
  // Segment filter needs computed stats; compute in a subquery
  const base = `SELECT c.*, e.name preferred_employee, ${STATS} FROM customers c LEFT JOIN employees e ON e.id=c.preferred_employee_id WHERE ${w.join(' AND ')}`;
  const segWhere = {
    vip: `spent >= ${Number(crm.vip_spend)} OR visits >= ${Number(crm.vip_visits)}`,
    inactive: `NOT (spent >= ${Number(crm.vip_spend)} OR visits >= ${Number(crm.vip_visits)}) AND ((last_visit IS NOT NULL AND last_visit < '${addDays(today(), -crm.inactive_days)}') OR (visits=0 AND substr(created_at,1,10) < '${addDays(today(), -crm.inactive_days)}'))`,
    regular: `NOT (spent >= ${Number(crm.vip_spend)} OR visits >= ${Number(crm.vip_visits)}) AND visits >= ${Number(crm.regular_visits)} AND (last_visit >= '${addDays(today(), -crm.inactive_days)}')`,
    new: `visits < ${Number(crm.regular_visits)} AND NOT (spent >= ${Number(crm.vip_spend)}) AND ((last_visit IS NULL AND substr(created_at,1,10) >= '${addDays(today(), -crm.inactive_days)}') OR last_visit >= '${addDays(today(), -crm.inactive_days)}')`,
    due: 'due > 0',
    birthday: `birthday IS NOT NULL AND substr(birthday,6,2)='${today().slice(5, 7)}'`,
  }[req.query.segment] || '1=1';
  const sorts = { recent: 'id DESC', name: 'name ASC', spent: 'spent DESC', visits: 'visits DESC', last_visit: 'last_visit DESC' };
  const rows = all(`SELECT * FROM (${base}) WHERE ${segWhere} ORDER BY ${sorts[req.query.sort] || 'id DESC'} LIMIT ? OFFSET ?`, ...p, limit, offset);
  const total = get(`SELECT COUNT(*) n FROM (${base}) WHERE ${segWhere}`, ...p).n;
  res.json({ data: rows.map((c) => ({ ...c, segment: segmentOf(c, crm) })), total, page, pageSize });
}));

r.get('/segments', h((_req, res) => {
  const crm = getSettings().crm;
  const rows = all(`SELECT c.id, c.created_at, ${STATS} FROM customers c`);
  const counts = { new: 0, regular: 0, vip: 0, inactive: 0 };
  for (const c of rows) counts[segmentOf(c, crm)]++;
  res.json({ ...counts, total: rows.length });
}));

r.get('/search', h((req, res) => {
  const q = `%${req.query.q || ''}%`;
  res.json(all(`SELECT id,name,phone,email,loyalty_points FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 15`, q, q));
}));

r.get('/:id', h((req, res) => {
  const id = Number(req.params.id);
  const c = get(`SELECT c.*, e.name preferred_employee, ${STATS} FROM customers c LEFT JOIN employees e ON e.id=c.preferred_employee_id WHERE c.id=?`, id);
  if (!c) throw new HttpError(404, 'Customer not found');
  c.segment = segmentOf(c);
  const finance = req.user.permissions.includes('finance') || req.user.permissions.includes('billing');
  c.invoices = finance ? all(`SELECT id, invoice_no, date, total, paid_amount, balance, status FROM invoices WHERE customer_id=? ORDER BY id DESC LIMIT 50`, id) : [];
  c.appointments = all(`SELECT a.id, a.start_at, a.status, a.source, e.name employee,
    (SELECT GROUP_CONCAT(s.name, ', ') FROM appointment_services aps JOIN services s ON s.id=aps.service_id WHERE aps.appointment_id=a.id) services
    FROM appointments a LEFT JOIN employees e ON e.id=a.employee_id WHERE a.customer_id=? ORDER BY a.start_at DESC LIMIT 50`, id);
  c.upcoming = c.appointments.filter((a) => a.start_at >= `${today()}T00:00` && ['pending', 'confirmed'].includes(a.status)).at(-1) || null;
  c.services_purchased = all(`SELECT ii.name, SUM(ii.qty) count, MAX(i.date) last FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
    WHERE i.customer_id=? AND i.status<>'void' AND ii.item_type='service' GROUP BY ii.ref_id ORDER BY count DESC`, id);
  c.top_stylist = get(`SELECT e.id, e.name, COUNT(*) n FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id JOIN employees e ON e.id=ii.employee_id
    WHERE i.customer_id=? AND i.status<>'void' GROUP BY e.id ORDER BY n DESC LIMIT 1`, id) || null;
  c.packages = all(`SELECT cp.*, p.name package_name, p.type, p.discount_pct FROM customer_packages cp JOIN packages p ON p.id=cp.package_id WHERE cp.customer_id=? ORDER BY cp.id DESC`, id)
    .map((cp) => ({ ...cp, credits: all(`SELECT cpc.*, s.name service FROM customer_package_credits cpc JOIN services s ON s.id=cpc.service_id WHERE customer_package_id=?`, cp.id) }));
  c.feedback = all(`SELECT f.*, e.name employee FROM feedback f LEFT JOIN employees e ON e.id=f.employee_id WHERE f.customer_id=? ORDER BY f.id DESC`, id);
  c.avg_rating = c.feedback.length ? Math.round((c.feedback.reduce((a, f) => a + f.rating, 0) / c.feedback.length) * 10) / 10 : null;
  if (!finance) { delete c.spent; delete c.due; }
  res.json(c);
}));

/** Active package credits usable in POS. */
r.get('/:id/credits', h((req, res) => {
  res.json(all(`SELECT cpc.id, cpc.service_id, cpc.total, cpc.used, s.name service, p.name package, cp.expires_at FROM customer_package_credits cpc
    JOIN customer_packages cp ON cp.id=cpc.customer_package_id JOIN packages p ON p.id=cp.package_id JOIN services s ON s.id=cpc.service_id
    WHERE cp.customer_id=? AND cp.status='active' AND cp.expires_at >= ? AND cpc.used < cpc.total`, Number(req.params.id), today()));
}));

const schema = z.object({
  name: z.string().trim().min(2), phone: z.string().trim().regex(/^\+?\d[\d\s-]{8,14}$/, 'Enter a valid mobile number'),
  email: z.string().email().optional().nullable().or(z.literal('')), birthday: z.string().optional().nullable(), gender: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(), preferred_employee_id: z.coerce.number().int().nullable().optional(), source: z.string().optional(),
  branch_id: z.coerce.number().optional(),
});
r.post('/', h((req, res) => {
  const b = parse(schema, req.body);
  b.phone = b.phone.replace(/[^\d+]/g, '');
  const dupe = get('SELECT id FROM customers WHERE phone=?', b.phone);
  if (dupe) throw new HttpError(409, 'A customer with this mobile number already exists', { id: dupe.id });
  const id = insert('customers', { ...b, branch_id: resolveBranch(req, b.branch_id), source: b.source || 'walk_in' });
  audit(req, 'create', 'customer', id, { name: b.name });
  res.json({ id });
}));
r.put('/:id', h((req, res) => {
  const id = Number(req.params.id);
  const b = parse(schema.partial(), req.body);
  if (b.phone) {
    b.phone = b.phone.replace(/[^\d+]/g, '');
    const dupe = get('SELECT id FROM customers WHERE phone=? AND id<>?', b.phone, id);
    if (dupe) throw new HttpError(409, 'Another customer already uses this mobile number');
  }
  update('customers', id, b);
  audit(req, 'update', 'customer', id, b);
  res.json({ ok: true });
}));
r.post('/:id/points', requirePerm('customers'), h((req, res) => {
  const b = parse(z.object({ delta: z.coerce.number().int(), reason: z.string().min(2) }), req.body);
  const c = get('SELECT loyalty_points FROM customers WHERE id=?', Number(req.params.id));
  if (!c) throw new HttpError(404, 'Customer not found');
  if (c.loyalty_points + b.delta < 0) throw new HttpError(400, 'Points cannot go below zero');
  update('customers', Number(req.params.id), { loyalty_points: c.loyalty_points + b.delta });
  audit(req, 'adjust_points', 'customer', Number(req.params.id), b);
  res.json({ ok: true });
}));
r.post('/:id/feedback', h((req, res) => {
  const b = parse(z.object({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().max(1000).optional(), employee_id: z.coerce.number().int().nullable().optional(), appointment_id: z.coerce.number().int().nullable().optional() }), req.body);
  const id = insert('feedback', { ...b, customer_id: Number(req.params.id) });
  audit(req, 'create', 'feedback', id, b);
  res.json({ id });
}));

export default r;
