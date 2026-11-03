import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Gift, Pencil, Trash2, CalendarPlus } from 'lucide-react';
import { useApi, useToast } from '../context.jsx';
import { api } from '../lib/api.js';
import { money, fmtDate, titleCase, today, addDays } from '../lib/format.js';
import { PageHead, Card, Button, Badge, Empty, Loader, ErrorState, Modal, Input, Select, Textarea, Switch, Tabs, Kpi, Field } from '../components/ui.jsx';

export default function Packages() {
  const { data, error, reload } = useApi('/api/catalog/packages');
  const [tab, setTab] = useState('catalog');
  const [status, setStatus] = useState('');
  const sales = useApi(tab === 'members' ? '/api/catalog/packages/sales' : null, { status });
  const [edit, setEdit] = useState(null);
  const [extend, setExtend] = useState(null);
  const nav = useNavigate();
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const expiring = (sales.data || []).filter((s) => s.status === 'active' && s.expires_at <= addDays(today(), 7)).length;
  return (
    <div>
      <PageHead title="Memberships & packages" sub="Prepaid service packs, monthly to annual memberships, credits and renewals">
        <Button onClick={() => nav('/pos')}>Sell in POS</Button>
        <Button variant="primary" icon={Plus} onClick={() => setEdit({})}>New package</Button>
      </PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[['catalog', 'Packages'], ['members', 'Customer packages']]} />
      <div className="mt" />
      {tab === 'catalog' ? (!data ? <Loader /> : !data.length ? <Card><Empty icon={Gift} title="No packages yet" text="Create memberships with service discounts, or prepaid packs with service credits." action={<Button variant="primary" onClick={() => setEdit({})}>Create package</Button>} /></Card> : (
        <div className="grid g3">{data.map((p) => (
          <div key={p.id} className="card card-pad col" style={{ gap: 10, opacity: p.is_active ? 1 : .55 }}>
            <div className="row between"><Badge tone="plum">{titleCase(p.type)}</Badge><Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(p)} aria-label="Edit" /></div>
            <div><h3 className="display" style={{ fontSize: 19 }}>{p.name}</h3><p className="muted small">{p.description}</p></div>
            <div className="display" style={{ fontSize: 26 }}>{money(p.price)} <span className="faint small" style={{ fontFamily: 'var(--font)' }}>/ {p.validity_days} days</span></div>
            <div className="col" style={{ gap: 4 }}>
              {p.discount_pct > 0 && <div className="small">✓ {p.discount_pct}% off all services</div>}
              {p.items.map((i) => <div key={i.service_id} className="small">✓ {i.credits}× {i.name}</div>)}
            </div>
            <div className="row wrap faint small" style={{ borderTop: '1px solid var(--border)', paddingTop: 10, gap: 14 }}><span>{p.sold} sold</span><span>{p.active_members} active</span><span>{money(p.revenue)} revenue</span>{!p.is_active && <Badge status="inactive" />}{p.online_purchasable && p.is_active ? <Badge tone="blue">Online</Badge> : null}</div>
          </div>
        ))}</div>
      )) : (
        <Card pad={false}>
          <div className="toolbar"><select className="input" style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All</option><option value="active">Active</option><option value="pending">Pending payment</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select>{expiring > 0 && <Badge tone="amber">{expiring} expiring within 7 days</Badge>}</div>
          {!sales.data ? <Loader /> : !sales.data.length ? <Empty title="No packages sold yet" /> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Customer</th><th>Package</th><th>Purchased</th><th>Expires</th><th>Credits used</th><th className="right">Price</th><th>Status</th><th /></tr></thead><tbody>
              {sales.data.map((s) => (
                <tr key={s.id}><td><b className="click" style={{ cursor: 'pointer' }} onClick={() => nav(`/customers/${s.customer_id}`)}>{s.customer}</b><div className="faint tiny">{s.phone}</div></td><td>{s.package}<div className="faint tiny">{titleCase(s.type)}</div></td>
                  <td>{fmtDate(s.purchased_at)}</td><td style={{ color: s.status === 'active' && s.expires_at <= addDays(today(), 7) ? 'var(--warning)' : undefined }}>{fmtDate(s.expires_at)}</td>
                  <td>{s.credits_total ? `${s.credits_used}/${s.credits_total}` : '—'}</td><td className="num">{money(s.price)}</td><td><Badge status={s.status} /></td>
                  <td className="nowrap"><Button size="sm" variant="ghost" icon={CalendarPlus} onClick={() => setExtend(s)}>Extend</Button></td></tr>
              ))}
            </tbody></table></div>
          )}
        </Card>
      )}
      {edit && <PackageForm initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {extend && <ExtendModal cp={extend} onClose={() => setExtend(null)} onSaved={() => { setExtend(null); sales.reload(); }} />}
    </div>
  );
}

function PackageForm({ initial, onClose, onSaved }) {
  const services = useApi('/api/catalog/services', { active: 1 });
  const toast = useToast();
  const [f, setF] = useState({ name: '', type: 'prepaid', description: '', price: '', validity_days: 90, discount_pct: 0, online_purchasable: true, is_active: true, items: [], ...initial });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: f.name, type: f.type, description: f.description, price: Number(f.price), validity_days: Number(f.validity_days), discount_pct: Number(f.discount_pct) || 0, online_purchasable: !!f.online_purchasable, is_active: !!f.is_active, items: f.items.map((i) => ({ service_id: Number(i.service_id), credits: Number(i.credits) })) };
      if (initial.id) await api.put(`/api/catalog/packages/${initial.id}`, body); else await api.post('/api/catalog/packages', body);
      toast.success('Package saved'); onSaved();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const VALIDITY = { monthly: 30, quarterly: 90, annual: 365 };
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit package' : 'New package'} size="wide" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={f.name.length < 2 || f.price === ''} onClick={save}>Save package</Button></>}>
      <div className="form-grid">
        <Input label="Package name" value={f.name} onChange={set('name')} />
        <Select label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, validity_days: VALIDITY[e.target.value] || f.validity_days })} options={[['monthly', 'Monthly membership'], ['quarterly', 'Quarterly membership'], ['annual', 'Annual membership'], ['prepaid', 'Prepaid service pack'], ['custom', 'Custom']]} />
        <Input label="Price (₹)" type="number" min="0" value={f.price} onChange={set('price')} />
        <Input label="Validity (days)" type="number" min="1" value={f.validity_days} onChange={set('validity_days')} />
        <Input label="Discount on all services (%)" type="number" min="0" max="100" value={f.discount_pct} onChange={set('discount_pct')} hint="Applied automatically in POS while the package is active" />
        <Textarea label="Description" rows={2} value={f.description || ''} onChange={set('description')} />
        <Field label="Included service credits" className="full">
          <div className="col" style={{ gap: 8 }}>
            {f.items.map((it, i) => (
              <div key={i} className="row">
                <select className="input" value={it.service_id} onChange={(e) => setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, service_id: e.target.value } : x)) })} aria-label="Service">{(services.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                <input className="input" type="number" min="1" style={{ width: 90 }} value={it.credits} onChange={(e) => setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, credits: e.target.value } : x)) })} aria-label="Credits" />
                <Button variant="ghost" icon={Trash2} onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== i) })} aria-label="Remove" />
              </div>
            ))}
            <div><Button size="sm" icon={Plus} disabled={!services.data?.length} onClick={() => setF({ ...f, items: [...f.items, { service_id: services.data[0].id, credits: 1 }] })}>Add service credit</Button></div>
          </div>
        </Field>
        <Switch label="Active" checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} />
        <Switch label="Can be bought online" checked={f.online_purchasable} onChange={(v) => setF({ ...f, online_purchasable: v })} />
      </div>
    </Modal>
  );
}

function ExtendModal({ cp, onClose, onSaved }) {
  const [f, setF] = useState({ days: 30, reason: '' });
  const toast = useToast();
  const save = async () => { try { await api.post(`/api/catalog/customer-packages/${cp.id}/renew`, { days: Number(f.days), reason: f.reason }); toast.success('Validity extended'); onSaved(); } catch (e) { toast.error(e); } };
  return (
    <Modal open onClose={onClose} title={`Extend ${cp.package}`} size="narrow" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={f.reason.length < 2} onClick={save}>Extend</Button></>}>
      <div className="col"><p className="muted small">For paid renewals, sell the package again from POS. Use this for goodwill extensions.</p><Input label="Extend by (days)" type="number" min="1" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /><Input label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
    </Modal>
  );
}
