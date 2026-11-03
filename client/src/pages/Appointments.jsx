import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CalendarPlus, Receipt, MessageCircle, Pencil, CalendarDays } from 'lucide-react';
import { useApi, useAuth, useToast, useDebounced } from '../context.jsx';
import { api } from '../lib/api.js';
import { today, addDays, startOfWeek, startOfMonth, endOfMonth, parseDate, fmtDate, fmtTime, fmtDT, money, titleCase, ymd } from '../lib/format.js';
import { PageHead, Card, Button, Seg, Modal, Select, Textarea, Badge, Empty, Loader, ErrorState, CustomerPicker, Field, Pager, SearchInput, Avatar, useConfirm } from '../components/ui.jsx';

const PX = 1.4; // pixels per minute in day view
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const STATUS_ACTIONS = {
  pending: [['confirmed', 'Confirm'], ['checked_in', 'Check in'], ['no_show', 'No show'], ['cancelled', 'Cancel']],
  confirmed: [['checked_in', 'Check in'], ['in_progress', 'Start'], ['no_show', 'No show'], ['cancelled', 'Cancel']],
  checked_in: [['in_progress', 'Start service'], ['completed', 'Mark complete'], ['cancelled', 'Cancel']],
  in_progress: [['completed', 'Mark complete']],
  cancelled: [['pending', 'Restore']], no_show: [['pending', 'Restore']], completed: [],
};

export default function Appointments() {
  const [params, setParams] = useSearchParams();
  const { can, user } = useAuth();
  const [view, setView] = useState(window.innerWidth < 700 ? 'list' : 'day');
  const [date, setDate] = useState(today());
  const [empFilter, setEmpFilter] = useState('');
  const [newOpen, setNewOpen] = useState(params.get('new') ? {} : null);
  const detailId = params.get('id');
  const emps = useApi('/api/staff/employees');
  const stylists = (emps.data || []).filter((e) => e.service_ids?.length);

  const range = view === 'day' ? [date, date] : view === 'week' ? [startOfWeek(date), addDays(startOfWeek(date), 6)] : view === 'month' ? [startOfWeek(startOfMonth(date)), addDays(startOfWeek(endOfMonth(date)), 6)] : null;
  const appts = useApi(range ? '/api/appointments' : null, range ? { from: range[0], to: range[1], all: 1, employee_id: empFilter } : null);
  const reload = () => { appts.reload(); };

  const step = (n) => setDate(view === 'day' ? addDays(date, n) : view === 'week' ? addDays(date, 7 * n) : (() => { const d = parseDate(date); d.setMonth(d.getMonth() + n, 1); return ymd(d); })());
  const title = view === 'day' ? fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : view === 'week' ? `${fmtDate(range[0], { day: 'numeric', month: 'short' })} – ${fmtDate(range[1], { day: 'numeric', month: 'short', year: 'numeric' })}`
      : view === 'month' ? parseDate(date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : 'All appointments';
  const openDetail = (id) => setParams((p) => { p.set('id', id); return p; });
  const closeDetail = () => setParams((p) => { p.delete('id'); return p; });
  const canCreate = can('appointments') && user.role !== 'employee';

  return (
    <div>
      <PageHead title="Appointments" sub="Book, reschedule and track every visit">
        <Seg value={view} onChange={setView} options={[['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['list', 'List']]} />
        {canCreate && <Button variant="primary" icon={CalendarPlus} onClick={() => setNewOpen({ date })}>New appointment</Button>}
      </PageHead>
      <Card pad={false}>
        {view !== 'list' && (
          <div className="toolbar">
            <Button icon={ChevronLeft} onClick={() => step(-1)} aria-label="Previous" /><Button onClick={() => setDate(today())}>Today</Button><Button icon={ChevronRight} onClick={() => step(1)} aria-label="Next" />
            <h2 className="display" style={{ fontSize: 18, marginLeft: 6 }}>{title}</h2>
            <div className="grow" />
            <input type="date" className="input sm" style={{ width: 150 }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Go to date" />
            {view !== 'day' && user.role !== 'employee' && <select className="input sm" style={{ width: 170 }} value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} aria-label="Stylist filter"><option value="">All stylists</option>{stylists.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>}
          </div>
        )}
        {view === 'list' ? <ListView onOpen={openDetail} stylists={stylists} />
          : appts.error ? <ErrorState error={appts.error} onRetry={appts.reload} />
            : !appts.data ? <Loader rows={8} />
              : view === 'day' ? <DayView date={date} appts={appts.data} stylists={user.role === 'employee' ? stylists.filter((s) => s.id === user.employee_id) : stylists} onOpen={openDetail} onSlot={canCreate ? (empId, time) => setNewOpen({ date, employee_id: empId, time }) : null} />
                : view === 'week' ? <WeekView start={range[0]} appts={appts.data} onOpen={openDetail} onDay={(d) => { setDate(d); setView('day'); }} />
                  : <MonthView date={date} start={range[0]} appts={appts.data} onDay={(d) => { setDate(d); setView('day'); }} />}
      </Card>
      {newOpen && <AppointmentForm initial={newOpen} stylists={stylists} onClose={() => { setNewOpen(null); setParams((p) => { p.delete('new'); return p; }); }} onSaved={(a) => { setNewOpen(null); reload(); setDate(a.start_at.slice(0, 10)); }} />}
      {detailId && <AppointmentDetail id={detailId} stylists={stylists} onClose={closeDetail} onChanged={reload} />}
    </div>
  );
}

// ---------------------------------------------------------------- Day view (employee columns)
function DayView({ date, appts, stylists, onOpen, onSlot }) {
  if (!stylists.length) return <Empty icon={CalendarDays} title="No stylists set up" text="Add employees and assign services to them to see the schedule." />;
  const start = Math.min(...stylists.map((s) => toMin(s.work_start)), 9 * 60);
  const end = Math.max(...stylists.map((s) => toMin(s.work_end)), 20 * 60);
  const hours = []; for (let m = Math.floor(start / 60) * 60; m <= end; m += 30) hours.push(m);
  const top0 = Math.floor(start / 60) * 60;
  const height = (end - top0) * PX + 20;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const wd = parseDate(date).getDay();
  const unassigned = appts.filter((a) => !a.employee_id);
  return (
    <div className="cal-day" style={{ gridTemplateColumns: `56px repeat(${stylists.length + (unassigned.length ? 1 : 0)}, minmax(150px, 1fr))` }}>
      <div className="cal-colhead" style={{ position: 'sticky', left: 0, zIndex: 4, minWidth: 56 }} />
      {stylists.map((s) => <div key={s.id} className="cal-colhead"><div className="row" style={{ justifyContent: 'center', gap: 6 }}><Avatar name={s.name} src={s.photo} size="sm" /><span className="truncate">{s.name}</span></div></div>)}
      {unassigned.length > 0 && <div className="cal-colhead">Unassigned</div>}
      <div className="cal-time" style={{ height, position: 'relative' }}>{hours.filter((m) => m % 60 === 0).map((m) => <div key={m} style={{ position: 'absolute', top: Math.max(2, (m - top0) * PX - 7), right: 8 }}>{fmtTime(`${String(m / 60).padStart(2, '0')}:00`).replace(':00', '')}</div>)}</div>
      {stylists.map((s) => {
        const off = s.weekly_off !== null && Number(s.weekly_off) === wd;
        return (
          <div key={s.id} className="cal-col" style={{ height }}>
            {hours.map((m) => <div key={m} className={`cal-line ${m % 60 ? 'half' : ''}`} style={{ top: (m - top0) * PX }} />)}
            {off ? <div className="cal-off" style={{ top: 0, bottom: 0 }} /> : <>
              <div className="cal-off" style={{ top: 0, height: Math.max(0, (toMin(s.work_start) - top0) * PX) }} />
              <div className="cal-off" style={{ top: (toMin(s.work_end) - top0) * PX, bottom: 0 }} />
            </>}
            {onSlot && !off && hours.slice(0, -1).map((m) => <div key={`s${m}`} className="cal-slot" style={{ top: (m - top0) * PX, height: 30 * PX }} onClick={() => onSlot(s.id, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)} title="Book this slot" />)}
            {appts.filter((a) => a.employee_id === s.id).map((a) => <Event key={a.id} a={a} top0={top0} onOpen={onOpen} />)}
            {date === today() && nowMin > top0 && nowMin < end && <div className="cal-now" style={{ top: (nowMin - top0) * PX }} />}
          </div>
        );
      })}
      {unassigned.length > 0 && <div className="cal-col" style={{ height }}>{hours.map((m) => <div key={m} className={`cal-line ${m % 60 ? 'half' : ''}`} style={{ top: (m - top0) * PX }} />)}{unassigned.map((a) => <Event key={a.id} a={a} top0={top0} onOpen={onOpen} />)}</div>}
    </div>
  );
}
function Event({ a, top0, onOpen }) {
  const s = toMin(a.start_at.slice(11)), e = toMin(a.end_at.slice(11));
  return (
    <div className={`cal-event ev-${a.status}`} style={{ top: (s - top0) * PX + 1, height: Math.max(22, (e - s) * PX - 2) }} onClick={(ev) => { ev.stopPropagation(); onOpen(a.id); }} title={`${a.customer_name} · ${a.services}`}>
      <b className="truncate">{a.customer_name}</b>
      <span className="truncate" style={{ display: 'block', opacity: .8 }}>{fmtTime(a.start_at.slice(11))} · {a.services}</span>
      {['online', 'qr'].includes(a.source) && (e - s) >= 45 && <span className="badge plain plum" style={{ marginTop: 3, fontSize: 10 }}>{a.source === 'qr' ? 'QR' : 'Online'}</span>}
    </div>
  );
}

function WeekView({ start, appts, onOpen, onDay }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="week-grid">
      {days.map((d) => {
        const list = appts.filter((a) => a.start_at.startsWith(d));
        return (
          <div key={d} className="week-col">
            <div className={`head ${d === today() ? 'today' : ''}`} onClick={() => onDay(d)} style={{ cursor: 'pointer' }}>{fmtDate(d, { weekday: 'short', day: 'numeric' })} <span className="faint">· {list.length}</span></div>
            <div className="body">{list.map((a) => (
              <div key={a.id} className={`week-ev ev-${a.status}`} onClick={() => onOpen(a.id)}>
                <b>{fmtTime(a.start_at.slice(11))}</b> {a.customer_name}<div className="faint truncate">{a.employee_name || 'Unassigned'} · {a.services}</div>
              </div>
            ))}{!list.length && <div className="faint tiny center" style={{ padding: 12 }}>No bookings</div>}</div>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ date, start, appts, onDay }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i)).filter((d, i) => i < 35 || d.slice(0, 7) === date.slice(0, 7));
  const byDay = useMemo(() => appts.reduce((m, a) => { const k = a.start_at.slice(0, 10); (m[k] ||= []).push(a); return m; }, {}), [appts]);
  return (
    <div className="month-grid">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="dow">{d}</div>)}
      {days.map((d) => {
        const list = (byDay[d] || []).filter((a) => !['cancelled', 'no_show'].includes(a.status));
        return (
          <div key={d} className={`month-cell ${d.slice(0, 7) !== date.slice(0, 7) ? 'other' : ''} ${d === today() ? 'today' : ''}`} onClick={() => onDay(d)}>
            <div className="row between"><span className="dnum">{Number(d.slice(8))}</span>{list.length > 0 && <span className="badge plain plum">{list.length}</span>}</div>
            {list.slice(0, 3).map((a) => <div key={a.id} className={`ev ev-${a.status}`}>{fmtTime(a.start_at.slice(11))} {a.customer_name}</div>)}
            {list.length > 3 && <div className="faint tiny" style={{ marginTop: 2 }}>+{list.length - 3} more</div>}
          </div>
        );
      })}
    </div>
  );
}

function ListView({ onOpen, stylists }) {
  const [f, setF] = useState({ q: '', status: '', source: '', employee_id: '', from: '', to: '', page: 1 });
  const q = useDebounced(f.q);
  const { data, loading, error, reload } = useApi('/api/appointments', { ...f, q, pageSize: 25 });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, page: 1 });
  return (
    <>
      <div className="toolbar">
        <SearchInput value={f.q} onChange={(v) => setF({ ...f, q: v, page: 1 })} placeholder="Customer name or mobile" />
        <select className="input" style={{ width: 140 }} value={f.status} onChange={set('status')} aria-label="Status"><option value="">All statuses</option>{Object.keys(STATUS_ACTIONS).map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select>
        <select className="input" style={{ width: 140 }} value={f.source} onChange={set('source')} aria-label="Source"><option value="">All sources</option>{['manual', 'walk_in', 'phone', 'online', 'qr'].map((s) => <option key={s} value={s}>{s === 'qr' ? 'QR code' : titleCase(s)}</option>)}</select>
        <select className="input" style={{ width: 160 }} value={f.employee_id} onChange={set('employee_id')} aria-label="Stylist"><option value="">All stylists</option>{stylists.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
        <input type="date" className="input" style={{ width: 145 }} value={f.from} onChange={set('from')} aria-label="From" /><input type="date" className="input" style={{ width: 145 }} value={f.to} onChange={set('to')} aria-label="To" />
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loader rows={8} /> : !data.data.length ? <Empty title="No appointments found" text="Try changing the filters." /> : (
        <div className="table-wrap" style={{ opacity: loading ? .6 : 1 }}>
          <table className="table"><thead><tr><th>When</th><th>Customer</th><th>Services</th><th>Stylist</th><th>Source</th><th>Status</th><th className="right">Value</th></tr></thead>
            <tbody>{data.data.map((a) => (
              <tr key={a.id} className="click" onClick={() => onOpen(a.id)}>
                <td className="nowrap">{fmtDT(a.start_at)}</td><td><b>{a.customer_name}</b><div className="faint tiny">{a.customer_phone}</div></td>
                <td className="muted" style={{ maxWidth: 240 }}><div className="truncate">{a.services}</div></td><td>{a.employee_name || <span className="faint">Unassigned</span>}</td>
                <td><Badge status={a.source}>{a.source === 'qr' ? 'QR' : titleCase(a.source)}</Badge></td><td><Badge status={a.status} /></td><td className="num">{money(a.total_price)}</td>
              </tr>
            ))}</tbody></table>
        </div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ ...f, page: p })} />}
    </>
  );
}

// ---------------------------------------------------------------- Create / reschedule form
function ServicePicker({ services, value, onChange }) {
  const [q, setQ] = useState('');
  const groups = services.filter((s) => s.is_active && s.name.toLowerCase().includes(q.toLowerCase())).reduce((g, s) => { (g[s.category || 'Other'] ||= []).push(s); return g; }, {});
  return (
    <div className="col" style={{ gap: 8 }}>
      <input className="input sm" placeholder="Filter services…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter services" />
      <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
        {Object.entries(groups).map(([cat, list]) => (
          <div key={cat} style={{ marginBottom: 8 }}><div className="faint tiny" style={{ fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{cat}</div>
            <div className="chips">{list.map((s) => <button type="button" key={s.id} className={`chip ${value.includes(s.id) ? 'on' : ''}`} onClick={() => onChange(value.includes(s.id) ? value.filter((x) => x !== s.id) : [...value, s.id])}>{s.name} · {money(s.price)} · {s.duration_min}m</button>)}</div></div>
        ))}
      </div>
    </div>
  );
}

function SlotPicker({ branchId, date, serviceIds, employeeId, value, onChange, excludeHint }) {
  const { data, loading, error } = useApi(serviceIds.length ? '/api/appointments/slots' : null, { date, service_ids: serviceIds.join(','), employee_id: employeeId || undefined, branch_id: branchId });
  if (!serviceIds.length) return <p className="faint small">Select services to see available times.</p>;
  if (loading && !data) return <div className="row"><span className="spinner" /> <span className="faint small">Checking availability…</span></div>;
  if (error) return <p className="err small">{error.message}</p>;
  if (data.closed) return <p className="faint small">{data.closed}</p>;
  if (!data.slots.length) return <p className="faint small">No free slots on this day{employeeId ? ' for this stylist' : ''}. {excludeHint}</p>;
  return (
    <div>
      <div className="faint tiny mb" style={{ marginBottom: 6 }}>Total duration {data.duration} min · {data.slots.length} slots free</div>
      <div className="slot-grid">{data.slots.map((s) => <button type="button" key={s.time} className={`slot ${value === s.time ? 'on' : ''}`} onClick={() => onChange(s.time, s.employees)}>{fmtTime(s.time)}</button>)}</div>
    </div>
  );
}

function AppointmentForm({ initial, stylists: allStylists, onClose, onSaved, editing }) {
  const toast = useToast();
  const { branch, branches } = useAuth();
  const consolidated = !editing && branch === 'all' && branches.length > 1;
  const initialBranch = editing?.branch_id || allStylists.find((s) => s.id === Number(initial.employee_id))?.branch_id || branches[0]?.id;
  const [apptBranch, setApptBranch] = useState(String(initialBranch || ''));
  const stylists = consolidated || editing ? allStylists.filter((s) => String(s.branch_id) === String(editing?.branch_id || apptBranch)) : allStylists;
  const services = useApi('/api/catalog/services', { active: 1 });
  const [customer, setCustomer] = useState(editing ? { id: editing.customer_id, name: editing.customer_name, phone: editing.customer_phone } : null);
  const [f, setF] = useState({
    service_ids: editing ? editing.services.map((s) => s.id) : [], employee_id: editing ? editing.employee_id || '' : initial.employee_id || '',
    date: editing ? editing.start_at.slice(0, 10) : initial.date || today(), time: editing ? editing.start_at.slice(11) : initial.time || '',
    source: 'manual', status: 'confirmed', notes: editing?.notes || '', manualTime: !!initial.time,
  });
  const [busy, setBusy] = useState(false);
  const eligible = stylists.filter((s) => f.service_ids.every((id) => s.service_ids.includes(id)));
  useEffect(() => { if (f.employee_id && !eligible.some((e) => e.id === Number(f.employee_id))) setF((x) => ({ ...x, employee_id: '' })); }, [f.service_ids.join()]); // eslint-disable-line
  const selected = (services.data || []).filter((s) => f.service_ids.includes(s.id));
  const total = selected.reduce((a, s) => a + s.price, 0), dur = selected.reduce((a, s) => a + s.duration_min, 0);

  const save = async () => {
    setBusy(true);
    try {
      const body = { service_ids: f.service_ids, employee_id: f.employee_id ? Number(f.employee_id) : null, start_at: `${f.date}T${f.time}`, notes: f.notes, ...(consolidated ? { branch_id: Number(apptBranch) } : {}) };
      const a = editing ? await api.put(`/api/appointments/${editing.id}`, body)
        : await api.post('/api/appointments', { ...body, customer_id: customer.id, source: f.source, status: f.status });
      toast.success(editing ? 'Appointment updated' : 'Appointment booked');
      onSaved(a);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const valid = (editing || customer) && f.service_ids.length && f.date && /^\d{2}:\d{2}$/.test(f.time) && (f.employee_id || f.source === 'walk_in');

  return (
    <Modal open drawer onClose={onClose} title={editing ? 'Reschedule appointment' : 'New appointment'}
      footer={<><div className="grow small muted">{selected.length > 0 && `${dur} min · ${money(total)}`}</div><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={save}>{editing ? 'Save changes' : 'Book appointment'}</Button></>}>
      <div className="col" style={{ gap: 16 }}>
        {!editing && <Field label="Customer"><CustomerPicker value={customer} onChange={setCustomer} /></Field>}
        {consolidated && <Select label="Branch" value={apptBranch} onChange={(e) => setF({ ...f, employee_id: '', time: f.manualTime ? f.time : '' }) || setApptBranch(e.target.value)} options={branches.map((b) => [b.id, b.name])} />}
        {!editing && <div className="form-grid">
          <Select label="Booking type" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} options={[['manual', 'Manual / in-person'], ['phone', 'Phone call'], ['walk_in', 'Walk-in (now)']]} />
          <Select label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[['confirmed', 'Confirmed'], ['pending', 'Pending']]} />
        </div>}
        <Field label="Services">{services.data ? <ServicePicker services={services.data} value={f.service_ids} onChange={(v) => setF({ ...f, service_ids: v, time: f.manualTime ? f.time : '' })} /> : <Loader rows={2} />}</Field>
        <div className="form-grid">
          <Select label="Stylist" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value, time: f.manualTime ? f.time : '' })} placeholder={f.source === 'walk_in' ? 'Auto-assign free stylist' : 'Any available'} options={eligible.map((e) => [e.id, e.name])} hint={f.service_ids.length && !eligible.length ? 'No stylist offers all selected services' : undefined} />
          <Field label="Date"><input type="date" className="input" value={f.date} min={editing ? undefined : today()} onChange={(e) => setF({ ...f, date: e.target.value, time: f.manualTime ? f.time : '' })} /></Field>
        </div>
        <Field label={<span className="row between" style={{ width: '100%' }}>Time <label className="check small"><input type="checkbox" checked={f.manualTime} onChange={(e) => setF({ ...f, manualTime: e.target.checked })} />Enter manually</label></span>}>
          {f.manualTime ? <input type="time" className="input" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} step={300} />
            : <SlotPicker branchId={consolidated ? apptBranch : undefined} date={f.date} serviceIds={f.service_ids} employeeId={f.employee_id} value={f.time} onChange={(t, emps) => setF((x) => ({ ...x, time: t, employee_id: x.employee_id || (emps?.length ? String(emps[0]) : '') }))} />}
          {f.manualTime && <span className="hint">Overlapping bookings for the same stylist are still blocked.</span>}
        </Field>
        <Textarea label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} placeholder="Preferences, allergies…" />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Detail drawer
function AppointmentDetail({ id, stylists, onClose, onChanged }) {
  const { data: a, loading, error, reload, setData } = useApi(`/api/appointments/${id}`);
  const { can, user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const setStatus = async (status) => {
    let reason;
    if (status === 'cancelled') { reason = await confirm({ title: 'Cancel appointment?', text: 'The time slot will be freed for other bookings.', prompt: 'Reason for cancellation', confirmText: 'Cancel appointment', danger: true }); if (!reason) return; }
    setBusy(status);
    try {
      const r = await api.post(`/api/appointments/${id}/status`, { status, reason });
      setData(r); onChanged(); toast.success(`Marked ${titleCase(status)}`);
      if (r.whatsapp?.sent) toast.success('WhatsApp confirmation sent');
      else if (r.whatsapp?.link && status === 'confirmed') setData({ ...r, waLink: r.whatsapp.link });
    } catch (e) { toast.error(e); } finally { setBusy(''); }
  };
  if (editing && a) return <AppointmentForm editing={a} initial={{}} stylists={stylists} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); onChanged(); }} />;
  const self = user.role === 'employee';
  const actions = (STATUS_ACTIONS[a?.status] || []).filter(([s]) => !self || ['checked_in', 'in_progress', 'completed'].includes(s));
  return (
    <Modal open drawer onClose={onClose} title="Appointment details"
      footer={a && <>
        {!self && !['completed', 'cancelled', 'no_show'].includes(a.status) && <Button icon={Pencil} onClick={() => setEditing(true)}>Reschedule</Button>}
        <div className="grow" />
        {can('billing') && !a.invoice_id && !['cancelled', 'no_show'].includes(a.status) && <Button variant="primary" icon={Receipt} onClick={() => nav(`/pos?appointment=${a.id}`)}>Bill now</Button>}
        {a.invoice_id && can('billing') && <Button onClick={() => nav(`/invoices/${a.invoice_id}`)}>View invoice</Button>}
      </>}>
      {error ? <ErrorState error={error} /> : loading && !a ? <Loader /> : (
        <div className="col" style={{ gap: 18 }}>
          <div className="row top between">
            <div><div className="display" style={{ fontSize: 22 }}>{a.customer_name}</div><a href={`tel:${a.customer_phone}`} className="small">{a.customer_phone}</a></div>
            <Badge status={a.status} />
          </div>
          <div className="card card-pad" style={{ background: 'var(--bg-elev)' }}>
            <div className="mini-stat"><span className="muted">When</span><b>{fmtDate(a.start_at.slice(0, 10), { weekday: 'short', day: 'numeric', month: 'short' })}, {fmtTime(a.start_at.slice(11))} – {fmtTime(a.end_at.slice(11))}</b></div>
            <div className="mini-stat"><span className="muted">Stylist</span><b>{a.employee_name || 'Unassigned'}</b></div>
            <div className="mini-stat"><span className="muted">Branch</span><b>{a.branch_name}</b></div>
            <div className="mini-stat"><span className="muted">Booked via</span><Badge status={a.source}>{a.source === 'qr' ? 'QR code' : titleCase(a.source)}</Badge></div>
            {a.cancel_reason && <div className="mini-stat"><span className="muted">Cancel reason</span><span>{a.cancel_reason}</span></div>}
          </div>
          <div>
            <div className="label mb" style={{ marginBottom: 6 }}>Services</div>
            {a.services.map((s) => <div key={s.id} className="mini-stat"><span>{s.name} <span className="faint small">· {s.duration_min} min</span></span><b className="num">{money(s.price)}</b></div>)}
            <div className="mini-stat"><b>Total</b><b className="num">{money(a.total_price)}</b></div>
          </div>
          {a.notes && <div><div className="label">Notes</div><p className="muted">{a.notes}</p></div>}
          {actions.length > 0 && <div><div className="label" style={{ marginBottom: 8 }}>Update status</div><div className="row wrap">{actions.map(([s, l]) => <Button key={s} size="sm" variant={s === 'cancelled' || s === 'no_show' ? 'danger' : s === 'completed' ? 'success' : ''} loading={busy === s} onClick={() => setStatus(s)}>{l}</Button>)}</div></div>}
          {a.waLink && <a className="btn success" href={a.waLink} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Send confirmation on WhatsApp</a>}
          <a className="small" href={`https://wa.me/${a.customer_phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}`} target="_blank" rel="noreferrer">Message customer on WhatsApp →</a>
        </div>
      )}
    </Modal>
  );
}
