import { Router } from 'express';
import { z } from 'zod';
import { all, get, getSettings, currentTenant } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { h, parse, HttpError, audit, paginate, money, today, addDays } from '../lib/util.js';
import { priceCart, createInvoice, addPayment, voidInvoice, invoiceDetail, PAYMENT_METHODS } from '../lib/billing.js';
import { waLink } from '../lib/messaging.js';
import { resolveBranch } from './appointments.js';

const r = Router();
r.use(requirePerm('billing'));

const itemSchema = z.object({
  type: z.enum(['service', 'product', 'package']), ref_id: z.coerce.number().int(), qty: z.coerce.number().positive().max(999).default(1),
  unit_price: z.coerce.number().min(0).optional(), discount: z.coerce.number().min(0).default(0),
  employee_id: z.coerce.number().int().nullable().optional(), use_credit_id: z.coerce.number().int().nullable().optional(),
  use_reward_card_id: z.coerce.number().int().nullable().optional(),
});
const cartSchema = z.object({
  customer_id: z.coerce.number().int().nullable().optional(), appointment_id: z.coerce.number().int().nullable().optional(),
  items: z.array(itemSchema).min(1, 'Add at least one item'),
  discount: z.object({ type: z.enum(['amount', 'percent']), value: z.coerce.number().min(0) }).optional().nullable(),
  coupon_code: z.string().trim().optional().nullable().or(z.literal('')), redeem_points: z.coerce.number().int().min(0).optional(),
  tax_enabled: z.boolean().optional(), notes: z.string().max(1000).optional().nullable(), branch_id: z.coerce.number().optional(),
  payments: z.array(z.object({ amount: z.coerce.number().min(0), method: z.enum(PAYMENT_METHODS), reference: z.string().optional().nullable() })).default([]),
});
const toInput = (req, b) => ({
  branchId: resolveBranch(req, b.branch_id), customerId: b.customer_id || null, appointmentId: b.appointment_id || null, items: b.items,
  discount: b.discount, couponCode: b.coupon_code || null, redeemPoints: b.redeem_points || 0, taxEnabled: b.tax_enabled, payments: b.payments, notes: b.notes,
});

r.post('/preview', h((req, res) => {
  const b = parse(cartSchema, req.body);
  const p = priceCart(toInput(req, b));
  res.json({ ...p, coupon: p.coupon ? { code: p.coupon.code, description: p.coupon.description } : null });
}));

r.post('/', h((req, res) => {
  const b = parse(cartSchema, req.body);
  if (b.appointment_id) {
    const a = get('SELECT * FROM appointments WHERE id=?', b.appointment_id);
    if (!a) throw new HttpError(404, 'Appointment not found');
    if (a.invoice_id) throw new HttpError(409, 'This appointment is already billed');
    if (b.customer_id && a.customer_id !== b.customer_id) throw new HttpError(400, 'Customer does not match the appointment');
  }
  const id = createInvoice(toInput(req, b), req.user);
  const inv = invoiceDetail('id', id);
  audit(req, 'create', 'invoice', id, { no: inv.invoice_no, total: inv.total, paid: inv.paid_amount });
  res.json(withShare(req, inv));
}));

function withShare(req, inv) {
  const s = getSettings();
  const url = `${req.protocol}://${req.get('host')}/s/${currentTenant().slug}/i/${inv.public_token}`;
  const text = `Hi ${inv.customer_name || ''}, thank you for visiting ${s.salon.name}! Invoice ${inv.invoice_no}: ${s.salon.currency_symbol}${inv.total.toLocaleString('en-IN')}${inv.balance > 0 ? ` (balance due ${s.salon.currency_symbol}${inv.balance.toLocaleString('en-IN')})` : ''}. View: ${url}`;
  return { ...inv, share_url: url, whatsapp_url: inv.customer_phone ? waLink(inv.customer_phone, text) : `https://wa.me/?text=${encodeURIComponent(text)}` };
}

r.get('/', h((req, res) => {
  const { limit, offset, page, pageSize } = paginate(req.query);
  const w = ['1=1'], p = [];
  if (req.branchId) { w.push('i.branch_id=?'); p.push(req.branchId); }
  if (req.query.status === 'due') w.push(`i.status IN ('unpaid','partial')`);
  else if (req.query.status) { w.push('i.status=?'); p.push(req.query.status); }
  if (req.query.from) { w.push('i.date >= ?'); p.push(req.query.from); }
  if (req.query.to) { w.push('i.date <= ?'); p.push(req.query.to); }
  if (req.query.customer_id) { w.push('i.customer_id=?'); p.push(Number(req.query.customer_id)); }
  if (req.query.q) { w.push('(i.invoice_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)'); p.push(...Array(3).fill(`%${req.query.q}%`)); }
  const where = w.join(' AND ');
  const base = `FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE ${where}`;
  const sums = get(`SELECT COALESCE(SUM(CASE WHEN i.status<>'void' THEN i.total END),0) total, COALESCE(SUM(i.paid_amount),0) paid, COALESCE(SUM(i.balance),0) balance ${base}`, ...p);
  res.json({
    data: all(`SELECT i.id, i.invoice_no, i.date, i.total, i.paid_amount, i.balance, i.status, i.source, i.created_at, c.name customer_name, c.phone customer_phone,
      (SELECT GROUP_CONCAT(DISTINCT method) FROM payments WHERE invoice_id=i.id) methods ${base} ORDER BY i.id DESC LIMIT ? OFFSET ?`, ...p, limit, offset),
    total: get(`SELECT COUNT(*) n ${base}`, ...p).n, page, pageSize, sums: { total: money(sums.total), paid: money(sums.paid), balance: money(sums.balance) },
  });
}));

r.get('/:id', h((req, res) => {
  const inv = invoiceDetail('id', Number(req.params.id));
  if (!inv) throw new HttpError(404, 'Invoice not found');
  if (req.branchId && inv.branch_id !== req.branchId) throw new HttpError(403, 'Invoice belongs to another branch');
  res.json(withShare(req, inv));
}));

r.post('/:id/payments', h((req, res) => {
  const b = parse(z.object({ amount: z.coerce.number().positive(), method: z.enum(PAYMENT_METHODS), reference: z.string().optional().nullable() }), req.body);
  addPayment(Number(req.params.id), b, req.user);
  audit(req, 'payment', 'invoice', Number(req.params.id), b);
  res.json(withShare(req, invoiceDetail('id', Number(req.params.id))));
}));

r.post('/:id/void', h((req, res) => {
  if (!['owner', 'manager', 'accountant'].includes(req.user.role)) throw new HttpError(403, 'Only owner/manager/accountant can void invoices');
  const b = parse(z.object({ reason: z.string().trim().min(3, 'Give a reason') }), req.body);
  voidInvoice(Number(req.params.id), b.reason, req.user);
  audit(req, 'void', 'invoice', Number(req.params.id), b);
  res.json({ ok: true });
}));

/** Unbilled appointments ready for checkout. */
r.get('/meta/billable-appointments', h((req, res) => {
  res.json(all(`SELECT a.id, a.start_at, a.status, a.customer_id, a.employee_id, c.name customer_name, c.phone customer_phone, e.name employee_name
    FROM appointments a JOIN customers c ON c.id=a.customer_id LEFT JOIN employees e ON e.id=a.employee_id
    WHERE a.invoice_id IS NULL AND a.status IN ('confirmed','checked_in','in_progress','completed') AND substr(a.start_at,1,10) >= '${addDays(today(), -2)}'
    ${req.branchId ? 'AND a.branch_id=' + Number(req.branchId) : ''} ORDER BY a.start_at LIMIT 50`)
    .map((a) => ({ ...a, services: all('SELECT service_id, price FROM appointment_services WHERE appointment_id=?', a.id) })));
}));

export default r;
