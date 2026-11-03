import { all, get, getSettings } from '../db.js';
import { toMin, money, daysInMonth, dateRange, today, parseDate } from './util.js';

/**
 * Derive worked/late/early/overtime minutes and full vs half day from check-in/out.
 * Times are 'HH:MM'. Status 'present' may become 'half_day' if worked time is short.
 */
export function computeAttendance(emp, checkIn, checkOut, status = 'present') {
  const s = getSettings().attendance;
  const out = { work_minutes: 0, late_minutes: 0, early_minutes: 0, overtime_minutes: 0, status };
  if (!['present', 'half_day'].includes(status) || !checkIn) return out;
  const shift = Math.max(0, toMin(emp.work_end) - toMin(emp.work_start));
  const inM = toMin(checkIn);
  const late = inM - toMin(emp.work_start);
  out.late_minutes = late > (s.grace_min || 0) ? late : 0;
  if (checkOut) {
    const outM = toMin(checkOut);
    out.work_minutes = Math.max(0, outM - inM);
    const early = toMin(emp.work_end) - outM;
    out.early_minutes = early > 0 ? early : 0;
    out.overtime_minutes = Math.max(0, out.work_minutes - shift);
    if (status === 'present' && shift && out.work_minutes < shift * (s.half_day_ratio ?? 0.5)) out.status = 'half_day';
  }
  return out;
}

/** Full payroll computation for one employee and month ('YYYY-MM'). Pure read; caller persists. */
export function computePayroll(emp, month, extras = {}) {
  const settings = getSettings().attendance;
  const dim = daysInMonth(month);
  const from = `${month}-01`, to = `${month}-${String(dim).padStart(2, '0')}`;
  const lastCountable = to < today() ? to : today(); // don't mark future days absent
  const joined = emp.joining_date && emp.joining_date > from ? emp.joining_date : from;

  const att = new Map(all('SELECT * FROM attendance WHERE employee_id=? AND date BETWEEN ? AND ?', emp.id, from, to).map((a) => [a.date, a]));
  const holidays = new Set(all('SELECT date FROM holidays WHERE date BETWEEN ? AND ? AND (branch_id IS NULL OR branch_id=?)', from, to, emp.branch_id).map((h) => h.date));
  const leaves = all(`SELECT * FROM leaves WHERE employee_id=? AND status='approved' AND to_date >= ? AND from_date <= ?`, emp.id, from, to);
  const leaveOn = (d) => leaves.find((l) => d >= l.from_date && d <= l.to_date);

  let present = 0, half = 0, paidLeave = 0, unpaidLeave = 0, absent = 0, weeklyOffs = 0, hol = 0, workMin = 0, otMin = 0;
  for (const d of dateRange(from, to)) {
    const a = att.get(d);
    const isOff = emp.weekly_off !== null && emp.weekly_off !== undefined && parseDate(d).getDay() === Number(emp.weekly_off);
    if (a) {
      workMin += a.work_minutes; otMin += a.overtime_minutes;
      if (a.status === 'present') present++;
      else if (a.status === 'half_day') half++;
      else if (a.status === 'leave') (leaveOn(d)?.leave_type === 'unpaid' ? unpaidLeave++ : paidLeave++);
      else if (a.status === 'weekly_off') weeklyOffs++;
      else if (a.status === 'holiday') hol++;
      else if (a.status === 'absent' && d >= joined) absent++;
      continue;
    }
    if (holidays.has(d)) { hol++; continue; }
    if (isOff) { weeklyOffs++; continue; }
    const lv = leaveOn(d);
    if (lv) { lv.leave_type === 'unpaid' ? unpaidLeave++ : paidLeave++; continue; }
    if (d <= lastCountable && d >= joined) absent++;
  }
  const effectivePresent = present + half * 0.5;
  const workingDays = dim - weeklyOffs - hol;
  const unpaidDays = absent + unpaidLeave + half * 0.5;

  let base = 0, earned = 0, otPay = 0;
  const shiftHours = Math.max(1, (toMin(emp.work_end) - toMin(emp.work_start)) / 60);
  switch (emp.salary_type) {
    case 'daily': base = emp.daily_rate * workingDays; earned = emp.daily_rate * (effectivePresent + paidLeave); otPay = (emp.daily_rate / shiftHours) * (otMin / 60); break;
    case 'hourly': base = 0; earned = emp.hourly_rate * ((workMin - otMin) / 60); otPay = emp.hourly_rate * (otMin / 60); break;
    case 'commission': base = 0; earned = 0; break;
    case 'fixed_monthly': case 'fixed_plus_commission': default: {
      base = emp.base_salary;
      const perDay = emp.base_salary / dim;
      // Pro-rate for mid-month joiners
      const preJoin = joined > from ? Math.round((parseDate(joined) - parseDate(from)) / 86400000) : 0;
      earned = Math.max(0, emp.base_salary - perDay * (unpaidDays + preJoin));
      otPay = (perDay / shiftHours) * (otMin / 60);
    }
  }
  otPay *= settings.overtime_rate ?? 1;

  const comm = get(`SELECT COALESCE(SUM(CASE WHEN ii.item_type='service' THEN ii.commission_amount END),0) svc,
    COALESCE(SUM(CASE WHEN ii.item_type='product' THEN ii.commission_amount END),0) prod
    FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE ii.employee_id=? AND i.status<>'void' AND i.date BETWEEN ? AND ?`, emp.id, from, to);
  const advance = get(`SELECT COALESCE(SUM(amount),0) a FROM salary_advances WHERE employee_id=? AND (recovered_month IS NULL OR recovered_month=?) AND date <= ?`, emp.id, month, to).a;

  const incentives = Number(extras.incentives) || 0, bonus = Number(extras.bonus) || 0, deductions = Number(extras.deductions) || 0;
  const net = earned + otPay + comm.svc + comm.prod + incentives + bonus - deductions - advance;
  return {
    employee_id: emp.id, month, salary_type: emp.salary_type, days_in_month: dim, working_days: workingDays,
    present_days: effectivePresent, absent_days: absent + unpaidLeave, leave_days: paidLeave + unpaidLeave, half_days: half,
    weekly_offs: weeklyOffs, holidays: hol, worked_hours: money(workMin / 60), overtime_hours: money(otMin / 60),
    base_salary: money(base), earned_base: money(earned), overtime_pay: money(otPay),
    service_commission: money(comm.svc), product_commission: money(comm.prod),
    incentives: money(incentives), bonus: money(bonus), deductions: money(deductions), advance: money(advance),
    net_payable: money(Math.max(0, net)),
  };
}
