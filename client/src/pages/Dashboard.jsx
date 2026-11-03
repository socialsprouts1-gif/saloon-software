import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  IndianRupee, TrendingUp, Wallet, AlertCircle, CalendarCheck, CalendarX, CalendarClock, UserPlus, Repeat, Footprints, Users, UserCheck, UserX, Plane,
  Package, PackageX, PackageMinus, ShoppingBag, Sparkles, Receipt, CalendarPlus, LogIn, LogOut, Clock,
} from 'lucide-react';
import { useApi, useAuth, useToast } from '../context.jsx';
import { api } from '../lib/api.js';
import { money, compact, num, fmtDT, fmtTime, payLabel, today } from '../lib/format.js';
import { Card, Kpi, Seg, Loader, ErrorState, Empty, Badge, Avatar, Button, Stars } from '../components/ui.jsx';
import { TrendChart, Donut, BarList, CHART } from '../components/charts.jsx';
import { InsightList } from '../components/AIPanel.jsx';

export default function Dashboard() {
  const { user, can, branchName } = useAuth();
  const { data, loading, error, reload } = useApi('/api/dashboard');
  const nav = useNavigate();
  if (loading && !data) return <><Head user={user} branchName={branchName} /><div className="card"><Loader rows={6} /></div></>;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (data.personal) return <Personal data={data} reload={reload} user={user} />;
  const f = data.finance, a = data.appointments_today, am = data.appointments_month, c = data.customers_month, s = data.staff, inv = data.inventory;

  return (
    <div>
      <Head user={user} branchName={branchName}>
        {can('appointments') && <Button icon={CalendarPlus} onClick={() => nav('/appointments?new=1')}>New appointment</Button>}
        {can('billing') && <Button variant="primary" icon={Receipt} onClick={() => nav('/pos')}>New bill</Button>}
      </Head>

      {f && <>
        <div className="grid g4 kpis">
          <Kpi className="hero-kpi" icon={IndianRupee} label="Revenue today" value={money(f.revenue.today)} meta={`${num(a.completed)} completed appointment${a.completed === 1 ? '' : 's'}`} />
          <Kpi icon={TrendingUp} label="This week" value={compact(f.revenue.week)} meta="Since Monday" />
          <Kpi icon={TrendingUp} tone="accent" label="This month" value={compact(f.revenue.month)} meta={`Net profit ${compact(f.net_profit_month)}`} />
          <Kpi icon={TrendingUp} tone="info" label="This year" value={compact(f.revenue.year)} meta="Year to date" />
        </div>
        <div className="grid g4 kpis mt">
          <Kpi icon={Wallet} tone="danger" label="Expenses (month)" value={compact(f.expenses_month)} meta="Incl. salaries & purchases" />
          <Kpi icon={IndianRupee} tone={f.net_profit_month >= 0 ? 'success' : 'danger'} label="Net profit (month)" value={compact(f.net_profit_month)} meta="Net sales − COGS − operating costs" />
          <Kpi icon={AlertCircle} tone="warning" label="Pending today" value={money(f.pending_payments_today)} meta="Unpaid on today's bills" />
          <Kpi icon={AlertCircle} tone="warning" label="Total outstanding" value={compact(f.outstanding.amount)} meta={<Link to="/invoices?status=due">{f.outstanding.invoices} invoice(s) due →</Link>} />
        </div>
        <RevenueCard />
      </>}

      <div className="section-title">Business today</div>
      <div className="grid g4 kpis">
        <Kpi icon={CalendarCheck} label="Appointments today" value={num(a.total)} meta={`${a.completed} completed · ${a.online} online`} />
        <Kpi icon={CalendarClock} tone="info" label="Upcoming" value={num(a.upcoming)} meta="Pending & confirmed from today" />
        <Kpi icon={CalendarX} tone="danger" label="Cancelled / no-show" value={num(a.cancelled + a.no_show)} meta={`${am.cancelled + am.no_show} this month`} />
        <Kpi icon={Footprints} tone="accent" label="Walk-ins today" value={num(a.walk_in)} meta={`${am.walk_in} this month`} />
        <Kpi icon={UserPlus} tone="success" label="New customers (month)" value={num(c.new_customers)} meta={`${c.first_time} first-time visitors`} />
        <Kpi icon={Repeat} label="Returning (month)" value={num(c.returning)} meta={c.retention_rate != null ? `${c.retention_rate}% retention` : 'of customers billed'} />
        {f && <Kpi icon={ShoppingBag} tone="accent" label="Avg. customer spend" value={money(c.avg_spend)} meta="This month" />}
        <Kpi icon={Users} tone="info" label="Customers billed (month)" value={num(c.visitors)} />
      </div>

      <div className="grid g3 mt">
        <Card title="Upcoming appointments" actions={<Link to="/appointments" className="small">View calendar →</Link>} pad={false}>
          {data.upcoming.length ? <div style={{ padding: '6px 0' }}>{data.upcoming.map((u) => (
            <Link key={u.id} to={`/appointments?id=${u.id}`} className="row" style={{ padding: '9px 20px', color: 'inherit', textDecoration: 'none' }}>
              <div style={{ width: 62 }} className="small"><b>{fmtTime(u.start_at.slice(11))}</b><div className="faint tiny">{u.start_at.slice(0, 10) === today() ? 'Today' : fmtDT(u.start_at).split(',')[0]}</div></div>
              <div className="grow"><div className="truncate" style={{ fontWeight: 600 }}>{u.customer}</div><div className="faint small truncate">{u.employee || 'Unassigned'}</div></div>
              <Badge status={u.status} />
            </Link>
          ))}</div> : <Empty icon={CalendarClock} title="No upcoming appointments" />}
        </Card>
        <Card title="Staff today" actions={<Link to="/attendance" className="small">Attendance →</Link>}>
          <div className="grid g2" style={{ gap: 10 }}>
            <MiniTile icon={Users} label="Total staff" value={s.total} />
            <MiniTile icon={UserCheck} label="Present" value={s.present} tone="success" />
            <MiniTile icon={UserX} label="Absent" value={s.absent} tone="danger" />
            <MiniTile icon={Plane} label="Leave / off" value={s.on_leave + s.weekly_off} tone="info" />
          </div>
          <div className="section-title" style={{ marginTop: 18 }}>Top performers this month</div>
          {data.top_employees.length ? data.top_employees.map((e, i) => (
            <Link key={e.id} to={`/employees/${e.id}`} className="row" style={{ padding: '6px 0', color: 'inherit', textDecoration: 'none' }}>
              <span className="faint small" style={{ width: 14 }}>{i + 1}</span><Avatar name={e.name} src={e.photo} size="sm" />
              <div className="grow"><div className="truncate" style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div><div className="faint tiny">{e.completed} done{e.rating ? <> · <Stars value={e.rating} /></> : ''}</div></div>
              {e.revenue != null && <b className="num small">{compact(e.revenue)}</b>}
            </Link>
          )) : <p className="faint small">No sales recorded this month yet.</p>}
        </Card>
        <Card title="Inventory" actions={<Link to="/inventory" className="small">Manage →</Link>}>
          <div className="grid g2" style={{ gap: 10 }}>
            {inv.value !== undefined && <MiniTile icon={Package} label="Stock value" value={compact(inv.value)} />}
            <MiniTile icon={ShoppingBag} label="Sold today" value={inv.sold_today} tone="success" />
            <MiniTile icon={PackageMinus} label="Low stock" value={inv.low_stock} tone="warning" />
            <MiniTile icon={PackageX} label="Out of stock" value={inv.out_of_stock} tone="danger" />
          </div>
          <div className="section-title" style={{ marginTop: 18 }}>Needs restocking</div>
          {data.low_stock.length ? data.low_stock.map((p) => (
            <div key={p.id} className="mini-stat small"><span className="truncate">{p.name}</span><Badge tone={p.stock <= 0 ? 'red' : 'amber'}>{p.stock} left</Badge></div>
          )) : <p className="faint small">All products are above minimum levels.</p>}
        </Card>
      </div>

      <div className="grid g3 mt">
        <Card title="Popular services (month)">
          {data.popular_services.length ? <BarList items={data.popular_services} valueKey="bookings" fmt={(v) => `${v} bookings`} /> : <p className="faint small">No bookings yet this month.</p>}
        </Card>
        {f && <Card title="Payment methods (month)">
          {f.payment_methods_month.length ? <Donut data={f.payment_methods_month.map((m) => ({ name: payLabel(m.method), value: m.amount }))} height={160} /> : <p className="faint small">No payments yet this month.</p>}
        </Card>}
        {can('ai') && <Card title={<h2 className="row" style={{ gap: 8 }}><Sparkles size={16} style={{ color: 'var(--accent)' }} />Smart insights</h2>} actions={<Link to="/assistant" className="small">Ask AI →</Link>}><Insights /></Card>}
      </div>
    </div>
  );
}

function Head({ user, branchName, children }) {
  const h = new Date().getHours();
  return (
    <div className="page-head">
      <div><h1>Good {h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}, {user.name.split(' ')[0]}</h1>
        <div className="sub">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {branchName}</div></div>
      {children && <div className="row wrap">{children}</div>}
    </div>
  );
}

const MiniTile = ({ icon: Icon, label, value, tone = '' }) => (
  <div className={`kpi ${tone}`} style={{ padding: 12, background: 'var(--bg-elev)', borderRadius: 12, border: '1px solid var(--border)' }}>
    <div className="label" style={{ fontSize: 12 }}><span className="ico" style={{ width: 24, height: 24 }}><Icon size={13} /></span>{label}</div>
    <div className="value" style={{ fontSize: 20 }}>{value}</div>
  </div>
);

function RevenueCard() {
  const [gran, setGran] = useState('day');
  const { data, loading } = useApi('/api/dashboard/chart', { gran });
  const totals = (data || []).reduce((t, x) => ({ r: t.r + x.revenue, e: t.e + x.expenses }), { r: 0, e: 0 });
  return (
    <Card className="mt" title={<div><h2>Revenue & expenses</h2><div className="legend mt-sm"><span><i style={{ background: CHART[0] }} />Revenue {compact(totals.r)}</span><span><i style={{ background: CHART[1] }} />Expenses {compact(totals.e)}</span></div></div>}
      actions={<Seg value={gran} onChange={setGran} options={[['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']]} />}>
      {loading && !data ? <div className="skeleton" style={{ height: 280 }} /> : <TrendChart data={data} gran={gran} type={gran === 'year' ? 'bar' : 'area'} series={[{ key: 'revenue', name: 'Revenue', color: CHART[0] }, { key: 'expenses', name: 'Expenses', color: CHART[1] }]} />}
    </Card>
  );
}

function Insights() {
  const { data, loading } = useApi('/api/ai/insights');
  if (loading && !data) return <Loader rows={3} />;
  return <InsightList items={(data || []).slice(0, 5)} />;
}

function Personal({ data, reload, user }) {
  const toast = useToast();
  const punch = async (action) => { try { await api.post('/api/staff/attendance/punch', { employee_id: user.employee_id, action }); toast.success(action === 'in' ? 'Checked in' : 'Checked out'); reload(); } catch (e) { toast.error(e); } };
  const p = data.performance, att = data.attendance;
  return (
    <div>
      <Head user={user} branchName={data.employee?.designation || ''} />
      <div className="grid g4 kpis">
        <Kpi className="hero-kpi" icon={Clock} label="Today's attendance" value={att?.check_in ? (att.check_out ? 'Done' : 'Checked in') : 'Not in'} meta={att?.check_in ? `In ${fmtTime(att.check_in)}${att.check_out ? ` · Out ${fmtTime(att.check_out)}` : ''}` : 'Tap check in when you arrive'} />
        <Kpi icon={CalendarCheck} label="My appointments today" value={data.today_appointments.length} />
        <Kpi icon={CalendarCheck} tone="success" label="Completed this month" value={p?.completed ?? 0} />
        <Kpi icon={Users} tone="accent" label="Customer rating" value={p?.rating ? `${p.rating} ★` : '—'} meta={p?.ratings ? `${p.ratings} reviews` : 'No reviews yet'} />
      </div>
      <div className="row mt">
        <Button variant="primary" icon={LogIn} disabled={!!att?.check_in} onClick={() => punch('in')}>Check in</Button>
        <Button icon={LogOut} disabled={!att?.check_in || !!att?.check_out} onClick={() => punch('out')}>Check out</Button>
      </div>
      <Card className="mt" title="My schedule today" pad={false}>
        {data.today_appointments.length ? (
          <div className="table-wrap"><table className="table"><thead><tr><th>Time</th><th>Customer</th><th>Services</th><th>Status</th></tr></thead><tbody>
            {data.today_appointments.map((a) => <tr key={a.id}><td className="nowrap">{fmtTime(a.start_at.slice(11))} – {fmtTime(a.end_at.slice(11))}</td><td>{a.customer}</td><td className="muted">{a.services}</td><td><Badge status={a.status} /></td></tr>)}
          </tbody></table></div>
        ) : <Empty icon={CalendarCheck} title="No appointments today" />}
      </Card>
    </div>
  );
}
