import { useState } from 'react';
import { LogIn, LogOut, Pencil, CalendarOff, Plus, Trash2, History, Check, X } from 'lucide-react';
import { useApi, useAuth, useToast } from '../context.jsx';
import { api } from '../lib/api.js';
import { today, fmtDate, fmtTime, minsToH, titleCase, monthLabel, addDays } from '../lib/format.js';
import { exportCSV, exportXLSX, exportPDF } from '../lib/export.js';
import { PageHead, Card, Button, Badge, Empty, Loader, ErrorState, Modal, Input, Select, Textarea, Avatar, Tabs, ExportMenu, Kpi, useConfirm } from '../components/ui.jsx';

const ST = [['present', 'Present'], ['half_day', 'Half day'], ['absent', 'Absent'], ['leave', 'Leave'], ['weekly_off', 'Weekly off'], ['holiday', 'Holiday']];
const CODE = { present: 'P', half_day: 'H', absent: 'A', leave: 'L', weekly_off: 'W', holiday: 'Ho' };

export default function Attendance() {
  const { user } = useAuth();
  const [tab, setTab] = useState('daily');
  const manager = user.role !== 'employee';
  return (
    <div>
      <PageHead title="Attendance" sub="Check-ins, working hours, leave and holidays — feeds directly into payroll" />
      <Tabs value={tab} onChange={setTab} tabs={[['daily', 'Daily'], ['monthly', 'Monthly report'], ['leaves', 'Leave'], ...(manager ? [['holidays', 'Holidays'], ['audit', 'Corrections log']] : [])]} />
      <div className="mt">{tab === 'daily' ? <Daily manager={manager} /> : tab === 'monthly' ? <Monthly /> : tab === 'leaves' ? <Leaves manager={manager} /> : tab === 'holidays' ? <Holidays /> : <Audit />}</div>
    </div>
  );
}

function Daily({ manager }) {
  const [date, setDate] = useState(today());
  const { data, error, reload } = useApi('/api/staff/attendance', { date });
  const [edit, setEdit] = useState(null);
  const toast = useToast();
  const punch = async (e, action) => { try { await api.post('/api/staff/attendance/punch', { employee_id: e.id, action }); toast.success(`${e.name} checked ${action}`); reload(); } catch (err) { toast.error(err); } };
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const rows = data || [];
  const count = (s) => rows.filter((r) => r.attendance?.status === s).length;
  return (
    <>
      <div className="grid g4 kpis mb" style={{ marginBottom: 16 }}>
        <Kpi tone="success" label="Present" value={count('present') + count('half_day')} meta={`${count('half_day')} half day`} />
        <Kpi tone="danger" label="Absent" value={count('absent') + rows.filter((r) => !r.attendance && r.expected === 'working' && date <= today()).length} meta="Incl. not checked in" />
        <Kpi tone="info" label="Leave / off" value={rows.filter((r) => ['leave', 'weekly_off', 'holiday'].includes(r.attendance?.status || r.expected)).length} />
        <Kpi tone="warning" label="Late arrivals" value={rows.filter((r) => r.attendance?.late_minutes > 0).length} />
      </div>
      <Card pad={false}>
        <div className="toolbar"><Button size="sm" onClick={() => setDate(addDays(date, -1))}>‹</Button><input type="date" className="input" style={{ width: 160 }} value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" /><Button size="sm" onClick={() => setDate(addDays(date, 1))} disabled={date >= today()}>›</Button><b>{fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</b></div>
        {!data ? <Loader rows={6} /> : !rows.length ? <Empty title="No active employees" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Employee</th><th>Shift</th><th>Check-in</th><th>Check-out</th><th>Worked</th><th>Late / early</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((e) => {
              const a = e.attendance;
              return (
                <tr key={e.id}>
                  <td><div className="row"><Avatar name={e.name} src={e.photo} size="sm" /><div><b>{e.name}</b><div className="faint tiny">{e.designation}</div></div></div></td>
                  <td className="small nowrap">{fmtTime(e.work_start)}–{fmtTime(e.work_end)}</td>
                  <td>{a?.check_in ? fmtTime(a.check_in) : '—'}</td><td>{a?.check_out ? fmtTime(a.check_out) : '—'}</td>
                  <td>{a?.work_minutes ? minsToH(a.work_minutes) : '—'}{a?.overtime_minutes > 0 && <div className="tiny" style={{ color: 'var(--success)' }}>+{minsToH(a.overtime_minutes)} OT</div>}</td>
                  <td className="small">{a?.late_minutes > 0 && <Badge tone="amber">{a.late_minutes}m late</Badge>} {a?.early_minutes > 0 && <Badge tone="amber">{a.early_minutes}m early</Badge>}</td>
                  <td>{a ? <Badge status={a.status} /> : e.expected !== 'working' ? <Badge status={e.expected}>{e.holiday || titleCase(e.expected)}</Badge> : <span className="faint small">Not marked</span>}</td>
                  <td className="nowrap right">
                    {date === today() && !a?.check_in && e.expected === 'working' && <Button size="sm" variant="primary" icon={LogIn} onClick={() => punch(e, 'in')}>In</Button>}
                    {date === today() && a?.check_in && !a?.check_out && <Button size="sm" icon={LogOut} onClick={() => punch(e, 'out')}>Out</Button>}
                    {manager && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit({ e, a, date })} aria-label="Correct" />}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>
      {edit && <CorrectModal {...edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function CorrectModal({ e, a, date, onClose, onSaved }) {
  const [f, setF] = useState({ status: a?.status || (e.expected === 'working' ? 'present' : e.expected), check_in: a?.check_in || e.work_start, check_out: a?.check_out || '', notes: a?.notes || '', reason: '' });
  const toast = useToast();
  const timed = ['present', 'half_day'].includes(f.status);
  const save = async () => {
    try { await api.put('/api/staff/attendance', { employee_id: e.id, date, ...f, check_in: timed ? f.check_in || null : null, check_out: timed ? f.check_out || null : null }); toast.success('Attendance updated'); onSaved(); } catch (err) { toast.error(err); }
  };
  return (
    <Modal open onClose={onClose} title={`${a ? 'Correct' : 'Mark'} attendance — ${e.name}`} size="narrow" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={f.reason.trim().length < 3} onClick={save}>Save</Button></>}>
      <div className="col">
        <p className="muted small">{fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })} · every manual change is recorded in the corrections log.</p>
        <Select label="Status" value={f.status} onChange={(ev) => setF({ ...f, status: ev.target.value })} options={ST} />
        {timed && <div className="form-grid"><Input label="Check-in" type="time" value={f.check_in} onChange={(ev) => setF({ ...f, check_in: ev.target.value })} /><Input label="Check-out" type="time" value={f.check_out} onChange={(ev) => setF({ ...f, check_out: ev.target.value })} /></div>}
        <Input label="Note (optional)" value={f.notes} onChange={(ev) => setF({ ...f, notes: ev.target.value })} />
        <Textarea label="Reason for change (required)" rows={2} value={f.reason} onChange={(ev) => setF({ ...f, reason: ev.target.value })} placeholder="e.g. Forgot to check out; confirmed by manager" />
      </div>
    </Modal>
  );
}

function Monthly() {
  const { salon } = useAuth();
  const [month, setMonth] = useState(today().slice(0, 7));
  const { data, error, reload } = useApi('/api/staff/attendance/monthly', { month });
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const cols = [{ key: 'name', label: 'Employee' }, ...['present', 'absent', 'leave', 'half_days', 'weekly_offs', 'holidays', 'late_days', 'early_days', 'hours', 'overtime'].map((k) => ({ key: (r) => r.summary[k], label: titleCase(k) }))];
  return (
    <Card pad={false}>
      <div className="toolbar"><input type="month" className="input" style={{ width: 170 }} value={month} max={today().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" /><b>{monthLabel(month)}</b><div className="grow" />
        {data && <ExportMenu onCSV={() => exportCSV(`attendance-${month}`, cols, data.employees)} onExcel={() => exportXLSX(`attendance-${month}`, [{ name: 'Summary', columns: cols, rows: data.employees }, { name: 'Daily', columns: [{ key: 'name', label: 'Employee' }, ...data.days.map((d) => ({ key: (r) => CODE[r.records[d]?.status] || '', label: d.slice(8) }))], rows: data.employees }])}
          onPDF={() => exportPDF(`attendance-${month}`, 'Monthly attendance report', monthLabel(month), [{ columns: cols, rows: data.employees }], salon?.name)} />}</div>
      {!data ? <Loader rows={6} /> : (
        <div className="table-wrap"><table className="table" style={{ fontSize: 12 }}>
          <thead><tr><th style={{ position: 'sticky', left: 0, background: 'var(--bg-elev)', zIndex: 1 }}>Employee</th>{data.days.map((d) => <th key={d} className="center" style={{ padding: '8px 4px' }}>{Number(d.slice(8))}</th>)}<th className="right">P</th><th className="right">A</th><th className="right">L</th><th className="right">Hours</th><th className="right">OT</th></tr></thead>
          <tbody>{data.employees.map((e) => (
            <tr key={e.id}>
              <td style={{ position: 'sticky', left: 0, background: 'var(--surface)', fontWeight: 600 }} className="nowrap">{e.name}</td>
              {data.days.map((d) => { const r = e.records[d]; const s = r?.status; const off = !r && e.weekly_off != null && new Date(`${d}T00:00`).getDay() === Number(e.weekly_off); return <td key={d} className="center" style={{ padding: '6px 2px' }} title={r ? `${titleCase(s)}${r.check_in ? ` ${r.check_in}–${r.check_out || '?'}` : ''}` : ''}><span style={{ fontWeight: 700, fontSize: 11, color: { present: 'var(--success)', half_day: 'var(--warning)', absent: 'var(--danger)', leave: 'var(--info)', holiday: 'var(--accent)' }[s] || 'var(--text-3)' }}>{CODE[s] || (off ? 'W' : d <= today() ? '·' : '')}</span></td>; })}
              <td className="num">{e.summary.present}</td><td className="num">{e.summary.absent}</td><td className="num">{e.summary.leave}</td><td className="num">{e.summary.hours}</td><td className="num">{e.summary.overtime}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="pager"><span>P present · H half day · A absent · L leave · W weekly off · Ho holiday</span></div>
    </Card>
  );
}

function Leaves({ manager }) {
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const { data, reload } = useApi('/api/staff/leaves', { status });
  const emps = useApi('/api/staff/employees');
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const act = async (id, a) => { try { await api.post(`/api/staff/leaves/${id}/${a}`); toast.success(`Leave ${a === 'approve' ? 'approved' : 'rejected'}`); reload(); } catch (e) { toast.error(e); } };
  return (
    <Card pad={false} title=" " actions={<><select className="input sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><Button size="sm" variant="primary" icon={Plus} onClick={() => setOpen(true)}>{manager ? 'Add leave' : 'Request leave'}</Button></>}>
      <div style={{ height: 10 }} />
      {!data ? <Loader /> : !data.length ? <Empty icon={CalendarOff} title="No leave records" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Employee</th><th>From</th><th>To</th><th>Type</th><th>Reason</th><th>Status</th><th /></tr></thead><tbody>
          {data.map((l) => <tr key={l.id}><td><b>{l.employee}</b></td><td>{fmtDate(l.from_date)}</td><td>{fmtDate(l.to_date)}</td><td>{titleCase(l.leave_type)}</td><td className="muted small">{l.reason}</td><td><Badge status={l.status} /></td>
            <td className="nowrap">{manager && l.status === 'pending' && <><Button size="sm" variant="success" icon={Check} onClick={() => act(l.id, 'approve')}>Approve</Button> <Button size="sm" variant="danger" icon={X} onClick={() => act(l.id, 'reject')}>Reject</Button></>}{manager && l.status === 'approved' && l.to_date >= today() && <Button size="sm" variant="ghost" onClick={() => act(l.id, 'cancel')}>Cancel</Button>}</td></tr>)}
        </tbody></table></div>
      )}
      {open && <LeaveModal emps={manager ? emps.data || [] : (emps.data || []).filter((e) => e.id === user.employee_id)} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
    </Card>
  );
}
function LeaveModal({ emps, onClose, onSaved }) {
  const [f, setF] = useState({ employee_id: emps[0]?.id || '', from_date: today(), to_date: today(), leave_type: 'paid', reason: '' });
  const toast = useToast();
  const save = async () => { try { const r = await api.post('/api/staff/leaves', { ...f, employee_id: Number(f.employee_id) }); toast.success(r.status === 'approved' ? 'Leave added' : 'Leave requested'); onSaved(); } catch (e) { toast.error(e); } };
  return (
    <Modal open onClose={onClose} title="Leave" size="narrow" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.employee_id} onClick={save}>Save</Button></>}>
      <div className="col">
        <Select label="Employee" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} options={emps.map((e) => [e.id, e.name])} />
        <div className="form-grid"><Input label="From" type="date" value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value })} /><Input label="To" type="date" value={f.to_date} min={f.from_date} onChange={(e) => setF({ ...f, to_date: e.target.value })} /></div>
        <Select label="Type" value={f.leave_type} onChange={(e) => setF({ ...f, leave_type: e.target.value })} options={[['paid', 'Paid leave'], ['sick', 'Sick leave (paid)'], ['casual', 'Casual leave (paid)'], ['unpaid', 'Unpaid leave']]} />
        <Input label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </div>
    </Modal>
  );
}

function Holidays() {
  const { branches } = useAuth();
  const { data, reload } = useApi('/api/staff/holidays');
  const [f, setF] = useState({ date: '', name: '', branch_id: '' });
  const toast = useToast();
  const confirm = useConfirm();
  const add = async () => { try { await api.post('/api/staff/holidays', { ...f, branch_id: f.branch_id ? Number(f.branch_id) : null }); setF({ date: '', name: '', branch_id: '' }); reload(); toast.success('Holiday added'); } catch (e) { toast.error(e); } };
  const del = async (h) => { if (!(await confirm({ title: `Remove ${h.name}?`, danger: true }))) return; await api.del(`/api/staff/holidays/${h.id}`); reload(); };
  return (
    <Card title="Salon holidays" actions={<span className="faint small">Holidays block online booking and count as paid days in payroll</span>}>
      <div className="row wrap mb" style={{ marginBottom: 14 }}>
        <input type="date" className="input" style={{ width: 160 }} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Date" />
        <input className="input" style={{ width: 220 }} placeholder="Holiday name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" />
        <select className="input" style={{ width: 170 }} value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value })} aria-label="Branch"><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <Button variant="primary" icon={Plus} disabled={!f.date || f.name.length < 2} onClick={add}>Add</Button>
      </div>
      {!data ? <Loader /> : !data.length ? <p className="faint">No holidays added for this year.</p> : data.map((h) => <div key={h.id} className="mini-stat"><span><b>{fmtDate(h.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</b> · {h.name} <span className="faint small">{h.branch_name || 'All branches'}</span></span><Button size="sm" variant="ghost" icon={Trash2} onClick={() => del(h)} aria-label="Remove" /></div>)}
    </Card>
  );
}

function Audit() {
  const { data } = useApi('/api/staff/attendance/audit');
  const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const desc = (v) => (v ? `${titleCase(v.status)}${v.check_in ? ` ${v.check_in}–${v.check_out || '…'}` : ''}` : '—');
  return (
    <Card pad={false} title={<h2 className="row" style={{ gap: 8 }}><History size={16} />Manual corrections</h2>}>
      <div style={{ height: 10 }} />
      {!data ? <Loader /> : !data.length ? <Empty title="No manual corrections" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Employee</th><th>Date</th><th>Before</th><th>After</th><th>Reason</th><th>By</th></tr></thead><tbody>
          {data.map((r) => { const o = parse(r.old_value), n = parse(r.new_value); return <tr key={r.id}><td className="small nowrap">{r.created_at.slice(0, 16)}</td><td>{r.employee}</td><td>{n && fmtDate(n.date)}</td><td className="small">{desc(o)}</td><td className="small">{desc(n)}</td><td className="small muted">{r.reason}</td><td className="small">{r.changed_by}</td></tr>; })}
        </tbody></table></div>
      )}
    </Card>
  );
}
