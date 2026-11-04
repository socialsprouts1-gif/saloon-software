import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Plus, LogIn, PauseCircle, PlayCircle, Trash2, Users, IndianRupee, CalendarCheck, LogOut, ExternalLink, Pencil, ShieldCheck } from 'lucide-react';
import { platformApi, getPlatformToken, setPlatformToken } from '../lib/api.js';
import { useAuth, useToast } from '../context.jsx';
import { money, compact, fmtStamp, titleCase } from '../lib/format.js';
import { Button, Input, Select, Textarea, Modal, Kpi, Badge, Loader, Empty, Switch, useConfirm } from '../components/ui.jsx';

/** Platform owner panel: every salon on the platform in one place. */
export default function Platform() {
  const [token, setTok] = useState(getPlatformToken());
  const [me, setMe] = useState(null);
  useEffect(() => {
    if (!token) return;
    platformApi.get('/api/platform/me').then(setMe).catch(() => { setPlatformToken(null); setTok(null); });
  }, [token]);
  const signIn = (t) => { setPlatformToken(t); setTok(t); };
  const signOut = () => { setPlatformToken(null); setTok(null); setMe(null); };
  if (!token || !me) return token ? <Center><span className="spinner" /></Center> : <PlatformLogin onToken={signIn} />;
  return <Dashboard admin={me.admin} onSignOut={signOut} />;
}

const Center = ({ children }) => <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: 'var(--bg)' }}>{children}</div>;

function PlatformLogin({ onToken }) {
  const [status, setStatus] = useState(null);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { platformApi.get('/api/platform/status').then(setStatus).catch(() => setStatus({ hasAdmin: true })); }, []);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const r = await platformApi.post(status.hasAdmin ? '/api/platform/login' : '/api/platform/setup', f); onToken(r.token); }
    catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <Center>
      <form onSubmit={submit} className="card" style={{ width: '100%', maxWidth: 400, padding: 28 }}>
        <div className="row" style={{ marginBottom: 16 }}><span className="brand-mark"><ShieldCheck size={18} /></span><div><b className="display" style={{ fontSize: 18 }}>Salon Studio</b><div className="faint tiny">Platform owner panel</div></div></div>
        {!status ? <Loader rows={2} /> : <div className="col" style={{ gap: 13 }}>
          <h1 style={{ fontSize: 23 }}>{status.hasAdmin ? 'Platform sign in' : 'Set up the platform'}</h1>
          <p className="muted small">{status.hasAdmin ? 'Manage every salon on the platform.' : 'Create the platform owner account. This is separate from salon logins.'}</p>
          {!status.hasAdmin && <Input label="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} />}
          <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
          <Input label="Password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={status.hasAdmin ? 1 : 8} />
          {status.demo && status.hasAdmin && <p className="faint small">Demo: <b>admin@salonstudio.demo</b> / <b>Admin@1234</b></p>}
          {err && <div className="badge red plain" style={{ padding: '8px 12px', borderRadius: 10, whiteSpace: 'normal', textTransform: 'none' }}>{err}</div>}
          <Button variant="primary" size="lg" type="submit" loading={busy} className="block">{status.hasAdmin ? 'Sign in' : 'Create platform account'}</Button>
          <p className="center tiny"><Link to="/login" className="faint">Salon staff login →</Link></p>
        </div>}
      </form>
    </Center>
  );
}

function Dashboard({ admin, onSignOut }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState(null);
  const { login } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const load = useCallback(() => platformApi.get('/api/platform/salons').then(setData).catch((e) => toast.error(e)), [toast]);
  useEffect(() => { load(); }, [load]);
  const setStatus = async (s, status) => {
    if (status === 'suspended' && !(await confirm({ title: `Suspend ${s.name}?`, text: 'Their staff will be signed out and booking links stop working until you reactivate the salon. No data is deleted.', confirmText: 'Suspend', danger: true }))) return;
    try { await platformApi.put(`/api/platform/salons/${s.id}`, { status }); toast.success(status === 'active' ? 'Salon reactivated' : 'Salon suspended'); load(); } catch (e) { toast.error(e); }
  };
  const remove = async (s) => {
    const typed = await confirm({ title: `Delete ${s.name} permanently?`, text: `All of this salon's data will be deleted. Type the salon ID "${s.slug}" to confirm.`, prompt: 'Salon ID', confirmText: 'Delete salon', danger: true });
    if (!typed) return;
    try { await platformApi.del(`/api/platform/salons/${s.id}`, { confirm: typed }); toast.success('Salon deleted'); load(); } catch (e) { toast.error(e); }
  };
  const open = async (s) => {
    try {
      const r = await platformApi.post(`/api/platform/salons/${s.id}/open`);
      try { sessionStorage.setItem('salon.noauto', '1'); } catch { /* ignore */ }
      await login(r.token);
      toast.info(`Opened ${s.name} as owner (support access is logged)`);
      nav('/');
    } catch (e) { toast.error(e); }
  };
  const list = (data?.salons || []).filter((s) => `${s.name} ${s.slug} ${s.city || ''} ${s.owner_email || ''}`.toLowerCase().includes(q.toLowerCase()));
  const t = data?.totals;
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header className="topbar" style={{ position: 'sticky' }}>
        <span className="brand-mark" style={{ width: 32, height: 32 }}><ShieldCheck size={16} /></span>
        <div><b>Salon Studio Platform</b><div className="faint tiny">Signed in as {admin.name}</div></div>
        <div className="grow" />
        <a className="btn sm" href="/signup" target="_blank" rel="noreferrer"><ExternalLink size={14} />Public sign-up page</a>
        <Button size="sm" variant="ghost" icon={LogOut} onClick={onSignOut}>Sign out</Button>
      </header>
      <main className="content">
        <div className="page-head"><div><h1>Salons</h1><div className="sub">Every salon gets its own private admin panel and database</div></div>
          <div className="row wrap"><input className="input" style={{ width: 220 }} placeholder="Search salons" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search salons" /><Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add salon</Button></div></div>
        {t && <div className="grid g4 kpis mb" style={{ marginBottom: 18 }}>
          <Kpi icon={Building2} className="hero-kpi" label="Salons" value={t.salons} meta={`${t.active} active`} />
          <Kpi icon={IndianRupee} tone="success" label="Billed this month (all salons)" value={compact(t.revenue_month)} />
          <Kpi icon={CalendarCheck} tone="info" label="Appointments this month" value={t.appointments_month.toLocaleString('en-IN')} />
          <Kpi icon={Users} tone="accent" label="Customers" value={t.customers.toLocaleString('en-IN')} />
        </div>}
        <div className="card">
          {!data ? <Loader rows={5} /> : !list.length ? <Empty icon={Building2} title="No salons yet" text="Add a salon for a client, or share the public sign-up page." action={<Button variant="primary" onClick={() => setAdding(true)}>Add salon</Button>} /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Salon</th><th>Owner</th><th>Plan</th><th className="right">Staff</th><th className="right">Customers</th><th className="right">Appts (month)</th><th className="right">Billed (month)</th><th>Last activity</th><th>Status</th><th /></tr></thead>
              <tbody>{list.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.name}</b><div className="faint tiny">ID: {s.slug}{s.city ? ` · ${s.city}` : ''}</div></td>
                  <td className="small">{s.owner_name || '—'}<div className="faint tiny">{s.owner_email}</div></td>
                  <td><Badge tone="plum">{titleCase(s.plan)}</Badge></td>
                  <td className="num">{s.stats.staff ?? '—'}</td><td className="num">{s.stats.customers ?? '—'}</td><td className="num">{s.stats.appointments_month ?? '—'}</td>
                  <td className="num">{s.stats.revenue_month != null ? money(s.stats.revenue_month) : '—'}</td>
                  <td className="small nowrap">{s.stats.last_activity ? fmtStamp(s.stats.last_activity) : '—'}{s.stats.error && <div className="tiny" style={{ color: 'var(--danger)' }}>{s.stats.error}</div>}</td>
                  <td><Badge status={s.status === 'active' ? 'active' : 'cancelled'}>{titleCase(s.status)}</Badge></td>
                  <td className="nowrap right">
                    <Button size="sm" variant="primary" icon={LogIn} disabled={s.status !== 'active'} onClick={() => open(s)}>Open panel</Button>
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(s)} aria-label="Edit" />
                    {s.status === 'active' ? <Button size="sm" variant="ghost" icon={PauseCircle} onClick={() => setStatus(s, 'suspended')} aria-label="Suspend" /> : <Button size="sm" variant="ghost" icon={PlayCircle} onClick={() => setStatus(s, 'active')} aria-label="Reactivate" />}
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(s)} aria-label="Delete" />
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </main>
      {adding && <AddSalon onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
      {edit && <EditSalon salon={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function AddSalon({ onClose, onDone }) {
  const [f, setF] = useState({ salonName: '', ownerName: '', email: '', password: '', phone: '', city: '', plan: 'trial', demo: false });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try { const r = await platformApi.post('/api/platform/salons', f); toast.success(`Salon created (ID: ${r.slug}). Share the owner's email and password with them.`); onDone(); }
    catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Add a salon" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={f.salonName.length < 2 || f.ownerName.length < 2 || !f.email || f.password.length < 8} onClick={save}>Create salon</Button></>}>
      <div className="form-grid">
        <Input label="Salon name" value={f.salonName} onChange={set('salonName')} fieldClass="full" />
        <Input label="Owner name" value={f.ownerName} onChange={set('ownerName')} /><Input label="City" value={f.city} onChange={set('city')} />
        <Input label="Owner email (login)" type="email" value={f.email} onChange={set('email')} /><Input label="Temporary password" type="text" value={f.password} onChange={set('password')} hint="Min. 8 characters — owner can change it" />
        <Input label="Phone" value={f.phone} onChange={set('phone')} />
        <Select label="Plan" value={f.plan} onChange={set('plan')} options={[['trial', 'Trial'], ['basic', 'Basic'], ['pro', 'Pro'], ['enterprise', 'Enterprise']]} />
        <div className="full"><Switch label="Fill with sample data" hint="Useful for demos and training" checked={f.demo} onChange={(v) => setF({ ...f, demo: v })} /></div>
      </div>
    </Modal>
  );
}

function EditSalon({ salon, onClose, onDone }) {
  const [f, setF] = useState({ name: salon.name, plan: salon.plan, city: salon.city || '', phone: salon.phone || '', notes: salon.notes || '' });
  const toast = useToast();
  const save = async () => { try { await platformApi.put(`/api/platform/salons/${salon.id}`, f); toast.success('Saved'); onDone(); } catch (e) { toast.error(e); } };
  return (
    <Modal open onClose={onClose} title={`Edit ${salon.name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="form-grid">
        <Input label="Salon name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Select label="Plan" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} options={[['trial', 'Trial'], ['basic', 'Basic'], ['pro', 'Pro'], ['enterprise', 'Enterprise'], ['active', 'Active (legacy)']]} />
        <Input label="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /><Input label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <Textarea label="Internal notes" fieldClass="full" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <p className="faint small full">Salon ID (used in its links): <code>{salon.slug}</code> · created {fmtStamp(salon.created_at)}</p>
      </div>
    </Modal>
  );
}
