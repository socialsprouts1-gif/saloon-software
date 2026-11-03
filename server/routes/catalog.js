import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, update, run, tx } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { h, parse, HttpError, audit, money } from '../lib/util.js';

const r = Router();
const canEdit = requirePerm('services');

// ---- categories ------------------------------------------------------------------
r.get('/categories', h((_req, res) => res.json(all(`SELECT c.*, (SELECT COUNT(*) FROM services s WHERE s.category_id=c.id) services FROM service_categories c ORDER BY sort, name`))));
r.post('/categories', canEdit, h((req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2) }), req.body);
  if (get('SELECT id FROM service_categories WHERE name=?', b.name)) throw new HttpError(409, 'Category already exists');
  const id = insert('service_categories', { name: b.name, sort: (get('SELECT MAX(sort) m FROM service_categories').m || 0) + 1 });
  audit(req, 'create', 'category', id, b); res.json({ id });
}));
r.put('/categories/:id', canEdit, h((req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2) }), req.body);
  update('service_categories', Number(req.params.id), b); audit(req, 'update', 'category', Number(req.params.id), b); res.json({ ok: true });
}));
r.delete('/categories/:id', canEdit, h((req, res) => {
  if (get('SELECT id FROM services WHERE category_id=? LIMIT 1', Number(req.params.id))) throw new HttpError(400, 'Move or delete the services in this category first');
  run('DELETE FROM service_categories WHERE id=?', Number(req.params.id)); audit(req, 'delete', 'category', Number(req.params.id)); res.json({ ok: true });
}));

// ---- services --------------------------------------------------------------------
const svcSchema = z.object({
  name: z.string().trim().min(2), category_id: z.coerce.number().int().nullable().optional(), description: z.string().max(1000).optional().nullable(),
  price: z.coerce.number().min(0), duration_min: z.coerce.number().int().min(5).max(600), commission_pct: z.coerce.number().min(0).max(100).nullable().optional(),
  image: z.string().optional().nullable(), is_active: z.boolean().optional(), online_bookable: z.boolean().optional(),
  employee_ids: z.array(z.coerce.number().int()).optional(),
});
r.get('/services', h((req, res) => {
  const w = ['1=1'], p = [];
  if (req.query.active) w.push('s.is_active=1');
  if (req.query.category_id) { w.push('s.category_id=?'); p.push(Number(req.query.category_id)); }
  if (req.query.q) { w.push('s.name LIKE ?'); p.push(`%${req.query.q}%`); }
  const rows = all(`SELECT s.*, c.name category FROM services s LEFT JOIN service_categories c ON c.id=s.category_id WHERE ${w.join(' AND ')} ORDER BY c.sort, c.name, s.name`, ...p);
  const links = all('SELECT es.service_id, e.id, e.name, e.branch_id FROM employee_services es JOIN employees e ON e.id=es.employee_id WHERE e.status=\'active\'');
  res.json(rows.map((s) => ({ ...s, employees: links.filter((l) => l.service_id === s.id).map(({ id, name, branch_id }) => ({ id, name, branch_id })) })));
}));
function setServiceEmployees(serviceId, ids) {
  run('DELETE FROM employee_services WHERE service_id=?', serviceId);
  for (const e of ids) run('INSERT OR IGNORE INTO employee_services (employee_id, service_id) VALUES (?,?)', e, serviceId);
}
r.post('/services', canEdit, h((req, res) => {
  const { employee_ids, ...b } = parse(svcSchema, req.body);
  const id = tx(() => { const sid = insert('services', b); if (employee_ids) setServiceEmployees(sid, employee_ids); return sid; });
  audit(req, 'create', 'service', id, b); res.json({ id });
}));
r.put('/services/:id', canEdit, h((req, res) => {
  const id = Number(req.params.id);
  const { employee_ids, ...b } = parse(svcSchema.partial(), req.body);
  tx(() => { update('services', id, b); if (employee_ids) setServiceEmployees(id, employee_ids); });
  audit(req, 'update', 'service', id, b); res.json({ ok: true });
}));
r.delete('/services/:id', canEdit, h((req, res) => {
  const id = Number(req.params.id);
  const used = get('SELECT 1 FROM appointment_services WHERE service_id=? LIMIT 1', id) || get(`SELECT 1 FROM invoice_items WHERE item_type='service' AND ref_id=? LIMIT 1`, id) || get('SELECT 1 FROM package_items WHERE service_id=? LIMIT 1', id);
  if (used) { update('services', id, { is_active: 0 }); audit(req, 'deactivate', 'service', id); return res.json({ ok: true, archived: true }); }
  run('DELETE FROM services WHERE id=?', id); audit(req, 'delete', 'service', id); res.json({ ok: true });
}));

// ---- packages & memberships ----------------------------------------------------------
const pkgSchema = z.object({
  name: z.string().trim().min(2), type: z.enum(['monthly', 'quarterly', 'annual', 'prepaid', 'custom']), description: z.string().optional().nullable(),
  price: z.coerce.number().min(0), validity_days: z.coerce.number().int().min(1).max(3650), discount_pct: z.coerce.number().min(0).max(100).default(0),
  online_purchasable: z.boolean().optional(), is_active: z.boolean().optional(),
  items: z.array(z.object({ service_id: z.coerce.number().int(), credits: z.coerce.number().int().min(1) })).default([]),
});
r.get('/packages', h((req, res) => {
  const rows = all(`SELECT p.*, (SELECT COUNT(*) FROM customer_packages cp WHERE cp.package_id=p.id) sold,
    (SELECT COUNT(*) FROM customer_packages cp WHERE cp.package_id=p.id AND cp.status='active') active_members,
    (SELECT COALESCE(SUM(price),0) FROM customer_packages cp WHERE cp.package_id=p.id AND cp.status<>'cancelled') revenue
    FROM packages p ${req.query.active ? 'WHERE p.is_active=1' : ''} ORDER BY p.is_active DESC, p.name`);
  res.json(rows.map((p) => ({ ...p, items: all('SELECT pi.service_id, pi.credits, s.name FROM package_items pi JOIN services s ON s.id=pi.service_id WHERE pi.package_id=?', p.id) })));
}));
r.get('/packages/sales', requirePerm('packages'), h((req, res) => {
  const w = req.query.status ? 'WHERE cp.status=?' : '';
  res.json(all(`SELECT cp.*, c.name customer, c.phone, p.name package, p.type,
    (SELECT SUM(total) FROM customer_package_credits WHERE customer_package_id=cp.id) credits_total,
    (SELECT SUM(used) FROM customer_package_credits WHERE customer_package_id=cp.id) credits_used
    FROM customer_packages cp JOIN customers c ON c.id=cp.customer_id JOIN packages p ON p.id=cp.package_id ${w} ORDER BY cp.id DESC LIMIT 300`, ...(req.query.status ? [req.query.status] : [])));
}));
const savePkg = (id, items) => { run('DELETE FROM package_items WHERE package_id=?', id); for (const i of items) insert('package_items', { package_id: id, ...i }); };
r.post('/packages', requirePerm('packages'), h((req, res) => {
  const { items, ...b } = parse(pkgSchema, req.body);
  const id = tx(() => { const pid = insert('packages', b); savePkg(pid, items); return pid; });
  audit(req, 'create', 'package', id, b); res.json({ id });
}));
r.put('/packages/:id', requirePerm('packages'), h((req, res) => {
  const id = Number(req.params.id);
  const { items, ...b } = parse(pkgSchema.partial(), req.body);
  tx(() => { update('packages', id, b); if (items) savePkg(id, items); });
  audit(req, 'update', 'package', id, b); res.json({ ok: true });
}));
r.post('/customer-packages/:id/renew', requirePerm('packages'), h((req, res) => {
  // Renewal is done by selling the package again through POS; this endpoint extends validity (e.g. goodwill)
  const b = parse(z.object({ days: z.coerce.number().int().min(1).max(3650), reason: z.string().min(2) }), req.body);
  const cp = get('SELECT * FROM customer_packages WHERE id=?', Number(req.params.id));
  if (!cp) throw new HttpError(404, 'Not found');
  const base = cp.expires_at > new Date().toISOString().slice(0, 10) ? cp.expires_at : new Date().toISOString().slice(0, 10);
  const d = new Date(base); d.setDate(d.getDate() + b.days);
  update('customer_packages', cp.id, { expires_at: d.toISOString().slice(0, 10), status: cp.status === 'expired' ? 'active' : cp.status });
  audit(req, 'extend', 'customer_package', cp.id, b); res.json({ ok: true });
}));

// ---- coupons -----------------------------------------------------------------------
const couponBase = z.object({
  code: z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, - and _ only'), description: z.string().optional().nullable(),
  discount_type: z.enum(['percent', 'fixed']), value: z.coerce.number().positive(),
  applies_to: z.enum(['all', 'services', 'products', 'service', 'product']).default('all'),
  service_id: z.coerce.number().int().nullable().optional(), product_id: z.coerce.number().int().nullable().optional(),
  min_invoice: z.coerce.number().min(0).default(0), max_discount: z.coerce.number().positive().nullable().optional(),
  valid_from: z.string().nullable().optional(), valid_to: z.string().nullable().optional(),
  usage_limit: z.coerce.number().int().positive().nullable().optional(), per_customer_limit: z.coerce.number().int().positive().nullable().optional(),
  customer_id: z.coerce.number().int().nullable().optional(), is_active: z.boolean().optional(),
});
const couponSchema = couponBase.refine((c) => c.discount_type !== 'percent' || c.value <= 100, { message: 'Percentage cannot exceed 100', path: ['value'] });
r.get('/coupons', requirePerm('coupons', 'billing'), h((_req, res) => {
  res.json(all(`SELECT co.*, c.name customer_name, s.name service_name, p.name product_name,
    (SELECT COALESCE(SUM(discount),0) FROM coupon_usages u WHERE u.coupon_id=co.id) discount_given,
    (SELECT COALESCE(SUM(invoice_total),0) FROM coupon_usages u WHERE u.coupon_id=co.id) revenue_generated
    FROM coupons co LEFT JOIN customers c ON c.id=co.customer_id LEFT JOIN services s ON s.id=co.service_id LEFT JOIN products p ON p.id=co.product_id ORDER BY co.id DESC`)
    .map((c) => ({ ...c, discount_given: money(c.discount_given), revenue_generated: money(c.revenue_generated) })));
}));
r.get('/coupons/:id/usages', requirePerm('coupons'), h((req, res) => {
  res.json(all(`SELECT u.*, i.invoice_no, c.name customer FROM coupon_usages u JOIN invoices i ON i.id=u.invoice_id LEFT JOIN customers c ON c.id=u.customer_id WHERE coupon_id=? ORDER BY u.id DESC`, Number(req.params.id)));
}));
r.post('/coupons', requirePerm('coupons'), h((req, res) => {
  const b = parse(couponSchema, req.body);
  if (get('SELECT id FROM coupons WHERE code=?', b.code)) throw new HttpError(409, 'Coupon code already exists');
  const id = insert('coupons', { ...b, code: b.code.toUpperCase() });
  audit(req, 'create', 'coupon', id, b); res.json({ id });
}));
r.put('/coupons/:id', requirePerm('coupons'), h((req, res) => {
  const b = parse(couponBase.partial(), req.body);
  if (b.code) b.code = b.code.toUpperCase();
  update('coupons', Number(req.params.id), b);
  audit(req, 'update', 'coupon', Number(req.params.id), b); res.json({ ok: true });
}));

export default r;
