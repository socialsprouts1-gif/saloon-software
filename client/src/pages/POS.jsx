import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Trash2, Plus, Minus, TicketPercent, CheckCircle2, Printer, FileDown, MessageCircle, Receipt, Gift, Scissors, Package, CalendarCheck, X } from 'lucide-react';
import { useApi, useAuth, useToast, useDebounced } from '../context.jsx';
import { api } from '../lib/api.js';
import { money, fmtTime, PAY_METHODS, payLabel } from '../lib/format.js';
import { invoicePDF } from '../lib/pdf.js';
import { PageHead, Card, Button, Tabs, SearchInput, CustomerPicker, Modal, Empty, Badge, Field, Switch, Loader } from '../components/ui.jsx';

let lineSeq = 1;

export default function POS() {
  const [params, setParams] = useSearchParams();
  const { salon, branch, branches, user } = useAuth();
  const consolidated = branch === 'all' && branches.length > 1;
  const [billBranch, setBillBranch] = useState(String(branch !== 'all' ? branch : user.branch_id || branches[0]?.id || ''));
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState('service');
  const [q, setQ] = useState('');
  const [customer, setCustomer] = useState(null);
  const [appointmentId, setAppointmentId] = useState(null);
  const [lines, setLines] = useState([]);
  const [discount, setDiscount] = useState({ type: 'percent', value: '' });
  const [coupon, setCoupon] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [points, setPoints] = useState('');
  const [taxOn, setTaxOn] = useState(salon?.tax?.enabled ?? true);
  const [payments, setPayments] = useState([{ method: 'upi', amount: '', reference: '' }]);
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewErr, setPreviewErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const services = useApi('/api/catalog/services', { active: 1 });
  const products = useApi('/api/inventory/products', { in_stock: 1, sellable: 1, pageSize: 200, branch_id: consolidated ? billBranch : undefined });
  const packages = useApi('/api/catalog/packages', { active: 1 });
  const employees = useApi('/api/staff/employees');
  const billable = useApi('/api/invoices/meta/billable-appointments');
  const credits = useApi(customer ? `/api/customers/${customer.id}/credits` : null);
  const cards = useApi(customer ? '/api/loyalty/cards' : null, customer ? { customer_id: customer.id, pageSize: 10 } : null);
  const branchEmps = (employees.data || []).filter((e) => !consolidated || String(e.branch_id) === billBranch);
  const stylists = branchEmps.filter((e) => e.service_ids?.length);

  // Load an appointment into the cart (from ?appointment= or the "ready to bill" strip)
  const loadAppointment = async (id) => {
    try {
      const a = await api.get(`/api/appointments/${id}`);
      if (a.invoice_id) return toast.info('This appointment is already billed');
      setCustomer({ id: a.customer_id, name: a.customer_name, phone: a.customer_phone });
      setAppointmentId(a.id);
      setBillBranch(String(a.branch_id));
      setLines(a.services.map((s) => ({ key: lineSeq++, type: 'service', ref_id: s.id, name: s.name, unit_price: s.price, qty: 1, discount: 0, employee_id: a.employee_id || '' })));
    } catch (e) { toast.error(e); }
  };
  useEffect(() => { const id = params.get('appointment'); if (id) { loadAppointment(id); setParams({}, { replace: true }); } }, []); // eslint-disable-line

  const add = (type, item) => {
    setLines((ls) => {
      const ex = ls.find((l) => l.type === type && l.ref_id === item.id && !l.use_credit_id);
      if (ex && type !== 'service') return ls.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { key: lineSeq++, type, ref_id: item.id, name: item.name, unit_price: type === 'product' ? item.selling_price : item.price, qty: 1, discount: 0, employee_id: '' }];
    });
  };
  const upd = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const cart = useMemo(() => ({
    branch_id: Number(billBranch) || undefined, customer_id: customer?.id || null, appointment_id: appointmentId,
    items: lines.map((l) => ({ type: l.type, ref_id: l.ref_id, qty: l.qty, unit_price: Number(l.unit_price), discount: Number(l.discount) || 0, employee_id: l.employee_id ? Number(l.employee_id) : null, use_credit_id: l.use_credit_id || null, use_reward_card_id: l.use_reward_card_id || null })),
    discount: discount.value ? { type: discount.type, value: Number(discount.value) } : null, coupon_code: appliedCoupon || null,
    redeem_points: Number(points) || 0, tax_enabled: taxOn, notes,
  }), [billBranch, customer, appointmentId, lines, discount, appliedCoupon, points, taxOn, notes]);
  const dCart = useDebounced(cart, 250);

  useEffect(() => {
    if (!dCart.items.length) { setPreview(null); setPreviewErr(''); return; }
    api.post('/api/invoices/preview', dCart).then((p) => { setPreview(p); setPreviewErr(''); }).catch((e) => {
      setPreviewErr(e.message);
      if (appliedCoupon && /coupon/i.test(e.message)) { setAppliedCoupon(''); toast.error(e.message); }
    });
  }, [JSON.stringify(dCart)]); // eslint-disable-line

  const total = preview?.total || 0;
  const paid = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const balance = Math.max(0, Math.round((total - paid) * 100) / 100);

  const reset = () => { setCustomer(null); setAppointmentId(null); setLines([]); setDiscount({ type: 'percent', value: '' }); setCoupon(''); setAppliedCoupon(''); setPoints(''); setPayments([{ method: 'upi', amount: '', reference: '' }]); setNotes(''); setPreview(null); setTaxOn(salon?.tax?.enabled ?? true); };
  const checkout = async () => {
    if (lines.some((l) => l.type === 'service' && !l.employee_id) && !window.confirm('Some services have no stylist assigned (no commission will be recorded). Continue?')) return;
    setBusy(true);
    try {
      const inv = await api.post('/api/invoices', { ...cart, payments: payments.filter((p) => Number(p.amount) > 0).map((p) => ({ ...p, amount: Number(p.amount) })) });
      setDone(inv); reset(); billable.reload(); products.reload();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  const filter = (list) => (list || []).filter((x) => x.name.toLowerCase().includes(q.toLowerCase()) || (x.sku || '').toLowerCase().includes(q.toLowerCase()) || (x.barcode || '') === q);
  const items = tab === 'service' ? filter(services.data) : tab === 'product' ? filter(products.data?.data) : filter(packages.data);
  const creditFor = (sid) => (credits.data || []).filter((c) => c.service_id === sid);
  // Full loyalty cards whose reward can cover this service (one reward per card per bill)
  const rewardFor = (sid, key) => (cards.data?.data || []).filter((c) => c.reward_ready && (c.reward_service_id ? c.reward_service_id === sid : !c.eligible_service_ids.length || c.eligible_service_ids.includes(sid)) && !lines.some((l) => l.key !== key && l.use_reward_card_id === c.id));

  return (
    <div>
      <PageHead title="Billing / POS" sub="Fast checkout for services, products and packages" />
      {billable.data?.length > 0 && (
        <div className="row wrap mb" style={{ marginBottom: 14 }}>
          <span className="faint small row" style={{ gap: 6 }}><CalendarCheck size={14} />Ready to bill:</span>
          {billable.data.slice(0, 8).map((a) => <button key={a.id} className={`chip ${appointmentId === a.id ? 'on' : ''}`} onClick={() => loadAppointment(a.id)}>{fmtTime(a.start_at.slice(11))} · {a.customer_name}{a.employee_name ? ` · ${a.employee_name.split(' ')[0]}` : ''}</button>)}
        </div>
      )}
      <div className="pos">
        <Card pad={false}>
          <div style={{ padding: '6px 16px 0' }}><Tabs value={tab} onChange={setTab} tabs={[['service', <><Scissors size={14} />Services</>], ['product', <><Package size={14} />Products</>], ['package', <><Gift size={14} />Packages</>]]} /></div>
          <div className="toolbar" style={{ borderBottom: 0 }}><SearchInput value={q} onChange={setQ} placeholder={tab === 'product' ? 'Search name, SKU or scan barcode' : 'Search…'} style={{ flex: 1 }} /></div>
          <div style={{ padding: '0 16px 16px', maxHeight: 'calc(100vh - 290px)', overflowY: 'auto' }}>
            {(tab === 'service' ? services : tab === 'product' ? products : packages).loading && !items.length ? <Loader /> : !items.length ? <Empty title="Nothing found" text={tab === 'product' ? 'No in-stock products match.' : undefined} /> : (
              <div className="pos-items">{items.map((it) => (
                <button key={it.id} className="pos-item" onClick={() => add(tab, it)}>
                  <span className="faint tiny">{tab === 'service' ? it.category : tab === 'product' ? `${it.brand || ''} · ${it.stock} in stock` : `${it.validity_days} days`}</span>
                  <span className="nm">{it.name}</span>
                  <span className="row between"><span className="pr">{money(tab === 'product' ? it.selling_price : it.price)}</span>{tab === 'service' && <span className="faint tiny">{it.duration_min}m</span>}</span>
                </button>
              ))}</div>
            )}
          </div>
        </Card>

        <div className="card pos-cart">
          <div className="card-body col" style={{ gap: 14 }}>
            {consolidated && <div className="row"><span className="label">Billing branch</span><select className="input sm grow" value={billBranch} onChange={(e) => { setBillBranch(e.target.value); setLines((ls) => ls.filter((l) => l.type !== 'product').map((l) => ({ ...l, employee_id: '' }))); }} aria-label="Billing branch">{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
            <div className="row between"><h2>Current bill</h2>{lines.length > 0 && <Button size="sm" variant="ghost" icon={X} onClick={reset}>Clear</Button>}</div>
            <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); setPoints(''); setLines((ls) => ls.map((l) => ({ ...l, use_credit_id: null, use_reward_card_id: null }))); if (!c) setAppointmentId(null); }} />
            {appointmentId && <Badge tone="plum">Billing appointment #{appointmentId}</Badge>}
            {(cards.data?.data || []).map((c) => <div key={c.id} className="row small" style={{ gap: 8, padding: '6px 10px', borderRadius: 10, background: 'var(--bg-elev)', border: '1px solid var(--border)' }}><i className="dot" style={{ background: c.color }} /><span className="grow truncate">{c.program_name}: <b>{c.stamps}/{c.stamps_required}</b>{c.reward_ready ? ' — reward ready 🎁' : ''}</span></div>)}
            <div>
              {!lines.length ? <p className="faint small center" style={{ padding: 20 }}>Tap services or products to add them</p> : lines.map((l) => {
                const cr = l.type === 'service' ? creditFor(l.ref_id) : [];
                return (
                  <div key={l.key} className="cart-line">
                    <div className="row top">
                      <div className="grow"><b style={{ fontSize: 13.5 }}>{l.name}</b>{l.type !== 'service' && <Badge tone="">{l.type}</Badge>}</div>
                      <b className="num">{money(l.use_credit_id || l.use_reward_card_id ? 0 : l.qty * l.unit_price - (Number(l.discount) || 0))}</b>
                      <button className="btn ghost sm icon" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove"><Trash2 size={14} /></button>
                    </div>
                    <div className="row wrap mt-sm" style={{ gap: 8 }}>
                      {l.type !== 'service' ? <span className="qty"><button onClick={() => upd(l.key, { qty: Math.max(1, l.qty - 1) })} aria-label="Less"><Minus size={12} /></button><span>{l.qty}</span><button onClick={() => upd(l.key, { qty: l.qty + 1 })} aria-label="More"><Plus size={12} /></button></span> : null}
                      <input className="input sm num" style={{ width: 86 }} type="number" min="0" value={l.unit_price} onChange={(e) => upd(l.key, { unit_price: e.target.value })} aria-label="Price" disabled={!!l.use_credit_id} title="Price" />
                      <input className="input sm num" style={{ width: 76 }} type="number" min="0" placeholder="Disc ₹" value={l.discount || ''} onChange={(e) => upd(l.key, { discount: e.target.value })} aria-label="Item discount" disabled={!!l.use_credit_id} />
                      {l.type !== 'package' && <select className="input sm" style={{ flex: 1, minWidth: 110 }} value={l.employee_id} onChange={(e) => upd(l.key, { employee_id: e.target.value })} aria-label="Staff">
                        <option value="">{l.type === 'service' ? 'Assign stylist…' : 'Sold by…'}</option>
                        {(l.type === 'service' ? stylists.filter((s) => s.service_ids.includes(l.ref_id)) : branchEmps).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>}
                    </div>
                    {l.type === 'service' && rewardFor(l.ref_id, l.key).map((c) => <label key={c.id} className="check small mt-sm" style={{ color: 'var(--warning)' }}><input type="checkbox" checked={l.use_reward_card_id === c.id} onChange={(e) => upd(l.key, { use_reward_card_id: e.target.checked ? c.id : null, use_credit_id: null })} />🎁 Use loyalty reward — {c.program_name} ({c.reward})</label>)}
                    {cr.length > 0 && <label className="check small mt-sm"><input type="checkbox" checked={!!l.use_credit_id} onChange={(e) => upd(l.key, { use_credit_id: e.target.checked ? cr[0].id : null })} />Use package credit ({cr[0].package}: {cr[0].total - cr[0].used} left)</label>}
                  </div>
                );
              })}
            </div>
            {lines.length > 0 && <>
              <div className="form-grid" style={{ gap: 10 }}>
                <Field label="Bill discount"><div className="row" style={{ gap: 6 }}><select className="input sm" style={{ width: 62 }} value={discount.type} onChange={(e) => setDiscount({ ...discount, type: e.target.value })} aria-label="Discount type"><option value="percent">%</option><option value="amount">₹</option></select><input className="input sm" type="number" min="0" value={discount.value} onChange={(e) => setDiscount({ ...discount, value: e.target.value })} aria-label="Discount value" /></div></Field>
                <Field label="Coupon">{appliedCoupon ? <div className="row"><Badge tone="green"><TicketPercent size={12} />{appliedCoupon}</Badge><button className="btn ghost sm" onClick={() => { setAppliedCoupon(''); setCoupon(''); }}>Remove</button></div>
                  : <div className="row" style={{ gap: 6 }}><input className="input sm" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="CODE" aria-label="Coupon code" /><Button size="sm" disabled={!coupon} onClick={() => setAppliedCoupon(coupon)}>Apply</Button></div>}</Field>
                {customer?.loyalty_points > 0 && <Field label={`Redeem points (${customer.loyalty_points} available)`} className="full"><input className="input sm" type="number" min="0" max={customer.loyalty_points} value={points} onChange={(e) => setPoints(e.target.value)} /></Field>}
              </div>
              <Switch label={`Apply ${salon?.tax?.label || 'GST'} (${salon?.tax?.rate ?? 0}%)`} checked={taxOn} onChange={setTaxOn} />
              {previewErr && <div className="badge red plain" style={{ whiteSpace: 'normal', textTransform: 'none', padding: '6px 10px', borderRadius: 8 }}>{previewErr}</div>}
              {preview && (
                <div className="totals" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <Row l="Subtotal" v={preview.subtotal} />
                  {preview.item_discount > 0 && <Row l="Item discounts" v={-preview.item_discount} />}
                  {preview.membership_discount > 0 && <Row l={`Membership (${preview.membership_pct}%)`} v={-preview.membership_discount} />}
                  {preview.discount_amount > 0 && <Row l="Bill discount" v={-preview.discount_amount} />}
                  {preview.coupon_discount > 0 && <Row l={`Coupon ${preview.coupon?.code}`} v={-preview.coupon_discount} />}
                  {preview.loyalty_value > 0 && <Row l={`Points (${preview.loyalty_redeemed})`} v={-preview.loyalty_value} />}
                  {preview.tax_amount > 0 && <Row l={`${salon?.tax?.label || 'GST'} ${preview.tax_rate}%`} v={preview.tax_amount} />}
                  <div className="row between" style={{ marginTop: 6 }}><b>Total</b><span className="grand num">{money(preview.total)}</span></div>
                </div>
              )}
              <div className="col" style={{ gap: 8 }}>
                <div className="label">Payment</div>
                {payments.map((p, i) => (
                  <div key={i} className="row" style={{ gap: 6 }}>
                    <select className="input sm" style={{ width: 120 }} value={p.method} onChange={(e) => setPayments(payments.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))} aria-label="Method">{PAY_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                    <input className="input sm num" type="number" min="0" placeholder="Amount" value={p.amount} onChange={(e) => setPayments(payments.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} aria-label="Amount" />
                    <Button size="sm" onClick={() => setPayments(payments.map((x, j) => (j === i ? { ...x, amount: Math.round(((Number(x.amount) || 0) + balance) * 100) / 100 || '' } : x)))} title="Fill remaining">Full</Button>
                    {payments.length > 1 && <button className="btn ghost sm icon" onClick={() => setPayments(payments.filter((_, j) => j !== i))} aria-label="Remove payment"><X size={14} /></button>}
                  </div>
                ))}
                <div className="row between small"><button className="btn ghost sm" onClick={() => setPayments([...payments, { method: 'cash', amount: '', reference: '' }])}><Plus size={14} />Split payment</button>
                  <span className={balance > 0 ? 'faint' : ''} style={{ color: balance > 0 ? 'var(--warning)' : 'var(--success)', fontWeight: 600 }}>{balance > 0 ? `Balance due ${money(balance)}` : paid > 0 ? 'Fully paid' : ''}</span></div>
              </div>
              <input className="input sm" placeholder="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Note" />
              <Button variant="primary" size="lg" className="block" icon={Receipt} loading={busy} disabled={!preview || !!previewErr || paid - total > 0.009} onClick={checkout}>
                {paid >= total - 0.009 && total > 0 ? `Complete sale · ${money(total)}` : paid > 0 ? `Save with partial payment` : 'Save as unpaid'}
              </Button>
            </>}
          </div>
        </div>
      </div>
      {done && <SuccessModal inv={done} onClose={() => setDone(null)} onView={() => nav(`/invoices/${done.id}`)} />}
    </div>
  );
}
const Row = ({ l, v }) => <div className="mini-stat"><span className="muted">{l}</span><span className="num">{v < 0 ? `− ${money(-v)}` : money(v)}</span></div>;

export function SuccessModal({ inv, onClose, onView }) {
  const { data: s } = useApi('/api/public/invoice/' + inv.public_token);
  return (
    <Modal open onClose={onClose} title="Sale completed" size="narrow" footer={<><Button onClick={onView}>View invoice</Button><Button variant="primary" onClick={onClose}>New sale</Button></>}>
      <div className="center col" style={{ alignItems: 'center', gap: 8 }}>
        <CheckCircle2 size={48} style={{ color: 'var(--success)' }} />
        <div className="display" style={{ fontSize: 28 }}>{money(inv.total)}</div>
        <div className="muted">{inv.invoice_no} · {inv.customer_name || 'Walk-in'}</div>
        <Badge status={inv.status} />
        {inv.payments.map((p) => <div key={p.id} className="faint small">{payLabel(p.method)} {money(p.amount)}</div>)}
        <div className="row wrap mt" style={{ justifyContent: 'center' }}>
          <Button icon={Printer} onClick={() => window.open(`${inv.share_url}?print=1`, '_blank')}>Print</Button>
          <Button icon={FileDown} disabled={!s} onClick={() => invoicePDF(inv, s.salon, s.tax, s.invoice_settings)}>PDF</Button>
          <a className="btn success" href={inv.whatsapp_url} target="_blank" rel="noreferrer"><MessageCircle size={16} />WhatsApp</a>
        </div>
      </div>
    </Modal>
  );
}
