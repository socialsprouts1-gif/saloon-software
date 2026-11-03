import { all, get, insert, run, getSettings } from '../db.js';
import { today, addDays, addMinutes, localISO, toMin, notify, money } from './util.js';
import { offDutyReason, isHoliday } from './scheduling.js';

function advance(date, rec) {
  if (rec === 'weekly') return addDays(date, 7);
  if (rec === 'yearly') return `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
  const [y, m, d] = date.split('-').map(Number); // monthly, clamp day to month length
  const nm = m === 12 ? 1 : m + 1, ny = m === 12 ? y + 1 : y;
  const last = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Post recurring expenses whose next due date has arrived. */
export function runRecurringExpenses() {
  const t = today();
  for (const e of all(`SELECT * FROM expenses WHERE is_recurring=1 AND next_due IS NOT NULL AND next_due <= ?`, t)) {
    let due = e.next_due, guard = 0;
    while (due <= t && guard++ < 36) {
      insert('expenses', { branch_id: e.branch_id, category: e.category, amount: e.amount, date: due, payment_method: e.payment_method, description: `${e.description || e.category} (recurring)`, recurring_parent_id: e.id });
      due = advance(due, e.recurrence);
    }
    run('UPDATE expenses SET next_due=? WHERE id=?', due, e.id);
  }
}
export { advance as nextRecurrence };

export function runNotificationJobs() {
  const n = getSettings().notifications;
  const t = today(), now = localISO();

  if (n.upcoming) {
    for (const a of all(`SELECT a.id, a.start_at, a.branch_id, c.name customer, e.name employee FROM appointments a JOIN customers c ON c.id=a.customer_id
      LEFT JOIN employees e ON e.id=a.employee_id WHERE a.status IN ('pending','confirmed') AND a.start_at BETWEEN ? AND ?`, now, addMinutes(now, 60)))
      notify({ type: 'upcoming', title: `Upcoming at ${a.start_at.slice(11)}: ${a.customer}`, message: a.employee ? `With ${a.employee}` : 'No stylist assigned yet', link: `/appointments?id=${a.id}`, branchId: a.branch_id, dedupeKey: `upcoming-${a.id}` });
  }
  if (n.low_stock) {
    for (const p of all(`SELECT id,name,stock,min_stock,branch_id FROM products WHERE is_archived=0 AND stock <= min_stock`))
      notify({ type: 'low_stock', title: p.stock <= 0 ? `Out of stock: ${p.name}` : `Low stock: ${p.name}`, message: `${p.stock} left (minimum ${p.min_stock})`, link: '/inventory?filter=low', branchId: p.branch_id, dedupeKey: `stock-day-${p.id}-${t}` });
  }
  if (n.birthdays) {
    for (const c of all(`SELECT id,name,phone FROM customers WHERE birthday IS NOT NULL AND substr(birthday,6,5)=?`, t.slice(5)))
      notify({ type: 'birthday', title: `🎂 ${c.name}'s birthday today`, message: `Send wishes to ${c.phone}`, link: `/customers/${c.id}`, dedupeKey: `bday-${c.id}-${t}` });
  }
  run(`UPDATE customer_packages SET status='expired' WHERE status='active' AND expires_at < ?`, t);
  if (n.membership_expiry) {
    for (const cp of all(`SELECT cp.id, cp.expires_at, c.name, c.id cid, p.name pkg FROM customer_packages cp JOIN customers c ON c.id=cp.customer_id JOIN packages p ON p.id=cp.package_id
      WHERE cp.status='active' AND cp.expires_at BETWEEN ? AND ?`, t, addDays(t, 7)))
      notify({ type: 'membership', title: `Package expiring: ${cp.name}`, message: `${cp.pkg} expires on ${cp.expires_at}`, link: `/customers/${cp.cid}`, dedupeKey: `pkgexp-${cp.id}` });
  }
  if (n.pending_payments) {
    const r = get(`SELECT COUNT(*) n, COALESCE(SUM(balance),0) v FROM invoices WHERE status IN ('unpaid','partial') AND date <= ?`, addDays(t, -1));
    if (r.n) notify({ type: 'payment', title: `${r.n} invoice(s) with pending payment`, message: `Outstanding: ₹${money(r.v).toLocaleString('en-IN')}`, link: '/invoices?status=due', dedupeKey: `due-${t}` });
  }
  if (n.salary_due && Number(t.slice(8)) >= 5) {
    const prev = addDays(`${t.slice(0, 7)}-01`, -1).slice(0, 7);
    const r = get(`SELECT COUNT(*) n, COALESCE(SUM(net_payable),0) v FROM payroll WHERE month=? AND status='pending'`, prev);
    if (r.n) notify({ type: 'salary', title: `${r.n} salary payment(s) pending for ${prev}`, message: `Total ₹${money(r.v).toLocaleString('en-IN')}`, link: `/payroll?month=${prev}`, dedupeKey: `salary-${prev}-${t}` });
  }
  if (n.absences) {
    const nowMin = toMin(now.slice(11));
    for (const e of all(`SELECT * FROM employees WHERE status='active'`)) {
      if (nowMin < toMin(e.work_start) + 60) continue;
      if (get('SELECT 1 FROM attendance WHERE employee_id=? AND date=?', e.id, t) || offDutyReason(e, t) || isHoliday(e.branch_id, t)) continue;
      notify({ type: 'absence', title: `${e.name} hasn't checked in`, message: `Shift started at ${e.work_start}`, link: '/attendance', branchId: e.branch_id, dedupeKey: `absent-${e.id}-${t}` });
    }
  }
}

export function startJobs() {
  const tick = () => { try { runRecurringExpenses(); runNotificationJobs(); } catch (e) { console.error('job error', e); } };
  tick();
  return setInterval(tick, 5 * 60 * 1000).unref();
}
