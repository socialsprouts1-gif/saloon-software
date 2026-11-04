import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { ScanLine, Plus, Pencil, Gift, Stamp, Undo2, Printer, MessageCircle, Download, CreditCard, Sparkles, Archive, CheckCircle2 } from 'lucide-react';
import { useApi, useAuth, useToast, useDebounced } from '../context.jsx';
import { api } from '../lib/api.js';
import { fmtStamp, titleCase } from '../lib/format.js';
import { downloadBlob } from '../lib/export.js';
import { PageHead, Card, Button, Badge, Empty, Loader, ErrorState, Modal, Input, Select, Textarea, Switch, Field, Kpi, Tabs, SearchInput, Pager, CustomerPicker, useConfirm } from '../components/ui.jsx';
import { StampCard, ScannerModal, cardUrl } from '../components/Loyalty.jsx';

const SWATCHES = ['#6d2a52', '#b9785a', '#2f6497', '#2f7d5b', '#8a3ffc', '#c2410c', '#0f766e', '#1f2937', '#be185d'];

export default function LoyaltyCards() {
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState('cards');
  const [scan, setScan] = useState(!!sp.get('scan'));
  const [openCode, setOpenCode] = useState(sp.get('card') || null);
  const [issue, setIssue] = useState(false);
  const [edit, setEdit] = useState(null);
  const stats = useApi('/api/loyalty/stats');
  const programs = useApi('/api/loyalty/programs');
  const { can } = useAuth();
  const [listKey, setListKey] = useState(0);
  const refresh = () => { stats.reload(); programs.reload(); setListKey((k) => k + 1); };
  useEffect(() => { if (sp.get('card') || sp.get('scan')) setSp({}, { replace: true }); }, []); // eslint-disable-line
  const s = stats.data;
  const hasPrograms = programs.data?.some((p) => p.is_active);
  return (
    <div>
      <PageHead title="Loyalty stamp cards" sub="Scan a customer's card QR, tick the visit, and give the reward when the card is full">
        {can('loyalty') && <Button icon={Plus} onClick={() => setEdit({})}>New card design</Button>}
        <Button icon={CreditCard} disabled={!hasPrograms} onClick={() => setIssue(true)}>Issue card</Button>
        <Button variant="primary" icon={ScanLine} onClick={() => setScan(true)}>Scan card</Button>
      </PageHead>
      {s && <div className="grid g4 kpis mb" style={{ marginBottom: 16 }}>
        <Kpi icon={CreditCard} label="Active cards" value={s.active_cards} />
        <Kpi icon={Gift} tone="accent" label="Rewards ready" value={s.ready} meta="Full cards waiting to redeem" />
        <Kpi icon={Stamp} tone="success" label="Stamps this month" value={s.stamps_month} />
        <Kpi icon={Sparkles} tone="info" label="Rewards given this month" value={s.rewards_month} />
      </div>}
      <Tabs value={tab} onChange={setTab} tabs={[['cards', 'Customer cards'], ['designs', 'Card designs', programs.data?.length]]} />
      <div className="mt">
        {tab === 'cards' ? <CardList key={listKey} programs={programs.data || []} onOpen={setOpenCode} onIssue={() => setIssue(true)} hasPrograms={hasPrograms} onDesign={() => setEdit({})} />
          : <Designs programs={programs} onEdit={setEdit} />}
      </div>
      <ScannerModal open={scan} onClose={() => setScan(false)} onCode={(code) => { setScan(false); setOpenCode(code); }} />
      {openCode && <CardDrawer code={openCode} onClose={() => { setOpenCode(null); refresh(); }} />}
      {issue && <IssueModal programs={(programs.data || []).filter((p) => p.is_active)} onClose={() => setIssue(false)} onIssued={(code) => { setIssue(false); refresh(); setOpenCode(code); }} />}
      {edit && <ProgramEditor initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); setTab('designs'); }} />}
    </div>
  );
}

function CardList({ programs, onOpen, onIssue, hasPrograms, onDesign }) {
  const [f, setF] = useState({ q: '', program_id: '', ready: '', status: 'active', page: 1 });
  const q = useDebounced(f.q);
  const { data, loading, error, reload } = useApi('/api/loyalty/cards', { ...f, q, pageSize: 25 });
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <Card pad={false}>
      <div className="toolbar">
        <SearchInput value={f.q} onChange={(v) => setF({ ...f, q: v, page: 1 })} placeholder="Customer, mobile or card number" />
        <select className="input" style={{ width: 170 }} value={f.program_id} onChange={(e) => setF({ ...f, program_id: e.target.value, page: 1 })} aria-label="Card design"><option value="">All card designs</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <label className="check small"><input type="checkbox" checked={!!f.ready} onChange={(e) => setF({ ...f, ready: e.target.checked ? 1 : '', page: 1 })} />Reward ready</label>
        <label className="check small"><input type="checkbox" checked={f.status === 'archived'} onChange={(e) => setF({ ...f, status: e.target.checked ? 'archived' : 'active', page: 1 })} />Archived</label>
      </div>
      {!data ? <Loader rows={6} /> : !data.data.length ? (
        hasPrograms ? <Empty icon={CreditCard} title="No cards found" text="Issue a card from here or from a customer's profile." action={<Button variant="primary" onClick={onIssue}>Issue a card</Button>} />
          : <Empty icon={Sparkles} title="Design your first stamp card" text="e.g. 4 haircuts stamped → the 5th haircut is free." action={<Button variant="primary" onClick={onDesign}>Create card design</Button>} />
      ) : (
        <div className="table-wrap" style={{ opacity: loading ? .6 : 1 }}><table className="table">
          <thead><tr><th>Customer</th><th>Card</th><th>Progress</th><th>Rewards used</th><th>Last stamp</th><th /></tr></thead>
          <tbody>{data.data.map((c) => (
            <tr key={c.id} className="click" onClick={() => onOpen(c.code)}>
              <td><b>{c.customer_name}</b><div className="faint tiny">{c.customer_phone}</div></td>
              <td><span className="row" style={{ gap: 6 }}><i className="dot" style={{ background: c.color }} />{c.program_name}</span><div className="faint tiny"><code>{c.code}</code></div></td>
              <td><Dots n={c.stamps} of={c.stamps_required} color={c.color} />{c.reward_ready && <Badge tone="amber"><Gift size={11} />Reward ready</Badge>}</td>
              <td className="num">{c.rewards_redeemed}</td>
              <td className="small nowrap">{c.last_stamp_at ? fmtStamp(c.last_stamp_at) : <span className="faint">—</span>}</td>
              <td className="right"><Button size="sm" onClick={(e) => { e.stopPropagation(); onOpen(c.code); }}>Open</Button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ ...f, page: p })} />}
    </Card>
  );
}
const Dots = ({ n, of, color }) => (
  <span className="row" style={{ gap: 3, flexWrap: 'nowrap', marginBottom: 2 }} aria-label={`${n} of ${of}`}>
    {Array.from({ length: of }).map((_, i) => <i key={i} style={{ width: 11, height: 11, borderRadius: 99, background: i < n ? color : 'transparent', border: `2px solid ${color}`, opacity: i < n ? 1 : .45 }} />)}
    <Gift size={13} style={{ color: n >= of ? '#d9a03a' : 'var(--text-3)', marginLeft: 2 }} />
  </span>
);

function Designs({ programs, onEdit }) {
  const { salon } = useAuth();
  if (!programs.data) return <Loader />;
  if (!programs.data.length) return <Card><Empty icon={Sparkles} title="No card designs yet" text="Create a design like “Haircut Club — 4 visits, 5th haircut free”." action={<Button variant="primary" onClick={() => onEdit({})}>Create card design</Button>} /></Card>;
  return (
    <div className="grid g2">{programs.data.map((p) => (
      <div key={p.id} className="card card-pad col" style={{ gap: 14, opacity: p.is_active ? 1 : .6 }}>
        <StampCard compact salonName={salon?.name} card={{ ...p, program_name: p.name, customer_name: 'Customer name', code: 'SAMPLE01', stamps: Math.min(2, p.stamps_required), reward_ready: false }} />
        <div className="row between wrap">
          <div className="small muted">{p.stamps_required} visits → <b>{p.reward}</b>{p.auto_stamp ? ' · auto-stamps from bills' : ''}{p.min_gap_hours ? ` · ${p.min_gap_hours}h between stamps` : ''}</div>
          <Button size="sm" icon={Pencil} onClick={() => onEdit(p)}>Edit</Button>
        </div>
        <div className="row wrap faint small" style={{ gap: 14 }}><span>{p.cards} cards</span><span>{p.ready} ready to redeem</span><span>{p.redeemed} rewards given</span>{!p.is_active && <Badge status="inactive">Paused</Badge>}</div>
      </div>
    ))}</div>
  );
}

function ProgramEditor({ initial, onClose, onSaved }) {
  const { salon } = useAuth();
  const toast = useToast();
  const services = useApi('/api/catalog/services', { active: 1 });
  const [f, setF] = useState({ name: 'Haircut Club', stamps_required: 4, reward: 'Free haircut on your 5th visit', reward_service_id: '', eligible_service_ids: [], color: '#6d2a52', terms: 'One stamp per paid visit.', auto_stamp: true, min_gap_hours: 2, is_active: true, ...initial, ...(initial.id ? {} : {}) });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: f.name, stamps_required: Number(f.stamps_required), reward: f.reward, reward_service_id: f.reward_service_id ? Number(f.reward_service_id) : null, eligible_service_ids: f.eligible_service_ids, color: f.color, terms: f.terms || null, auto_stamp: !!f.auto_stamp, min_gap_hours: Number(f.min_gap_hours) || 0, is_active: !!f.is_active };
      if (initial.id) await api.put(`/api/loyalty/programs/${initial.id}`, body); else await api.post('/api/loyalty/programs', body);
      toast.success('Card design saved'); onSaved();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const n = Math.max(1, Math.min(20, Number(f.stamps_required) || 1));
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit card design' : 'New card design'} size="wide" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={f.name.length < 2 || f.reward.length < 2} onClick={save}>Save design</Button></>}>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 22 }}>
        <div className="col" style={{ gap: 14 }}>
          <Input label="Card name" value={f.name} onChange={set('name')} placeholder="Haircut Club" />
          <div className="form-grid">
            <Input label="Visits to stamp" type="number" min="1" max="20" value={f.stamps_required} onChange={set('stamps_required')} hint={`Reward on visit ${n + 1}`} />
            <Input label="Min. hours between stamps" type="number" min="0" max="72" value={f.min_gap_hours} onChange={set('min_gap_hours')} hint="Stops accidental double scans" />
          </div>
          <Input label="Reward" value={f.reward} onChange={set('reward')} placeholder="Free haircut on your 5th visit" />
          <Select label="Free service in POS" value={f.reward_service_id || ''} onChange={set('reward_service_id')} placeholder="Any service that earns stamps" options={(services.data || []).map((s) => [s.id, s.name])} hint="The service billed at ₹0 when the reward is used" />
          <Field label={`Services that earn a stamp (${f.eligible_service_ids.length ? f.eligible_service_ids.length : 'all'})`}>
            <div className="chips" style={{ maxHeight: 130, overflowY: 'auto' }}>{(services.data || []).map((s) => <button type="button" key={s.id} className={`chip ${f.eligible_service_ids.includes(s.id) ? 'on' : ''}`} onClick={() => setF({ ...f, eligible_service_ids: f.eligible_service_ids.includes(s.id) ? f.eligible_service_ids.filter((x) => x !== s.id) : [...f.eligible_service_ids, s.id] })}>{s.name}</button>)}</div>
          </Field>
          <Textarea label="Terms (shown on the card)" rows={2} value={f.terms || ''} onChange={set('terms')} />
          <Switch label="Auto-stamp from bills" hint="Paid bills with an eligible service add a stamp automatically" checked={f.auto_stamp} onChange={(v) => setF({ ...f, auto_stamp: v })} />
          <Switch label="Active" checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} />
        </div>
        <div className="col" style={{ gap: 14 }}>
          <div className="label">Colour</div>
          <div className="row wrap">{SWATCHES.map((c) => <button key={c} type="button" onClick={() => setF({ ...f, color: c })} aria-label={c} style={{ width: 30, height: 30, borderRadius: 99, background: c, border: f.color === c ? '3px solid var(--text)' : '2px solid var(--border)', cursor: 'pointer' }} />)}<input type="color" value={f.color} onChange={set('color')} aria-label="Custom colour" style={{ width: 34, height: 30, border: 0, background: 'none' }} /></div>
          <div className="label">Preview</div>
          <StampCard salonName={salon?.name} qrValue={cardUrl('your-salon', 'SAMPLE01')} card={{ program_name: f.name || 'Card name', customer_name: 'Riya Rao', code: 'SAMPLE01', stamps_required: n, stamps: Math.min(n, 2), reward: f.reward, color: f.color, reward_ready: false }} />
          <p className="faint small">Customers keep this card (printed or on their phone). Staff scan the QR and tap ✓ for each visit. After {n} stamps the {n + 1}th visit is free.</p>
        </div>
      </div>
      <style>{`@media (max-width: 760px){ .modal .grid[style*="1fr) minmax"]{ grid-template-columns: 1fr !important } }`}</style>
    </Modal>
  );
}

function IssueModal({ programs, onClose, onIssued, customer: fixed }) {
  const [customer, setCustomer] = useState(fixed || null);
  const [programId, setProgramId] = useState(programs[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const issue = async () => {
    setBusy(true);
    try { const c = await api.post('/api/loyalty/cards', { customer_id: customer.id, program_id: Number(programId) }); toast.success('Card ready'); onIssued(c.code); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Issue loyalty card" size="narrow" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!customer || !programId} onClick={issue}>Issue card</Button></>}>
      <div className="col">
        {!fixed && <Field label="Customer"><CustomerPicker value={customer} onChange={setCustomer} /></Field>}
        <Select label="Card design" value={programId} onChange={(e) => setProgramId(e.target.value)} options={programs.map((p) => [p.id, `${p.name} — ${p.stamps_required} visits → ${p.reward}`])} />
        <p className="faint small">If the customer already has this card, their existing card opens instead.</p>
      </div>
    </Modal>
  );
}
export { IssueModal };

/** Card detail: big stamp card with QR, tick a visit, redeem the reward, history. */
export function CardDrawer({ code, onClose }) {
  const { data: c, error, setData } = useApi(`/api/loyalty/cards/${code}`);
  const { salon, tenant, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const [busy, setBusy] = useState('');
  const act = async (path, body = {}, okMsg) => {
    setBusy(path);
    try { const r = await api.post(`/api/loyalty/cards/${code}/${path}`, body); setData(r); toast.success(okMsg(r)); return r; }
    catch (e) {
      if (e.status === 409 && e.details?.code === 'recent_stamp') {
        if (await confirm({ title: 'Stamp again?', text: `${e.message} Add another stamp anyway?`, confirmText: 'Add stamp' })) return act(path, { ...body, force: true }, okMsg);
      } else toast.error(e);
    } finally { setBusy(''); }
    return null;
  };
  const stamp = () => act('stamp', {}, (r) => (r.reward_ready ? `Stamped! Reward unlocked: ${r.reward}` : `Stamped — ${r.stamps}/${r.stamps_required}`));
  const redeem = async () => { if (await confirm({ title: 'Give the reward now?', text: `${c.reward} — the card restarts after this. Tip: you can also use the reward on the bill in POS.`, confirmText: 'Mark reward given' })) act('redeem', {}, () => 'Reward given — card restarted'); };
  const undo = async () => { const reason = await confirm({ title: 'Remove a stamp?', text: 'Use this to correct a mistaken stamp.', prompt: 'Reason', confirmText: 'Remove stamp', danger: true }); if (reason) act('unstamp', { reason }, () => 'Stamp removed'); };
  const archive = async () => { try { setData(await api.put(`/api/loyalty/cards/${code}`, { status: c.status === 'active' ? 'archived' : 'active' })); toast.success('Card updated'); } catch (e) { toast.error(e); } };
  const url = c ? cardUrl(tenant?.slug, c.code) : '';
  const wa = c ? `https://wa.me/${c.customer_phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}?text=${encodeURIComponent(`Hi ${c.customer_name.split(' ')[0]}! Here's your ${c.program_name} loyalty card from ${salon?.name}: ${url} — show this QR at every visit. ${c.stamps_required} visits → ${c.reward}.`)}` : '';
  const downloadQR = async () => { const d = await QRCode.toDataURL(url, { width: 900, margin: 2 }); downloadBlob(await (await fetch(d)).blob(), `loyalty-card-${c.code}.png`); };
  return (
    <Modal open drawer onClose={onClose} title="Loyalty card"
      footer={c && <>{can('loyalty') && <Button variant="ghost" icon={Archive} onClick={archive}>{c.status === 'active' ? 'Archive' : 'Restore'}</Button>}<div className="grow" /><Button onClick={() => nav(`/customers/${c.customer_id}`)}>Customer profile</Button></>}>
      {error ? <ErrorState error={error} /> : !c ? <Loader /> : (
        <div className="col" style={{ gap: 18 }}>
          <StampCard card={c} salonName={salon?.name} qrValue={url} />
          {c.status !== 'active' ? <Badge status="inactive">Archived card</Badge> : c.reward_ready ? (
            <div className="col">
              <div className="badge amber plain" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal', textTransform: 'none', fontSize: 13.5 }}>🎉 Card full — {c.reward}. Use it on the bill in POS (tick “Use loyalty reward”) or mark it given here.</div>
              <Button variant="primary" size="lg" icon={Gift} loading={busy === 'redeem'} onClick={redeem}>Mark reward given</Button>
            </div>
          ) : (
            <Button variant="primary" size="lg" icon={CheckCircle2} loading={busy === 'stamp'} onClick={stamp}>Tick visit {c.stamps + 1} of {c.stamps_required}</Button>
          )}
          <div className="row wrap">
            <Button size="sm" icon={Printer} onClick={() => printCard(c, salon, url)}>Print card</Button>
            <Button size="sm" icon={Download} onClick={downloadQR}>QR image</Button>
            <a className="btn sm success" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={14} />Send on WhatsApp</a>
            {c.stamps > 0 && can('loyalty') && <Button size="sm" variant="ghost" icon={Undo2} loading={busy === 'unstamp'} onClick={undo}>Remove a stamp</Button>}
          </div>
          <div className="faint small">{c.rewards_redeemed} reward{c.rewards_redeemed === 1 ? '' : 's'} used so far · issued {fmtStamp(c.created_at)}{c.terms ? ` · ${c.terms}` : ''}</div>
          <div>
            <div className="label" style={{ marginBottom: 6 }}>History</div>
            {c.events.length ? c.events.map((e) => (
              <div key={e.id} className="mini-stat small">
                <span><Badge tone={{ stamp: 'green', redeem: 'amber', remove: 'red', unredeem: 'red' }[e.type]}>{{ stamp: 'Stamp', redeem: 'Reward used', remove: 'Removed', unredeem: 'Reward reversed' }[e.type] || titleCase(e.type)}</Badge> {e.note && <span className="faint">{e.note}</span>}</span>
                <span className="faint nowrap">{e.user_name ? `${e.user_name} · ` : ''}{fmtStamp(e.created_at)}</span>
              </div>
            )) : <p className="faint small">No visits stamped yet.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Wallet-size printable card with QR (fits a standard business-card sleeve). */
async function printCard(c, salon, url) {
  const qr = await QRCode.toDataURL(url, { width: 400, margin: 1 });
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const slots = Array.from({ length: c.stamps_required }, (_, i) => `<div class="s">${i < c.stamps ? '✓' : i + 1}</div>`).join('');
  const w = window.open('', '_blank', 'width=720,height=560');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${esc(c.program_name)} – ${esc(c.customer_name)}</title><style>
    @page{size:auto;margin:12mm} body{font-family:Georgia,serif;margin:0;padding:20px;color:#fff}
    .card{width:85.6mm;height:54mm;border-radius:4mm;padding:4.5mm;box-sizing:border-box;background:${esc(c.color)};-webkit-print-color-adjust:exact;print-color-adjust:exact;display:flex;flex-direction:column;justify-content:space-between}
    .top{display:flex;justify-content:space-between;gap:3mm} .salon{font:600 2.4mm system-ui;letter-spacing:.12em;text-transform:uppercase;opacity:.8}
    .t{font-size:4.6mm;margin-top:.6mm} .n{font:3mm system-ui;opacity:.9} img{width:16mm;height:16mm;background:#fff;border-radius:1.5mm;padding:.8mm}
    .slots{display:flex;gap:1.6mm} .s{width:7mm;height:7mm;border-radius:50%;border:.4mm dashed rgba(255,255,255,.75);display:grid;place-items:center;font:600 2.6mm system-ui}
    .s.r{border:.5mm solid #f5cf7a;color:#f5cf7a;font-size:2mm} .f{font:2.3mm system-ui;opacity:.9;display:flex;justify-content:space-between}
  </style></head><body><div class="card"><div class="top"><div><div class="salon">${esc(salon?.name)}</div><div class="t">${esc(c.program_name)}</div><div class="n">${esc(c.customer_name)}</div></div><img src="${qr}" alt=""/></div>
  <div class="slots">${slots}<div class="s r">FREE</div></div><div class="f"><span>${esc(c.reward)}</span><span>${esc(c.code)}</span></div></div>
  <script>window.onload=()=>setTimeout(()=>window.print(),200)<\/script></body></html>`);
  w.document.close();
}
