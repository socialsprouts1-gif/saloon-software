import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, update, run, tx } from '../db.js';
import { requirePerm, selfEmployeeId, can } from '../lib/auth.js';
import { h, parse, HttpError, audit, today, hm, startOfMonth, money, dateRange, daysInMonth } from '../lib/util.js';
import { computeAttendance, computePayroll } from '../lib/hr.js';
import { employeePerformance } from '../lib/analytics.js';
import { resolveBranch } from './appointments.js';

const r = Router();
export const EMP_ROLES = ['owner', 'manager', 'receptionist', 'hair_stylist', 'beautician', 'assistant', 'accountant'];
export const SALARY_TYPES = ['fixed_monthly', 'daily', 'hourly', 'commission', 'fixed_plus_commission'];
const SALARY_FIELDS = ['base_salary', 'daily_rate', 'hourly_rate', 'service_commission_pct', 'product_commission_pct', 'salary_type'];

// ---- employees --------------------------------------------------------------------
const empBase = z.object({
  name: z.string().trim().min(2), photo: z.string().optional().nullable(), phone: z.string().optional().nullable(), email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(), joining_date: z.string().optional().nullable(), designation: z.string().optional().nullable(), department: z.string().optional().nullable(),
  role: z.enum(EMP_ROLES), salary_type: z.enum(SALARY_TYPES), base_salary: z.coerce.number().min(0).default(0), daily_rate: z.coerce.number().min(0).default(0),
  hourly_rate: z.coerce.number().min(0).default(0), service_commission_pct: z.coerce.number().min(0).max(100).default(0), product_commission_pct: z.coerce.number().min(0).max(100).default(0),
  work_start: z.string().regex(/^\d{2}:\d{2}$/), work_end: z.string().regex(/^\d{2}:\d{2}$/), weekly_off: z.coerce.number().int().min(0).max(6).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(), branch_id: z.coerce.number().optional(), service_ids: z.array(z.coerce.number().int()).optional(),
});
const empSchema = empBase.refine((e) => e.work_start < e.work_end, { message: 'Shift start must be before end', path: ['work_start'] });

const stripSalary = (req, e) => (can(req.user, 'payroll') || can(req.user, 'finance') ? e : Object.fromEntries(Object.entries(e).filter(([k]) => !SALARY_FIELDS.includes(k))));

r.get('/employees', requirePerm('employees', 'appointments', 'billing', 'attendance', 'payroll'), h((req, res) => {
  const w = ['1=1'], p = [];
  if (req.branchId) { w.push('e.branch_id=?'); p.push(req.branchId); }
  if (!req.query.include_inactive) w.push(`e.status='active'`);
  if (req.query.q) { w.push('(e.name LIKE ? OR e.phone LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const rows = all(`SELECT e.*, b.name branch_name FROM employees e JOIN branches b ON b.id=e.branch_id WHERE ${w.join(' AND ')} ORDER BY e.status, e.name`, ...p);
  const links = all('SELECT employee_id, service_id FROM employee_services');
  res.json(rows.map((e) => stripSalary(req, { ...e, service_ids: links.filter((l) => l.employee_id === e.id).map((l) => l.service_id) })));
}));

r.get('/employees/:id', requirePerm('employees', 'payroll', 'attendance'), h((req, res) => {
  const id = Number(req.params.id);
  const self = selfEmployeeId(req);
  if (self && self !== id) throw new HttpError(403, 'Not allowed');
  const e = get('SELECT e.*, b.name branch_name FROM employees e JOIN branches b ON b.id=e.branch_id WHERE e.id=?', id);
  if (!e) throw new HttpError(404, 'Employee not found');
  const from = req.query.from || startOfMonth(), to = req.query.to || today();
  e.service_ids = all('SELECT service_id FROM employee_services WHERE employee_id=?', id).map((x) => x.service_id);
  e.services = all('SELECT s.id, s.name FROM employee_services es JOIN services s ON s.id=es.service_id WHERE es.employee_id=?', id);
  e.performance = employeePerformance(e.branch_id, from, to).find((x) => x.id === id) || null;
  e.sales = all(`SELECT i.date, i.invoice_no, ii.name, ii.item_type, ii.qty, ii.total, ii.commission_amount FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
    WHERE ii.employee_id=? AND i.status<>'void' AND i.date BETWEEN ? AND ? ORDER BY i.date DESC, i.id DESC LIMIT 200`, id, from, to);
  e.feedback = all('SELECT f.*, c.name customer FROM feedback f LEFT JOIN customers c ON c.id=f.customer_id WHERE f.employee_id=? ORDER BY f.id DESC LIMIT 30', id);
  e.payroll = can(req.user, 'payroll') ? all('SELECT * FROM payroll WHERE employee_id=? ORDER BY month DESC LIMIT 12', id) : [];
  e.login = get('SELECT id, email, role, is_active FROM users WHERE employee_id=?', id) || null;
  res.json(stripSalary(req, e));
}));

r.post('/employees', requirePerm('employees'), h((req, res) => {
  const { service_ids, ...b } = parse(empSchema, req.body);
  b.branch_id = resolveBranch(req, b.branch_id);
  if (!can(req.user, 'payroll')) for (const f of SALARY_FIELDS) if (f !== 'salary_type') delete b[f];
  const id = tx(() => {
    const eid = insert('employees', { ...b, joining_date: b.joining_date || today() });
    for (const s of service_ids || []) run('INSERT OR IGNORE INTO employee_services (employee_id, service_id) VALUES (?,?)', eid, s);
    return eid;
  });
  audit(req, 'create', 'employee', id, { name: b.name, role: b.role });
  res.json({ id });
}));
r.put('/employees/:id', requirePerm('employees'), h((req, res) => {
  const id = Number(req.params.id);
  const { service_ids, ...b } = parse(empBase.partial(), req.body);
  if (!can(req.user, 'payroll')) for (const f of SALARY_FIELDS) delete b[f];
  tx(() => {
    update('employees', id, b);
    if (service_ids) { run('DELETE FROM employee_services WHERE employee_id=?', id); for (const s of service_ids) run('INSERT INTO employee_services (employee_id, service_id) VALUES (?,?)', id, s); }
    if (b.status === 'inactive') run('UPDATE users SET is_active=0 WHERE employee_id=?', id);
  });
  audit(req, b.status === 'inactive' ? 'deactivate' : 'update', 'employee', id, b);
  res.json({ ok: true });
}));

// ---- attendance ----------------------------------------------------------------------
const ATT_STATUSES = ['present', 'absent', 'half_day', 'leave', 'weekly_off', 'holiday'];

r.get('/attendance', requirePerm('attendance'), h((req, res) => {
  const date = req.query.date || today();
  const self = selfEmployeeId(req);
  const w = [`e.status='active'`], p = [];
  if (req.branchId) { w.push('e.branch_id=?'); p.push(req.branchId); }
  if (self) { w.push('e.id=?'); p.push(self); }
  const emps = all(`SELECT e.id, e.name, e.photo, e.designation, e.work_start, e.work_end, e.weekly_off, e.branch_id FROM employees e WHERE ${w.join(' AND ')} ORDER BY e.name`, ...p);
  const wd = new Date(`${date}T00:00`).getDay();
  res.json(emps.map((e) => {
    const a = get('SELECT * FROM attendance WHERE employee_id=? AND date=?', e.id, date);
    const leave = get(`SELECT leave_type FROM leaves WHERE employee_id=? AND status='approved' AND ? BETWEEN from_date AND to_date`, e.id, date);
    const holiday = get('SELECT name FROM holidays WHERE date=? AND (branch_id IS NULL OR branch_id=?)', date, e.branch_id);
    const expected = holiday ? 'holiday' : leave ? 'leave' : e.weekly_off !== null && Number(e.weekly_off) === wd ? 'weekly_off' : 'working';
    return { ...e, attendance: a || null, expected, holiday: holiday?.name };
  }));
}));

function upsertAttendance(emp, date, data) {
  const calc = computeAttendance(emp, data.check_in, data.check_out, data.status);
  const existing = get('SELECT * FROM attendance WHERE employee_id=? AND date=?', emp.id, date);
  const row = { check_in: data.check_in || null, check_out: data.check_out || null, notes: data.notes ?? existing?.notes ?? null, ...calc };
  if (existing) { update('attendance', existing.id, row); return { id: existing.id, old: existing }; }
  return { id: insert('attendance', { employee_id: emp.id, date, ...row }), old: null };
}

/** Self/kiosk check-in & check-out with the current time. */
r.post('/attendance/punch', requirePerm('attendance'), h((req, res) => {
  const b = parse(z.object({ employee_id: z.coerce.number().int(), action: z.enum(['in', 'out']) }), req.body);
  const self = selfEmployeeId(req);
  if (self && self !== b.employee_id) throw new HttpError(403, 'You can only mark your own attendance');
  const emp = get(`SELECT * FROM employees WHERE id=? AND status='active'`, b.employee_id);
  if (!emp) throw new HttpError(404, 'Employee not found');
  const date = today(), now = hm(new Date());
  const ex = get('SELECT * FROM attendance WHERE employee_id=? AND date=?', emp.id, date);
  if (b.action === 'in') {
    if (ex?.check_in) throw new HttpError(400, `Already checked in at ${ex.check_in}`);
    upsertAttendance(emp, date, { check_in: now, status: 'present' });
  } else {
    if (!ex?.check_in) throw new HttpError(400, 'Check in first');
    if (ex.check_out) throw new HttpError(400, `Already checked out at ${ex.check_out}`);
    upsertAttendance(emp, date, { check_in: ex.check_in, check_out: now, status: 'present' });
  }
  audit(req, `check_${b.action}`, 'attendance', emp.id, { time: now });
  res.json(get('SELECT * FROM attendance WHERE employee_id=? AND date=?', emp.id, date));
}));

/** Manager correction / manual entry. Always writes an audit record with a reason. */
r.put('/attendance', requirePerm('attendance'), h((req, res) => {
  if (req.user.role === 'employee') throw new HttpError(403, 'Only managers can correct attendance');
  const b = parse(z.object({
    employee_id: z.coerce.number().int(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), status: z.enum(ATT_STATUSES),
    check_in: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional().or(z.literal('')), check_out: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional().or(z.literal('')),
    notes: z.string().max(500).optional().nullable(), reason: z.string().trim().min(3, 'A reason is required for manual changes'),
  }), req.body);
  if (b.date > today()) throw new HttpError(400, "Can't mark attendance for a future date");
  if (b.check_in && b.check_out && b.check_out <= b.check_in) throw new HttpError(400, 'Check-out must be after check-in');
  const emp = get('SELECT * FROM employees WHERE id=?', b.employee_id);
  if (!emp) throw new HttpError(404, 'Employee not found');
  const out = tx(() => {
    const { id, old } = upsertAttendance(emp, b.date, b);
    const now = get('SELECT * FROM attendance WHERE id=?', id);
    insert('attendance_audit', { attendance_id: id, employee_id: emp.id, user_id: req.user.id, old_value: old ? JSON.stringify(old) : null, new_value: JSON.stringify(now), reason: b.reason });
    return now;
  });
  audit(req, 'correct', 'attendance', out.id, { employee: emp.name, date: b.date, reason: b.reason });
  res.json(out);
}));

r.get('/attendance/audit', requirePerm('attendance'), h((req, res) => {
  res.json(all(`SELECT aa.*, e.name employee, u.name changed_by FROM attendance_audit aa JOIN employees e ON e.id=aa.employee_id LEFT JOIN users u ON u.id=aa.user_id
    ${req.query.employee_id ? 'WHERE aa.employee_id=?' : ''} ORDER BY aa.id DESC LIMIT 200`, ...(req.query.employee_id ? [Number(req.query.employee_id)] : [])));
}));

/** Monthly attendance register for every employee. */
r.get('/attendance/monthly', requirePerm('attendance'), h((req, res) => {
  const month = req.query.month || today().slice(0, 7);
  const from = `${month}-01`, to = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const self = selfEmployeeId(req);
  const w = [`e.status='active'`], p = [];
  if (req.branchId) { w.push('e.branch_id=?'); p.push(req.branchId); }
  if (self) { w.push('e.id=?'); p.push(self); }
  const emps = all(`SELECT * FROM employees e WHERE ${w.join(' AND ')} ORDER BY name`, ...p);
  res.json({
    month, days: dateRange(from, to),
    employees: emps.map((e) => {
      const p2 = computePayroll(e, month);
      const recs = all('SELECT date, status, check_in, check_out, work_minutes, late_minutes, early_minutes, overtime_minutes FROM attendance WHERE employee_id=? AND date BETWEEN ? AND ?', e.id, from, to);
      return {
        id: e.id, name: e.name, weekly_off: e.weekly_off, records: Object.fromEntries(recs.map((x) => [x.date, x])),
        summary: { present: p2.present_days, absent: p2.absent_days, leave: p2.leave_days, half_days: p2.half_days, weekly_offs: p2.weekly_offs, holidays: p2.holidays, hours: p2.worked_hours, overtime: p2.overtime_hours,
          late_days: recs.filter((x) => x.late_minutes > 0).length, early_days: recs.filter((x) => x.early_minutes > 0).length },
      };
    }),
  });
}));

// ---- leaves & holidays ------------------------------------------------------------------
r.get('/leaves', requirePerm('attendance'), h((req, res) => {
  const self = selfEmployeeId(req);
  const w = ['1=1'], p = [];
  if (self) { w.push('l.employee_id=?'); p.push(self); }
  if (req.branchId) { w.push('e.branch_id=?'); p.push(req.branchId); }
  if (req.query.status) { w.push('l.status=?'); p.push(req.query.status); }
  res.json(all(`SELECT l.*, e.name employee FROM leaves l JOIN employees e ON e.id=l.employee_id WHERE ${w.join(' AND ')} ORDER BY l.from_date DESC LIMIT 200`, ...p));
}));
r.post('/leaves', requirePerm('attendance'), h((req, res) => {
  const b = parse(z.object({ employee_id: z.coerce.number().int(), from_date: z.string(), to_date: z.string(), leave_type: z.enum(['paid', 'unpaid', 'sick', 'casual']), reason: z.string().optional() }), req.body);
  const self = selfEmployeeId(req);
  if (self && self !== b.employee_id) throw new HttpError(403, 'You can only request your own leave');
  if (b.to_date < b.from_date) throw new HttpError(400, 'End date must be after start date');
  if (get(`SELECT 1 FROM leaves WHERE employee_id=? AND status<>'rejected' AND from_date <= ? AND to_date >= ?`, b.employee_id, b.to_date, b.from_date)) throw new HttpError(409, 'Overlaps an existing leave');
  const status = self ? 'pending' : 'approved';
  const id = insert('leaves', { ...b, leave_type: b.leave_type === 'unpaid' ? 'unpaid' : b.leave_type, status, approved_by: status === 'approved' ? req.user.id : null });
  audit(req, 'create', 'leave', id, b);
  res.json({ id, status });
}));
r.post('/leaves/:id/:action', requirePerm('attendance'), h((req, res) => {
  if (req.user.role === 'employee') throw new HttpError(403, 'Only managers can approve leave');
  const action = req.params.action;
  if (!['approve', 'reject', 'cancel'].includes(action)) throw new HttpError(400, 'Invalid action');
  const status = { approve: 'approved', reject: 'rejected', cancel: 'rejected' }[action];
  update('leaves', Number(req.params.id), { status, approved_by: req.user.id });
  audit(req, action, 'leave', Number(req.params.id));
  res.json({ ok: true });
}));
r.get('/holidays', requirePerm('attendance', 'appointments'), h((req, res) => {
  res.json(all(`SELECT h.*, b.name branch_name FROM holidays h LEFT JOIN branches b ON b.id=h.branch_id WHERE h.date >= ? ORDER BY h.date`, req.query.from || `${today().slice(0, 4)}-01-01`));
}));
r.post('/holidays', requirePerm('attendance'), h((req, res) => {
  if (req.user.role === 'employee') throw new HttpError(403, 'Not allowed');
  const b = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(2), branch_id: z.coerce.number().nullable().optional() }), req.body);
  const id = insert('holidays', b); audit(req, 'create', 'holiday', id, b); res.json({ id });
}));
r.delete('/holidays/:id', requirePerm('attendance'), h((req, res) => {
  if (req.user.role === 'employee') throw new HttpError(403, 'Not allowed');
  run('DELETE FROM holidays WHERE id=?', Number(req.params.id)); audit(req, 'delete', 'holiday', Number(req.params.id)); res.json({ ok: true });
}));

// ---- payroll -----------------------------------------------------------------------------
r.get('/payroll', requirePerm('payroll'), h((req, res) => {
  const month = req.query.month || today().slice(0, 7);
  const w = ['p.month=?'], p = [month];
  if (req.branchId) { w.push('e.branch_id=?'); p.push(req.branchId); }
  if (req.query.status) { w.push('p.status=?'); p.push(req.query.status); }
  const rows = all(`SELECT p.*, e.name, e.designation, e.photo, e.branch_id FROM payroll p JOIN employees e ON e.id=p.employee_id WHERE ${w.join(' AND ')} ORDER BY e.name`, ...p);
  const totals = rows.reduce((t, x) => ({ net: t.net + x.net_payable, paid: t.paid + (x.status === 'paid' ? x.net_payable : 0), pending: t.pending + (x.status === 'pending' ? x.net_payable : 0) }), { net: 0, paid: 0, pending: 0 });
  res.json({ month, rows, totals: { net: money(totals.net), paid: money(totals.paid), pending: money(totals.pending) } });
}));

/** (Re)generate payroll for the month. Paid rows are never overwritten; manual adjustments are preserved. */
r.post('/payroll/generate', requirePerm('payroll'), h((req, res) => {
  const b = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), employee_ids: z.array(z.coerce.number()).optional() }), req.body);
  const emps = all(`SELECT * FROM employees WHERE status='active'${req.branchId ? ' AND branch_id=' + Number(req.branchId) : ''}`)
    .filter((e) => !b.employee_ids || b.employee_ids.includes(e.id)).filter((e) => !e.joining_date || e.joining_date <= `${b.month}-31`);
  let generated = 0, skipped = 0;
  tx(() => {
    for (const e of emps) {
      const ex = get('SELECT * FROM payroll WHERE employee_id=? AND month=?', e.id, b.month);
      if (ex?.status === 'paid') { skipped++; continue; }
      const calc = computePayroll(e, b.month, ex || {});
      if (ex) update('payroll', ex.id, calc); else insert('payroll', { ...calc, status: 'pending' });
      generated++;
    }
  });
  audit(req, 'generate', 'payroll', null, { month: b.month, generated });
  res.json({ generated, skipped });
}));

r.put('/payroll/:id', requirePerm('payroll'), h((req, res) => {
  const b = parse(z.object({ incentives: z.coerce.number().min(0), bonus: z.coerce.number().min(0), deductions: z.coerce.number().min(0), notes: z.string().optional().nullable() }).partial(), req.body);
  const row = get('SELECT * FROM payroll WHERE id=?', Number(req.params.id));
  if (!row) throw new HttpError(404, 'Payroll row not found');
  if (row.status === 'paid') throw new HttpError(400, 'Already paid — cannot edit');
  const emp = get('SELECT * FROM employees WHERE id=?', row.employee_id);
  const calc = computePayroll(emp, row.month, { ...row, ...b });
  update('payroll', row.id, { ...calc, notes: b.notes ?? row.notes });
  audit(req, 'adjust', 'payroll', row.id, b);
  res.json(get('SELECT * FROM payroll WHERE id=?', row.id));
}));

r.post('/payroll/:id/pay', requirePerm('payroll'), h((req, res) => {
  const b = parse(z.object({ paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), payment_method: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'other']), notes: z.string().optional() }), req.body);
  const row = get('SELECT p.*, e.name, e.branch_id FROM payroll p JOIN employees e ON e.id=p.employee_id WHERE p.id=?', Number(req.params.id));
  if (!row) throw new HttpError(404, 'Payroll row not found');
  if (row.status === 'paid') throw new HttpError(400, 'Already paid');
  tx(() => {
    update('payroll', row.id, { status: 'paid', paid_at: b.paid_at, payment_method: b.payment_method, notes: b.notes ?? row.notes });
    // Salary payouts flow into expenses so profit reports stay accurate
    insert('expenses', { branch_id: row.branch_id, category: 'Employee salaries', amount: row.net_payable, date: b.paid_at, payment_method: b.payment_method, description: `Salary ${row.month} — ${row.name}`, payroll_id: row.id, created_by: req.user.id });
    run('UPDATE salary_advances SET recovered_month=? WHERE employee_id=? AND recovered_month IS NULL AND date <= ?', row.month, row.employee_id, `${row.month}-31`);
  });
  audit(req, 'pay', 'payroll', row.id, b);
  res.json({ ok: true });
}));

r.get('/advances', requirePerm('payroll'), h((req, res) => {
  res.json(all('SELECT a.*, e.name employee FROM salary_advances a JOIN employees e ON e.id=a.employee_id ORDER BY a.id DESC LIMIT 200'));
}));
r.post('/advances', requirePerm('payroll'), h((req, res) => {
  const b = parse(z.object({ employee_id: z.coerce.number().int(), amount: z.coerce.number().positive(), date: z.string(), note: z.string().optional(), payment_method: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'other']).default('cash') }), req.body);
  const emp = get('SELECT * FROM employees WHERE id=?', b.employee_id);
  if (!emp) throw new HttpError(404, 'Employee not found');
  const id = tx(() => {
    const aid = insert('salary_advances', { employee_id: b.employee_id, amount: b.amount, date: b.date, note: b.note });
    insert('expenses', { branch_id: emp.branch_id, category: 'Employee salaries', amount: b.amount, date: b.date, payment_method: b.payment_method, description: `Salary advance — ${emp.name}`, created_by: req.user.id });
    return aid;
  });
  audit(req, 'create', 'salary_advance', id, b);
  res.json({ id });
}));

export default r;
