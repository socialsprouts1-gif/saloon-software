import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Printer, FileDown, MessageCircle, ArrowLeft, Wallet, Ban, Link2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth, useToast } from '../context.jsx';
import { money, fmtDate, payLabel, titleCase, fmtStamp, PAY_METHODS } from '../lib/format.js';
import { invoicePDF } from '../lib/pdf.js';
import { Button, Badge, Modal, Select, Input, Loader, ErrorState, useConfirm } from '../components/ui.jsx';

export function InvoicePaper({ inv, salon, tax, invoiceSettings }) {
  const sym = salon.currency_symbol || '₹';
  const m = (n) => `${sym}${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const Line = ({ l, v, b }) => <tr><td colSpan={5} className="r" style={{ border: 0, padding: '4px 6px', fontWeight: b ? 700 : 400, fontSize: b ? 15 : 13 }}>{l}</td><td className="r" style={{ border: 0, padding: '4px 6px', fontWeight: b ? 700 : 400, fontSize: b ? 15 : 13 }}>{v}</td></tr>;
  return (
    <div className="invoice-paper print-area">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', borderBottom: '3px solid #6d2a52', paddingBottom: 18 }}>
        <div style={{ display: 'flex', gap: 14 }}>
          {salon.logo && <img src={salon.logo} alt="" style={{ width: 58, height: 58, borderRadius: 12, objectFit: 'cover' }} />}
          <div><h1 style={{ fontSize: 24 }}>{salon.name}</h1>
            <div style={{ color: '#666', fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>{inv.branch_name && <>{inv.branch_name} branch<br /></>}{inv.branch_address || salon.address}<br />{[salon.phone, salon.email].filter(Boolean).join(' · ')}{tax?.gstin && invoiceSettings?.show_gstin && <><br />GSTIN: {tax.gstin}</>}</div></div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '.04em' }}>{inv.tax_amount > 0 ? 'TAX INVOICE' : 'INVOICE'}</div>
          <div style={{ fontSize: 12.5, color: '#555', marginTop: 6, lineHeight: 1.7 }}># <b>{inv.invoice_no}</b><br />Date: {fmtDate(inv.date)}<br /><span style={{ textTransform: 'uppercase', fontWeight: 700, color: inv.status === 'paid' ? '#2f7d5b' : inv.status === 'void' ? '#999' : '#b4363d' }}>{titleCase(inv.status)}</span></div>
        </div>
      </div>
      <div style={{ margin: '18px 0', fontSize: 13 }}><div style={{ color: '#888', fontSize: 11, letterSpacing: '.08em' }}>BILLED TO</div><b style={{ fontSize: 15 }}>{inv.customer_name || 'Walk-in customer'}</b>{inv.customer_phone && <div style={{ color: '#555' }}>{inv.customer_phone}</div>}</div>
      <table>
        <thead><tr><th>Item</th><th>Staff</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Disc.</th><th className="r">Amount</th></tr></thead>
        <tbody>{inv.items.map((it) => <tr key={it.id}><td>{it.name}<div style={{ color: '#999', fontSize: 11, textTransform: 'capitalize' }}>{it.item_type}</div></td><td>{it.employee_name || '—'}</td><td className="r">{it.qty}</td><td className="r">{m(it.unit_price)}</td><td className="r">{it.discount ? m(it.discount) : '—'}</td><td className="r">{m(it.total)}</td></tr>)}</tbody>
        <tbody>
          <tr><td colSpan={6} style={{ border: 0, height: 8 }} /></tr>
          <Line l="Subtotal" v={m(inv.subtotal)} />
          {inv.item_discount > 0 && <Line l="Item discounts" v={`− ${m(inv.item_discount)}`} />}
          {inv.membership_discount > 0 && <Line l="Membership discount" v={`− ${m(inv.membership_discount)}`} />}
          {inv.discount_amount > 0 && <Line l="Discount" v={`− ${m(inv.discount_amount)}`} />}
          {inv.coupon_discount > 0 && <Line l={`Coupon ${inv.coupon_code || ''}`} v={`− ${m(inv.coupon_discount)}`} />}
          {inv.loyalty_redeemed > 0 && <Line l={`Loyalty points (${inv.loyalty_redeemed})`} v={`− ${m(inv.loyalty_value)}`} />}
          {inv.tax_amount > 0 && <><Line l="Taxable value" v={m(inv.taxable_amount)} /><Line l={`CGST @ ${inv.tax_rate / 2}%`} v={m(inv.tax_amount / 2)} /><Line l={`SGST @ ${inv.tax_rate / 2}%`} v={m(inv.tax_amount / 2)} /></>}
          <Line l="Total" v={m(inv.total)} b /><Line l="Paid" v={m(inv.paid_amount)} />{inv.balance > 0 && <Line l="Balance due" v={m(inv.balance)} b />}
        </tbody>
      </table>
      {inv.payments.length > 0 && <div style={{ marginTop: 16, fontSize: 12, color: '#555' }}><b style={{ color: '#888', fontSize: 11, letterSpacing: '.08em' }}>PAYMENTS</b>{inv.payments.map((p) => <div key={p.id}>{fmtStamp(p.paid_at.replace('T', ' '))} · {payLabel(p.method)}{p.reference ? ` (${p.reference})` : ''} · {m(p.amount)}</div>)}</div>}
      {inv.status === 'void' && <div style={{ marginTop: 14, color: '#b4363d', fontWeight: 600 }}>VOID — {inv.void_reason}</div>}
      {invoiceSettings?.footer && <div style={{ textAlign: 'center', marginTop: 30, color: '#6d2a52', fontFamily: 'Fraunces, Georgia, serif', fontSize: 15 }}>{invoiceSettings.footer}</div>}
      {invoiceSettings?.terms && <div style={{ marginTop: 10, color: '#999', fontSize: 11 }}>{invoiceSettings.terms}</div>}
    </div>
  );
}

export default function InvoiceView({ publicView }) {
  const { id, token } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [inv, setInv] = useState(null);
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const load = async () => {
    try {
      if (publicView) { const r = await api.get(`/api/public/invoice/${token}`); setInv(r.invoice); setMeta(r); }
      else { const r = await api.get(`/api/invoices/${id}`); setInv(r); setMeta(await api.get(`/api/public/invoice/${r.public_token}`)); }
    } catch (e) { setErr(e); }
  };
  useEffect(() => { load(); }, [id, token]); // eslint-disable-line
  useEffect(() => { if (inv && meta && sp.get('print')) setTimeout(() => window.print(), 400); }, [inv, meta]); // eslint-disable-line
  if (err) return <ErrorState error={err} />;
  if (!inv || !meta) return <Loader rows={8} />;
  const voidIt = async () => {
    const reason = await confirm({ title: `Void ${inv.invoice_no}?`, text: 'Stock, coupon usage, package credits and loyalty points will be reversed. This cannot be undone.', prompt: 'Reason', confirmText: 'Void invoice', danger: true });
    if (!reason) return;
    try { await api.post(`/api/invoices/${inv.id}/void`, { reason }); toast.success('Invoice voided'); load(); } catch (e) { toast.error(e); }
  };
  return (
    <div style={publicView ? { padding: '24px 12px', background: 'var(--bg)', minHeight: '100vh' } : undefined}>
      <div className="row wrap no-print" style={{ maxWidth: 820, margin: '0 auto 16px' }}>
        {!publicView && <Button variant="ghost" icon={ArrowLeft} onClick={() => nav(-1)}>Back</Button>}
        <div className="grow" />
        <Button icon={Printer} onClick={() => window.print()}>Print</Button>
        <Button icon={FileDown} onClick={() => invoicePDF(inv, meta.salon, meta.tax, meta.invoice_settings).catch((e) => toast.error(e.message))}>Download PDF</Button>
        {!publicView && <>
          <a className="btn success" href={inv.whatsapp_url} target="_blank" rel="noreferrer"><MessageCircle size={16} />WhatsApp</a>
          <Button icon={Link2} onClick={() => navigator.clipboard.writeText(inv.share_url).then(() => toast.success('Share link copied'))}>Copy link</Button>
          {inv.balance > 0 && inv.status !== 'void' && <Button variant="primary" icon={Wallet} onClick={() => setPayOpen(true)}>Record payment</Button>}
          {inv.status !== 'void' && ['owner', 'manager', 'accountant'].includes(auth.user.role) && <Button variant="danger" icon={Ban} onClick={voidIt}>Void</Button>}
        </>}
      </div>
      <InvoicePaper inv={inv} salon={meta.salon} tax={meta.tax} invoiceSettings={meta.invoice_settings} />
      {payOpen && <PaymentModal inv={inv} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); load(); }} />}
    </div>
  );
}

function PaymentModal({ inv, onClose, onDone }) {
  const [f, setF] = useState({ amount: inv.balance, method: 'upi', reference: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => { setBusy(true); try { await api.post(`/api/invoices/${inv.id}/payments`, { ...f, amount: Number(f.amount) }); toast.success('Payment recorded'); onDone(); } catch (e) { toast.error(e); } finally { setBusy(false); } };
  return (
    <Modal open onClose={onClose} title="Record payment" size="narrow" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!(Number(f.amount) > 0)} onClick={save}>Save payment</Button></>}>
      <div className="col">
        <p className="muted">Balance due: <b>{money(inv.balance)}</b></p>
        <Input label="Amount" type="number" min="0" max={inv.balance} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Select label="Method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} options={PAY_METHODS} />
        <Input label="Reference (optional)" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="UPI ref / last 4 digits" />
      </div>
    </Modal>
  );
}
