import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Store, CalendarCheck, CreditCard, QrCode } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth, useToast } from '../context.jsx';
import { Button, Input } from '../components/ui.jsx';

/** Self-service sign-up: a new salon gets its own private admin panel. */
export default function Signup() {
  const { user, login } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [f, setF] = useState({ salonName: '', ownerName: '', email: '', password: '', phone: '', city: '', demo: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (user) return <Navigate to="/" replace />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api.post('/api/auth/signup', f);
      await login(r.token);
      toast.success(`Welcome! ${r.salon.name} is ready.`);
      nav('/');
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: 'linear-gradient(160deg, var(--bg) 0%, var(--primary-soft) 100%)' }}>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,440px)', gap: 36, maxWidth: 980, width: '100%', alignItems: 'center' }}>
        <div className="hide-sm">
          <div className="row" style={{ marginBottom: 22 }}><div className="brand-mark">S</div><div className="display" style={{ fontSize: 20 }}>Salon Studio</div></div>
          <h1 style={{ fontSize: 38, lineHeight: 1.15 }}>Your salon's own admin panel, ready in a minute.</h1>
          <div className="col" style={{ gap: 14, marginTop: 26 }}>
            {[[Store, 'Private panel for your team — your data stays yours'], [CalendarCheck, 'Appointments, QR booking, billing and invoices'], [CreditCard, 'Loyalty stamp cards: scan the QR, tick the visit'], [QrCode, 'Inventory, staff, payroll and reports built in']].map(([I, t]) => (
              <div key={t} className="row" style={{ gap: 12 }}><span className="kpi" style={{ padding: 0 }}><span className="ico"><I size={16} /></span></span>{t}</div>
            ))}
          </div>
        </div>
        <form onSubmit={submit} className="card" style={{ padding: 28 }}>
          <h1 style={{ fontSize: 25 }}>Create your salon</h1>
          <p className="muted" style={{ margin: '4px 0 20px' }}>Free to start. You'll be the owner and can add your team later.</p>
          <div className="col" style={{ gap: 13 }}>
            <Input label="Salon name" value={f.salonName} onChange={set('salonName')} required minLength={2} placeholder="e.g. Glow Studio" />
            <div className="form-grid"><Input label="Your name" value={f.ownerName} onChange={set('ownerName')} required minLength={2} /><Input label="City" value={f.city} onChange={set('city')} /></div>
            <Input label="Phone" value={f.phone} onChange={set('phone')} inputMode="tel" />
            <Input label="Email (your login)" type="email" value={f.email} onChange={set('email')} required autoComplete="email" />
            <Input label="Password" type="password" value={f.password} onChange={set('password')} required minLength={8} autoComplete="new-password" hint="At least 8 characters" />
            <label className="check small"><input type="checkbox" checked={f.demo} onChange={set('demo')} />Fill my panel with sample data to explore</label>
            {err && <div className="badge red plain" style={{ padding: '8px 12px', borderRadius: 10, whiteSpace: 'normal', textTransform: 'none' }}>{err}</div>}
            <Button variant="primary" size="lg" type="submit" loading={busy} className="block">Create my salon</Button>
            <p className="center small muted">Already have an account? <Link to="/login">Sign in</Link></p>
          </div>
        </form>
      </div>
      <style>{`@media (max-width: 860px){ .grid[style*="440px"]{ grid-template-columns: 1fr !important } }`}</style>
    </div>
  );
}
