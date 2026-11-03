import { useState } from 'react';
import { Plus, TicketPercent, Pencil, BarChart3 } from 'lucide-react';
import { useApi, useToast } from '../context.jsx';
import { api } from '../lib/api.js';
import { money, fmtDate, today } from '../lib/format.js';
import { PageHead, Card, Button, Badge, Empty, Loader, ErrorState, Modal, Input, Select, Switch, Kpi, CustomerPicker, Field } from '../components/ui.jsx';

const scopeLabel = (c) => ({ all: 'Entire bill', services: 'All services', products: 'All products', service: c.service_name, product: c.product_name })[c.applies_to];

export default function Coupons() {
  const { data, error, reload } = useApi('/api/catalog/coupons');
  const [edit, setEdit] = useState(null);
  const [usage, setUsage] = useState(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const totals = (data || []).reduce((t, c) => ({ uses: t.uses + c.used_count, disc: t.disc + c.discount_given, rev: t.rev + c.revenue_generated }), { uses: 0, disc: 0, rev: 0 });
  const state = (c) => (!c.is_active ? 'inactive' : c.valid_to && c.valid_to < today() ? 'expired' : c.usage_limit && c.used_count >= c.usage_limit ? 'expired' : 'active');
  return (
    <div>
      <PageHead title="Discounts & coupons" sub="Promotions, usage limits and campaign performance"><Button variant="primary" icon={Plus} onClick={() => setEdit({})}>New coupon</Button></PageHead>
      <div className="grid g3 kpis mb" style={{ marginBottom: 16 }}>
        <Kpi icon={TicketPercent} label="Times redeemed" value={totals.uses} /><Kpi tone="danger" label="Discount given" value={money(totals.disc)} /><Kpi tone="success" icon={BarChart3} label="Revenue from coupon bills" value={money(totals.rev)} />
      </div>
      <Card pad={false}>
        {!data ? <Loader /> : !data.length ? <Empty icon={TicketPercent} title="No coupons yet" action={<Button variant="primary" onClick={() => setEdit({})}>Create coupon</Button>} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Code</th><th>Discount</th><th>Applies to</th><th>Validity</th><th>Usage</th><th className="right">Revenue</th><th>Status</th><th /></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id}>
                <td><code style={{ fontWeight: 700, background: 'var(--primary-soft)', color: 'var(--primary)', padding: '3px 8px', borderRadius: 6 }}>{c.code}</code><div className="faint tiny">{c.description}</div></td>
                <td><b>{c.discount_type === 'percent' ? `${c.value}%` : money(c.value)}</b>{c.max_discount ? <div className="faint tiny">max {money(c.max_discount)}</div> : null}{c.min_invoice > 0 && <div className="faint tiny">min bill {money(c.min_invoice)}</div>}</td>
                <td>{scopeLabel(c)}{c.customer_name && <div className="faint tiny">Only for {c.customer_name}</div>}</td>
                <td className="small nowrap">{c.valid_from ? fmtDate(c.valid_from) : 'Now'} → {c.valid_to ? fmtDate(c.valid_to) : 'No expiry'}</td>
                <td className="small">{c.used_count}{c.usage_limit ? ` / ${c.usage_limit}` : ''}{c.per_customer_limit ? <div className="faint tiny">{c.per_customer_limit}/customer</div> : null}</td>
                <td className="num">{money(c.revenue_generated)}<div className="faint tiny">−{money(c.discount_given)}</div></td>
                <td><Badge status={state(c)} /></td>
                <td className="nowrap"><Button size="sm" variant="ghost" onClick={() => setUsage(c)}>Usage</Button><Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(c)} aria-label="Edit" /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {edit && <CouponForm initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {usage && <UsageModal coupon={usage} onClose={() => setUsage(null)} />}
    </div>
  );
}

function CouponForm({ initial, onClose, onSaved }) {
  const toast = useToast();
  const services = useApi('/api/catalog/services');
  const products = useApi('/api/inventory/products', { pageSize: 200 });
  const [f, setF] = useState({ code: '', description: '', discount_type: 'percent', value: '', applies_to: 'all', service_id: '', product_id: '', min_invoice: 0, max_discount: '', valid_from: today(), valid_to: '', usage_limit: '', per_customer_limit: '', customer_id: null, is_active: true, ...initial });
  const [customer, setCustomer] = useState(initial.customer_id ? { id: initial.customer_id, name: initial.customer_name } : null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const n = (v) => (v === '' || v == null ? null : Number(v));
  const save = async () => {
    setBusy(true);
    try {
      const body = { code: f.code, description: f.description, discount_type: f.discount_type, value: Number(f.value), applies_to: f.applies_to, service_id: f.applies_to === 'service' ? n(f.service_id) : null, product_id: f.applies_to === 'product' ? n(f.product_id) : null,
        min_invoice: Number(f.min_invoice) || 0, max_discount: n(f.max_discount), valid_from: f.valid_from || null, valid_to: f.valid_to || null, usage_limit: n(f.usage_limit), per_customer_limit: n(f.per_customer_limit), customer_id: customer?.id || null, is_active: !!f.is_active };
      if (initial.id) await api.put(`/api/catalog/coupons/${initial.id}`, body); else await api.post('/api/catalog/coupons', body);
      toast.success('Coupon saved'); onSaved();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit coupon' : 'New coupon'} size="wide" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={f.code.length < 3 || !(Number(f.value) > 0)} onClick={save}>Save coupon</Button></>}>
      <div className="form-grid">
        <Input label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} placeholder="DIWALI20" />
        <Input label="Description" value={f.description || ''} onChange={set('description')} />
        <Select label="Discount type" value={f.discount_type} onChange={set('discount_type')} options={[['percent', 'Percentage (%)'], ['fixed', 'Fixed amount (₹)']]} />
        <Input label={f.discount_type === 'percent' ? 'Discount %' : 'Discount ₹'} type="number" min="0" value={f.value} onChange={set('value')} />
        <Select label="Applies to" value={f.applies_to} onChange={set('applies_to')} options={[['all', 'Entire bill'], ['services', 'All services'], ['products', 'All products'], ['service', 'A specific service'], ['product', 'A specific product']]} />
        {f.applies_to === 'service' ? <Select label="Service" value={f.service_id || ''} onChange={set('service_id')} placeholder="Choose…" options={(services.data || []).map((s) => [s.id, s.name])} />
          : f.applies_to === 'product' ? <Select label="Product" value={f.product_id || ''} onChange={set('product_id')} placeholder="Choose…" options={(products.data?.data || []).map((p) => [p.id, `${p.name}${p.branch_name ? ` (${p.branch_name})` : ''}`])} /> : <div />}
        <Input label="Minimum bill (₹)" type="number" min="0" value={f.min_invoice} onChange={set('min_invoice')} />
        <Input label="Maximum discount (₹)" type="number" min="0" value={f.max_discount ?? ''} onChange={set('max_discount')} hint="Optional cap for % coupons" />
        <Input label="Valid from" type="date" value={f.valid_from || ''} onChange={set('valid_from')} />
        <Input label="Valid until" type="date" value={f.valid_to || ''} onChange={set('valid_to')} />
        <Input label="Total usage limit" type="number" min="1" value={f.usage_limit ?? ''} onChange={set('usage_limit')} placeholder="Unlimited" />
        <Input label="Uses per customer" type="number" min="1" value={f.per_customer_limit ?? ''} onChange={set('per_customer_limit')} placeholder="Unlimited" />
        <Field label="Only for a specific customer (optional)" className="full"><CustomerPicker value={customer} onChange={setCustomer} allowCreate={false} /></Field>
        <Switch label="Active" checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} />
      </div>
    </Modal>
  );
}

function UsageModal({ coupon, onClose }) {
  const { data } = useApi(`/api/catalog/coupons/${coupon.id}/usages`);
  return (
    <Modal open onClose={onClose} title={`${coupon.code} usage`} footer={<Button onClick={onClose}>Close</Button>}>
      {!data ? <Loader /> : !data.length ? <Empty title="Not used yet" /> : <div className="table-wrap"><table className="table"><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th className="right">Discount</th><th className="right">Bill</th></tr></thead><tbody>
        {data.map((u) => <tr key={u.id}><td>{fmtDate(u.created_at.slice(0, 10))}</td><td>{u.invoice_no}</td><td>{u.customer || '—'}</td><td className="num">{money(u.discount)}</td><td className="num">{money(u.invoice_total)}</td></tr>)}
      </tbody></table></div>}
    </Modal>
  );
}
