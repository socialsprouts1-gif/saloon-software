import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Sparkles, CalendarCheck, QrCode, BarChart3 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context.jsx';
import { Button, Input } from '../components/ui.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [status, setStatus] = useState(null);
  const [f, setF] = useState({ email: '', password: '' });
  const [choose, setChoose] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/api/auth/setup-status').then(setStatus).catch(() => setStatus({ hasSalons: true })); }, []);
  const next = sp.get('next');
  if (user) return <Navigate to={next && next.startsWith('/') ? next : '/'} replace />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e, salon) => {
    e?.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api.post('/api/auth/login', { email: f.email, password: f.password, salon });
      if (r.choose) { setChoose(r.choose); return; }
      await login(r.token);
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  if (status && !status.hasSalons) return <Navigate to="/signup" replace />;

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
          {!status ? <div className="center"><span className="spinner" /></div> : choose ? <>
            <h1 style={{ fontSize: 26 }}>Choose a salon</h1>
            <p className="muted" style={{ marginTop: 4, marginBottom: 18 }}>Your login works at more than one salon.</p>
            <div className="col">{choose.map((c) => <Button key={c.slug} size="lg" className="block" onClick={() => submit(null, c.slug)} loading={busy}>{c.name}</Button>)}</div>
            <Button variant="ghost" className="block mt" onClick={() => setChoose(null)}>Back</Button>
          </> : <>
            <h1 style={{ fontSize: 26 }}>Welcome back</h1>
            <p className="muted" style={{ marginTop: 4, marginBottom: 22 }}>Sign in to your salon's admin panel</p>
            <div className="col" style={{ gap: 14 }}>
              <Input label="Email" type="email" value={f.email} onChange={set('email')} required autoComplete="email" />
              <Input label="Password" type="password" value={f.password} onChange={set('password')} required autoComplete="current-password" />
              {status.demo && <p className="faint small">Demo: salon owner <b>owner@demo.salon</b> / <b>Owner@1234</b> · staff (manager@, reception@, accounts@, stylist@demo.salon) use <b>Demo@1234</b>.</p>}
              {err && <div className="badge red plain" style={{ padding: '8px 12px', borderRadius: 10, whiteSpace: 'normal', textTransform: 'none' }}>{err}</div>}
              <Button variant="primary" size="lg" type="submit" loading={busy} className="block">Sign in</Button>
              {status.signup && <p className="center small muted">New salon? <Link to="/signup">Create your salon's panel</Link></p>}
              <p className="center tiny faint"><Link to="/platform" className="faint">Platform owner login</Link></p>
            </div>
          </>}
        </form>
      </div>
    </div>
  );
}
