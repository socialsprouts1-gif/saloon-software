import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Sparkles, CalendarCheck, QrCode, BarChart3 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth, useToast } from '../context.jsx';
import { Button, Input } from '../components/ui.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [f, setF] = useState({ email: '', password: '', salonName: '', ownerName: '', phone: '', address: '', demo: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/api/auth/setup-status').then(setStatus).catch(() => setStatus({ needsSetup: false })); }, []);
  if (user) return <Navigate to="/" replace />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = status?.needsSetup
        ? await api.post('/api/auth/setup', { salonName: f.salonName, ownerName: f.ownerName, email: f.email, password: f.password, phone: f.phone, address: f.address, demo: f.demo })
        : await api.post('/api/auth/login', { email: f.email, password: f.password });
      await login(r.token);
      if (status?.needsSetup) toast.success(f.demo ? 'Salon created with demo data' : 'Salon created — welcome!');
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)' }} className="login-grid">
      <style>{`@media (max-width: 860px){ .login-grid{ grid-template-columns: 1fr !important } .login-art{ display:none !important } }`}</style>
      <div className="login-art" style={{ background: 'linear-gradient(150deg,#3a1730 0%,#6d2a52 55%,#b9785a 130%)', color: '#fff', padding: '56px 60px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div className="row"><div className="brand-mark" style={{ background: 'rgba(255,255,255,.15)' }}>S</div><div className="display" style={{ fontSize: 20 }}>Salon Studio</div></div>
        <div>
          <h1 style={{ color: '#fff', fontSize: 42, lineHeight: 1.15, maxWidth: 520 }}>Run your whole salon from one elegant dashboard.</h1>
          <p style={{ marginTop: 14, opacity: .8, maxWidth: 460, fontSize: 15 }}>Appointments, QR booking, billing, staff, payroll, inventory and analytics — connected in real time.</p>
          <div className="col" style={{ marginTop: 32, gap: 14 }}>
            {[[CalendarCheck, 'Double-booking-proof calendar'], [QrCode, 'QR code online booking, no app needed'], [BarChart3, 'Live revenue, profit and staff performance'], [Sparkles, 'AI assistant that reads your real numbers']].map(([I, t]) => (
              <div key={t} className="row" style={{ gap: 12 }}><span style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.12)', display: 'grid', placeItems: 'center' }}><I size={17} /></span>{t}</div>
            ))}
          </div>
        </div>
        <div style={{ opacity: .6, fontSize: 12 }}>© {new Date().getFullYear()} Salon Studio ERP</div>
      </div>
      <div style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
        <form onSubmit={submit} className="card" style={{ width: '100%', maxWidth: 420, padding: 30 }}>
          {!status ? <div className="center"><span className="spinner" /></div> : <>
            <h1 style={{ fontSize: 26 }}>{status.needsSetup ? 'Set up your salon' : 'Welcome back'}</h1>
            <p className="muted" style={{ marginTop: 4, marginBottom: 22 }}>{status.needsSetup ? 'Create the owner account to get started.' : `Sign in to ${status.salon}`}</p>
            <div className="col" style={{ gap: 14 }}>
              {status.needsSetup && <>
                <Input label="Salon name" value={f.salonName} onChange={set('salonName')} required minLength={2} />
                <Input label="Your name" value={f.ownerName} onChange={set('ownerName')} required minLength={2} />
                <Input label="Phone" value={f.phone} onChange={set('phone')} inputMode="tel" />
              </>}
              <Input label="Email" type="email" value={f.email} onChange={set('email')} required autoComplete="email" />
              <Input label="Password" type="password" value={f.password} onChange={set('password')} required minLength={status.needsSetup ? 8 : 1} autoComplete={status.needsSetup ? 'new-password' : 'current-password'} hint={status.needsSetup ? 'At least 8 characters' : undefined} />
              {status.needsSetup && <label className="check"><input type="checkbox" checked={f.demo} onChange={set('demo')} /> Load realistic demo data (you can start fresh later)</label>}
              {!status.needsSetup && status.autoLogin && <p className="faint small">Testing tip: demo owner is <b>owner@demo.salon</b> / <b>Owner@1234</b>. Staff logins (manager@, reception@, accounts@, stylist@demo.salon) use <b>Demo@1234</b>.</p>}
              {err && <div className="badge red plain" style={{ padding: '8px 12px', borderRadius: 10, whiteSpace: 'normal', textTransform: 'none' }}>{err}</div>}
              <Button variant="primary" size="lg" type="submit" loading={busy} className="block">{status.needsSetup ? 'Create salon' : 'Sign in'}</Button>
            </div>
          </>}
        </form>
      </div>
    </div>
  );
}
