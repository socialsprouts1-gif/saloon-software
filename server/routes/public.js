import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { all, get, insert, getSettings } from '../db.js';
import { h, parse, HttpError, notify, today, addDays, audit } from '../lib/util.js';
import { computeSlots, createAppointment, appointmentDetail, upsertCustomer } from '../lib/scheduling.js';
import { createInvoice, invoiceDetail } from '../lib/billing.js';
import { sendWhatsApp, waLink } from '../lib/messaging.js';
import { fmtWhen } from './appointments.js';

const r = Router();

// Small per-IP rate limiter for public write endpoints
const hits = new Map();
function limit(max, windowMs) {
  return (req, _res, next) => {
    const k = `${req.path}|${req.ip}`, now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return next(new HttpError(429, 'Too many requests, please wait a few minutes.'));
    arr.push(now); hits.set(k, arr); next();
  };
}

function bookingConfig(token) {
  const s = getSettings();
  if (!s.booking.token || token !== s.booking.token) throw new HttpError(404, 'This booking link is not valid.');
  if (!s.booking.active) throw new HttpError(410, 'Online booking is currently paused. Please call the salon.');
  return s;
}
const branchOk = (id) => { const b = get('SELECT * FROM branches WHERE id=? AND is_active=1', id); if (!b) throw new HttpError(400, 'Choose a branch'); return b; };

r.get('/book/:token', h((req, res) => {
  const s = bookingConfig(req.params.token);
  const services = all(`SELECT s.id, s.name, s.description, s.price, s.duration_min, s.image, s.category_id, c.name category FROM services s
    LEFT JOIN service_categories c ON c.id=s.category_id WHERE s.is_active=1 AND s.online_bookable=1 ORDER BY c.sort, c.name, s.name`);
  const employees = all(`SELECT e.id, e.name, e.photo, e.designation, e.branch_id FROM employees e WHERE e.status='active'
    AND EXISTS (SELECT 1 FROM employee_services es WHERE es.employee_id=e.id) ORDER BY e.name`)
    .map((e) => ({ ...e, services: all('SELECT service_id FROM employee_services WHERE employee_id=?', e.id).map((x) => x.service_id),
      rating: get('SELECT ROUND(AVG(rating),1) r FROM feedback WHERE employee_id=?', e.id).r }));
  const packages = s.booking.allow_packages ? all(`SELECT id,name,type,description,price,validity_days,discount_pct FROM packages WHERE is_active=1 AND online_purchasable=1`)
    .map((p) => ({ ...p, items: all('SELECT pi.credits, s.name FROM package_items pi JOIN services s ON s.id=pi.service_id WHERE pi.package_id=?', p.id) })) : [];
  res.json({
    salon: { name: s.salon.name, tagline: s.salon.tagline, logo: s.salon.logo, address: s.salon.address, phone: s.salon.phone, email: s.salon.email, currency_symbol: s.salon.currency_symbol },
    booking: { theme_color: s.booking.theme_color, welcome: s.booking.welcome, show_prices: s.booking.show_prices, max_advance_days: s.appointments.max_advance_days, allow_any_stylist: s.appointments.allow_any_stylist },
    opening_hours: s.opening_hours,
    today: today(), // salon-local date, so visitors in other time zones see the right days
    branches: all('SELECT id,name,address,phone FROM branches WHERE is_active=1 ORDER BY id'),
    services, employees, packages,
  });
}));

r.post('/book/:token/track', limit(60, 60000), h((req, res) => {
  bookingConfig(req.params.token);
  const type = req.body?.type === 'scan' ? 'scan' : 'visit';
  const visitor = crypto.createHash('sha256').update(`${req.ip}|${req.headers['user-agent']}|${today()}`).digest('hex').slice(0, 16);
  // count each visitor once per day per type
  if (!get(`SELECT 1 FROM booking_events WHERE type=? AND visitor=? AND substr(created_at,1,10)=?`, type, visitor, today()))
    insert('booking_events', { type, token: req.params.token, visitor });
  res.json({ ok: true });
}));

const slotQuery = z.object({ branch_id: z.coerce.number(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), service_ids: z.string().min(1), employee_id: z.coerce.number().optional() });
function checkDate(s, date) {
  if (date < today()) throw new HttpError(400, 'Please choose a future date');
  if (date > addDays(today(), s.appointments.max_advance_days || 30)) throw new HttpError(400, `Bookings open up to ${s.appointments.max_advance_days} days ahead`);
}
r.get('/book/:token/slots', h((req, res) => {
  const s = bookingConfig(req.params.token);
  const q = parse(slotQuery, req.query);
  branchOk(q.branch_id); checkDate(s, q.date);
  const ids = q.service_ids.split(',').map(Number);
  if (all(`SELECT id FROM services WHERE is_active=1 AND online_bookable=1 AND id IN (${ids.map(() => '?').join(',')})`, ...ids).length !== ids.length) throw new HttpError(400, 'Service unavailable online');
  const out = computeSlots({ branchId: q.branch_id, date: q.date, serviceIds: ids, employeeId: q.employee_id || null });
  res.json({ ...out, slots: out.slots.map((x) => ({ time: x.time, available: x.employees.length })) });
}));

const bookSchema = z.object({
  branch_id: z.coerce.number(), service_ids: z.array(z.coerce.number().int()).min(1).max(6),
  employee_id: z.coerce.number().int().nullable().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/),
  name: z.string().trim().min(2, 'Please enter your name').max(80), phone: z.string().trim().regex(/^\+?\d[\d\s-]{8,14}$/, 'Enter a valid mobile number'),
  email: z.string().email().optional().or(z.literal('')), notes: z.string().max(500).optional(), via: z.enum(['qr', 'online']).default('online'),
});
r.post('/book/:token/appointments', limit(8, 10 * 60000), h(async (req, res) => {
  const s = bookingConfig(req.params.token);
  const b = parse(bookSchema, req.body);
  branchOk(b.branch_id); checkDate(s, b.date);
  if (!b.employee_id && !s.appointments.allow_any_stylist) throw new HttpError(400, 'Please choose a stylist');
  // Slot must be one the engine offers (enforces hours, shifts, leave, notice)
  const avail = computeSlots({ branchId: b.branch_id, date: b.date, serviceIds: b.service_ids, employeeId: b.employee_id || null });
  const slot = avail.slots.find((x) => x.time === b.time);
  if (!slot) throw new HttpError(409, 'Sorry, that time was just taken. Please pick another slot.');
  const cust = upsertCustomer({ name: b.name, phone: b.phone, email: b.email, branchId: b.branch_id, source: b.via });
  const id = createAppointment({
    branchId: b.branch_id, customerId: cust.id, employeeId: b.employee_id || null, serviceIds: b.service_ids, start: `${b.date}T${b.time}`,
    source: b.via, status: s.appointments.auto_confirm_online ? 'confirmed' : 'pending', notes: b.notes, autoAssign: !b.employee_id,
  });
  insert('booking_events', { type: 'booking', token: req.params.token, appointment_id: id });
  const d = appointmentDetail(id);
  audit({ ip: req.ip }, 'online_booking', 'appointment', id, { via: b.via });
  if (s.notifications.new_booking) notify({ type: 'booking', title: `New ${b.via === 'qr' ? 'QR' : 'online'} booking: ${d.customer_name}`, message: `${fmtWhen(d.start_at)} · ${d.services.map((x) => x.name).join(', ')}${d.employee_name ? ` · ${d.employee_name}` : ''}`, link: `/appointments?id=${id}`, branchId: b.branch_id });
  const msg = `Hi ${d.customer_name}, thanks for booking at ${s.salon.name}! ${d.status === 'confirmed' ? 'Your appointment is confirmed' : 'We have received your request'} for ${fmtWhen(d.start_at)}${d.employee_name ? ` with ${d.employee_name}` : ''}. Booking ref #${id}.`;
  const wa = s.whatsapp.send_booking_confirmation ? await sendWhatsApp(d.customer_phone, msg) : { sent: false };
  res.json({
    id, status: d.status, start_at: d.start_at, end_at: d.end_at, employee: d.employee_name, services: d.services, total: d.total_price,
    branch: d.branch_name, confirmation_sent: wa.sent, salon_whatsapp: s.salon.phone ? waLink(s.salon.phone, `Hi, I just booked appointment #${id} for ${fmtWhen(d.start_at)}.`) : null,
  });
}));

r.post('/book/:token/packages', limit(5, 10 * 60000), h((req, res) => {
  const s = bookingConfig(req.params.token);
  if (!s.booking.allow_packages) throw new HttpError(400, 'Packages are not available online');
  const b = parse(z.object({ package_id: z.coerce.number(), branch_id: z.coerce.number(), name: z.string().trim().min(2), phone: z.string().trim().regex(/^\+?\d[\d\s-]{8,14}$/, 'Enter a valid mobile number') }), req.body);
  branchOk(b.branch_id);
  const pk = get('SELECT * FROM packages WHERE id=? AND is_active=1 AND online_purchasable=1', b.package_id);
  if (!pk) throw new HttpError(404, 'Package not available');
  const cust = upsertCustomer({ name: b.name, phone: b.phone, branchId: b.branch_id, source: 'online' });
  const invId = createInvoice({ branchId: b.branch_id, customerId: cust.id, items: [{ type: 'package', ref_id: pk.id, qty: 1 }], payments: [], source: 'online', notes: 'Online package request — collect payment at salon' }, null);
  const inv = get('SELECT invoice_no,total,public_token FROM invoices WHERE id=?', invId);
  notify({ type: 'booking', title: `Package request: ${pk.name}`, message: `${b.name} (${b.phone}) — invoice ${inv.invoice_no} awaiting payment`, link: `/invoices/${invId}`, branchId: b.branch_id });
  res.json({ invoice_no: inv.invoice_no, total: inv.total, invoice_url: `/i/${inv.public_token}` });
}));

// Public, unguessable-token invoice view for sharing via WhatsApp
r.get('/invoice/:token', h((req, res) => {
  const inv = invoiceDetail('public_token', String(req.params.token));
  if (!inv) throw new HttpError(404, 'Invoice not found');
  const s = getSettings();
  const { created_by, created_by_name, loyalty_points, ...safe } = inv;
  res.json({ invoice: safe, salon: { ...s.salon }, tax: s.tax, invoice_settings: s.invoice });
}));

export default r;
