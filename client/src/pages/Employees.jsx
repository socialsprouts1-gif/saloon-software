import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, UserCog } from 'lucide-react';
import { useApi, useAuth, useToast } from '../context.jsx';
import { api } from '../lib/api.js';
import { money, titleCase, DOW, fmtTime, fmtDate } from '../lib/format.js';
import { PageHead, Card, Button, Badge, Empty, Loader, ErrorState, Modal, Input, Select, Textarea, Avatar, SearchInput, ImageUpload, Field, Switch } from '../components/ui.jsx';

export const EMP_ROLES = [['owner', 'Salon owner'], ['manager', 'Manager'], ['receptionist', 'Receptionist'], ['hair_stylist', 'Hair stylist'], ['beautician', 'Beautician'], ['assistant', 'Assistant'], ['accountant', 'Accountant']];
export const SALARY_TYPES = [['fixed_monthly', 'Fixed monthly salary'], ['daily', 'Daily wage'], ['hourly', 'Hourly wage'], ['commission', 'Commission only'], ['fixed_plus_commission', 'Fixed salary + commission']];
export const salaryText = (e) => ({ fixed_monthly: `${money(e.base_salary)}/month`, daily: `${money(e.daily_rate)}/day`, hourly: `${money(e.hourly_rate)}/hour`, commission: `${e.service_commission_pct}% commission`, fixed_plus_commission: `${money(e.base_salary)} + ${e.service_commission_pct}%` })[e.salary_type];

export default function Employees() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [inactive, setInactive] = useState(false);
  const { data, error, reload } = useApi('/api/staff/employees', { include_inactive: inactive ? 1 : undefined });
  const [edit, setEdit] = useState(null);
  const nav = useNavigate();
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const list = (data || []).filter((e) => e.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHead title="Employees" sub="Team profiles, roles, shifts, services and salary structures">
        <Button variant="primary" icon={UserPlus} onClick={() => setEdit({})}>Add employee</Button>
      </PageHead>
      <Card pad={false}>
        <div className="toolbar"><SearchInput value={q} onChange={setQ} placeholder="Search team" /><label className="check small"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />Show inactive</label></div>
        {!data ? <Loader rows={8} /> : !list.length ? <Empty icon={UserCog} title="No employees yet" action={<Button variant="primary" onClick={() => setEdit({})}>Add employee</Button>} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Employee</th><th>Role</th><th>Branch</th><th>Shift</th><th>Weekly off</th>{can('payroll') && <th>Salary</th>}<th>Services</th><th>Status</th></tr></thead>
            <tbody>{list.map((e) => (
              <tr key={e.id} className="click" onClick={() => nav(`/employees/${e.id}`)}>
                <td><div className="row"><Avatar name={e.name} src={e.photo} /><div><b>{e.name}</b><div className="faint tiny">{e.phone}</div></div></div></td>
                <td>{e.designation || titleCase(e.role)}<div className="faint tiny">{e.department}</div></td><td>{e.branch_name}</td>
                <td className="nowrap small">{fmtTime(e.work_start)} – {fmtTime(e.work_end)}</td><td>{e.weekly_off != null ? DOW[e.weekly_off] : '—'}</td>
                {can('payroll') && <td className="small">{salaryText(e)}</td>}<td>{e.service_ids.length || '—'}</td><td><Badge status={e.status} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {edit && <EmployeeForm initial={edit} onClose={() => setEdit(null)} onSaved={(id) => { setEdit(null); reload(); if (id) nav(`/employees/${id}`); }} />}
    </div>
  );
}

export function EmployeeForm({ initial, onClose, onSaved }) {
  const { can, branches, branch } = useAuth();
  const toast = useToast();
  const services = useApi('/api/catalog/services', { active: 1 });
  const [f, setF] = useState({
    name: '', photo: null, phone: '', email: '', address: '', joining_date: '', designation: '', department: '', role: 'hair_stylist', salary_type: 'fixed_monthly',
    base_salary: 0, daily_rate: 0, hourly_rate: 0, service_commission_pct: 0, product_commission_pct: 0, work_start: '10:00', work_end: '19:00', weekly_off: '', status: 'active',
    branch_id: branch !== 'all' ? branch : branches[0]?.id, service_ids: [], ...initial,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const payroll = can('payroll');
  const save = async () => {
    setBusy(true);
    try {
      const num = (v) => Number(v) || 0;
      const body = { name: f.name, photo: f.photo, phone: f.phone, email: f.email || null, address: f.address, joining_date: f.joining_date || null, designation: f.designation, department: f.department, role: f.role, salary_type: f.salary_type,
        work_start: f.work_start, work_end: f.work_end, weekly_off: f.weekly_off === '' || f.weekly_off == null ? null : Number(f.weekly_off), status: f.status, branch_id: Number(f.branch_id), service_ids: f.service_ids,
        ...(payroll ? { base_salary: num(f.base_salary), daily_rate: num(f.daily_rate), hourly_rate: num(f.hourly_rate), service_commission_pct: num(f.service_commission_pct), product_commission_pct: num(f.product_commission_pct) } : {}) };
      const r = initial.id ? await api.put(`/api/staff/employees/${initial.id}`, body) : await api.post('/api/staff/employees', body);
      toast.success('Employee saved'); onSaved(initial.id ? null : r.id);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const st = f.salary_type;
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit employee' : 'Add employee'} size="wide" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={f.name.length < 2} onClick={save}>Save</Button></>}>
      <div className="form-grid">
        <Input label="Full name" value={f.name} onChange={set('name')} />
        <ImageUpload label="Profile photo" round value={f.photo} onChange={(v) => setF({ ...f, photo: v })} />
        <Input label="Mobile" value={f.phone || ''} onChange={set('phone')} inputMode="tel" />
        <Input label="Email" type="email" value={f.email || ''} onChange={set('email')} />
        <Input label="Address" fieldClass="full" value={f.address || ''} onChange={set('address')} />
        <Select label="Role" value={f.role} onChange={set('role')} options={EMP_ROLES} />
        <Input label="Designation" value={f.designation || ''} onChange={set('designation')} placeholder="e.g. Senior Stylist" />
        <Input label="Department" value={f.department || ''} onChange={set('department')} placeholder="e.g. Hair" />
        <Input label="Joining date" type="date" value={f.joining_date || ''} onChange={set('joining_date')} />
        <Select label="Branch" value={f.branch_id || ''} onChange={set('branch_id')} options={branches.map((b) => [b.id, b.name])} />
        <Select label="Employment status" value={f.status} onChange={set('status')} options={[['active', 'Active'], ['inactive', 'Inactive (deactivated)']]} />
        <Input label="Shift start" type="time" value={f.work_start} onChange={set('work_start')} />
        <Input label="Shift end" type="time" value={f.work_end} onChange={set('work_end')} />
        <Select label="Weekly off" value={f.weekly_off ?? ''} onChange={set('weekly_off')} placeholder="None" options={DOW.map((d, i) => [i, d])} />
        {payroll && <>
          <Select label="Salary structure" value={st} onChange={set('salary_type')} options={SALARY_TYPES} />
          {['fixed_monthly', 'fixed_plus_commission'].includes(st) && <Input label="Monthly salary (₹)" type="number" min="0" value={f.base_salary} onChange={set('base_salary')} />}
          {st === 'daily' && <Input label="Daily rate (₹)" type="number" min="0" value={f.daily_rate} onChange={set('daily_rate')} />}
          {st === 'hourly' && <Input label="Hourly rate (₹)" type="number" min="0" value={f.hourly_rate} onChange={set('hourly_rate')} />}
          {['commission', 'fixed_plus_commission'].includes(st) && <><Input label="Service commission %" type="number" min="0" max="100" value={f.service_commission_pct} onChange={set('service_commission_pct')} /><Input label="Product commission %" type="number" min="0" max="100" value={f.product_commission_pct} onChange={set('product_commission_pct')} /></>}
        </>}
        <Field label={`Services this person performs (${f.service_ids.length})`} className="full">
          <div className="row mb" style={{ marginBottom: 6 }}><Button size="sm" variant="ghost" onClick={() => setF({ ...f, service_ids: (services.data || []).map((s) => s.id) })}>Select all</Button><Button size="sm" variant="ghost" onClick={() => setF({ ...f, service_ids: [] })}>Clear</Button></div>
          <div className="chips" style={{ maxHeight: 160, overflowY: 'auto' }}>{(services.data || []).map((s) => <button type="button" key={s.id} className={`chip ${f.service_ids.includes(s.id) ? 'on' : ''}`} onClick={() => setF({ ...f, service_ids: f.service_ids.includes(s.id) ? f.service_ids.filter((x) => x !== s.id) : [...f.service_ids, s.id] })}>{s.name}</button>)}</div>
        </Field>
      </div>
    </Modal>
  );
}
