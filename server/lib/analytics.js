import { all, get, getSettings } from '../db.js';
import { today, addDays, startOfWeek, startOfMonth, startOfYear, money, parseDate, ymd } from './util.js';

// Branch filter helper: b = branchId or null (all branches)
const bf = (b, col = 'branch_id') => (b ? { s: ` AND ${col}=${Number(b)}`, p: [] } : { s: '', p: [] });
const VALID_INV = `status <> 'void'`;

export function revenue(b, from, to) {
  const f = bf(b);
  const r = get(`SELECT COALESCE(SUM(total),0) total, COALESCE(SUM(tax_amount),0) tax, COALESCE(SUM(paid_amount),0) paid,
    COUNT(*) invoices, COUNT(DISTINCT customer_id) customers FROM invoices WHERE ${VALID_INV} AND date BETWEEN ? AND ?${f.s}`, from, to);
  return { total: money(r.total), tax: money(r.tax), net: money(r.total - r.tax), paid: money(r.paid), invoices: r.invoices, customers: r.customers };
}
export function collections(b, from, to) {
  const f = bf(b, 'i.branch_id');
  return all(`SELECT p.method, COALESCE(SUM(p.amount),0) amount, COUNT(*) count FROM payments p JOIN invoices i ON i.id=p.invoice_id
    WHERE i.${VALID_INV} AND substr(p.paid_at,1,10) BETWEEN ? AND ?${f.s} GROUP BY p.method ORDER BY amount DESC`, from, to)
    .map((r) => ({ ...r, amount: money(r.amount) }));
}
export function expensesTotal(b, from, to, { excludePurchases = false } = {}) {
  const f = bf(b);
  return money(get(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE date BETWEEN ? AND ?${f.s}${excludePurchases ? ` AND category<>'Product purchases'` : ''}`, from, to).t);
}
export function cogs(b, from, to) {
  const f = bf(b, 'i.branch_id');
  return money(get(`SELECT COALESCE(SUM(ii.qty * p.purchase_price),0) t FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
    JOIN products p ON p.id=ii.ref_id WHERE ii.item_type='product' AND i.${VALID_INV} AND i.date BETWEEN ? AND ?${f.s}`, from, to).t);
}

/** Profit statement for a range. */
export function profit(b, from, to) {
  const rev = revenue(b, from, to);
  const cost = cogs(b, from, to);
  const totalExp = expensesTotal(b, from, to);
  const opex = expensesTotal(b, from, to, { excludePurchases: true });
  const gross = money(rev.net - cost);
  const net = money(gross - opex);
  return {
    revenue: rev.total, tax_collected: rev.tax, net_sales: rev.net, cogs: cost, gross_profit: gross,
    total_expenses: totalExp, operating_expenses: opex, net_profit: net,
    gross_margin: rev.net ? money((gross / rev.net) * 100) : 0, net_margin: rev.net ? money((net / rev.net) * 100) : 0,
  };
}

export function outstanding(b) {
  const f = bf(b);
  const r = get(`SELECT COALESCE(SUM(balance),0) bal, COUNT(*) n FROM invoices WHERE status IN ('unpaid','partial')${f.s}`);
  return { amount: money(r.bal), invoices: r.n };
}

/** Time series of revenue + expenses grouped by day/week/month/year. */
export function series(b, from, to, gran = 'day') {
  const key = { day: `date`, month: `substr(date,1,7)`, year: `substr(date,1,4)`, week: `date` }[gran] || 'date';
  const f = bf(b);
  const rev = all(`SELECT ${key} k, SUM(total) v FROM invoices WHERE ${VALID_INV} AND date BETWEEN ? AND ?${f.s} GROUP BY k`, from, to);
  const exp = all(`SELECT ${key} k, SUM(amount) v FROM expenses WHERE date BETWEEN ? AND ?${f.s} GROUP BY k`, from, to);
  const buckets = new Map();
  const bucketOf = (k) => (gran === 'week' ? startOfWeek(k) : k);
  // pre-fill so charts show zero periods instead of gaps
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = gran === 'month' ? d.slice(0, 7) : gran === 'year' ? d.slice(0, 4) : gran === 'week' ? startOfWeek(d) : d;
    if (!buckets.has(k)) buckets.set(k, { period: k, revenue: 0, expenses: 0 });
  }
  for (const r of rev) { const k = bucketOf(r.k); const x = buckets.get(k) || { period: k, revenue: 0, expenses: 0 }; x.revenue += r.v; buckets.set(k, x); }
  for (const r of exp) { const k = bucketOf(r.k); const x = buckets.get(k) || { period: k, revenue: 0, expenses: 0 }; x.expenses += r.v; buckets.set(k, x); }
  return [...buckets.values()].sort((a, c) => a.period.localeCompare(c.period))
    .map((x) => ({ ...x, revenue: money(x.revenue), expenses: money(x.expenses), profit: money(x.revenue - x.expenses) }));
}

export function serviceRevenue(b, from, to, limit = 50) {
  const f = bf(b, 'i.branch_id');
  return all(`SELECT ii.ref_id id, ii.name, SUM(ii.qty) count, SUM(ii.total) revenue FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
    WHERE ii.item_type='service' AND i.${VALID_INV} AND i.date BETWEEN ? AND ?${f.s} GROUP BY ii.ref_id ORDER BY revenue DESC LIMIT ?`, from, to, limit)
    .map((r) => ({ ...r, revenue: money(r.revenue) }));
}
export function productRevenue(b, from, to, limit = 50) {
  const f = bf(b, 'i.branch_id');
  return all(`SELECT ii.ref_id id, ii.name, SUM(ii.qty) qty, SUM(ii.total) revenue FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
    WHERE ii.item_type='product' AND i.${VALID_INV} AND i.date BETWEEN ? AND ?${f.s} GROUP BY ii.ref_id ORDER BY qty DESC LIMIT ?`, from, to, limit)
    .map((r) => ({ ...r, revenue: money(r.revenue) }));
}
export function popularServices(b, from, to, limit = 10) {
  const f = bf(b, 'a.branch_id');
  return all(`SELECT s.id, s.name, COUNT(*) bookings FROM appointment_services aps JOIN appointments a ON a.id=aps.appointment_id
    JOIN services s ON s.id=aps.service_id WHERE a.status NOT IN ('cancelled','no_show') AND substr(a.start_at,1,10) BETWEEN ? AND ?${f.s}
    GROUP BY s.id ORDER BY bookings DESC LIMIT ?`, from, to, limit);
}

export function employeePerformance(b, from, to) {
  const f = bf(b, 'e.branch_id');
  const emps = all(`SELECT e.id, e.name, e.designation, e.photo, e.role FROM employees e WHERE e.status='active'${f.s} ORDER BY e.name`);
  return emps.map((e) => {
    const sales = get(`SELECT COALESCE(SUM(CASE WHEN ii.item_type='service' THEN ii.total END),0) svc, COALESCE(SUM(CASE WHEN ii.item_type='product' THEN ii.total END),0) prod,
      COALESCE(SUM(ii.commission_amount),0) comm, COUNT(DISTINCT i.customer_id) customers
      FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE ii.employee_id=? AND i.${VALID_INV} AND i.date BETWEEN ? AND ?`, e.id, from, to);
    const appts = get(`SELECT COUNT(*) total, SUM(status='completed') completed, SUM(status='cancelled') cancelled, SUM(status='no_show') no_show
      FROM appointments WHERE employee_id=? AND substr(start_at,1,10) BETWEEN ? AND ?`, e.id, from, to);
    const rating = get(`SELECT AVG(rating) avg, COUNT(*) n FROM feedback WHERE employee_id=?`, e.id);
    const att = get(`SELECT SUM(status IN ('present','half_day')) present, SUM(work_minutes) mins FROM attendance WHERE employee_id=? AND date BETWEEN ? AND ?`, e.id, from, to);
    return {
      ...e, service_revenue: money(sales.svc), product_revenue: money(sales.prod), revenue: money(sales.svc + sales.prod),
      commission: money(sales.comm), customers: sales.customers, appointments: appts.total || 0, completed: appts.completed || 0,
      cancelled: appts.cancelled || 0, no_show: appts.no_show || 0, rating: rating.avg ? money(rating.avg) : null, ratings: rating.n,
      present_days: att.present || 0, hours_worked: money((att.mins || 0) / 60),
      revenue_per_hour: att.mins ? money((sales.svc + sales.prod) / (att.mins / 60)) : null,
    };
  }).sort((a, c) => c.revenue - a.revenue);
}

export function customerStats(b, from, to) {
  const f = bf(b, 'i.branch_id');
  const newCustomers = get(`SELECT COUNT(*) n FROM customers WHERE substr(created_at,1,10) BETWEEN ? AND ?${b ? ` AND branch_id=${Number(b)}` : ''}`, from, to).n;
  const visitors = all(`SELECT DISTINCT i.customer_id id FROM invoices i WHERE i.${VALID_INV} AND i.customer_id IS NOT NULL AND i.date BETWEEN ? AND ?${f.s}`, from, to);
  let returning = 0;
  for (const v of visitors) if (get(`SELECT 1 FROM invoices WHERE customer_id=? AND ${VALID_INV} AND date < ? LIMIT 1`, v.id, from)) returning++;
  // retention: of customers who visited in the previous equal-length window, how many came back in this one
  const len = Math.round((parseDate(to) - parseDate(from)) / 86400000) + 1;
  const prevFrom = addDays(from, -len), prevTo = addDays(from, -1);
  const prev = all(`SELECT DISTINCT customer_id id FROM invoices i WHERE i.${VALID_INV} AND customer_id IS NOT NULL AND date BETWEEN ? AND ?${f.s}`, prevFrom, prevTo);
  const visitorSet = new Set(visitors.map((v) => v.id));
  const retained = prev.filter((p) => visitorSet.has(p.id)).length;
  const rev = revenue(b, from, to);
  return {
    new_customers: newCustomers, visitors: visitors.length, returning, first_time: visitors.length - returning,
    retention_rate: prev.length ? money((retained / prev.length) * 100) : null,
    avg_spend: rev.customers ? money(rev.total / rev.customers) : 0,
  };
}

export function inventoryStats(b) {
  const f = bf(b);
  const r = get(`SELECT COALESCE(SUM(stock*purchase_price),0) cost_value, COALESCE(SUM(stock*selling_price),0) retail_value,
    SUM(stock<=0) out_of_stock, SUM(stock>0 AND stock<=min_stock) low_stock, COUNT(*) products FROM products WHERE is_archived=0${f.s}`);
  const fi = bf(b, 'i.branch_id');
  const soldToday = get(`SELECT COALESCE(SUM(ii.qty),0) q FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE ii.item_type='product' AND i.${VALID_INV} AND i.date=?${fi.s}`, today()).q;
  return { value: money(r.cost_value), retail_value: money(r.retail_value), out_of_stock: r.out_of_stock || 0, low_stock: r.low_stock || 0, products: r.products, sold_today: soldToday };
}
export function lowStockProducts(b, limit = 20) {
  const f = bf(b);
  return all(`SELECT id,name,brand,stock,min_stock,branch_id FROM products WHERE is_archived=0 AND stock<=min_stock${f.s} ORDER BY stock ASC, name LIMIT ?`, limit);
}

export function staffToday(b) {
  const f = bf(b);
  const t = today();
  const wd = new Date().getDay();
  const emps = all(`SELECT id, weekly_off FROM employees WHERE status='active'${f.s}`);
  let present = 0, leave = 0, off = 0;
  for (const e of emps) {
    const a = get('SELECT status, check_in FROM attendance WHERE employee_id=? AND date=?', e.id, t);
    const onLeave = get(`SELECT 1 FROM leaves WHERE employee_id=? AND status='approved' AND ? BETWEEN from_date AND to_date`, e.id, t);
    if (a && ['present', 'half_day'].includes(a.status)) present++;
    else if (onLeave || a?.status === 'leave') leave++;
    else if (Number(e.weekly_off) === wd && e.weekly_off !== null || a?.status === 'weekly_off' || a?.status === 'holiday') off++;
  }
  return { total: emps.length, present, on_leave: leave, weekly_off: off, absent: Math.max(0, emps.length - present - leave - off) };
}

export function appointmentStats(b, from, to) {
  const f = bf(b);
  const r = get(`SELECT COUNT(*) total, SUM(status='completed') completed, SUM(status='cancelled') cancelled, SUM(status='no_show') no_show,
    SUM(source='walk_in') walk_in, SUM(source IN ('online','qr')) online FROM appointments WHERE substr(start_at,1,10) BETWEEN ? AND ?${f.s}`, from, to);
  const upcoming = get(`SELECT COUNT(*) n FROM appointments WHERE start_at >= ? AND status IN ('pending','confirmed')${f.s}`, `${today()}T00:00`).n;
  const walkInvoices = get(`SELECT COUNT(*) n FROM invoices WHERE ${VALID_INV} AND appointment_id IS NULL AND date BETWEEN ? AND ?${f.s}`, from, to).n;
  return { total: r.total || 0, completed: r.completed || 0, cancelled: r.cancelled || 0, no_show: r.no_show || 0, online: r.online || 0, walk_in: (r.walk_in || 0) + walkInvoices, upcoming };
}

/** Customers who have not visited within `days`. */
export function inactiveCustomers(days = 60, limit = 100) {
  const cutoff = addDays(today(), -days);
  return all(`SELECT c.id, c.name, c.phone, MAX(i.date) last_visit, COUNT(i.id) visits, COALESCE(SUM(i.total),0) spent
    FROM customers c JOIN invoices i ON i.customer_id=c.id AND i.${VALID_INV} GROUP BY c.id HAVING last_visit < ? ORDER BY last_visit DESC LIMIT ?`, cutoff, limit);
}

/** Classify a customer into new / regular / vip / inactive using settings thresholds. */
export function segmentOf(c, crm = getSettings().crm) {
  if ((c.spent || 0) >= crm.vip_spend || (c.visits || 0) >= crm.vip_visits) return 'vip';
  if (c.last_visit && c.last_visit < addDays(today(), -crm.inactive_days)) return 'inactive';
  if ((c.visits || 0) >= crm.regular_visits) return 'regular';
  if (!c.visits && c.created_at && c.created_at.slice(0, 10) < addDays(today(), -crm.inactive_days)) return 'inactive';
  return 'new';
}

export function dashboard(b) {
  const t = today();
  const periods = { today: [t, t], week: [startOfWeek(t), t], month: [startOfMonth(t), t], year: [startOfYear(t), t] };
  const rev = Object.fromEntries(Object.entries(periods).map(([k, [f, to]]) => [k, revenue(b, f, to).total]));
  const [mf, mt] = periods.month;
  const p = profit(b, mf, mt);
  const fToday = bf(b);
  return {
    generated_at: new Date().toISOString(),
    finance: {
      revenue: rev, expenses_month: p.total_expenses, net_profit_month: p.net_profit, ...{ outstanding: outstanding(b) },
      pending_payments_today: money(get(`SELECT COALESCE(SUM(balance),0) v FROM invoices WHERE status IN ('unpaid','partial') AND date=?${fToday.s}`, t).v),
      payment_methods_month: collections(b, mf, mt),
    },
    appointments_today: appointmentStats(b, t, t),
    appointments_month: appointmentStats(b, mf, mt),
    customers_month: customerStats(b, mf, mt),
    staff: staffToday(b),
    top_employees: employeePerformance(b, mf, mt).slice(0, 5),
    inventory: inventoryStats(b),
    low_stock: lowStockProducts(b, 6),
    popular_services: popularServices(b, mf, mt, 5),
    upcoming: all(`SELECT a.id, a.start_at, a.status, a.source, c.name customer, e.name employee FROM appointments a JOIN customers c ON c.id=a.customer_id
      LEFT JOIN employees e ON e.id=a.employee_id WHERE a.start_at >= ? AND a.status IN ('pending','confirmed','checked_in')${bf(b, 'a.branch_id').s}
      ORDER BY a.start_at LIMIT 8`, `${t}T00:00`),
  };
}

export { ymd };
