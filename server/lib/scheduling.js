import { all, get, insert, run, tx, getSettings } from '../db.js';
import { HttpError, addMinutes, parseDate, parseDT, toMin, fromMin, localISO, today } from './util.js';

export const ACTIVE_APPT = `status NOT IN ('cancelled','no_show')`;

export function loadServices(serviceIds) {
  if (!serviceIds?.length) throw new HttpError(400, 'Select at least one service');
  const rows = all(`SELECT * FROM services WHERE id IN (${serviceIds.map(() => '?').join(',')})`, ...serviceIds);
  if (rows.length !== new Set(serviceIds).size) throw new HttpError(400, 'One or more services not found');
  return serviceIds.map((id) => rows.find((r) => r.id === id));
}

/** Employees in the branch who are assigned every requested service. */
export function eligibleEmployees(branchId, serviceIds) {
  const emps = all(`SELECT * FROM employees WHERE branch_id=? AND status='active'`, branchId);
  if (!serviceIds?.length) return emps;
  return emps.filter((e) => {
    const ids = new Set(all('SELECT service_id FROM employee_services WHERE employee_id=?', e.id).map((r) => r.service_id));
    return serviceIds.every((s) => ids.has(s));
  });
}

/** Returns a reason string if the employee is off duty on the date, else null. */
export function offDutyReason(emp, date) {
  const wd = parseDate(date).getDay();
  if (emp.weekly_off !== null && emp.weekly_off !== undefined && Number(emp.weekly_off) === wd) return 'weekly off';
  const leave = get(`SELECT id FROM leaves WHERE employee_id=? AND status='approved' AND ? BETWEEN from_date AND to_date`, emp.id, date);
  if (leave) return 'on leave';
  return null;
}

export function isHoliday(branchId, date) {
  return get('SELECT name FROM holidays WHERE date=? AND (branch_id IS NULL OR branch_id=?)', date, branchId);
}

export function findOverlap(employeeId, start, end, excludeId = null) {
  return get(
    `SELECT a.id, a.start_at, a.end_at, c.name AS customer FROM appointments a JOIN customers c ON c.id=a.customer_id
     WHERE a.employee_id=? AND ${ACTIVE_APPT.replace(/status/g, 'a.status')} AND a.start_at < ? AND a.end_at > ? ${excludeId ? 'AND a.id<>?' : ''} LIMIT 1`,
    ...[employeeId, end, start, ...(excludeId ? [excludeId] : [])],
  );
}

export function assertNoOverlap(employeeId, start, end, excludeId) {
  if (!employeeId) return;
  const o = findOverlap(employeeId, start, end, excludeId);
  if (o) throw new HttpError(409, `This stylist is already booked ${o.start_at.slice(11)}–${o.end_at.slice(11)} (${o.customer}). Pick another time or stylist.`);
}

/**
 * Available slots for a date. Respects opening hours, holidays, employee shifts,
 * weekly offs, approved leave, existing bookings and minimum notice.
 */
export function computeSlots({ branchId, date, serviceIds, employeeId = null }) {
  const s = getSettings();
  const services = loadServices(serviceIds);
  const duration = services.reduce((a, x) => a + x.duration_min, 0) + (s.appointments.buffer_min || 0);
  const hours = s.opening_hours[parseDate(date).getDay()];
  if (!hours || hours.closed) return { duration, slots: [], closed: 'Closed on this day' };
  const holiday = isHoliday(branchId, date);
  if (holiday) return { duration, slots: [], closed: `Holiday: ${holiday.name}` };

  let emps = eligibleEmployees(branchId, serviceIds);
  if (employeeId) emps = emps.filter((e) => e.id === employeeId);
  emps = emps.filter((e) => !offDutyReason(e, date));

  const booked = new Map(emps.map((e) => [e.id, all(
    `SELECT start_at,end_at FROM appointments WHERE employee_id=? AND ${ACTIVE_APPT} AND start_at < ? AND end_at > ?`,
    e.id, `${date}T23:59`, `${date}T00:00`)]));

  const interval = s.appointments.slot_interval || 15;
  const nowCutoff = date === today() ? toMin(localISO().slice(11)) + (s.appointments.min_notice_min || 0) : -1;
  const open = toMin(hours.open), close = toMin(hours.close);
  const slots = [];
  for (let m = open; m + duration <= close; m += interval) {
    if (m < nowCutoff) continue;
    const start = `${date}T${fromMin(m)}`, end = `${date}T${fromMin(m + duration)}`;
    const free = emps.filter((e) =>
      m >= toMin(e.work_start) && m + duration <= toMin(e.work_end) &&
      !booked.get(e.id).some((b) => b.start_at < end && b.end_at > start));
    if (free.length) slots.push({ time: fromMin(m), employees: free.map((e) => e.id) });
  }
  return { duration, slots, closed: null };
}

/**
 * Create an appointment atomically. Throws 409 on any overlap for the employee.
 * If employeeId is null and autoAssign is set, picks the free eligible employee with fewest bookings that day.
 */
export function createAppointment({ branchId, customerId, employeeId, serviceIds, start, source = 'manual', status = 'pending', notes, autoAssign = false }) {
  return tx(() => {
    const services = loadServices(serviceIds);
    const duration = services.reduce((a, x) => a + x.duration_min, 0);
    const end = addMinutes(start, duration);
    const date = start.slice(0, 10);
    if (!employeeId && autoAssign) {
      const candidates = eligibleEmployees(branchId, serviceIds).filter((e) =>
        !offDutyReason(e, date) && toMin(start.slice(11)) >= toMin(e.work_start) && toMin(end.slice(11)) <= toMin(e.work_end) && !findOverlap(e.id, start, end));
      if (!candidates.length) throw new HttpError(409, 'No stylist is free at this time. Please choose another slot.');
      candidates.sort((a, b) => countDay(a.id, date) - countDay(b.id, date));
      employeeId = candidates[0].id;
    }
    if (employeeId) {
      const emp = get('SELECT * FROM employees WHERE id=?', employeeId);
      if (!emp || emp.status !== 'active') throw new HttpError(400, 'Stylist not available');
      if (emp.branch_id !== branchId) throw new HttpError(400, 'Stylist belongs to another branch');
    }
    assertNoOverlap(employeeId, start, end);
    const total = services.reduce((a, x) => a + x.price, 0);
    const id = insert('appointments', { branch_id: branchId, customer_id: customerId, employee_id: employeeId || null, start_at: start, end_at: end, status, source, notes, total_price: total });
    for (const sv of services) insert('appointment_services', { appointment_id: id, service_id: sv.id, price: sv.price, duration_min: sv.duration_min });
    return id;
  });
}
const countDay = (empId, date) => get(`SELECT COUNT(*) n FROM appointments WHERE employee_id=? AND ${ACTIVE_APPT} AND substr(start_at,1,10)=?`, empId, date).n;

export function appointmentDetail(id) {
  const a = get(`SELECT a.*, c.name customer_name, c.phone customer_phone, e.name employee_name, b.name branch_name
    FROM appointments a JOIN customers c ON c.id=a.customer_id LEFT JOIN employees e ON e.id=a.employee_id
    LEFT JOIN branches b ON b.id=a.branch_id WHERE a.id=?`, id);
  if (!a) return null;
  a.services = all(`SELECT s.id, s.name, aps.price, aps.duration_min FROM appointment_services aps JOIN services s ON s.id=aps.service_id WHERE aps.appointment_id=?`, id);
  return a;
}

/** Find or create a customer by phone (used by booking + POS). */
export function upsertCustomer({ name, phone, email, branchId, source }) {
  const clean = String(phone).replace(/[^\d+]/g, '');
  const existing = get('SELECT * FROM customers WHERE phone=?', clean);
  if (existing) {
    if (email && !existing.email) run('UPDATE customers SET email=? WHERE id=?', email, existing.id);
    return { id: existing.id, isNew: false };
  }
  return { id: insert('customers', { name: name.trim(), phone: clean, email: email || null, branch_id: branchId, source }), isNew: true };
}

export { parseDT };
