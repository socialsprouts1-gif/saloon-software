import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Gift, Phone, MapPin, ShieldCheck } from 'lucide-react';
import { api, getToken } from '../lib/api.js';
import { fmtDate } from '../lib/format.js';
import { Spinner } from '../components/ui.jsx';
import { StampCard, cardUrl } from '../components/Loyalty.jsx';

/** What a customer (or staff member) sees after scanning a loyalty card's QR. */
export default function PublicCard() {
  const { slug, code } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.get(slug ? `/api/public/s/${slug}/card/${code}` : `/api/public/card/${code}`).then((r) => { setD(r); document.title = `${r.card.program} · ${r.salon.name}`; }).catch((e) => setErr(e.message));
  }, [slug, code]);
  if (err) return <div className="pub" style={{ display: 'grid', placeItems: 'center', padding: 24 }}><div className="card card-pad center" style={{ maxWidth: 420 }}><h2>Card not found</h2><p className="muted mt-sm">{err}</p></div></div>;
  if (!d) return <div className="pub" style={{ display: 'grid', placeItems: 'center' }}><Spinner size={28} /></div>;
  const c = d.card;
  const visits = d.card.history.filter((h) => h.type === 'stamp').slice(0, 8);
  return (
    <div className="pub" style={{ padding: '28px 16px 40px' }}>
      <div style={{ maxWidth: 460, margin: '0 auto' }} className="col">
        <div className="center" style={{ marginBottom: 6 }}>
          {d.salon.logo && <img src={d.salon.logo} alt="" style={{ width: 54, height: 54, borderRadius: 14, objectFit: 'cover', marginBottom: 8 }} />}
          <h1 style={{ fontSize: 24 }}>{d.salon.name}</h1>
          <p className="muted small">Hi {c.customer}! Show this card at every visit.</p>
        </div>
        <StampCard salonName={d.salon.name} qrValue={cardUrl(d.slug, c.code)} card={{ ...c, program_name: c.program, customer_name: c.customer }} />
        <div className="card card-pad col" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="kpi" style={{ padding: 0 }}><span className="ico"><Gift size={16} /></span></span>
            <div><b>{c.reward_ready ? 'Your reward is ready!' : `${c.stamps_required - c.stamps} more visit${c.stamps_required - c.stamps === 1 ? '' : 's'} to go`}</b><div className="muted small">{c.reward}</div></div>
          </div>
          {c.rewards_redeemed > 0 && <div className="faint small">You've enjoyed {c.rewards_redeemed} reward{c.rewards_redeemed === 1 ? '' : 's'} with us 💜</div>}
          {visits.length > 0 && <div className="faint small">Stamped visits: {visits.map((v) => fmtDate(v.at.slice(0, 10), { day: 'numeric', month: 'short' })).join(' · ')}</div>}
          {c.terms && <div className="faint tiny">{c.terms}</div>}
        </div>
        <div className="center faint small col" style={{ gap: 4, alignItems: 'center' }}>
          {d.salon.phone && <a href={`tel:${d.salon.phone}`} className="row" style={{ gap: 6 }}><Phone size={13} />{d.salon.phone}</a>}
          {d.salon.address && <span className="row" style={{ gap: 6 }}><MapPin size={13} />{d.salon.address}</span>}
        </div>
        {getToken() && <Link to={`/loyalty?card=${c.code}`} className="btn primary lg" style={{ marginTop: 6 }}><ShieldCheck size={16} />Staff: open card to add a stamp</Link>}
        {!getToken() && <Link to={`/login?next=${encodeURIComponent(`/loyalty?card=${c.code}`)}`} className="faint tiny center">Salon staff? Sign in to stamp this card</Link>}
      </div>
    </div>
  );
}
