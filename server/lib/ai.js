import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { all, get, getSettings } from '../db.js';
import * as A from './analytics.js';
import { today, addDays, startOfWeek, startOfMonth, startOfYear, endOfMonth, daysInMonth, money, resolveRange } from './util.js';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const rangeArgs = { from: { type: 'string', description: 'Start date YYYY-MM-DD' }, to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive)' } };
const rng = (a) => (a?.from && a?.to ? { from: a.from, to: a.to } : resolveRange({ period: 'month' }));

/** Every tool reads live data. `finance` marks tools that expose money figures. */
export function buildTools(branchId) {
  return [
    { name: 'get_financial_summary', finance: true, description: 'Revenue, tax, cost of goods, expenses, gross and net profit, margins and outstanding customer dues for a date range.',
      schema: { type: 'object', properties: rangeArgs, required: ['from', 'to'] },
      run: (a) => { const { from, to } = rng(a); return { from, to, ...A.profit(branchId, from, to), invoices: A.revenue(branchId, from, to).invoices, outstanding_dues: A.outstanding(branchId), payment_methods: A.collections(branchId, from, to) }; } },
    { name: 'get_monthly_profit_estimate', finance: true, description: 'Month-to-date profit for the current month and a straight-line projection to month end.',
      schema: { type: 'object', properties: {} },
      run: () => {
        const t = today(), from = startOfMonth(t), elapsed = Number(t.slice(8)), dim = daysInMonth(t.slice(0, 7));
        const p = A.profit(branchId, from, t);
        const recurring = all(`SELECT amount, next_due FROM expenses WHERE is_recurring=1 AND next_due BETWEEN ? AND ?`, addDays(t, 1), endOfMonth(t)).reduce((s, x) => s + x.amount, 0);
        const projNetSales = (p.net_sales / elapsed) * dim, projCogs = (p.cogs / elapsed) * dim;
        return { month: t.slice(0, 7), days_elapsed: elapsed, days_in_month: dim, month_to_date: p,
          projected: { net_sales: money(projNetSales), operating_expenses: money(p.operating_expenses + recurring), net_profit: money(projNetSales - projCogs - p.operating_expenses - recurring) },
          note: 'Projection scales sales linearly and adds recurring expenses still due this month.' };
      } },
    { name: 'get_employee_performance', finance: true, description: 'Per-employee revenue, commission, appointments completed, ratings, attendance and revenue per hour for a date range, sorted by revenue.',
      schema: { type: 'object', properties: rangeArgs, required: ['from', 'to'] },
      run: (a) => { const { from, to } = rng(a); return { from, to, employees: A.employeePerformance(branchId, from, to) }; } },
    { name: 'get_service_popularity', finance: false, description: 'Most booked services and service revenue for a date range.',
      schema: { type: 'object', properties: rangeArgs, required: ['from', 'to'] },
      run: (a) => { const { from, to } = rng(a); return { from, to, by_bookings: A.popularServices(branchId, from, to, 10), by_revenue: A.serviceRevenue(branchId, from, to, 10) }; } },
    { name: 'get_expense_breakdown', finance: true, description: 'Total expenses and per-category breakdown for a date range.',
      schema: { type: 'object', properties: rangeArgs, required: ['from', 'to'] },
      run: (a) => { const { from, to } = rng(a); const bf = branchId ? ` AND branch_id=${Number(branchId)}` : '';
        return { from, to, total: A.expensesTotal(branchId, from, to), by_category: all(`SELECT category, ROUND(SUM(amount),2) amount FROM expenses WHERE date BETWEEN ? AND ?${bf} GROUP BY category ORDER BY 2 DESC`, from, to) }; } },
    { name: 'get_inventory_status', finance: false, description: 'Inventory value, low-stock and out-of-stock products needing restock, and top-selling products this month.',
      schema: { type: 'object', properties: {} },
      run: () => { const { from, to } = resolveRange({ period: 'month' }); return { ...A.inventoryStats(branchId), needs_restock: A.lowStockProducts(branchId, 30), top_selling_this_month: A.productRevenue(branchId, from, to, 5) }; } },
    { name: 'get_customer_activity', finance: false, description: 'Customer visits, new vs returning customers, retention, average spend and appointment counts (walk-ins, online, cancelled) for a date range.',
      schema: { type: 'object', properties: rangeArgs, required: ['from', 'to'] },
      run: (a) => { const { from, to } = rng(a); return { from, to, customers: A.customerStats(branchId, from, to), appointments: A.appointmentStats(branchId, from, to) }; } },
    { name: 'get_inactive_customers', finance: false, description: 'Customers whose last visit is older than N days, with phone, visit count and total spend.',
      schema: { type: 'object', properties: { days: { type: 'integer', description: 'Days since last visit, e.g. 60' } }, required: ['days'] },
      run: (a) => { const list = A.inactiveCustomers(Number(a?.days) || 60, 100); return { days: Number(a?.days) || 60, count: list.length, customers: list }; } },
  ];
}

// ---- rule-based insights ---------------------------------------------------------------
export function insights(branchId, finance) {
  const out = [];
  const t = today(), m0 = startOfMonth(t), day = Number(t.slice(8));
  const prevStart = startOfMonth(addDays(m0, -1)), prevSame = addDays(prevStart, day - 1);
  if (finance) {
    const cur = A.revenue(branchId, m0, t).total, prev = A.revenue(branchId, prevStart, prevSame < m0 ? prevSame : addDays(m0, -1)).total;
    if (prev > 0) {
      const ch = ((cur - prev) / prev) * 100;
      out.push({ tone: ch >= 0 ? 'good' : 'warn', title: `Revenue ${ch >= 0 ? 'up' : 'down'} ${Math.abs(ch).toFixed(0)}% vs last month`, text: `${fmt(cur)} so far this month compared with ${fmt(prev)} by the same day last month.` });
    } else if (cur > 0) out.push({ tone: 'good', title: `${fmt(cur)} revenue this month`, text: 'No comparable sales last month to compare against yet.' });
    const p = A.profit(branchId, m0, t);
    if (p.net_sales > 0 && p.operating_expenses / p.net_sales > 0.7) out.push({ tone: 'warn', title: 'Expenses are high relative to sales', text: `Operating expenses are ${((p.operating_expenses / p.net_sales) * 100).toFixed(0)}% of net sales this month. Review the largest categories in Expense reports.` });
    const due = A.outstanding(branchId);
    if (due.amount > 0) out.push({ tone: 'warn', title: `${fmt(due.amount)} pending from customers`, text: `${due.invoices} invoice(s) have a balance due. Follow up from Billing → Due.` });
    const top = A.employeePerformance(branchId, m0, t)[0];
    if (top?.revenue > 0) out.push({ tone: 'good', title: `${top.name} is this month's top performer`, text: `${fmt(top.revenue)} in sales across ${top.completed} completed appointments.` });
  }
  const inv = A.inventoryStats(branchId);
  if (inv.out_of_stock + inv.low_stock > 0) out.push({ tone: 'warn', title: `${inv.out_of_stock + inv.low_stock} product(s) need restocking`, text: `${inv.out_of_stock} out of stock and ${inv.low_stock} below minimum level.` });
  const pop = A.popularServices(branchId, m0, t, 1)[0];
  if (pop) out.push({ tone: 'info', title: `Most popular: ${pop.name}`, text: `${pop.bookings} bookings this month. Consider a combo offer around it.` });
  const inactive = A.inactiveCustomers(60, 500).length;
  if (inactive) out.push({ tone: 'info', title: `${inactive} customers haven't visited in 60+ days`, text: 'Send a win-back coupon via WhatsApp from the Customers → Inactive list.' });
  const ap = A.appointmentStats(branchId, addDays(t, -29), t);
  if (ap.total >= 10 && (ap.no_show + ap.cancelled) / ap.total > 0.15) out.push({ tone: 'warn', title: 'High cancellation / no-show rate', text: `${(((ap.no_show + ap.cancelled) / ap.total) * 100).toFixed(0)}% of appointments in the last 30 days were cancelled or missed. Turn on confirmation messages.` });
  const busy = get(`SELECT substr(start_at,12,2) h, COUNT(*) n FROM appointments WHERE status NOT IN ('cancelled','no_show') AND start_at >= ? GROUP BY h ORDER BY n DESC LIMIT 1`, addDays(t, -29));
  if (busy) out.push({ tone: 'info', title: `Busiest hour: ${Number(busy.h) % 12 || 12}${Number(busy.h) < 12 ? 'am' : 'pm'}`, text: 'Schedule more stylists around this time and offer off-peak discounts.' });
  return out;
}

// ---- offline answer engine (no API key) ----------------------------------------------------
function periodFrom(q) {
  const t = today();
  if (/yesterday/.test(q)) return { from: addDays(t, -1), to: addDays(t, -1), label: 'yesterday' };
  if (/today/.test(q)) return { from: t, to: t, label: 'today' };
  if (/last month|previous month/.test(q)) { const s = startOfMonth(addDays(startOfMonth(t), -1)); return { from: s, to: endOfMonth(s), label: 'last month' }; }
  if (/this week|week/.test(q)) return { from: startOfWeek(t), to: t, label: 'this week' };
  if (/this year|year|annual/.test(q)) return { from: startOfYear(t), to: t, label: 'this year' };
  return { from: startOfMonth(t), to: t, label: 'this month' };
}
export function localAnswer(question, branchId, finance) {
  const q = question.toLowerCase();
  const P = periodFrom(q);
  const tools = Object.fromEntries(buildTools(branchId).map((x) => [x.name, x]));
  const noFin = 'You do not have permission to view financial figures.';
  if (/(inactive|haven'?t visited|not visited|lapsed|\d+\s*days)/.test(q) && /customer|client|visit/.test(q)) {
    const days = Number(q.match(/(\d+)\s*day/)?.[1]) || 60;
    const r = tools.get_inactive_customers.run({ days });
    if (!r.count) return `No customers have been away for more than ${days} days. 🎉`;
    return `**${r.count} customers** haven't visited in ${days}+ days. Most recent ones:\n${r.customers.slice(0, 10).map((c) => `- ${c.name} (${c.phone}) — last visit ${c.last_visit}, ${c.visits} visits`).join('\n')}`;
  }
  if (/restock|low stock|out of stock|inventory|stock/.test(q)) {
    const r = tools.get_inventory_status.run();
    if (!r.needs_restock.length) return 'All products are above their minimum stock level.';
    return `**${r.needs_restock.length} products need restocking:**\n${r.needs_restock.map((p) => `- ${p.name}${p.brand ? ` (${p.brand})` : ''}: ${p.stock} left, minimum ${p.min_stock}`).join('\n')}`;
  }
  if (/(employee|stylist|staff).*(highest|top|best|most)|(highest|top|best|most).*(employee|stylist|staff)|performance/.test(q)) {
    if (!finance) return noFin;
    const r = tools.get_employee_performance.run(P).employees.filter((e) => e.revenue > 0);
    if (!r.length) return `No employee sales recorded ${P.label}.`;
    return `**${r[0].name}** generated the highest revenue ${P.label}: ${fmt(r[0].revenue)} (${r[0].completed} completed appointments).\n\nRanking:\n${r.slice(0, 5).map((e, i) => `${i + 1}. ${e.name} — ${fmt(e.revenue)}`).join('\n')}`;
  }
  if (/popular|most booked|top service|best service|services/.test(q)) {
    const r = tools.get_service_popularity.run(P);
    if (!r.by_bookings.length) return `No services booked ${P.label} yet.`;
    return `**Most popular services ${P.label}:**\n${r.by_bookings.slice(0, 5).map((s, i) => `${i + 1}. ${s.name} — ${s.bookings} bookings`).join('\n')}`;
  }
  if (/estimat|projected|forecast/.test(q) && /profit/.test(q)) {
    if (!finance) return noFin;
    const r = tools.get_monthly_profit_estimate.run();
    return `Month-to-date net profit is **${fmt(r.month_to_date.net_profit)}** after ${r.days_elapsed} of ${r.days_in_month} days. At the current pace the estimated profit for ${r.month} is **${fmt(r.projected.net_profit)}** (projected net sales ${fmt(r.projected.net_sales)}, expenses ${fmt(r.projected.operating_expenses)}).`;
  }
  if (/expense|spend on|spent on|cost/.test(q)) {
    if (!finance) return noFin;
    const r = tools.get_expense_breakdown.run(P);
    if (!r.total) return `No expenses recorded ${P.label}.`;
    return `Total expenses ${P.label}: **${fmt(r.total)}**\n${r.by_category.map((c) => `- ${c.category}: ${fmt(c.amount)}`).join('\n')}`;
  }
  if (/customer|visit|walk.?in|client/.test(q)) {
    const r = tools.get_customer_activity.run(P);
    return `${P.label[0].toUpperCase() + P.label.slice(1)}: **${r.customers.visitors} customers** were billed (${r.customers.returning} returning, ${r.customers.first_time} first-time), ${r.customers.new_customers} new customer profiles, ${r.appointments.completed} completed appointments and ${r.appointments.walk_in} walk-ins.${finance ? ` Average spend ${fmt(r.customers.avg_spend)}.` : ''}`;
  }
  if (/profit|revenue|sales|earn|income|generate|made|business/.test(q)) {
    if (!finance) return noFin;
    const r = tools.get_financial_summary.run(P);
    return `**${P.label[0].toUpperCase() + P.label.slice(1)}** (${r.from} → ${r.to}):\n- Revenue: **${fmt(r.revenue)}** from ${r.invoices} invoices (incl. ${fmt(r.tax_collected)} tax)\n- Expenses: ${fmt(r.total_expenses)}\n- Net profit: **${fmt(r.net_profit)}** (${r.net_margin}% margin)\n- Pending customer dues: ${fmt(r.outstanding_dues.amount)}`;
  }
  return `I can answer questions about revenue, profit, expenses, employees, services, stock, customers and appointments using your live data. Try:\n- "How much revenue did we make this month?"\n- "Which products need restocking?"\n- "Which customers haven't visited in 60 days?"`;
}

// ---- Claude-powered answers -----------------------------------------------------------------
export async function claudeAnswer({ question, history, branchId, finance, apiKey, model }) {
  const client = new Anthropic({ apiKey });
  const tools = buildTools(branchId).filter((x) => finance || !x.finance)
    .map((x) => betaTool({ name: x.name, description: x.description, inputSchema: x.schema, run: (input) => JSON.stringify(x.run(input)) }));
  const salon = getSettings().salon.name;
  const branch = branchId ? get('SELECT name FROM branches WHERE id=?', branchId)?.name : 'all branches (consolidated)';
  const system = `You are the business assistant inside ${salon}'s salon management software. Answer the owner's questions using ONLY figures returned by the tools — never estimate or invent numbers. If a tool returns no data, say so plainly.
Currency is Indian Rupees (₹, use Indian digit grouping). Be concise: lead with the direct answer, then a short breakdown and, where useful, one practical suggestion. Use markdown lists sparingly.
${finance ? '' : 'This user cannot see financial figures; if asked, explain they need finance permission.'}
Scope: ${branch}. Today is ${today()} (week starts Monday).`;
  const messages = [...(history || []).slice(-8).filter((m) => m.content).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) })), { role: 'user', content: question }];
  // Merge consecutive same-role turns so the conversation alternates
  const merged = messages.reduce((acc, m) => { if (acc.length && acc.at(-1).role === m.role) acc.at(-1).content += `\n\n${m.content}`; else acc.push({ ...m }); return acc; }, []);
  if (merged[0]?.role === 'assistant') merged.shift();
  const final = await client.beta.messages.toolRunner({
    model: model || 'claude-opus-5-5', max_tokens: 16000, system, tools, messages: merged, max_iterations: 8,
    output_config: { effort: 'low' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
  });
  if (final.stop_reason === 'refusal') return 'Sorry, I can’t help with that request.';
  return final.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || 'I could not find an answer in the data.';
}
