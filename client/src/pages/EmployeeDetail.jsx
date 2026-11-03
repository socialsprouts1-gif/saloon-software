import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, IndianRupee, CalendarCheck, Star, Clock, Coins, FileDown } from 'lucide-react';
import { useApi, useAuth } from '../context.jsx';
import { money, fmtDate, titleCase, DOW, fmtTime, monthLabel } from '../lib/format.js';
import { salarySlipPDF } from '../lib/pdf.js';
import { Card, Button, Badge, Loader, ErrorState, Avatar, Kpi, Tabs, Empty, Stars, DateRange, rangeFor } from '../components/ui.jsx';
import { EmployeeForm, salaryText } from './Employees.jsx';

export default function EmployeeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, salon } = useAuth();
  const [range, setRange] = useState({ period: 'month', ...rangeFor('month') });
  const { data: e, error, reload } = useApi(`/api/staff/employees/${id}`, { from: range.from, to: range.to });
  const [tab, setTab] = useState('sales');
  const [edit, setEdit] = useState(false);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!e) return <Loader rows={8} />;
  const p = e.performance || {};
  return (
    <div>
      <Button variant="ghost" icon={ArrowLeft} onClick={() => nav('/employees')}>Employees</Button>
      <div className="card card-pad row wrap" style={{ gap: 18, margin: '8px 0 16px' }}>
        <Avatar name={e.name} src={e.photo} size="lg" />
        <div className="grow">
          <div className="row wrap"><h1>{e.name}</h1><Badge status={e.status} /></div>
          <div className="muted small mt-sm">{e.designation || titleCase(e.role)} · {e.department || '—'} · {e.branch_name} branch</div>
          <div className="faint small">{e.phone} {e.email && `· ${e.email}`} · Joined {fmtDate(e.joining_date)} · Shift {fmtTime(e.work_start)}–{fmtTime(e.work_end)} · Off {e.weekly_off != null ? DOW[e.weekly_off] : 'none'}</div>
          {e.base_salary !== undefined && <div className="small mt-sm"><Badge tone="plum">{salaryText(e)}</Badge>{e.product_commission_pct > 0 && <Badge tone="rose">{e.product_commission_pct}% on products</Badge>}</div>}
        </div>
        <div className="row wrap"><DateRange value={range} onChange={setRange} />{can('employees') && <Button icon={Pencil} onClick={() => setEdit(true)}>Edit</Button>}</div>
      </div>
      <div className="grid g4 kpis">
        {p.revenue !== undefined && <Kpi icon={IndianRupee} className="hero-kpi" label="Revenue generated" value={money(p.revenue)} meta={`Services ${money(p.service_revenue)} · Products ${money(p.product_revenue)}`} />}
        <Kpi icon={CalendarCheck} label="Appointments completed" value={p.completed ?? 0} meta={`${p.appointments ?? 0} booked · ${p.cancelled ?? 0} cancelled · ${p.no_show ?? 0} no-show`} />
        {p.commission !== undefined && <Kpi icon={Coins} tone="accent" label="Commission earned" value={money(p.commission)} />}
        <Kpi icon={Star} tone="warning" label="Customer rating" value={p.rating ? `${p.rating} ★` : '—'} meta={`${p.ratings || 0} reviews`} />
        <Kpi icon={Clock} tone="info" label="Attendance" value={`${p.present_days ?? 0} days`} meta={`${p.hours_worked ?? 0} h worked${p.revenue_per_hour ? ` · ${money(p.revenue_per_hour)}/h` : ''}`} />
      </div>
      <Card className="mt" pad={false}>
        <div style={{ padding: '6px 16px 0' }}><Tabs value={tab} onChange={setTab} tabs={[['sales', 'Sales', e.sales.length], ['services', 'Services', e.services.length], ['feedback', 'Ratings', e.feedback.length], ...(can('payroll') ? [['payroll', 'Salary history', e.payroll.length]] : [])]} /></div>
        {tab === 'sales' && (e.sales.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Date</th><th>Invoice</th><th>Item</th><th className="right">Qty</th><th className="right">Amount</th><th className="right">Commission</th></tr></thead><tbody>
          {e.sales.map((s, i) => <tr key={i}><td>{fmtDate(s.date)}</td><td>{s.invoice_no}</td><td>{s.name} <span className="faint tiny">{s.item_type}</span></td><td className="num">{s.qty}</td><td className="num">{money(s.total)}</td><td className="num">{money(s.commission_amount)}</td></tr>)}
        </tbody></table></div> : <Empty title="No sales in this period" />)}
        {tab === 'services' && <div className="card-body chips">{e.services.length ? e.services.map((s) => <span key={s.id} className="chip">{s.name}</span>) : <p className="faint">No services assigned.</p>}</div>}
        {tab === 'feedback' && (e.feedback.length ? <div className="card-body">{e.feedback.map((f) => <div key={f.id} className="mini-stat" style={{ alignItems: 'flex-start' }}><div><Stars value={f.rating} /> <span className="muted small">{f.customer}</span>{f.comment && <p className="small">“{f.comment}”</p>}</div><span className="faint tiny">{fmtDate(f.created_at.slice(0, 10))}</span></div>)}</div> : <Empty icon={Star} title="No ratings yet" />)}
        {tab === 'payroll' && (e.payroll.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Month</th><th className="right">Base</th><th className="right">Commission</th><th className="right">Deductions</th><th className="right">Net</th><th>Status</th><th /></tr></thead><tbody>
          {e.payroll.map((r) => <tr key={r.id}><td>{monthLabel(r.month)}</td><td className="num">{money(r.earned_base)}</td><td className="num">{money(r.service_commission + r.product_commission)}</td><td className="num">{money(r.deductions + r.advance)}</td><td className="num"><b>{money(r.net_payable)}</b></td><td><Badge status={r.status} /></td><td><Button size="sm" variant="ghost" icon={FileDown} onClick={() => salarySlipPDF(r, e, salon)}>Slip</Button></td></tr>)}
        </tbody></table></div> : <Empty title="No payroll generated yet" />)}
      </Card>
      {edit && <EmployeeForm initial={e} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
    </div>
  );
}
