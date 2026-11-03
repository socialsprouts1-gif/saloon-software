import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, update, run } from '../db.js';
import { requirePerm, can, selfEmployeeId } from '../lib/auth.js';
import { h, parse, HttpError, audit, paginate, money, today, addDays, startOfWeek, startOfMonth, startOfYear, resolveRange } from '../lib/util.js';
import * as A from '../lib/analytics.js';
import { nextRecurrence } from '../lib/jobs.js';
import { resolveBranch } from './appointments.js';

const r = Router();
export const EXPENSE_CATEGORIES = ['Rent', 'Electricity', 'Water', 'Employee salaries', 'Product purchases', 'Marketing', 'Maintenance', 'Internet', 'Equipment', 'Miscellaneous'];

// ---- dashboard ------------------------------------------------------------------------
r.get('/dashboard', requirePerm('dashboard'), h((req, res) => {
  const self = selfEmployeeId(req);
  if (self) {
    const t = today(), m = startOfMonth();
    const emp = get('SELECT * FROM employees WHERE id=?', self);
    return res.json({
      personal: true, employee: emp ? { id: emp.id, name: emp.name, designation: emp.designation } : null,
      today_appointments: all(`SELECT a.id, a.start_at, a.end_at, a.status, c.name customer, (SELECT GROUP_CONCAT(s.name, ', ') FROM appointment_services aps JOIN services s ON s.id=aps.service_id WHERE aps.appointment_id=a.id) services
        FROM appointments a JOIN customers c ON c.id=a.customer_id WHERE a.employee_id=? AND substr(a.start_at,1,10)=? AND a.status NOT IN ('cancelled') ORDER BY a.start_at`, self, t),
      attendance: get('SELECT * FROM attendance WHERE employee_id=? AND date=?', self, t) || null,
      performance: emp ? A.employeePerformance(emp.branch_id, m, t).find((x) => x.id === self) : null,
    });
  }
  const d = A.dashboard(req.branchId);
  if (!can(req.user, 'finance')) { delete d.finance; d.top_employees = d.top_employees.map(({ revenue, service_revenue, product_revenue, commission, revenue_per_hour, ...e }) => e); d.inventory = { ...d.inventory, value: undefined, retail_value: undefined }; }
  res.json(d);
}));

r.get('/dashboard/chart', requirePerm('finance'), h((req, res) => {
  const t = today();
  const gran = ['day', 'week', 'month', 'year'].includes(req.query.gran) ? req.query.gran : 'day';
  const from = { day: addDays(t, -29), week: startOfWeek(addDays(t, -7 * 11)), month: startOfMonth(addDays(startOfMonth(t), -335)), year: startOfYear(`${Number(t.slice(0, 4)) - 4}-01-01`) }[gran];
  res.json(A.series(req.branchId, from, t, gran));
}));

// ---- expenses -----------------------------------------------------------------------------
const expSchema = z.object({
  category: z.string().trim().min(2), amount: z.coerce.number().positive(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_method: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'other']), description: z.string().max(500).optional().nullable(),
  receipt: z.string().optional().nullable(), is_recurring: z.boolean().optional(), recurrence: z.enum(['weekly', 'monthly', 'yearly']).optional().nullable(),
  branch_id: z.coerce.number().optional(),
});
r.get('/expenses', requirePerm('expenses'), h((req, res) => {
  const { limit, offset, page, pageSize } = paginate(req.query);
  const w = ['1=1'], p = [];
  if (req.branchId) { w.push('x.branch_id=?'); p.push(req.branchId); }
  if (req.query.category) { w.push('x.category=?'); p.push(req.query.category); }
  if (req.query.from) { w.push('x.date >= ?'); p.push(req.query.from); }
  if (req.query.to) { w.push('x.date <= ?'); p.push(req.query.to); }
  if (req.query.recurring) w.push('x.is_recurring=1');
  if (req.query.q) { w.push('(x.description LIKE ? OR x.category LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const where = w.join(' AND ');
  const t = today();
  const bf = req.branchId ? req.branchId : null;
  res.json({
    data: all(`SELECT x.*, b.name branch_name, u.name created_by_name FROM expenses x LEFT JOIN branches b ON b.id=x.branch_id LEFT JOIN users u ON u.id=x.created_by WHERE ${where} ORDER BY x.date DESC, x.id DESC LIMIT ? OFFSET ?`, ...p, limit, offset),
    total: get(`SELECT COUNT(*) n FROM expenses x WHERE ${where}`, ...p).n, page, pageSize,
    filtered_sum: money(get(`SELECT COALESCE(SUM(amount),0) s FROM expenses x WHERE ${where}`, ...p).s),
    summary: { today: A.expensesTotal(bf, t, t), week: A.expensesTotal(bf, startOfWeek(t), t), month: A.expensesTotal(bf, startOfMonth(t), t), year: A.expensesTotal(bf, startOfYear(t), t) },
    categories: [...new Set([...EXPENSE_CATEGORIES, ...all('SELECT DISTINCT category FROM expenses').map((c) => c.category)])],
  });
}));
r.post('/expenses', requirePerm('expenses'), h((req, res) => {
  const b = parse(expSchema, req.body);
  if (b.is_recurring && !b.recurrence) throw new HttpError(400, 'Choose how often the expense repeats');
  const id = insert('expenses', { ...b, branch_id: resolveBranch(req, b.branch_id), next_due: b.is_recurring ? nextRecurrence(b.date, b.recurrence) : null, created_by: req.user.id });
  audit(req, 'create', 'expense', id, { category: b.category, amount: b.amount });
  res.json({ id });
}));
r.put('/expenses/:id', requirePerm('expenses'), h((req, res) => {
  const id = Number(req.params.id);
  const ex = get('SELECT * FROM expenses WHERE id=?', id);
  if (!ex) throw new HttpError(404, 'Expense not found');
  if (ex.payroll_id) throw new HttpError(400, 'Salary payouts are managed from Payroll');
  const b = parse(expSchema.partial(), req.body);
  if (b.is_recurring === false) { b.recurrence = null; b.next_due = null; }
  else if (b.is_recurring && b.recurrence && !ex.next_due) b.next_due = nextRecurrence(b.date || ex.date, b.recurrence);
  delete b.branch_id;
  update('expenses', id, b);
  audit(req, 'update', 'expense', id, b); res.json({ ok: true });
}));
r.delete('/expenses/:id', requirePerm('expenses'), h((req, res) => {
  const id = Number(req.params.id);
  const ex = get('SELECT * FROM expenses WHERE id=?', id);
  if (!ex) throw new HttpError(404, 'Expense not found');
  if (ex.payroll_id) throw new HttpError(400, 'Salary payouts are managed from Payroll');
  run('DELETE FROM expenses WHERE id=?', id);
  audit(req, 'delete', 'expense', id, { category: ex.category, amount: ex.amount, date: ex.date }); res.json({ ok: true });
}));

// ---- reports --------------------------------------------------------------------------------
r.get('/reports/:type', requirePerm('reports'), h((req, res) => {
  const { from, to } = resolveRange(req.query);
  const b = req.branchId;
  const gran = req.query.gran || (Math.abs(new Date(to) - new Date(from)) > 92 * 86400000 ? 'month' : 'day');
  const finance = can(req.user, 'finance');
  const needFinance = () => { if (!finance) throw new HttpError(403, 'Financial reports require finance permission'); };
  const out = { type: req.params.type, from, to, gran };
  switch (req.params.type) {
    case 'revenue': {
      needFinance();
      Object.assign(out, { totals: A.revenue(b, from, to), outstanding: A.outstanding(b), series: A.series(b, from, to, gran), by_service: A.serviceRevenue(b, from, to), by_product: A.productRevenue(b, from, to),
        by_employee: A.employeePerformance(b, from, to).map((e) => ({ name: e.name, service_revenue: e.service_revenue, product_revenue: e.product_revenue, revenue: e.revenue })),
        by_method: A.collections(b, from, to),
        by_branch: b ? [] : all('SELECT id, name FROM branches').map((br) => ({ name: br.name, ...A.revenue(br.id, from, to), expenses: A.expensesTotal(br.id, from, to) })) });
      break;
    }
    case 'expenses': {
      needFinance();
      const bf = b ? ` AND branch_id=${Number(b)}` : '';
      Object.assign(out, { total: A.expensesTotal(b, from, to),
        by_category: all(`SELECT category, SUM(amount) amount, COUNT(*) count FROM expenses WHERE date BETWEEN ? AND ?${bf} GROUP BY category ORDER BY amount DESC`, from, to).map((x) => ({ ...x, amount: money(x.amount) })),
        monthly: all(`SELECT substr(date,1,7) month, SUM(amount) amount FROM expenses WHERE date BETWEEN ? AND ?${bf} GROUP BY month ORDER BY month`, addDays(startOfMonth(to), -335), to).map((x) => ({ ...x, amount: money(x.amount) })),
        recurring: all(`SELECT id, category, amount, recurrence, next_due, description FROM expenses WHERE is_recurring=1${bf} ORDER BY next_due`) });
      break;
    }
    case 'profit': {
      needFinance();
      const months = [];
      for (let m = startOfMonth(addDays(startOfMonth(to), -335)); m <= to; m = addDays(m.slice(0, 7) + '-28', 4).slice(0, 7) + '-01') {
        const end = addDays(addDays(m.slice(0, 7) + '-28', 4).slice(0, 7) + '-01', -1);
        months.push({ month: m.slice(0, 7), ...A.profit(b, m, end < to ? end : to) });
      }
      Object.assign(out, { statement: A.profit(b, from, to), monthly: months });
      break;
    }
    case 'customers': {
      const bf = b ? ` AND i.branch_id=${Number(b)}` : '';
      Object.assign(out, { stats: A.customerStats(b, from, to), popular_services: A.popularServices(b, from, to, 15),
        top_customers: finance ? all(`SELECT c.id, c.name, c.phone, COUNT(i.id) visits, SUM(i.total) spent FROM invoices i JOIN customers c ON c.id=i.customer_id
          WHERE i.status<>'void' AND i.date BETWEEN ? AND ?${bf} GROUP BY c.id ORDER BY spent DESC LIMIT 20`, from, to).map((x) => ({ ...x, spent: money(x.spent) })) : [],
        new_by_period: all(`SELECT ${gran === 'month' ? 'substr(created_at,1,7)' : 'substr(created_at,1,10)'} period, COUNT(*) count FROM customers WHERE substr(created_at,1,10) BETWEEN ? AND ? GROUP BY period ORDER BY period`, from, to),
        by_source: all(`SELECT source, COUNT(*) count FROM customers WHERE substr(created_at,1,10) BETWEEN ? AND ? GROUP BY source`, from, to),
        inactive: A.inactiveCustomers(Number(req.query.inactive_days) || 60, 50) });
      break;
    }
    case 'employees': {
      const perf = A.employeePerformance(b, from, to);
      out.employees = finance ? perf : perf.map(({ revenue, service_revenue, product_revenue, commission, revenue_per_hour, ...e }) => e);
      break;
    }
    case 'appointments': {
      Object.assign(out, { stats: A.appointmentStats(b, from, to),
        by_status: all(`SELECT status, COUNT(*) count FROM appointments WHERE substr(start_at,1,10) BETWEEN ? AND ?${b ? ' AND branch_id=' + Number(b) : ''} GROUP BY status`, from, to),
        by_source: all(`SELECT source, COUNT(*) count FROM appointments WHERE substr(start_at,1,10) BETWEEN ? AND ?${b ? ' AND branch_id=' + Number(b) : ''} GROUP BY source`, from, to),
        by_hour: all(`SELECT substr(start_at,12,2) hour, COUNT(*) count FROM appointments WHERE status NOT IN ('cancelled','no_show') AND substr(start_at,1,10) BETWEEN ? AND ?${b ? ' AND branch_id=' + Number(b) : ''} GROUP BY hour ORDER BY hour`, from, to) });
      break;
    }
    default: throw new HttpError(404, 'Unknown report');
  }
  res.json(out);
}));

export default r;
