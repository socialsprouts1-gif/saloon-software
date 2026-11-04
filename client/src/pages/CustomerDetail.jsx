import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { StampCard, cardUrl } from '../components/Loyalty.jsx';
import { CardDrawer, IssueModal } from './LoyaltyCards.jsx';
import { Pencil, CalendarPlus, Receipt, MessageCircle, Star, Gift, Phone, Mail, Cake, ArrowLeft, Coins, CreditCard, Plus } from 'lucide-react';
import { useApi, useAuth, useToast } from '../context.jsx';
import { api } from '../lib/api.js';
import { money, fmtDate, fmtDT, titleCase } from '../lib/format.js';
import { Card, Button, Badge, Loader, ErrorState, Avatar, Kpi, Tabs, Empty, Modal, Select, Textarea, Input, Stars } from '../components/ui.jsx';
import { CustomerForm } from './Customers.jsx';

export default function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const { data: c, error, reload } = useApi(`/api/customers/${id}`);
  const [tab, setTab] = useState('visits');
  const [editing, setEditing] = useState(false);
  const [fb, setFb] = useState(false);
  const [pts, setPts] = useState(false);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!c) return <Loader rows={8} />;
  const wa = `https://wa.me/${c.phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}`;
  return (
    <div>
      <Button variant="ghost" icon={ArrowLeft} onClick={() => nav('/customers')} className="mb">Customers</Button>
      <div className="card card-pad row wrap" style={{ gap: 18, marginBottom: 16, marginTop: 8 }}>
        <Avatar name={c.name} size="lg" />
        <div className="grow">
          <div className="row wrap"><h1>{c.name}</h1><Badge status={c.segment} /></div>
          <div className="row wrap muted small mt-sm" style={{ gap: 16 }}>
            <a href={`tel:${c.phone}`} className="row" style={{ gap: 5 }}><Phone size={14} />{c.phone}</a>
            {c.email && <span className="row" style={{ gap: 5 }}><Mail size={14} />{c.email}</span>}
            {c.birthday && <span className="row" style={{ gap: 5 }}><Cake size={14} />{fmtDate(c.birthday, { day: 'numeric', month: 'long' })}</span>}
            <span>Customer since {fmtDate(c.created_at.slice(0, 10))} · via {titleCase(c.source)}</span>
          </div>
          {c.notes && <p className="mt-sm small" style={{ background: 'var(--warning-soft)', padding: '6px 10px', borderRadius: 8, display: 'inline-block' }}>📝 {c.notes}</p>}
        </div>
        <div className="row wrap">
          <a className="btn success" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={16} />WhatsApp</a>
          <Button icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>
          {can('appointments') && <Button icon={CalendarPlus} onClick={() => nav('/appointments?new=1')}>Book</Button>}
          {can('billing') && <Button variant="primary" icon={Receipt} onClick={() => nav('/pos')}>Bill</Button>}
        </div>
      </div>
      <div className="grid g4 kpis">
        <Kpi label="Visits" value={c.visits} meta={c.last_visit ? `Last ${fmtDate(c.last_visit)}` : 'No visits yet'} />
        {c.spent !== undefined && <Kpi tone="accent" label="Lifetime value" value={money(c.spent)} meta={c.visits ? `Avg ${money(c.spent / c.visits)} per visit` : ''} />}
        <Kpi tone="info" icon={Coins} label="Loyalty points" value={c.loyalty_points} meta={can('customers') ? <button className="btn ghost sm" style={{ height: 22, padding: '0 6px' }} onClick={() => setPts(true)}>Adjust</button> : null} />
        <Kpi tone={c.due > 0 ? 'warning' : 'success'} label={c.due !== undefined ? 'Payment due' : 'Rating given'} value={c.due !== undefined ? money(c.due) : c.avg_rating ? `${c.avg_rating} ★` : '—'} />
      </div>
      <div className="grid g3 mt">
        <Card title="Preferences">
          <div className="mini-stat"><span className="muted">Preferred stylist</span><b>{c.preferred_employee || c.top_stylist?.name || '—'}</b></div>
          <div className="mini-stat"><span className="muted">Most served by</span><b>{c.top_stylist ? `${c.top_stylist.name} (${c.top_stylist.n})` : '—'}</b></div>
          <div className="mini-stat"><span className="muted">Upcoming</span><b>{c.upcoming ? fmtDT(c.upcoming.start_at) : 'None'}</b></div>
          <div className="mini-stat"><span className="muted">Avg rating given</span><b>{c.avg_rating ? <Stars value={c.avg_rating} /> : '—'}</b></div>
        </Card>
        <Card title="Services purchased">
          {c.services_purchased.length ? c.services_purchased.slice(0, 8).map((s) => <div key={s.name} className="mini-stat small"><span>{s.name}</span><span className="faint">{s.count}× · {fmtDate(s.last)}</span></div>) : <p className="faint small">No services yet.</p>}
        </Card>
        <Card title="Packages & memberships">
          {c.packages.length ? c.packages.map((p) => (
            <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
              <div className="row between"><b className="small">{p.package_name}</b><Badge status={p.status} /></div>
              <div className="faint tiny">Valid till {fmtDate(p.expires_at)}{p.discount_pct ? ` · ${p.discount_pct}% off services` : ''}</div>
              {p.credits.map((cr) => <div key={cr.id} className="tiny muted">{cr.service}: {cr.total - cr.used}/{cr.total} left</div>)}
            </div>
          )) : <p className="faint small"><Gift size={14} /> No packages. Sell one from POS → Packages.</p>}
        </Card>
      </div>
      <LoyaltySection customer={c} />
      <Card className="mt" pad={false}>
        <div style={{ padding: '6px 16px 0' }} className="row between"><Tabs value={tab} onChange={setTab} tabs={[['visits', 'Appointments', c.appointments.length], ...(c.invoices.length || can('billing') ? [['invoices', 'Invoices', c.invoices.length]] : []), ['feedback', 'Feedback', c.feedback.length]]} />
          {tab === 'feedback' && <Button size="sm" icon={Star} onClick={() => setFb(true)}>Add feedback</Button>}</div>
        {tab === 'visits' && (c.appointments.length ? <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Services</th><th>Stylist</th><th>Source</th><th>Status</th></tr></thead><tbody>
          {c.appointments.map((a) => <tr key={a.id} className="click" onClick={() => nav(`/appointments?id=${a.id}`)}><td className="nowrap">{fmtDT(a.start_at)}</td><td className="muted">{a.services}</td><td>{a.employee || '—'}</td><td><Badge status={a.source}>{titleCase(a.source)}</Badge></td><td><Badge status={a.status} /></td></tr>)}
        </tbody></table></div> : <Empty title="No appointments yet" />)}
        {tab === 'invoices' && (c.invoices.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Invoice</th><th>Date</th><th className="right">Total</th><th className="right">Balance</th><th>Status</th></tr></thead><tbody>
          {c.invoices.map((i) => <tr key={i.id} className="click" onClick={() => nav(`/invoices/${i.id}`)}><td><b>{i.invoice_no}</b></td><td>{fmtDate(i.date)}</td><td className="num">{money(i.total)}</td><td className="num">{i.balance > 0 ? money(i.balance) : '—'}</td><td><Badge status={i.status} /></td></tr>)}
        </tbody></table></div> : <Empty title="No invoices yet" />)}
        {tab === 'feedback' && (c.feedback.length ? <div className="card-body col">{c.feedback.map((f) => <div key={f.id} className="mini-stat" style={{ alignItems: 'flex-start' }}><div><Stars value={f.rating} /> <span className="muted small">for {f.employee || 'the salon'}</span>{f.comment && <p className="small mt-sm">“{f.comment}”</p>}</div><span className="faint tiny">{fmtDate(f.created_at.slice(0, 10))}</span></div>)}</div> : <Empty icon={Star} title="No feedback yet" />)}
      </Card>
      {editing && <CustomerForm initial={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {fb && <FeedbackModal customer={c} onClose={() => setFb(false)} onSaved={() => { setFb(false); reload(); }} />}
      {pts && <PointsModal customer={c} onClose={() => setPts(false)} onSaved={() => { setPts(false); reload(); }} />}
    </div>
  );
}

function FeedbackModal({ customer, onClose, onSaved }) {
  const emps = useApi('/api/staff/employees');
  const [f, setF] = useState({ rating: 5, comment: '', employee_id: customer.top_stylist?.id || '' });
  const toast = useToast();
  const save = async () => { try { await api.post(`/api/customers/${customer.id}/feedback`, { ...f, employee_id: f.employee_id ? Number(f.employee_id) : null }); toast.success('Feedback saved'); onSaved(); } catch (e) { toast.error(e); } };
  return (
    <Modal open onClose={onClose} title="Customer feedback" size="narrow" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="col">
        <div className="field"><label>Rating</label><div className="row">{[1, 2, 3, 4, 5].map((n) => <button key={n} className="btn ghost icon" onClick={() => setF({ ...f, rating: n })} aria-label={`${n} stars`} style={{ color: n <= f.rating ? '#d9a03a' : 'var(--border-strong)', fontSize: 22 }}>★</button>)}</div></div>
        <Select label="Stylist" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} placeholder="Salon overall" options={(emps.data || []).map((e) => [e.id, e.name])} />
        <Textarea label="Comment" rows={3} value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} />
      </div>
    </Modal>
  );
}
function PointsModal({ customer, onClose, onSaved }) {
  const [f, setF] = useState({ delta: '', reason: '' });
  const toast = useToast();
  const save = async () => { try { await api.post(`/api/customers/${customer.id}/points`, { delta: Number(f.delta), reason: f.reason }); toast.success('Points updated'); onSaved(); } catch (e) { toast.error(e); } };
  return (
    <Modal open onClose={onClose} title="Adjust loyalty points" size="narrow" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!Number(f.delta) || f.reason.length < 2} onClick={save}>Save</Button></>}>
      <div className="col"><p className="muted">Current balance: <b>{customer.loyalty_points}</b></p>
        <Input label="Points to add (use negative to remove)" type="number" value={f.delta} onChange={(e) => setF({ ...f, delta: e.target.value })} />
        <Input label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Birthday bonus" /></div>
    </Modal>
  );
}

/** Customer's loyalty stamp cards with QR, plus issuing a new card. */
function LoyaltySection({ customer }) {
  const { can, salon, tenant } = useAuth();
  const cards = useApi('/api/loyalty/cards', { customer_id: customer.id, pageSize: 10 });
  const programs = useApi('/api/loyalty/programs');
  const [issue, setIssue] = useState(false);
  const [open, setOpen] = useState(null);
  if (!can('loyalty') && !can('billing') && !can('customers')) return null;
  const active = (programs.data || []).filter((p) => p.is_active);
  return (
    <Card className="mt" title={<h2 className="row" style={{ gap: 8 }}><CreditCard size={16} />Loyalty stamp cards</h2>}
      actions={active.length > 0 && <Button size="sm" icon={Plus} onClick={() => setIssue(true)}>Issue card</Button>}>
      {!cards.data ? <Loader rows={2} /> : !cards.data.data.length ? (
        <p className="faint small">{active.length ? 'No loyalty card yet — issue one so each visit can be stamped by scanning its QR.' : <>No card designs yet. Create one in <Link to="/loyalty">Loyalty Cards</Link>.</>}</p>
      ) : (
        <div className="grid g2">{cards.data.data.map((c) => (
          <button key={c.id} type="button" onClick={() => setOpen(c.code)} style={{ all: 'unset', cursor: 'pointer', display: 'block' }} aria-label={`Open ${c.program_name} card`}>
            <StampCard compact card={c} salonName={salon?.name} qrValue={cardUrl(tenant?.slug, c.code)} />
          </button>
        ))}</div>
      )}
      {issue && <IssueModal customer={customer} programs={active} onClose={() => setIssue(false)} onIssued={(code) => { setIssue(false); cards.reload(); setOpen(code); }} />}
      {open && <CardDrawer code={open} onClose={() => { setOpen(null); cards.reload(); }} />}
    </Card>
  );
}
