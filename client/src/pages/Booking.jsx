import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { Copy, Download, Printer, RefreshCw, ExternalLink, QrCode, Eye, CalendarCheck, Percent, ScanLine, Power } from 'lucide-react';
import { useApi, useAuth, useToast } from '../context.jsx';
import { api } from '../lib/api.js';
import { fmtDT, titleCase, money, today, addDays } from '../lib/format.js';
import { downloadBlob } from '../lib/export.js';
import { PageHead, Card, Button, Kpi, Switch, Input, Textarea, Badge, Loader, ErrorState, Empty, Pager, Seg, useConfirm } from '../components/ui.jsx';
import { TrendChart, CHART } from '../components/charts.jsx';

const loadImg = (src) => new Promise((res) => { if (!src) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const toDataURL = async (src) => { try { const b = await (await fetch(src)).blob(); return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); } catch { return null; } };

/** Draw a QR with an optional centred logo badge. Uses high error correction so the logo doesn't break scanning. */
async function drawQR(canvas, url, { logo, color, initial, withLogo }) {
  await QRCode.toCanvas(canvas, url, { errorCorrectionLevel: 'H', width: 640, margin: 2, color: { dark: color || '#2b1424', light: '#ffffff' } });
  canvas.style.width = '100%'; canvas.style.height = 'auto'; // the library pins a pixel size
  if (!withLogo) return;
  const ctx = canvas.getContext('2d'), s = canvas.width, box = s * 0.22, x = (s - box) / 2;
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(x - 8, x - 8, box + 16, box + 16, 18); ctx.fill();
  const img = await loadImg(logo);
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, x, box, box, 14); ctx.clip();
  if (img) ctx.drawImage(img, x, x, box, box);
  else { ctx.fillStyle = color || '#6d2a52'; ctx.fillRect(x, x, box, box); ctx.fillStyle = '#fff'; ctx.font = `600 ${box * 0.55}px Fraunces, Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(initial, s / 2, s / 2 + 4); }
  ctx.restore();
}

export default function Booking() {
  const { data, loading, error, reload, setData } = useApi('/api/settings');
  const { salon, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canvas = useRef(null);
  const [period, setPeriod] = useState('last30');
  const from = { last7: addDays(today(), -6), last30: addDays(today(), -29), last90: addDays(today(), -89), all: undefined }[period];
  const stats = useApi('/api/booking/stats', { from, to: from ? today() : undefined });
  const b = data?.settings.booking;
  const bookingUrl = b?.token ? `${window.location.origin}/book/${b.token}` : '';
  const qrUrl = bookingUrl ? `${bookingUrl}?src=qr` : '';

  useEffect(() => {
    if (canvas.current && qrUrl) drawQR(canvas.current, qrUrl, { logo: salon?.logo, color: '#2b1424', initial: (salon?.name || 'S')[0], withLogo: b.logo_in_qr }).catch(() => {});
  }, [qrUrl, b?.logo_in_qr, salon?.logo]); // eslint-disable-line

  const save = async (patch) => {
    try { const r = await api.put('/api/settings/booking', patch); setData((d) => ({ ...d, settings: { ...d.settings, booking: r.value } })); toast.success('Saved'); } catch (e) { toast.error(e); }
  };
  const saveAppt = async (patch) => {
    try { const r = await api.put('/api/settings/appointments', patch); setData((d) => ({ ...d, settings: { ...d.settings, appointments: r.value } })); toast.success('Saved'); } catch (e) { toast.error(e); }
  };
  const regenerate = async () => {
    if (!(await confirm({ title: 'Generate a new booking link?', text: 'The current link and every printed QR code will stop working immediately. You will need to reprint the QR code.', confirmText: 'Regenerate', danger: true }))) return;
    try { await api.post('/api/settings/booking/regenerate'); reload(); toast.success('New booking link generated'); } catch (e) { toast.error(e); }
  };
  const downloadPNG = () => canvas.current.toBlob((blob) => downloadBlob(blob, 'booking-qr.png'));
  const downloadSVG = async () => {
    let svg = await QRCode.toString(qrUrl, { type: 'svg', errorCorrectionLevel: 'H', margin: 2, color: { dark: '#2b1424', light: '#ffffff' } });
    if (b.logo_in_qr) {
      const vb = Number(svg.match(/viewBox="0 0 (\d+)/)?.[1] || 33), box = vb * 0.22, x = (vb - box) / 2;
      const logo = salon?.logo ? await toDataURL(salon.logo) : null;
      const inner = logo ? `<image href="${logo}" x="${x}" y="${x}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>`
        : `<rect x="${x}" y="${x}" width="${box}" height="${box}" rx="${box * .18}" fill="#6d2a52"/><text x="${vb / 2}" y="${vb / 2}" font-family="Georgia,serif" font-size="${box * .55}" fill="#fff" text-anchor="middle" dominant-baseline="central">${(salon?.name || 'S')[0]}</text>`;
      svg = svg.replace('</svg>', `<defs><clipPath id="c"><rect x="${x}" y="${x}" width="${box}" height="${box}" rx="${box * .18}"/></clipPath></defs><rect x="${x - .6}" y="${x - .6}" width="${box + 1.2}" height="${box + 1.2}" rx="${box * .22}" fill="#fff"/>${inner}</svg>`);
    }
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'booking-qr.svg');
  };
  const print = () => {
    const img = canvas.current.toDataURL('image/png');
    const w = window.open('', '_blank', 'width=700,height=900');
    if (!w) return toast.error('Allow pop-ups to print');
    const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    w.document.write(`<!doctype html><html><head><title>Scan to book</title><style>body{font-family:Georgia,serif;text-align:center;padding:40px;color:#2b1424}h1{font-size:34px;margin:0 0 6px}p{font-family:system-ui,sans-serif;color:#555}img{width:360px;margin:26px auto;display:block}.u{font-family:monospace;font-size:12px;color:#888}</style></head><body><h1>${esc(salon?.name)}</h1><p>Scan to book your appointment — no app or sign-up needed</p><img src="${img}" alt="QR code"/><p style="font-size:20px;color:#2b1424">📱 Open your camera · Scan · Book</p><p class="u">${esc(bookingUrl)}</p><script>window.onload=()=>{window.print()}<\/script></body></html>`);
    w.document.close();
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <Loader rows={6} />;
  const s = stats.data;
  return (
    <div>
      <PageHead title="QR Online Booking" sub="Customers scan, pick a service and stylist, and book — straight into your calendar">
        <Button icon={ExternalLink} onClick={() => window.open(bookingUrl, '_blank')} disabled={!b.active}>Open booking page</Button>
      </PageHead>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,380px) minmax(0,1fr)', gap: 18 }}>
        <Card title="Your booking QR code" actions={<Badge status={b.active ? 'active' : 'inactive'}>{b.active ? 'Live' : 'Paused'}</Badge>}>
          <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)', background: '#fff', opacity: b.active ? 1 : .35 }}>
            <canvas ref={canvas} style={{ width: '100%', display: 'block' }} aria-label="Booking QR code" />
          </div>
          <div className="row mt" style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '8px 10px' }}>
            <code className="grow truncate small">{bookingUrl}</code>
            <Button size="sm" icon={Copy} onClick={() => navigator.clipboard.writeText(bookingUrl).then(() => toast.success('Link copied'), () => toast.error('Copy failed'))}>Copy</Button>
          </div>
          <div className="grid g3 mt" style={{ gap: 8 }}>
            <Button icon={Download} onClick={downloadPNG}>PNG</Button><Button icon={Download} onClick={downloadSVG}>SVG</Button><Button icon={Printer} onClick={print}>Print</Button>
          </div>
          <div className="col mt" style={{ gap: 14 }}>
            <Switch label="Show salon logo in QR" checked={b.logo_in_qr} onChange={(v) => save({ logo_in_qr: v })} hint={salon?.logo ? 'Uses your logo from Settings' : 'Upload a logo in Settings, or the salon initial is used'} />
            <Switch label="Accept online bookings" checked={b.active} onChange={(v) => save({ active: v })} hint="Pause to deactivate the link temporarily" />
          </div>
          <div className="row mt"><Button variant="danger" icon={RefreshCw} onClick={regenerate}>Regenerate link</Button></div>
        </Card>
        <div className="col" style={{ gap: 18 }}>
          <Card title="Booking performance" actions={<Seg value={period} onChange={setPeriod} options={[['last7', '7d'], ['last30', '30d'], ['last90', '90d'], ['all', 'All']]} />}>
            {!s ? <Loader rows={3} /> : <>
              <div className="grid g4 kpis" style={{ gap: 10 }}>
                <Kpi icon={ScanLine} label="QR scans" value={s.scans} />
                <Kpi icon={Eye} tone="info" label="Link visits" value={s.visits} />
                <Kpi icon={CalendarCheck} tone="success" label="Bookings" value={s.bookings} meta={`${s.confirmed} confirmed · ${s.pending} pending`} />
                <Kpi icon={Percent} tone="accent" label="Conversion" value={`${s.conversion_rate}%`} meta="Bookings ÷ visits" />
              </div>
              <div className="mt"><TrendChart height={200} type="bar" gran="day" fmt={(v) => v} yFmt={(v) => v} data={s.daily.map((d) => ({ period: d.d, scans: d.scans, visits: d.visits, bookings: d.bookings }))} series={[{ key: 'visits', name: 'Visits', color: CHART[2] }, { key: 'scans', name: 'Scans', color: CHART[1] }, { key: 'bookings', name: 'Bookings', color: CHART[0] }]} /></div>
            </>}
          </Card>
          <Card title="Booking page customisation">
            <div className="form-grid">
              <Field2 label="Theme colour"><input type="color" className="input" style={{ padding: 4, width: 80 }} value={b.theme_color} onChange={(e) => save({ theme_color: e.target.value })} /></Field2>
              <div className="col" style={{ gap: 12, justifyContent: 'center' }}>
                <Switch label="Show prices" checked={b.show_prices} onChange={(v) => save({ show_prices: v })} />
                <Switch label="Sell packages online" checked={b.allow_packages} onChange={(v) => save({ allow_packages: v })} />
              </div>
              <div className="full"><WelcomeEditor value={b.welcome} onSave={(welcome) => save({ welcome })} /></div>
              {can('settings') && <>
                <Switch label="Auto-confirm online bookings" checked={data.settings.appointments.auto_confirm_online} onChange={(v) => saveAppt({ auto_confirm_online: v })} hint="Otherwise they arrive as Pending" />
                <Switch label="Allow 'Any available stylist'" checked={data.settings.appointments.allow_any_stylist} onChange={(v) => saveAppt({ allow_any_stylist: v })} />
              </>}
            </div>
          </Card>
        </div>
      </div>
      <OnlineBookings />
      <style>{`@media (max-width: 1024px){ .grid[style*="380px"]{ grid-template-columns: 1fr !important } }`}</style>
    </div>
  );
}
const Field2 = ({ label, children }) => <div className="field"><label>{label}</label>{children}</div>;
function WelcomeEditor({ value, onSave }) {
  const [v, setV] = useState(value || '');
  return <div className="col"><Textarea label="Welcome message" value={v} onChange={(e) => setV(e.target.value)} rows={2} maxLength={200} /><div><Button size="sm" disabled={v === value} onClick={() => onSave(v)}>Save message</Button></div></div>;
}

function OnlineBookings() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { data, loading, reload } = useApi('/api/appointments', { source: 'online,qr', status, page, pageSize: 15, sort: 'created' });
  const nav = useNavigate();
  const toast = useToast();
  const act = async (id, s) => { try { await api.post(`/api/appointments/${id}/status`, { status: s }); toast.success(`Booking ${s}`); reload(); } catch (e) { toast.error(e); } };
  return (
    <Card className="mt" title="QR & online bookings" pad={false} actions={<select className="input sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="">All</option>{['pending', 'confirmed', 'completed', 'cancelled', 'no_show'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</select>}>
      <div style={{ height: 12 }} />
      {!data ? <Loader /> : !data.data.length ? <Empty icon={QrCode} title="No online bookings yet" text="Share your link or print the QR code at your reception." /> : (
        <div className="table-wrap" style={{ opacity: loading ? .6 : 1 }}><table className="table">
          <thead><tr><th>Booked</th><th>Appointment</th><th>Customer</th><th>Services</th><th>Stylist</th><th>Via</th><th>Status</th><th /></tr></thead>
          <tbody>{data.data.map((a) => (
            <tr key={a.id}>
              <td className="faint small nowrap">{fmtDT(a.created_at.replace(' ', 'T').slice(0, 16))}</td><td className="nowrap"><b>{fmtDT(a.start_at)}</b></td>
              <td>{a.customer_name}<div className="faint tiny">{a.customer_phone}</div></td><td className="muted small">{a.services}</td><td>{a.employee_name || '—'}</td>
              <td><Badge status={a.source}>{a.source === 'qr' ? 'QR' : 'Link'}</Badge></td><td><Badge status={a.status} /></td>
              <td className="nowrap">{a.status === 'pending' && <Button size="sm" variant="primary" onClick={() => act(a.id, 'confirmed')}>Confirm</Button>} <Button size="sm" variant="ghost" onClick={() => nav(`/appointments?id=${a.id}`)}>Open</Button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </Card>
  );
}
