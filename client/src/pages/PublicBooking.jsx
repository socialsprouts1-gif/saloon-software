import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Check, ChevronLeft, MapPin, Phone, Clock, Gift, Sparkles, User, MessageCircle, CalendarCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { money, today, addDays, parseDate, fmtTime, fmtDate } from '../lib/format.js';
import { Button, Input, Textarea, Avatar, Spinner } from '../components/ui.jsx';

export default function PublicBooking() {
  const { token } = useParams();
  const [sp] = useSearchParams();
  const via = sp.get('src') === 'qr' ? 'qr' : 'online';
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState('book'); // book | package
  const [sel, setSel] = useState({ branch_id: null, service_ids: [], employee_id: null, date: today(), time: '', name: '', phone: '', email: '', notes: '' });
  const [slots, setSlots] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [formErr, setFormErr] = useState('');

  useEffect(() => {
    api.get(`/api/public/book/${token}`).then((d) => {
      setInfo(d); setSel((s) => ({ ...s, branch_id: d.branches[0]?.id }));
      document.title = `Book at ${d.salon.name}`;
      const key = `tracked-${token}-${via}-${today()}`;
      try { if (!sessionStorage.getItem(key)) { api.post(`/api/public/book/${token}/track`, { type: via === 'qr' ? 'scan' : 'visit' }); if (via === 'qr') api.post(`/api/public/book/${token}/track`, { type: 'visit' }); sessionStorage.setItem(key, '1'); } }
      catch { api.post(`/api/public/book/${token}/track`, { type: 'visit' }); }
    }).catch((e) => setErr(e.message));
  }, [token, via]);

  const theme = info?.booking.theme_color || '#6d2a52';
  const sym = info?.salon.currency_symbol || '₹';
  const services = info?.services || [];
  const chosen = services.filter((s) => sel.service_ids.includes(s.id));
  const total = chosen.reduce((a, s) => a + s.price, 0), dur = chosen.reduce((a, s) => a + s.duration_min, 0);
  const stylists = (info?.employees || []).filter((e) => e.branch_id === sel.branch_id && sel.service_ids.every((id) => e.services.includes(id)));
  const dates = useMemo(() => Array.from({ length: Math.min(info?.booking.max_advance_days || 30, 30) + 1 }, (_, i) => addDays(today(), i)), [info]);

  useEffect(() => {
    if (step !== 2 || !sel.service_ids.length) return;
    setSlots(null);
    api.get(`/api/public/book/${token}/slots`, { branch_id: sel.branch_id, date: sel.date, service_ids: sel.service_ids.join(','), employee_id: sel.employee_id || undefined })
      .then(setSlots).catch((e) => setSlots({ slots: [], closed: e.message }));
  }, [step, sel.date, sel.employee_id, sel.branch_id, sel.service_ids.join()]); // eslint-disable-line

  const book = async () => {
    setFormErr('');
    if (sel.name.trim().length < 2) return setFormErr('Please enter your name');
    if (!/^\+?\d[\d\s-]{8,14}$/.test(sel.phone.trim())) return setFormErr('Please enter a valid mobile number');
    setBusy(true);
    try {
      if (mode === 'package') setDone({ pkg: await api.post(`/api/public/book/${token}/packages`, { package_id: sel.package_id, branch_id: sel.branch_id, name: sel.name, phone: sel.phone }) });
      else setDone(await api.post(`/api/public/book/${token}/appointments`, { ...sel, via, email: sel.email || undefined }));
    } catch (e) {
      setFormErr(e.message);
      if (e.status === 409) { setStep(2); setSel((s) => ({ ...s, time: '' })); }
    } finally { setBusy(false); }
  };

  if (err) return <div className="pub" style={{ display: 'grid', placeItems: 'center', padding: 24 }}><div className="card card-pad center" style={{ maxWidth: 420 }}><h2>Booking unavailable</h2><p className="muted mt-sm">{err}</p></div></div>;
  if (!info) return <div className="pub" style={{ display: 'grid', placeItems: 'center' }}><Spinner size={28} /></div>;

  const Hero = (
    <div className="pub-hero" style={{ background: `linear-gradient(150deg, ${theme} 0%, color-mix(in srgb, ${theme} 70%, #000) 100%)` }}>
      <div className="logo">{info.salon.logo ? <img src={info.salon.logo} alt="" /> : info.salon.name[0]}</div>
      <h1>{info.salon.name}</h1>
      {info.salon.tagline && <p style={{ opacity: .85, marginTop: 4 }}>{info.salon.tagline}</p>}
      <p style={{ opacity: .8, marginTop: 10, fontSize: 13.5 }}>{info.booking.welcome}</p>
    </div>
  );

  if (done) {
    return (
      <div className="pub" style={{ '--primary': theme }}>{Hero}
        <div className="pub-wrap"><div className="card card-pad center col" style={{ alignItems: 'center', gap: 12, padding: 30 }}>
          <div style={{ width: 64, height: 64, borderRadius: 99, background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center' }}><Check size={32} /></div>
          {done.pkg ? <>
            <h2 className="display" style={{ fontSize: 24 }}>Package request received!</h2>
            <p className="muted">Reference {done.pkg.invoice_no}. Pay {money(done.pkg.total)} at the salon to activate your package.</p>
            <a className="btn" href={done.pkg.invoice_url} target="_blank" rel="noreferrer">View invoice</a>
          </> : <>
            <h2 className="display" style={{ fontSize: 24 }}>{done.status === 'confirmed' ? 'You’re booked!' : 'Booking request received!'}</h2>
            <p className="muted">{done.status === 'confirmed' ? 'Your appointment is confirmed.' : 'The salon will confirm your appointment shortly.'}{done.confirmation_sent ? ' A confirmation has been sent on WhatsApp.' : ''}</p>
            <div className="card card-pad" style={{ width: '100%', textAlign: 'left', background: 'var(--bg-elev)' }}>
              <div className="mini-stat"><span className="muted">Booking ref</span><b>#{done.id}</b></div>
              <div className="mini-stat"><span className="muted">When</span><b>{fmtDate(done.start_at.slice(0, 10), { weekday: 'short', day: 'numeric', month: 'short' })}, {fmtTime(done.start_at.slice(11))}</b></div>
              <div className="mini-stat"><span className="muted">Stylist</span><b>{done.employee || 'Assigned on arrival'}</b></div>
              <div className="mini-stat"><span className="muted">Services</span><b className="right">{done.services.map((s) => s.name).join(', ')}</b></div>
              <div className="mini-stat"><span className="muted">Where</span><b>{done.branch}</b></div>
              {info.booking.show_prices && <div className="mini-stat"><span className="muted">Estimated total</span><b>{money(done.total)}</b></div>}
            </div>
            {done.salon_whatsapp && <a className="btn success" href={done.salon_whatsapp} target="_blank" rel="noreferrer"><MessageCircle size={16} />Message the salon on WhatsApp</a>}
          </>}
          <Button variant="ghost" onClick={() => { setDone(null); setStep(0); setMode('book'); setSel((s) => ({ ...s, service_ids: [], time: '', employee_id: null })); }}>Make another booking</Button>
        </div></div>
      </div>
    );
  }

  const groups = services.reduce((g, s) => { (g[s.category || 'Services'] ||= []).push(s); return g; }, {});
  const STEPS = mode === 'package' ? 2 : 4;
  return (
    <div className="pub" style={{ '--primary': theme, '--primary-soft': `color-mix(in srgb, ${theme} 12%, transparent)` }}>
      {Hero}
      <div className="pub-wrap">
        <div className="card card-pad" style={{ padding: 22 }}>
          <div className="steps">{Array.from({ length: STEPS }).map((_, i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
          {step > 0 && <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={() => { setFormErr(''); setStep(mode === 'package' ? 0 : step - 1); if (mode === 'package') setMode('book'); }}>Back</Button>}

          {step === 0 && <>
            <h2 className="display" style={{ fontSize: 21, marginBottom: 4 }}>Choose your services</h2>
            <p className="muted small mb" style={{ marginBottom: 14 }}>Select one or more</p>
            {info.branches.length > 1 && <div className="chips mb" style={{ marginBottom: 14 }}>{info.branches.map((b) => <button key={b.id} className={`chip ${sel.branch_id === b.id ? 'on' : ''}`} onClick={() => setSel({ ...sel, branch_id: b.id, employee_id: null })}><MapPin size={13} />{b.name}</button>)}</div>}
            {Object.entries(groups).map(([cat, list]) => (
              <div key={cat} style={{ marginBottom: 16 }}>
                <div className="faint tiny" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>{cat}</div>
                <div className="col" style={{ gap: 8 }}>{list.map((s) => {
                  const on = sel.service_ids.includes(s.id);
                  return (
                    <div key={s.id} className={`svc-option ${on ? 'on' : ''}`} role="checkbox" aria-checked={on} tabIndex={0} onKeyDown={(e) => e.key === ' ' && e.currentTarget.click()} onClick={() => setSel({ ...sel, service_ids: on ? sel.service_ids.filter((x) => x !== s.id) : [...sel.service_ids, s.id], employee_id: null, time: '' })}>
                      {s.image ? <img src={s.image} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }} /> : <span className="avatar" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', borderRadius: 10 }}><Sparkles size={16} /></span>}
                      <div className="grow"><b>{s.name}</b><div className="faint small">{s.duration_min} min{s.description ? ` · ${s.description}` : ''}</div></div>
                      {info.booking.show_prices && <b className="num">{sym}{s.price.toLocaleString('en-IN')}</b>}
                      <span style={{ width: 22, height: 22, borderRadius: 7, border: '1.5px solid var(--border-strong)', display: 'grid', placeItems: 'center', background: on ? 'var(--primary)' : 'transparent', color: '#fff', flexShrink: 0 }}>{on && <Check size={14} />}</span>
                    </div>
                  );
                })}</div>
              </div>
            ))}
            {!services.length && <p className="muted">No services are available for online booking right now.</p>}
            {info.packages.length > 0 && <>
              <div className="faint tiny" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', margin: '22px 0 8px' }}>Packages & memberships</div>
              <div className="grid g2" style={{ gap: 10 }}>{info.packages.map((p) => (
                <button key={p.id} className="svc-option" style={{ flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', font: 'inherit', color: 'inherit' }} onClick={() => { setMode('package'); setSel({ ...sel, package_id: p.id }); setStep(1); }}>
                  <div className="row" style={{ width: '100%' }}><Gift size={16} style={{ color: 'var(--primary)' }} /><b className="grow">{p.name}</b><b>{sym}{p.price.toLocaleString('en-IN')}</b></div>
                  <div className="faint small">{p.description || p.items.map((i) => `${i.credits}× ${i.name}`).join(', ')} · valid {p.validity_days} days</div>
                </button>
              ))}</div>
            </>}
          </>}

          {step === 1 && mode === 'book' && <>
            <h2 className="display" style={{ fontSize: 21, marginBottom: 14 }}>Choose your stylist</h2>
            <div className="col" style={{ gap: 8 }}>
              {info.booking.allow_any_stylist && <div className={`svc-option ${sel.employee_id === null ? 'on' : ''}`} onClick={() => setSel({ ...sel, employee_id: null, time: '' })}><span className="avatar" style={{ background: 'var(--primary)' }}><User size={16} /></span><div className="grow"><b>Any available stylist</b><div className="faint small">Most available times</div></div></div>}
              {stylists.map((e) => <div key={e.id} className={`svc-option ${sel.employee_id === e.id ? 'on' : ''}`} onClick={() => setSel({ ...sel, employee_id: e.id, time: '' })}><Avatar name={e.name} src={e.photo} /><div className="grow"><b>{e.name}</b><div className="faint small">{e.designation}{e.rating ? ` · ★ ${e.rating}` : ''}</div></div></div>)}
              {!stylists.length && !info.booking.allow_any_stylist && <p className="muted">No stylist offers all the selected services at this branch. Go back and change your selection.</p>}
            </div>
          </>}

          {step === 2 && <>
            <h2 className="display" style={{ fontSize: 21, marginBottom: 14 }}>Pick a date & time</h2>
            <div className="date-strip">{dates.map((d) => { const dt = parseDate(d); return <button key={d} className={`date-pill ${sel.date === d ? 'on' : ''}`} onClick={() => setSel({ ...sel, date: d, time: '' })}><span className="w">{d === today() ? 'Today' : dt.toLocaleDateString('en-IN', { weekday: 'short' })}</span><span className="d">{dt.getDate()}</span><span className="w">{dt.toLocaleDateString('en-IN', { month: 'short' })}</span></button>; })}</div>
            <div className="mt">{!slots ? <div className="row"><Spinner /> <span className="muted small">Finding free times…</span></div>
              : slots.closed ? <p className="muted">{slots.closed}</p>
                : !slots.slots.length ? <p className="muted">No free times on this day — please try another date{sel.employee_id ? ' or choose “Any available stylist”' : ''}.</p>
                  : <div className="slot-grid">{slots.slots.map((s) => <button key={s.time} className={`slot ${sel.time === s.time ? 'on' : ''}`} onClick={() => setSel({ ...sel, time: s.time })}>{fmtTime(s.time)}</button>)}</div>}</div>
          </>}

          {((step === 3 && mode === 'book') || (step === 1 && mode === 'package')) && <>
            <h2 className="display" style={{ fontSize: 21, marginBottom: 14 }}>Your details</h2>
            <div className="col" style={{ gap: 12 }}>
              <Input label="Full name" value={sel.name} onChange={(e) => setSel({ ...sel, name: e.target.value })} autoComplete="name" maxLength={80} />
              <Input label="Mobile number" value={sel.phone} onChange={(e) => setSel({ ...sel, phone: e.target.value })} inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" />
              {mode === 'book' && <><Input label="Email (optional)" type="email" value={sel.email} onChange={(e) => setSel({ ...sel, email: e.target.value })} autoComplete="email" />
                <Textarea label="Notes for the salon (optional)" rows={2} value={sel.notes} onChange={(e) => setSel({ ...sel, notes: e.target.value })} maxLength={500} /></>}
            </div>
            <div className="card card-pad mt" style={{ background: 'var(--bg-elev)' }}>
              {mode === 'package' ? (() => { const p = info.packages.find((x) => x.id === sel.package_id); return <><div className="mini-stat"><span className="muted">Package</span><b>{p?.name}</b></div><div className="mini-stat"><span className="muted">Price</span><b>{sym}{p?.price.toLocaleString('en-IN')}</b></div><p className="faint small mt-sm">Pay at the salon to activate.</p></>; })() : <>
                <div className="mini-stat"><span className="muted">Services</span><b className="right">{chosen.map((s) => s.name).join(', ')}</b></div>
                <div className="mini-stat"><span className="muted">When</span><b>{fmtDate(sel.date, { weekday: 'short', day: 'numeric', month: 'short' })}, {fmtTime(sel.time)}</b></div>
                <div className="mini-stat"><span className="muted">Stylist</span><b>{stylists.find((e) => e.id === sel.employee_id)?.name || 'Any available'}</b></div>
                {info.booking.show_prices && <div className="mini-stat"><span className="muted">Estimated total</span><b>{sym}{total.toLocaleString('en-IN')}</b></div>}
              </>}
            </div>
          </>}

          {formErr && <div className="badge red plain mt" style={{ padding: '8px 12px', borderRadius: 10, whiteSpace: 'normal', textTransform: 'none', display: 'block' }}>{formErr}</div>}
          <div className="mt">
            {mode === 'book' && step < 3 ? (
              <Button variant="primary" size="lg" className="block" disabled={(step === 0 && !sel.service_ids.length) || (step === 1 && !info.booking.allow_any_stylist && !sel.employee_id) || (step === 2 && !sel.time)} onClick={() => { setFormErr(''); setStep(step + 1); }}>
                {step === 0 ? (sel.service_ids.length ? `Continue · ${dur} min${info.booking.show_prices ? ` · ${sym}${total.toLocaleString('en-IN')}` : ''}` : 'Select a service') : 'Continue'}
              </Button>
            ) : step > 0 && <Button variant="primary" size="lg" className="block" icon={CalendarCheck} loading={busy} onClick={book}>{mode === 'package' ? 'Request package' : 'Confirm booking'}</Button>}
          </div>
        </div>
        <div className="center faint small mt col" style={{ gap: 4, alignItems: 'center' }}>
          {info.salon.address && <span className="row" style={{ gap: 6 }}><MapPin size={13} />{info.salon.address}</span>}
          {info.salon.phone && <a href={`tel:${info.salon.phone}`} className="row" style={{ gap: 6 }}><Phone size={13} />{info.salon.phone}</a>}
          <span className="row" style={{ gap: 6 }}><Clock size={13} />No account needed · Free cancellation by calling the salon</span>
        </div>
      </div>
    </div>
  );
}
