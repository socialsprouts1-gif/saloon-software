import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, Download, UserPlus, Pencil, ShieldCheck, Database } from 'lucide-react';
import { useApi, useAuth, useToast, useDebounced } from '../context.jsx';
import { api } from '../lib/api.js';
import { DOW, titleCase, fmtStamp } from '../lib/format.js';
import { downloadBlob } from '../lib/export.js';
import { PageHead, Card, Button, Tabs, Input, Select, Textarea, Switch, Loader, ErrorState, ImageUpload, Badge, Modal, Pager, SearchInput, Empty } from '../components/ui.jsx';

const TABS = [['salon', 'Salon profile'], ['hours', 'Opening hours'], ['tax', 'GST & invoices'], ['appointments', 'Appointment rules'], ['crm', 'Loyalty & CRM'], ['attendance', 'Attendance rules'], ['notifications', 'Notifications'], ['whatsapp', 'WhatsApp'], ['ai', 'AI assistant'], ['users', 'Users & roles'], ['audit', 'Audit log'], ['data', 'Data & backup']];

export default function Settings() {
  const { data, error, reload, setData } = useApi('/api/settings');
  const [tab, setTab] = useState('salon');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loader rows={8} />;
  const s = data.settings;
  const patch = (key, value) => setData((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));
  return (
    <div>
      <PageHead title="Settings" sub="Configure your salon, billing, rules, integrations and team access" />
      <Tabs value={tab} onChange={setTab} tabs={TABS} />
      <div className="mt" style={{ maxWidth: 980 }}>
        {tab === 'salon' && <Section k="salon" s={s} patch={patch} render={(v, set) => <div className="form-grid">
          <Input label="Salon name" value={v.name} onChange={(e) => set({ name: e.target.value })} /><Input label="Tagline" value={v.tagline || ''} onChange={(e) => set({ tagline: e.target.value })} />
          <ImageUpload label="Logo (used on invoices, booking page and QR)" value={v.logo} onChange={(logo) => set({ logo })} />
          <Input label="Currency symbol" value={v.currency_symbol} onChange={(e) => set({ currency_symbol: e.target.value })} hint="Default ₹ (INR)" />
          <Textarea label="Business address" fieldClass="full" rows={2} value={v.address || ''} onChange={(e) => set({ address: e.target.value })} />
          <Input label="Phone" value={v.phone || ''} onChange={(e) => set({ phone: e.target.value })} /><Input label="Email" value={v.email || ''} onChange={(e) => set({ email: e.target.value })} />
          <Input label="Website" value={v.website || ''} onChange={(e) => set({ website: e.target.value })} />
        </div>} />}
        {tab === 'hours' && <Section k="opening_hours" s={s} patch={patch} render={(v, set) => <div className="col">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => { const h = v[d] || { open: '10:00', close: '20:00', closed: false }; const upd = (p) => set({ [d]: { ...h, ...p } });
            return <div key={d} className="row wrap" style={{ gap: 12 }}><b style={{ width: 110 }}>{DOW[d]}</b><label className="check"><input type="checkbox" checked={!h.closed} onChange={(e) => upd({ closed: !e.target.checked })} />Open</label>
              {!h.closed && <><input type="time" className="input" style={{ width: 130 }} value={h.open} onChange={(e) => upd({ open: e.target.value })} aria-label={`${DOW[d]} open`} /><span className="faint">to</span><input type="time" className="input" style={{ width: 130 }} value={h.close} onChange={(e) => upd({ close: e.target.value })} aria-label={`${DOW[d]} close`} /></>}</div>; })}
          <p className="faint small">Online booking only offers slots inside these hours and each stylist's shift.</p>
        </div>} />}
        {tab === 'tax' && <><Section k="tax" title="GST configuration" s={s} patch={patch} render={(v, set) => <div className="form-grid">
          <Switch label="Charge GST on bills" checked={v.enabled} onChange={(enabled) => set({ enabled })} /><Switch label="Prices include GST" hint="Tax is extracted from the bill instead of added" checked={v.inclusive} onChange={(inclusive) => set({ inclusive })} />
          <Input label="GST rate (%)" type="number" min="0" max="50" value={v.rate} onChange={(e) => set({ rate: e.target.value })} hint="Split equally into CGST + SGST on invoices" /><Input label="GSTIN" value={v.gstin || ''} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />
          <Input label="Tax label" value={v.label} onChange={(e) => set({ label: e.target.value })} />
        </div>} />
        <div className="mt" /><Section k="invoice" title="Invoice customisation" s={s} patch={patch} render={(v, set) => <div className="form-grid">
          <Input label="Invoice number prefix" value={v.prefix} onChange={(e) => set({ prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} hint="e.g. INV → INV-2026-00001" />
          <Switch label="Show GSTIN on invoices" checked={v.show_gstin} onChange={(show_gstin) => set({ show_gstin })} />
          <Input label="Footer message" fieldClass="full" value={v.footer || ''} onChange={(e) => set({ footer: e.target.value })} />
          <Textarea label="Terms & conditions" fieldClass="full" rows={2} value={v.terms || ''} onChange={(e) => set({ terms: e.target.value })} />
        </div>} /></>}
        {tab === 'appointments' && <Section k="appointments" s={s} patch={patch} render={(v, set) => <div className="form-grid">
          <Select label="Time slot interval" value={v.slot_interval} onChange={(e) => set({ slot_interval: Number(e.target.value) })} options={[[10, '10 minutes'], [15, '15 minutes'], [20, '20 minutes'], [30, '30 minutes'], [60, '60 minutes']]} />
          <Input label="Buffer between appointments (min)" type="number" min="0" value={v.buffer_min} onChange={(e) => set({ buffer_min: Number(e.target.value) })} />
          <Input label="Minimum notice for online bookings (min)" type="number" min="0" value={v.min_notice_min} onChange={(e) => set({ min_notice_min: Number(e.target.value) })} />
          <Input label="How far ahead customers can book (days)" type="number" min="1" max="180" value={v.max_advance_days} onChange={(e) => set({ max_advance_days: Number(e.target.value) })} />
          <Switch label="Auto-confirm online bookings" checked={v.auto_confirm_online} onChange={(auto_confirm_online) => set({ auto_confirm_online })} />
          <Switch label="Allow 'Any available stylist'" checked={v.allow_any_stylist} onChange={(allow_any_stylist) => set({ allow_any_stylist })} />
          <p className="faint small full">Double bookings are always blocked for the same stylist. Booking page look &amp; feel is under <Link to="/booking">QR Booking</Link>.</p>
        </div>} />}
        {tab === 'crm' && <><Section k="loyalty" title="Loyalty points" s={s} patch={patch} render={(v, set) => <div className="form-grid">
          <Switch label="Enable loyalty points" checked={v.enabled} onChange={(enabled) => set({ enabled })} /><div />
          <Input label="Points earned per ₹100 spent" type="number" min="0" value={v.points_per_100} onChange={(e) => set({ points_per_100: Number(e.target.value) })} />
          <Input label="Value of 1 point (₹)" type="number" min="0" step="0.1" value={v.point_value} onChange={(e) => set({ point_value: Number(e.target.value) })} />
          <Input label="Minimum points to redeem" type="number" min="0" value={v.min_redeem} onChange={(e) => set({ min_redeem: Number(e.target.value) })} />
        </div>} /><div className="mt" />
        <Section k="crm" title="Customer segments" s={s} patch={patch} render={(v, set) => <div className="form-grid">
          <Input label="VIP: lifetime spend at least (₹)" type="number" min="0" value={v.vip_spend} onChange={(e) => set({ vip_spend: Number(e.target.value) })} />
          <Input label="VIP: or at least this many visits" type="number" min="1" value={v.vip_visits} onChange={(e) => set({ vip_visits: Number(e.target.value) })} />
          <Input label="Regular: at least this many visits" type="number" min="1" value={v.regular_visits} onChange={(e) => set({ regular_visits: Number(e.target.value) })} />
          <Input label="Inactive: no visit for (days)" type="number" min="7" value={v.inactive_days} onChange={(e) => set({ inactive_days: Number(e.target.value) })} />
        </div>} /></>}
        {tab === 'attendance' && <Section k="attendance" s={s} patch={patch} render={(v, set) => <div className="form-grid">
          <Input label="Late grace period (min)" type="number" min="0" value={v.grace_min} onChange={(e) => set({ grace_min: Number(e.target.value) })} />
          <Input label="Half day if worked less than (fraction of shift)" type="number" min="0" max="1" step="0.05" value={v.half_day_ratio} onChange={(e) => set({ half_day_ratio: Number(e.target.value) })} />
          <Input label="Overtime pay multiplier" type="number" min="0" step="0.25" value={v.overtime_rate} onChange={(e) => set({ overtime_rate: Number(e.target.value) })} hint="1 = normal hourly rate, 1.5 = time and a half" />
        </div>} />}
        {tab === 'notifications' && <Section k="notifications" s={s} patch={patch} render={(v, set) => <div className="col">
          {[['new_booking', 'New online / QR bookings'], ['cancellations', 'Appointment cancellations'], ['upcoming', 'Upcoming appointments (1 hour before)'], ['low_stock', 'Low & out-of-stock products'], ['absences', "Employees who haven't checked in"], ['salary_due', 'Pending salary payments'], ['membership_expiry', 'Packages expiring within 7 days'], ['birthdays', 'Customer birthdays'], ['pending_payments', 'Pending customer payments']].map(([k, l]) => <Switch key={k} label={l} checked={v[k]} onChange={(x) => set({ [k]: x })} />)}
        </div>} />}
        {tab === 'whatsapp' && <Section k="whatsapp" s={s} patch={patch} render={(v, set) => <div className="form-grid">
          <Switch label="Enable WhatsApp messages" checked={v.enabled} onChange={(enabled) => set({ enabled })} />
          <Select label="Sending method" value={v.provider} onChange={(e) => set({ provider: e.target.value })} options={[['link', 'Click-to-chat links (no setup)'], ['cloud_api', 'WhatsApp Cloud API (automatic)']]} />
          {v.provider === 'cloud_api' && <><Input label="Phone number ID" value={v.phone_number_id || ''} onChange={(e) => set({ phone_number_id: e.target.value })} /><Input label="Access token" type="password" value={v.access_token || ''} onChange={(e) => set({ access_token: e.target.value })} hint="Stored on your server; never shown again" /></>}
          <Switch label="Send booking confirmations" checked={v.send_booking_confirmation} onChange={(x) => set({ send_booking_confirmation: x })} />
          <Switch label="Offer invoice sharing" checked={v.send_invoice} onChange={(x) => set({ send_invoice: x })} />
          <p className="faint small full">With click-to-chat, staff get a ready-to-send WhatsApp message (invoices, confirmations). With the Cloud API, booking confirmations are sent automatically from your WhatsApp Business number.</p>
        </div>} />}
        {tab === 'ai' && <Section k="ai" s={s} patch={patch} render={(v, set) => <div className="form-grid">
          <Switch label="Enable AI assistant" checked={v.enabled} onChange={(enabled) => set({ enabled })} /><div />
          <Input label="Anthropic API key (optional)" type="password" value={v.api_key || ''} onChange={(e) => set({ api_key: e.target.value })} hint="Without a key, the built-in engine answers common questions" />
          <Input label="Claude model" value={v.model} onChange={(e) => set({ model: e.target.value })} />
          <p className="faint small full">The assistant only reads your data through fixed reporting functions (revenue, expenses, staff, stock, customers) — it can't change anything and never invents figures.</p>
        </div>} />}
        {tab === 'users' && <Users modules={data.modules} roles={data.roles} permissions={s.permissions} onPerms={(p) => patch('permissions', p)} />}
        {tab === 'audit' && <Audit />}
        {tab === 'data' && <DataTab />}
      </div>
    </div>
  );
}

/** Generic settings section with local draft + save */
function Section({ k, s, patch, render, title }) {
  const [v, setV] = useState(s[k]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { refresh } = useAuth();
  useEffect(() => setV(s[k]), [k]); // eslint-disable-line
  const dirty = JSON.stringify(v) !== JSON.stringify(s[k]);
  const save = async () => {
    setBusy(true);
    try { const r = await api.put(`/api/settings/${k}`, v); patch(k, r.value); setV(r.value); toast.success('Settings saved'); if (['salon', 'tax'].includes(k)) refresh(); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Card title={title} actions={<Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={save}>Save</Button>}>
      {render(v, (p) => setV((x) => ({ ...x, ...p })))}
    </Card>
  );
}

const ROLE_INFO = { owner: 'Full access to everything', manager: 'Appointments, staff, inventory, reports, daily operations', receptionist: 'Customers, appointments and billing', accountant: 'Billing, expenses, payroll, financial reports', employee: 'Own appointments, attendance and performance' };

function Users({ modules, roles, permissions, onPerms }) {
  const { user, branches } = useAuth();
  const { data, reload } = useApi('/api/auth/users');
  const emps = useApi('/api/staff/employees', { include_inactive: 1 });
  const [edit, setEdit] = useState(null);
  const [perms, setPerms] = useState(permissions);
  const toast = useToast();
  const save = async () => {
    try {
      const body = { name: edit.name, email: edit.email, role: edit.role, employee_id: edit.employee_id ? Number(edit.employee_id) : null, branch_id: edit.branch_id ? Number(edit.branch_id) : null, is_active: edit.is_active !== false && edit.is_active !== 0, ...(edit.password ? { password: edit.password } : {}) };
      if (edit.id) await api.put(`/api/auth/users/${edit.id}`, body); else await api.post('/api/auth/users', body);
      toast.success('User saved'); setEdit(null); reload();
    } catch (e) { toast.error(e); }
  };
  const savePerms = async () => { try { const r = await api.put('/api/settings/permissions', perms); onPerms(r.value); toast.success('Permissions updated — users see changes on next page load'); } catch (e) { toast.error(e); } };
  const toggle = (role, m) => setPerms((p) => ({ ...p, [role]: p[role].includes(m) ? p[role].filter((x) => x !== m) : [...p[role], m] }));
  return (
    <div className="col" style={{ gap: 18 }}>
      <Card title="User accounts" actions={<Button variant="primary" size="sm" icon={UserPlus} onClick={() => setEdit({ role: 'receptionist', is_active: true })}>Add user</Button>} pad={false}>
        <div style={{ height: 10 }} />
        {!data ? <Loader /> : <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Employee</th><th>Branch</th><th>Last login</th><th>Status</th><th /></tr></thead><tbody>
          {data.map((u) => <tr key={u.id}><td><b>{u.name}</b>{u.id === user.id && <span className="faint tiny"> (you)</span>}</td><td className="small">{u.email}</td><td><Badge tone="plum">{titleCase(u.role)}</Badge></td><td className="small">{u.employee_name || '—'}</td><td className="small">{u.branch_name || 'All'}</td><td className="small">{u.last_login ? fmtStamp(u.last_login.replace('T', ' ')) : 'Never'}</td><td><Badge status={u.is_active ? 'active' : 'inactive'} /></td><td><Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit({ ...u, password: '' })} aria-label="Edit" /></td></tr>)}
        </tbody></table></div>}
      </Card>
      <Card title={<h2 className="row" style={{ gap: 8 }}><ShieldCheck size={16} />Role permissions</h2>} actions={user.role === 'owner' && <Button variant="primary" size="sm" icon={Save} disabled={JSON.stringify(perms) === JSON.stringify(permissions)} onClick={savePerms}>Save permissions</Button>} pad={false}>
        <p className="faint small" style={{ padding: '8px 20px 0' }}>“Finance” controls whether a role can see money figures (revenue, profit, salaries) anywhere in the app. Owners always have full access.</p>
        <div className="table-wrap"><table className="table"><thead><tr><th>Module</th>{roles.map((r) => <th key={r} className="center" title={ROLE_INFO[r]}>{titleCase(r)}</th>)}</tr></thead><tbody>
          {modules.map((m) => <tr key={m}><td><b>{titleCase(m)}</b></td>{roles.map((r) => <td key={r} className="center"><input type="checkbox" checked={perms[r]?.includes(m)} disabled={r === 'owner' || user.role !== 'owner'} onChange={() => toggle(r, m)} aria-label={`${r} ${m}`} style={{ accentColor: 'var(--primary)', width: 16, height: 16 }} /></td>)}</tr>)}
        </tbody></table></div>
      </Card>
      {edit && <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Edit user' : 'Add user'} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={!edit.name || !edit.email || (!edit.id && (edit.password || '').length < 8)} onClick={save}>Save</Button></>}>
        <div className="form-grid">
          <Input label="Name" value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <Input label="Email (login)" type="email" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
          <Select label="Role" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} options={roles.filter((r) => r !== 'owner' || user.role === 'owner').map((r) => [r, titleCase(r)])} hint={ROLE_INFO[edit.role]} />
          <Input label={edit.id ? 'New password (leave blank to keep)' : 'Password'} type="password" value={edit.password || ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} autoComplete="new-password" hint="At least 8 characters" />
          <Select label="Linked employee profile" value={edit.employee_id || ''} onChange={(e) => setEdit({ ...edit, employee_id: e.target.value })} placeholder="None" options={(emps.data || []).map((e) => [e.id, e.name])} hint={edit.role === 'employee' ? 'Required for employee logins' : undefined} />
          <Select label="Restrict to branch" value={edit.branch_id || ''} onChange={(e) => setEdit({ ...edit, branch_id: e.target.value })} placeholder="All branches" options={branches.map((b) => [b.id, b.name])} />
          {edit.id && <Switch label="Account active" checked={!!edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} />}
        </div>
      </Modal>}
    </div>
  );
}

function Audit() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data } = useApi('/api/audit-logs', { q: dq, page, pageSize: 40 });
  return (
    <Card pad={false} title="Audit log">
      <div className="toolbar"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search action, user, record" /></div>
      {!data ? <Loader /> : !data.data.length ? <Empty title="No activity" /> : <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>
        {data.data.map((l) => <tr key={l.id}><td className="small nowrap">{fmtStamp(l.created_at)}</td><td className="small">{l.user_name}</td><td><Badge tone="plum">{titleCase(l.action)}</Badge></td><td className="small">{titleCase(l.entity)}{l.entity_id ? ` #${l.entity_id}` : ''}</td><td className="small faint" style={{ maxWidth: 380 }}><div className="truncate" title={l.details || ''}>{l.details}</div></td></tr>)}
      </tbody></table></div>}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </Card>
  );
}

function DataTab() {
  const toast = useToast();
  const { user } = useAuth();
  const [check, setCheck] = useState(null);
  const exportAll = async () => { try { const b = await api.blob('/api/export'); downloadBlob(b, `salon-backup-${new Date().toISOString().slice(0, 10)}.json`); toast.success('Backup downloaded'); } catch (e) { toast.error(e); } };
  return (
    <div className="col" style={{ gap: 18 }}>
      <Card title={<h2 className="row" style={{ gap: 8 }}><Database size={16} />Data export & backup</h2>}>
        <p className="muted">Download every record (customers, appointments, invoices, staff, stock, expenses, settings) as a single JSON file. Passwords and API keys are never included.</p>
        <div className="row mt"><Button variant="primary" icon={Download} onClick={exportAll} disabled={user.role !== 'owner'}>Download full backup</Button>{user.role !== 'owner' && <span className="faint small">Only the owner can export all data.</span>}</div>
        <p className="faint small mt">Server administrators can also back up the database file directly (<code>data/salon.db</code>) — it's a single SQLite file. Individual tables can be exported as PDF/Excel/CSV from each page.</p>
      </Card>
      <Card title="Database health"><div className="row"><Button onClick={async () => setCheck(await api.get('/api/meta/db-check'))}>Run integrity check</Button>{check && <Badge tone={check.integrity?.integrity_check === 'ok' ? 'green' : 'red'}>{check.integrity?.integrity_check}</Badge>}</div></Card>
    </div>
  );
}
