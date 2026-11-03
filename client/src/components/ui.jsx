import { useEffect, useRef, useState, createContext, useContext, useCallback } from 'react';
import { X, Search, Inbox, AlertTriangle, Download, ChevronLeft, ChevronRight, UserPlus, FileText, FileSpreadsheet, Sheet } from 'lucide-react';
import { initials, titleCase, startOfMonth, today, addDays, startOfWeek } from '../lib/format.js';
import { api } from '../lib/api.js';
import { useDebounced, useToast } from '../context.jsx';

export const Spinner = ({ size = 18 }) => <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
export const Loader = ({ rows = 4 }) => (
  <div className="card-body col" aria-busy="true">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" style={{ height: 18, width: `${90 - i * 12}%` }} />)}</div>
);

export function Button({ variant, size, icon: Icon, loading, children, className = '', ...p }) {
  return (
    <button className={`btn ${variant || ''} ${size || ''} ${!children ? 'icon' : ''} ${className}`} disabled={loading || p.disabled} {...p}>
      {loading ? <Spinner size={14} /> : Icon && <Icon />}{children}
    </button>
  );
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
      {children && <div className="row wrap">{children}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', pad, ...p }) {
  return (
    <div className={`card ${className}`} {...p}>
      {(title || actions) && <div className="card-head">{typeof title === 'string' ? <h2>{title}</h2> : title}<div className="row wrap">{actions}</div></div>}
      {pad === false ? children : <div className="card-body">{children}</div>}
    </div>
  );
}

export function Kpi({ label, value, meta, icon: Icon, tone = '', className = '' }) {
  return (
    <div className={`card kpi ${tone} ${className}`}>
      <div className="label">{Icon && <span className="ico"><Icon /></span>}{label}</div>
      <div className="value">{value}</div>
      {meta && <div className="meta">{meta}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = '', drawer = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement;
    setTimeout(() => ref.current?.querySelector('input:not([type=hidden]),select,textarea,button')?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={`overlay ${drawer ? 'drawer-overlay' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} className={drawer ? 'drawer' : `modal ${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head"><h2>{title}</h2><button className="btn ghost icon" onClick={onClose} aria-label="Close"><X /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return <div className={`field ${className}`}>{label && <label>{label}</label>}{children}{hint && !error && <span className="hint">{hint}</span>}{error && <span className="err">{error}</span>}</div>;
}
export const Input = ({ label, hint, className = '', fieldClass, ...p }) => <Field label={label} hint={hint} className={fieldClass}><input className={`input ${className}`} {...p} /></Field>;
export const Textarea = ({ label, hint, fieldClass, ...p }) => <Field label={label} hint={hint} className={fieldClass}><textarea className="input" {...p} /></Field>;
export function Select({ label, hint, options, placeholder, fieldClass, className = '', ...p }) {
  return (
    <Field label={label} hint={hint} className={fieldClass}>
      <select className={`input ${className}`} {...p}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </Field>
  );
}
export const Switch = ({ checked, onChange, label, hint }) => (
  <label className="row" style={{ cursor: 'pointer', justifyContent: 'space-between', gap: 16 }}>
    <span><span style={{ fontWeight: 500 }}>{label}</span>{hint && <div className="faint small">{hint}</div>}</span>
    <span className="switch"><input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} /><span /></span>
  </label>
);
export function SearchInput({ value, onChange, placeholder = 'Search…', style }) {
  return <div className="input-icon" style={{ minWidth: 220, ...style }}><Search /><input className="input" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} /></div>;
}

const TONES = {
  pending: 'amber', confirmed: 'blue', checked_in: 'plum', in_progress: 'plum', completed: 'green', cancelled: 'red', no_show: 'red',
  paid: 'green', partial: 'amber', unpaid: 'red', void: '', active: 'green', inactive: '', expired: 'red', approved: 'green', rejected: 'red',
  present: 'green', absent: 'red', half_day: 'amber', leave: 'blue', weekly_off: '', holiday: 'rose',
  vip: 'plum', regular: 'blue', new: 'green', online: 'blue', qr: 'plum', walk_in: 'rose', manual: '', phone: '',
};
export const Badge = ({ status, children, tone }) => <span className={`badge ${tone ?? TONES[status] ?? ''}`}>{children ?? titleCase(status)}</span>;

const COLORS = ['#6d2a52', '#b9785a', '#3f7d8c', '#7a8a3c', '#b45a7a', '#6e6aa8', '#a0522d', '#2f7d5b'];
export function Avatar({ name, src, size = '' }) {
  const c = COLORS[[...String(name || '')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % COLORS.length];
  return <span className={`avatar ${size}`} style={{ background: src ? 'transparent' : c }}>{src ? <img src={src} alt="" /> : initials(name)}</span>;
}
export const Stars = ({ value }) => <span className="stars" aria-label={`${value} of 5`}>{'★'.repeat(Math.round(value || 0))}<span style={{ opacity: .25 }}>{'★'.repeat(5 - Math.round(value || 0))}</span></span>;

export function Empty({ icon: Icon = Inbox, title = 'Nothing here yet', text, action }) {
  return <div className="empty"><div className="ico"><Icon /></div><h3>{title}</h3>{text && <p className="small">{text}</p>}{action && <div className="mt">{action}</div>}</div>;
}
export function ErrorState({ error, onRetry }) {
  return <Empty icon={AlertTriangle} title={error?.status === 403 ? 'No access' : "Couldn't load this"} text={error?.message} action={onRetry && error?.status !== 403 && <Button onClick={onRetry}>Try again</Button>} />;
}

export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs" role="tablist">{tabs.map(([k, l, n]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}{n != null && <span className="badge plain">{n}</span>}</button>)}</div>;
}
export function Seg({ options, value, onChange }) {
  return <div className="seg">{options.map(([k, l]) => <button key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <div className="pager"><span>{total} record{total === 1 ? '' : 's'}</span></div> : null;
  return (
    <div className="pager">
      <span>{(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total.toLocaleString('en-IN')}</span>
      <div className="row"><Button size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" /><span>Page {page} / {pages}</span><Button size="sm" icon={ChevronRight} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" /></div>
    </div>
  );
}

/** Click-outside dropdown */
export function Dropdown({ trigger, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && <div className="dropdown" style={align === 'left' ? { left: 0, right: 'auto' } : {}} onClick={(e) => e.target.closest('.item') && setOpen(false)}>{children}</div>}
    </div>
  );
}

export function ExportMenu({ onCSV, onExcel, onPDF, label = 'Export' }) {
  const toast = useToast();
  const wrap = (fn) => async () => { try { await fn(); } catch (e) { toast.error(e.message || 'Export failed'); } };
  return (
    <Dropdown trigger={({ toggle }) => <Button icon={Download} onClick={toggle}>{label}</Button>}>
      {onPDF && <button className="item" onClick={wrap(onPDF)}><FileText size={15} /> PDF</button>}
      {onExcel && <button className="item" onClick={wrap(onExcel)}><FileSpreadsheet size={15} /> Excel (.xlsx)</button>}
      {onCSV && <button className="item" onClick={wrap(onCSV)}><Sheet size={15} /> CSV</button>}
    </Dropdown>
  );
}

// ---- confirm dialog (promise based) ------------------------------------------------------
const ConfirmCtx = createContext(null);
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const [input, setInput] = useState('');
  const confirm = useCallback((opts) => new Promise((resolve) => { setInput(''); setState({ ...opts, resolve }); }), []);
  const close = (v) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal open={!!state} onClose={() => close(false)} title={state?.title || 'Are you sure?'} size="narrow"
        footer={<><Button onClick={() => close(false)}>Cancel</Button><Button variant={state?.danger ? 'danger solid' : 'primary'} disabled={state?.prompt && input.trim().length < 3} onClick={() => close(state?.prompt ? input.trim() : true)}>{state?.confirmText || 'Confirm'}</Button></>}>
        <p className="muted">{state?.text}</p>
        {state?.prompt && <div className="mt"><Input label={state.prompt} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Required" /></div>}
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ---- date range ----------------------------------------------------------------------------
export function rangeFor(period) {
  const t = today();
  switch (period) {
    case 'today': return { from: t, to: t };
    case 'week': return { from: startOfWeek(t), to: t };
    case 'last30': return { from: addDays(t, -29), to: t };
    case 'last_month': { const s = startOfMonth(addDays(startOfMonth(t), -1)); const e = addDays(startOfMonth(t), -1); return { from: s, to: e }; }
    case 'quarter': return { from: addDays(t, -89), to: t };
    case 'year': return { from: `${t.slice(0, 4)}-01-01`, to: t };
    default: return { from: startOfMonth(t), to: t };
  }
}
export function DateRange({ value, onChange }) {
  const presets = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['last_month', 'Last month'], ['last30', 'Last 30 days'], ['quarter', 'Last 90 days'], ['year', 'This year'], ['custom', 'Custom']];
  return (
    <div className="row wrap">
      <select className="input" style={{ width: 150 }} value={value.period} onChange={(e) => onChange(e.target.value === 'custom' ? { ...value, period: 'custom' } : { period: e.target.value, ...rangeFor(e.target.value) })} aria-label="Period">
        {presets.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {value.period === 'custom' && <>
        <input className="input" type="date" style={{ width: 150 }} value={value.from} max={value.to} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="From" />
        <input className="input" type="date" style={{ width: 150 }} value={value.to} min={value.from} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="To" />
      </>}
    </div>
  );
}

// ---- customer picker with quick add ------------------------------------------------------------
export function CustomerPicker({ value, onChange, allowCreate = true }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dq = useDebounced(q, 200);
  useEffect(() => { if (!open) return; api.get('/api/customers/search', { q: dq }).then(setList).catch(() => setList([])); }, [dq, open]);
  const create = async () => {
    setBusy(true);
    try {
      const { id } = await api.post('/api/customers', form);
      onChange({ id, name: form.name, phone: form.phone, loyalty_points: 0 });
      setAdding(false); setForm({ name: '', phone: '' }); toast.success('Customer added');
    } catch (e) {
      if (e.status === 409 && e.details?.id) { const c = await api.get(`/api/customers/${e.details.id}`); onChange(c); setAdding(false); toast.info('Existing customer selected'); }
      else toast.error(e);
    } finally { setBusy(false); }
  };
  if (value) {
    return (
      <div className="row" style={{ padding: '8px 10px', border: '1px solid var(--border-strong)', borderRadius: 10 }}>
        <Avatar name={value.name} size="sm" />
        <div className="grow"><div style={{ fontWeight: 600 }}>{value.name}</div><div className="faint tiny">{value.phone}{value.loyalty_points ? ` · ${value.loyalty_points} pts` : ''}</div></div>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  if (adding) {
    return (
      <div className="col" style={{ padding: 12, border: '1px dashed var(--border-strong)', borderRadius: 10 }}>
        <div className="form-grid">
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Mobile" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div className="row"><Button size="sm" variant="primary" loading={busy} onClick={create} disabled={form.name.length < 2 || form.phone.length < 10}>Add customer</Button><Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      <div className="row">
        <div className="grow"><SearchInput value={q} onChange={(v) => { setQ(v); setOpen(true); }} placeholder="Search name or mobile" style={{ minWidth: 0 }} /></div>
        {allowCreate && <Button icon={UserPlus} onClick={() => { setAdding(true); setForm({ name: /^\d/.test(q) ? '' : q, phone: /^\d/.test(q) ? q : '' }); }}>New</Button>}
      </div>
      {open && q && (
        <div className="dropdown" style={{ left: 0, right: 0 }}>
          {list.length ? list.map((c) => <button key={c.id} className="item" onClick={() => { onChange(c); setOpen(false); setQ(''); }}><Avatar name={c.name} size="sm" /><span className="grow">{c.name}</span><span className="faint small">{c.phone}</span></button>)
            : <div className="item faint">No match{allowCreate && ' — click New to add'}</div>}
        </div>
      )}
    </div>
  );
}

// ---- image upload (logo, service image, employee photo) ------------------------------------------
export function ImageUpload({ value, onChange, label = 'Image', round }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error('Image must be under 5 MB');
    setBusy(true);
    try { const r = await api.upload('/api/uploads/image', file); onChange(r.url); } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <Field label={label}>
      <div className="row">
        <div style={{ width: 56, height: 56, borderRadius: round ? 99 : 12, background: 'var(--surface-2)', overflow: 'hidden', display: 'grid', placeItems: 'center', border: '1px solid var(--border)' }}>
          {value ? <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="faint tiny">None</span>}
        </div>
        <label className="btn sm" style={{ cursor: 'pointer' }}>{busy ? <Spinner size={14} /> : 'Upload'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} hidden /></label>
        {value && <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Remove</Button>}
      </div>
    </Field>
  );
}
