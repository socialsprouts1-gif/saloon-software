import { useState } from 'react';
import { useAuth, useApi } from '../context.jsx';
import { money, compact, num, pct, fmtDate, payLabel, titleCase, monthLabel } from '../lib/format.js';
import { exportCSV, exportXLSX, exportPDF } from '../lib/export.js';
import { PageHead, Card, Tabs, DateRange, rangeFor, Loader, ErrorState, Kpi, Empty, ExportMenu, Stars } from '../components/ui.jsx';
import { TrendChart, Donut, BarList, CHART, periodLabel } from '../components/charts.jsx';

export default function Reports() {
  const { can, salon, branchName } = useAuth();
  const finance = can('finance');
  const tabs = [...(finance ? [['revenue', 'Revenue'], ['expenses', 'Expenses'], ['profit', 'Profit']] : []), ['customers', 'Customers'], ['employees', 'Employees'], ['appointments', 'Appointments']];
  const [tab, setTab] = useState(tabs[0][0]);
  const [range, setRange] = useState({ period: 'month', ...rangeFor('month') });
  const { data, error, reload, loading } = useApi(`/api/reports/${tab}`, { from: range.from, to: range.to });
  const sub = `${fmtDate(range.from)} – ${fmtDate(range.to)} · ${branchName}`;
  const ready = data && !loading && data.type === tab && data.from === range.from && data.to === range.to;
  const ex = ready ? exporters(tab, data) : null;
  return (
    <div>
      <PageHead title="Reports & analytics" sub={sub}>
        <DateRange value={range} onChange={setRange} />
        {ex && <ExportMenu onCSV={() => exportCSV(`${tab}-report-${range.from}`, ex[0].columns, ex[0].rows)} onExcel={() => exportXLSX(`${tab}-report-${range.from}`, ex.map((s) => ({ name: s.title, columns: s.columns, rows: s.rows })))} onPDF={() => exportPDF(`${tab}-report-${range.from}`, `${titleCase(tab)} report`, sub, ex, salon?.name)} />}
      </PageHead>
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      <div className="mt">
        {error ? <ErrorState error={error} onRetry={reload} /> : !ready ? <div className="card"><Loader rows={8} /></div>
          : tab === 'revenue' ? <Revenue d={data} /> : tab === 'expenses' ? <Expenses d={data} /> : tab === 'profit' ? <Profit d={data} /> : tab === 'customers' ? <Customers d={data} finance={finance} /> : tab === 'employees' ? <Employees d={data} finance={finance} /> : <Appointments d={data} />}
      </div>
    </div>
  );
}

const M = { format: money, raw: (v) => v, align: 'right' };
function exporters(tab, d) {
  switch (tab) {
    case 'revenue': return [
      { title: 'Summary', summary: [['Revenue', money(d.totals.total)], ['Tax collected', money(d.totals.tax)], ['Net sales', money(d.totals.net)], ['Collected', money(d.totals.paid)], ['Invoices', d.totals.invoices]], columns: [{ key: 'period', label: 'Period', format: (v) => periodLabel(v, d.gran) }, { key: 'revenue', label: 'Revenue', ...M }, { key: 'expenses', label: 'Expenses', ...M }], rows: d.series },
      { title: 'By service', columns: [{ key: 'name', label: 'Service' }, { key: 'count', label: 'Qty' }, { key: 'revenue', label: 'Revenue', ...M }], rows: d.by_service },
      { title: 'By product', columns: [{ key: 'name', label: 'Product' }, { key: 'qty', label: 'Qty' }, { key: 'revenue', label: 'Revenue', ...M }], rows: d.by_product },
      { title: 'By employee', columns: [{ key: 'name', label: 'Employee' }, { key: 'service_revenue', label: 'Services', ...M }, { key: 'product_revenue', label: 'Products', ...M }, { key: 'revenue', label: 'Total', ...M }], rows: d.by_employee },
      { title: 'By payment method', columns: [{ key: 'method', label: 'Method', format: payLabel }, { key: 'count', label: 'Payments' }, { key: 'amount', label: 'Amount', ...M }], rows: d.by_method },
    ];
    case 'expenses': return [
      { title: 'By category', summary: [['Total expenses', money(d.total)]], columns: [{ key: 'category', label: 'Category' }, { key: 'count', label: 'Entries' }, { key: 'amount', label: 'Amount', ...M }], rows: d.by_category },
      { title: 'Monthly trend', columns: [{ key: 'month', label: 'Month', format: monthLabel }, { key: 'amount', label: 'Amount', ...M }], rows: d.monthly },
      { title: 'Recurring', columns: [{ key: 'category', label: 'Category' }, { key: 'description', label: 'Description' }, { key: 'recurrence', label: 'Repeats' }, { key: 'next_due', label: 'Next due' }, { key: 'amount', label: 'Amount', ...M }], rows: d.recurring },
    ];
    case 'profit': {
      const s = d.statement;
      return [{ title: 'Profit statement', summary: [['Revenue (incl. tax)', money(s.revenue)], ['Less tax collected', money(s.tax_collected)], ['Net sales', money(s.net_sales)], ['Cost of products sold', money(s.cogs)], ['Gross profit', money(s.gross_profit)], ['Operating expenses', money(s.operating_expenses)], ['Net operating profit', money(s.net_profit)], ['Gross margin', pct(s.gross_margin)], ['Net margin', pct(s.net_margin)]],
        columns: [{ key: 'month', label: 'Month', format: monthLabel }, { key: 'net_sales', label: 'Net sales', ...M }, { key: 'gross_profit', label: 'Gross profit', ...M }, { key: 'operating_expenses', label: 'Expenses', ...M }, { key: 'net_profit', label: 'Net profit', ...M }, { key: 'net_margin', label: 'Margin %', align: 'right' }], rows: d.monthly }];
    }
    case 'customers': return [
      { title: 'Summary', summary: [['New customers', d.stats.new_customers], ['Customers billed', d.stats.visitors], ['Returning', d.stats.returning], ['Retention', d.stats.retention_rate != null ? pct(d.stats.retention_rate) : '—'], ['Average spend', money(d.stats.avg_spend)]], columns: [{ key: 'name', label: 'Service' }, { key: 'bookings', label: 'Bookings' }], rows: d.popular_services },
      { title: 'Top customers', columns: [{ key: 'name', label: 'Customer' }, { key: 'phone', label: 'Mobile' }, { key: 'visits', label: 'Visits' }, { key: 'spent', label: 'Spent', ...M }], rows: d.top_customers },
      { title: 'Inactive 60d', columns: [{ key: 'name', label: 'Customer' }, { key: 'phone', label: 'Mobile' }, { key: 'last_visit', label: 'Last visit' }, { key: 'visits', label: 'Visits' }], rows: d.inactive },
    ];
    case 'employees': return [{ title: 'Employee performance', columns: [{ key: 'name', label: 'Employee' }, ...(d.employees[0]?.revenue !== undefined ? [{ key: 'revenue', label: 'Sales', ...M }, { key: 'commission', label: 'Commission', ...M }] : []), { key: 'completed', label: 'Completed' }, { key: 'customers', label: 'Customers' }, { key: 'present_days', label: 'Days present' }, { key: 'hours_worked', label: 'Hours' }, { key: 'rating', label: 'Rating' }], rows: d.employees }];
    default: return [{ title: 'Appointments', summary: [['Total', d.stats.total], ['Completed', d.stats.completed], ['Cancelled', d.stats.cancelled], ['No-show', d.stats.no_show], ['Online / QR', d.stats.online], ['Walk-ins', d.stats.walk_in]], columns: [{ key: 'status', label: 'Status', format: titleCase }, { key: 'count', label: 'Count' }], rows: d.by_status }];
  }
}

function Revenue({ d }) {
  const t = d.totals;
  return <>
    <div className="grid g4 kpis">
      <Kpi className="hero-kpi" label="Revenue" value={money(t.total)} meta={`${num(t.invoices)} invoices`} /><Kpi label="Net sales (excl. tax)" value={money(t.net)} meta={`Tax ${money(t.tax)}`} />
      <Kpi tone="success" label="Collected" value={money(t.paid)} meta={`Avg bill ${money(t.invoices ? t.total / t.invoices : 0)}`} /><Kpi tone="warning" label="Outstanding (all time)" value={money(d.outstanding.amount)} meta={`${d.outstanding.invoices} invoices`} />
    </div>
    <Card className="mt" title="Revenue trend"><TrendChart data={d.series} gran={d.gran} type={d.series.length > 40 ? 'area' : 'bar'} series={[{ key: 'revenue', name: 'Revenue', color: CHART[0] }, { key: 'expenses', name: 'Expenses', color: CHART[1] }]} /></Card>
    <div className="grid g2 mt">
      <Card title="Service-wise revenue">{d.by_service.length ? <BarList items={d.by_service.slice(0, 12)} valueKey="revenue" fmt={(v, it) => `${money(v)} · ${it.count}`} /> : <Empty title="No service sales" />}</Card>
      <Card title="Payment methods">{d.by_method.length ? <Donut data={d.by_method.map((m) => ({ name: payLabel(m.method), value: m.amount }))} /> : <Empty title="No payments" />}</Card>
      <Card title="Employee-wise revenue">{d.by_employee.some((e) => e.revenue) ? <BarList items={d.by_employee.filter((e) => e.revenue > 0)} valueKey="revenue" fmt={money} color={CHART[2]} /> : <Empty title="No sales" />}</Card>
      <Card title="Product-wise revenue">{d.by_product.length ? <BarList items={d.by_product.slice(0, 12)} valueKey="revenue" fmt={(v, it) => `${money(v)} · ${it.qty} sold`} color={CHART[1]} /> : <Empty title="No product sales" />}</Card>
    </div>
    {d.by_branch.length > 1 && <Card className="mt" title="Branch comparison" pad={false}><div className="table-wrap"><table className="table"><thead><tr><th>Branch</th><th className="right">Revenue</th><th className="right">Invoices</th><th className="right">Customers</th><th className="right">Expenses</th><th className="right">Revenue − expenses</th></tr></thead><tbody>
      {d.by_branch.map((b) => <tr key={b.name}><td><b>{b.name}</b></td><td className="num">{money(b.total)}</td><td className="num">{b.invoices}</td><td className="num">{b.customers}</td><td className="num">{money(b.expenses)}</td><td className="num"><b>{money(b.total - b.expenses)}</b></td></tr>)}
    </tbody></table></div></Card>}
  </>;
}

function Expenses({ d }) {
  return <>
    <div className="grid g3 kpis"><Kpi tone="danger" label="Total expenses" value={money(d.total)} /><Kpi label="Largest category" value={d.by_category[0]?.category || '—'} meta={d.by_category[0] ? money(d.by_category[0].amount) : ''} /><Kpi tone="info" label="Recurring commitments" value={d.recurring.length} meta={money(d.recurring.reduce((a, r) => a + r.amount, 0)) + ' per cycle'} /></div>
    <div className="grid g2 mt">
      <Card title="Category-wise expenses">{d.by_category.length ? <Donut data={d.by_category.map((c) => ({ name: c.category, value: c.amount }))} /> : <Empty title="No expenses in this period" />}</Card>
      <Card title="Monthly expense trend (12 months)"><TrendChart data={d.monthly.map((m) => ({ period: m.month, amount: m.amount }))} gran="month" type="bar" series={[{ key: 'amount', name: 'Expenses', color: CHART[1] }]} height={240} /></Card>
    </div>
    <Card className="mt" title="Recurring expenses" pad={false}>{d.recurring.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Category</th><th>Description</th><th>Repeats</th><th>Next due</th><th className="right">Amount</th></tr></thead><tbody>
      {d.recurring.map((r) => <tr key={r.id}><td>{r.category}</td><td className="muted">{r.description}</td><td>{titleCase(r.recurrence)}</td><td>{fmtDate(r.next_due)}</td><td className="num">{money(r.amount)}</td></tr>)}</tbody></table></div> : <Empty title="No recurring expenses" />}</Card>
  </>;
}

function Profit({ d }) {
  const s = d.statement;
  const L = ({ l, v, b, neg, sub }) => <div className="mini-stat" style={{ fontSize: b ? 15 : 13.5 }}><span className={sub ? 'muted' : ''} style={{ paddingLeft: sub ? 14 : 0, fontWeight: b ? 600 : 400 }}>{l}</span><span className="num" style={{ fontWeight: b ? 700 : 500, color: neg ? 'var(--danger)' : undefined }}>{neg ? `− ${money(v)}` : money(v)}</span></div>;
  return <>
    <div className="grid g4 kpis">
      <Kpi className="hero-kpi" label="Net operating profit" value={money(s.net_profit)} meta={`${pct(s.net_margin)} net margin`} />
      <Kpi tone="success" label="Gross profit" value={money(s.gross_profit)} meta={`${pct(s.gross_margin)} gross margin`} />
      <Kpi label="Total revenue" value={money(s.revenue)} /><Kpi tone="danger" label="Total expenses" value={money(s.total_expenses)} meta="Incl. product purchases" />
    </div>
    <div className="grid mt" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.5fr)', gap: 16 }}>
      <Card title="Profit & loss statement">
        <L l="Revenue (incl. tax)" v={s.revenue} /><L l="GST / tax collected" v={s.tax_collected} neg sub /><L l="Net sales" v={s.net_sales} b /><L l="Cost of products sold" v={s.cogs} neg sub /><L l="Gross profit" v={s.gross_profit} b />
        <L l="Operating expenses" v={s.operating_expenses} neg sub /><L l="Net operating profit" v={s.net_profit} b />
        <p className="faint tiny mt">Product purchases are counted through cost of goods sold, so they aren't subtracted twice.</p>
      </Card>
      <Card title="Monthly profit (12 months)"><TrendChart data={d.monthly.map((m) => ({ period: m.month, net_sales: m.net_sales, net_profit: m.net_profit }))} gran="month" type="bar" series={[{ key: 'net_sales', name: 'Net sales', color: CHART[2] }, { key: 'net_profit', name: 'Net profit', color: CHART[0] }]} /></Card>
    </div>
  </>;
}

function Customers({ d, finance }) {
  const s = d.stats;
  return <>
    <div className="grid g4 kpis">
      <Kpi label="New customers" value={s.new_customers} /><Kpi tone="info" label="Customers billed" value={s.visitors} meta={`${s.first_time} first-time`} />
      <Kpi tone="success" label="Returning" value={s.returning} meta={s.retention_rate != null ? `${s.retention_rate}% retained from previous period` : ''} />
      {finance && <Kpi tone="accent" label="Average spend" value={money(s.avg_spend)} />}
    </div>
    <div className="grid g2 mt">
      <Card title="Most popular services">{d.popular_services.length ? <BarList items={d.popular_services} valueKey="bookings" fmt={(v) => `${v} bookings`} /> : <Empty title="No bookings" />}</Card>
      <Card title="New customers by source">{d.by_source.length ? <Donut data={d.by_source.map((x) => ({ name: x.source === 'qr' ? 'QR code' : titleCase(x.source), value: x.count }))} fmt={(v) => v} /> : <Empty title="No new customers" />}</Card>
    </div>
    <div className="grid g2 mt">
      {finance && <Card title="Top customers" pad={false}>{d.top_customers.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Customer</th><th className="right">Visits</th><th className="right">Spent</th></tr></thead><tbody>{d.top_customers.slice(0, 10).map((c) => <tr key={c.id}><td><b>{c.name}</b><div className="faint tiny">{c.phone}</div></td><td className="num">{c.visits}</td><td className="num">{money(c.spent)}</td></tr>)}</tbody></table></div> : <Empty title="No sales" />}</Card>}
      <Card title="Inactive customers (60+ days)" pad={false}>{d.inactive.length ? <div className="table-wrap" style={{ maxHeight: 420 }}><table className="table"><thead><tr><th>Customer</th><th>Last visit</th><th className="right">Visits</th></tr></thead><tbody>{d.inactive.map((c) => <tr key={c.id}><td><b>{c.name}</b><div className="faint tiny">{c.phone}</div></td><td>{fmtDate(c.last_visit)}</td><td className="num">{c.visits}</td></tr>)}</tbody></table></div> : <Empty title="No inactive customers" />}</Card>
    </div>
  </>;
}

function Employees({ d, finance }) {
  return (
    <Card pad={false} title="Employee productivity">
      <div style={{ height: 10 }} />
      {!d.employees.length ? <Empty title="No employees" /> : <div className="table-wrap"><table className="table">
        <thead><tr><th>Employee</th>{finance && <><th className="right">Service sales</th><th className="right">Product sales</th><th className="right">Commission</th><th className="right">Sales / hour</th></>}<th className="right">Completed</th><th className="right">Cancel / no-show</th><th className="right">Customers</th><th className="right">Days present</th><th className="right">Hours</th><th>Rating</th></tr></thead>
        <tbody>{d.employees.map((e) => <tr key={e.id}><td><b>{e.name}</b><div className="faint tiny">{e.designation}</div></td>
          {finance && <><td className="num">{money(e.service_revenue)}</td><td className="num">{money(e.product_revenue)}</td><td className="num">{money(e.commission)}</td><td className="num">{e.revenue_per_hour ? money(e.revenue_per_hour) : '—'}</td></>}
          <td className="num">{e.completed}</td><td className="num">{e.cancelled + e.no_show}</td><td className="num">{e.customers}</td><td className="num">{e.present_days}</td><td className="num">{e.hours_worked}</td><td>{e.rating ? <><Stars value={e.rating} /> <span className="faint tiny">{e.rating}</span></> : '—'}</td></tr>)}</tbody>
      </table></div>}
    </Card>
  );
}

function Appointments({ d }) {
  const s = d.stats;
  return <>
    <div className="grid g4 kpis"><Kpi label="Total appointments" value={s.total} /><Kpi tone="success" label="Completed" value={s.completed} meta={s.total ? `${Math.round((s.completed / s.total) * 100)}% completion` : ''} /><Kpi tone="danger" label="Cancelled / no-show" value={s.cancelled + s.no_show} /><Kpi tone="info" label="Online & QR" value={s.online} meta={`${s.walk_in} walk-ins`} /></div>
    <div className="grid g2 mt">
      <Card title="By booking source">{d.by_source.length ? <Donut data={d.by_source.map((x) => ({ name: x.source === 'qr' ? 'QR code' : titleCase(x.source), value: x.count }))} fmt={(v) => v} /> : <Empty title="No data" />}</Card>
      <Card title="Busiest hours"><TrendChart data={d.by_hour.map((h) => ({ period: h.hour, count: h.count }))} type="bar" fmt={(v) => `${v} appts`} yFmt={(v) => v} series={[{ key: 'count', name: 'Appointments', color: CHART[0] }]} height={240} gran="hour" /></Card>
    </div>
  </>;
}
