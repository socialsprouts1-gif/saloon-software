import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, update, tx, getSettings } from '../db.js';
import { requirePerm, selfEmployeeId } from '../lib/auth.js';
import { h, parse, HttpError, audit, paginate, notify, addMinutes, today } from '../lib/util.js';
import { computeSlots, createAppointment, appointmentDetail, assertNoOverlap, loadServices, upsertCustomer } from '../lib/scheduling.js';
import { waLink, sendWhatsApp } from '../lib/messaging.js';

const r = Router();
export const STATUSES = ['pending', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'];
const TRANSITIONS = {
  pending: ['confirmed', 'checked_in', 'cancelled', 'no_show'],
  confirmed: ['checked_in', 'in_progress', 'cancelled', 'no_show', 'pending'],
  checked_in: ['in_progress', 'completed', 'cancelled', 'confirmed'],
  in_progress: ['completed', 'checked_in'],
  completed: [], cancelled: ['pending'], no_show: ['pending'],
};

export function resolveBranch(req, bodyBranch) {
  const id = req.user?.branch_id || req.branchId || Number(bodyBranch) || get('SELECT id FROM branches WHERE is_active=1 ORDER BY id LIMIT 1')?.id;
  if (!id || !get('SELECT id FROM branches WHERE id=?', id)) throw new HttpError(400, 'Select a branch');
  return id;
}

function listWhere(req) {
  const w = ['1=1'], p = [];
  if (req.branchId) { w.push('a.branch_id=?'); p.push(req.branchId); }
  const self = selfEmployeeId(req);
  if (self) { w.push('a.employee_id=?'); p.push(self); }
  if (req.query.from) { w.push('substr(a.start_at,1,10) >= ?'); p.push(req.query.from); }
  if (req.query.to) { w.push('substr(a.start_at,1,10) <= ?'); p.push(req.query.to); }
  if (req.query.employee_id) { w.push('a.employee_id=?'); p.push(Number(req.query.employee_id)); }
  if (req.query.customer_id) { w.push('a.customer_id=?'); p.push(Number(req.query.customer_id)); }
  if (req.query.status) { const st = String(req.query.status).split(','); w.push(`a.status IN (${st.map(() => '?').join(',')})`); p.push(...st); }
  if (req.query.source) { const so = String(req.query.source).split(','); w.push(`a.source IN (${so.map(() => '?').join(',')})`); p.push(...so); }
  if (req.query.q) { w.push('(c.name LIKE ? OR c.phone LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  return { where: w.join(' AND '), p };
}
const SELECT = `SELECT a.*, c.name customer_name, c.phone customer_phone, e.name employee_name,
  (SELECT GROUP_CONCAT(s.name, ', ') FROM appointment_services aps JOIN services s ON s.id=aps.service_id WHERE aps.appointment_id=a.id) services
  FROM appointments a JOIN customers c ON c.id=a.customer_id LEFT JOIN employees e ON e.id=a.employee_id`;

r.get('/', requirePerm('appointments', 'booking'), h((req, res) => {
  const { where, p } = listWhere(req);
  if (req.query.all) return res.json(all(`${SELECT} WHERE ${where} ORDER BY a.start_at`, ...p));
  const { limit, offset, page, pageSize } = paginate(req.query);
  const order = req.query.sort === 'created' ? 'a.created_at DESC, a.id DESC' : `a.start_at ${req.query.sort === 'asc' ? 'ASC' : 'DESC'}`;
  res.json({ data: all(`${SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...p, limit, offset), total: get(`SELECT COUNT(*) n FROM appointments a JOIN customers c ON c.id=a.customer_id WHERE ${where}`, ...p).n, page, pageSize });
}));

r.get('/slots', requirePerm('appointments'), h((req, res) => {
  const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), service_ids: z.string().min(1), employee_id: z.coerce.number().optional(), branch_id: z.coerce.number().optional() }), req.query);
  const branchId = resolveBranch(req, q.branch_id);
  res.json(computeSlots({ branchId, date: q.date, serviceIds: q.service_ids.split(',').map(Number), employeeId: q.employee_id || null }));
}));

r.get('/:id', requirePerm('appointments', 'booking'), h((req, res) => {
  const a = appointmentDetail(Number(req.params.id));
  if (!a) throw new HttpError(404, 'Appointment not found');
  const self = selfEmployeeId(req);
  if (self && a.employee_id !== self) throw new HttpError(403, 'Not your appointment');
  res.json(a);
}));

const createSchema = z.object({
  customer_id: z.coerce.number().int().optional(),
  new_customer: z.object({ name: z.string().trim().min(2), phone: z.string().regex(/^\+?\d[\d\s-]{8,14}$/, 'Enter a valid mobile number'), email: z.string().email().optional().or(z.literal('')) }).optional(),
  employee_id: z.coerce.number().int().nullable().optional(),
  service_ids: z.array(z.coerce.number().int()).min(1, 'Select at least one service'),
  start_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Invalid date/time'),
  source: z.enum(['manual', 'walk_in', 'phone', 'online', 'qr']).default('manual'),
  status: z.enum(['pending', 'confirmed', 'checked_in']).default('confirmed'),
  notes: z.string().max(1000).optional().nullable(), branch_id: z.coerce.number().optional(),
});
r.post('/', requirePerm('appointments'), h((req, res) => {
  if (req.user.role === 'employee') throw new HttpError(403, 'Employees cannot create appointments');
  const b = parse(createSchema, req.body);
  const branchId = resolveBranch(req, b.branch_id);
  let customerId = b.customer_id;
  if (!customerId) {
    if (!b.new_customer) throw new HttpError(400, 'Select or add a customer');
    customerId = upsertCustomer({ ...b.new_customer, branchId, source: b.source === 'walk_in' ? 'walk_in' : 'phone' }).id;
  }
  if (!get('SELECT id FROM customers WHERE id=?', customerId)) throw new HttpError(400, 'Customer not found');
  const id = createAppointment({ branchId, customerId, employeeId: b.employee_id || null, serviceIds: b.service_ids, start: b.start_at, source: b.source, status: b.source === 'walk_in' ? 'checked_in' : b.status, notes: b.notes, autoAssign: !b.employee_id && b.source === 'walk_in' });
  audit(req, 'create', 'appointment', id, { start: b.start_at, employee: b.employee_id });
  res.json(appointmentDetail(id));
}));

r.put('/:id', requirePerm('appointments'), h((req, res) => {
  if (req.user.role === 'employee') throw new HttpError(403, 'Employees cannot reschedule appointments');
  const id = Number(req.params.id);
  const b = parse(createSchema.partial().pick({ employee_id: true, service_ids: true, start_at: true, notes: true }), req.body);
  const result = tx(() => {
    const a = get('SELECT * FROM appointments WHERE id=?', id);
    if (!a) throw new HttpError(404, 'Appointment not found');
    if (['completed', 'cancelled', 'no_show'].includes(a.status)) throw new HttpError(400, `Cannot edit a ${a.status.replace('_', ' ')} appointment`);
    const serviceIds = b.service_ids || all('SELECT service_id FROM appointment_services WHERE appointment_id=?', id).map((x) => x.service_id);
    const services = loadServices(serviceIds);
    const start = b.start_at || a.start_at;
    const end = addMinutes(start, services.reduce((s, x) => s + x.duration_min, 0));
    const employeeId = b.employee_id === undefined ? a.employee_id : b.employee_id;
    assertNoOverlap(employeeId, start, end, id);
    update('appointments', id, { start_at: start, end_at: end, employee_id: employeeId, notes: b.notes ?? a.notes, total_price: services.reduce((s, x) => s + x.price, 0) });
    if (b.service_ids) {
      run('DELETE FROM appointment_services WHERE appointment_id=?', id);
      for (const sv of services) run('INSERT INTO appointment_services (appointment_id,service_id,price,duration_min) VALUES (?,?,?,?)', id, sv.id, sv.price, sv.duration_min);
    }
    return { rescheduled: start !== a.start_at };
  });
  audit(req, result.rescheduled ? 'reschedule' : 'update', 'appointment', id, b);
  res.json(appointmentDetail(id));
}));

r.post('/:id/status', requirePerm('appointments'), h(async (req, res) => {
  const id = Number(req.params.id);
  const b = parse(z.object({ status: z.enum(STATUSES), reason: z.string().max(500).optional() }), req.body);
  const a = get('SELECT * FROM appointments WHERE id=?', id);
  if (!a) throw new HttpError(404, 'Appointment not found');
  const self = selfEmployeeId(req);
  if (self && (a.employee_id !== self || !['checked_in', 'in_progress', 'completed'].includes(b.status))) throw new HttpError(403, 'Not allowed');
  if (!TRANSITIONS[a.status].includes(b.status)) throw new HttpError(400, `Can't move from ${a.status.replace('_', ' ')} to ${b.status.replace('_', ' ')}`);
  if (b.status === 'pending' && ['cancelled', 'no_show'].includes(a.status)) assertNoOverlap(a.employee_id, a.start_at, a.end_at, id);
  update('appointments', id, { status: b.status, cancel_reason: b.status === 'cancelled' ? b.reason || null : undefined });
  audit(req, 'status', 'appointment', id, { from: a.status, to: b.status, reason: b.reason });
  const d = appointmentDetail(id);
  let whatsapp = null;
  const salon = getSettings().salon.name;
  if (b.status === 'confirmed') {
    const msg = `Hi ${d.customer_name}, your appointment at ${salon} is confirmed for ${fmtWhen(d.start_at)}${d.employee_name ? ` with ${d.employee_name}` : ''}. Services: ${d.services.map((s) => s.name).join(', ')}.`;
    whatsapp = getSettings().whatsapp.send_booking_confirmation ? await sendWhatsApp(d.customer_phone, msg) : { sent: false, link: waLink(d.customer_phone, msg) };
  }
  if (b.status === 'cancelled') {
    if (getSettings().notifications.cancellations) notify({ type: 'cancellation', title: `Cancelled: ${d.customer_name}`, message: `${fmtWhen(d.start_at)}${b.reason ? ` — ${b.reason}` : ''}`, link: `/appointments?id=${id}`, branchId: d.branch_id });
    whatsapp = { sent: false, link: waLink(d.customer_phone, `Hi ${d.customer_name}, your appointment at ${salon} on ${fmtWhen(d.start_at)} has been cancelled.`) };
  }
  res.json({ ...d, whatsapp });
}));

export const fmtWhen = (s) => {
  const d = new Date(`${s}:00`);
  return `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
};

// ---- QR / online booking management ---------------------------------------------------
export const bookingRouter = Router();
bookingRouter.get('/stats', requirePerm('booking'), h((req, res) => {
  const from = req.query.from || '0000-01-01', to = req.query.to || '9999-12-31';
  const c = (type) => get(`SELECT COUNT(*) n FROM booking_events WHERE type=? AND substr(created_at,1,10) BETWEEN ? AND ?`, type, from, to).n;
  const bf = req.branchId ? ` AND branch_id=${Number(req.branchId)}` : '';
  const bookings = get(`SELECT COUNT(*) n, SUM(status IN ('confirmed','checked_in','in_progress','completed')) confirmed, SUM(status='completed') completed, SUM(status='cancelled') cancelled, SUM(status='pending') pending
    FROM appointments WHERE source IN ('online','qr') AND substr(created_at,1,10) BETWEEN ? AND ?${bf}`, from, to);
  const scans = c('scan'), visits = c('visit');
  const daily = all(`SELECT substr(created_at,1,10) d, SUM(type='scan') scans, SUM(type='visit') visits, SUM(type='booking') bookings FROM booking_events
    WHERE substr(created_at,1,10) >= ? GROUP BY d ORDER BY d`, req.query.from || today().slice(0, 8) + '01');
  res.json({ scans, visits, bookings: bookings.n || 0, confirmed: bookings.confirmed || 0, completed: bookings.completed || 0, cancelled: bookings.cancelled || 0, pending: bookings.pending || 0,
    conversion_rate: visits ? Math.round(((bookings.n || 0) / visits) * 1000) / 10 : 0, daily });
}));

export default r;
