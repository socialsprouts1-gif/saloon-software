import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Gift, Camera, Keyboard, X } from 'lucide-react';
import { Button, Modal } from './ui.jsx';

/** Public link a card's QR code opens. */
export const cardUrl = (slug, code) => `${window.location.origin}/s/${slug}/card/${code}`;

/** Accepts a scanned URL (…/card/CODE) or a typed card number. */
export function parseCardCode(text) {
  const t = String(text || '').trim();
  const m = t.match(/\/card\/([A-Za-z0-9]{6,12})/);
  if (m) return m[1].toUpperCase();
  return /^[A-Za-z0-9]{6,12}$/.test(t) ? t.toUpperCase() : null;
}

export function QRImage({ value, size = 160, color = '#2b1424' }) {
  const [src, setSrc] = useState(null);
  useEffect(() => { QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M', color: { dark: color, light: '#ffffff' } }).then(setSrc).catch(() => setSrc(null)); }, [value, size, color]);
  return src ? <img src={src} width={size} height={size} alt="Card QR code" style={{ borderRadius: 10, background: '#fff', display: 'block' }} /> : <div style={{ width: size, height: size }} />;
}

/**
 * The stamp card itself: one slot per visit plus a final reward slot.
 * e.g. stamps_required 4 → four stamp slots and a fifth "FREE" slot.
 */
export function StampCard({ card, salonName, qrValue, compact, onSlotClick }) {
  const color = card.color || '#6d2a52';
  const slots = Array.from({ length: card.stamps_required });
  return (
    <div className={`stamp-card ${card.stamps_required >= 6 ? 'many' : ''}`} style={{ '--card': color, maxWidth: compact ? 360 : 440 }}>
      <div className="row between top" style={{ gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="sc-salon truncate">{salonName}</div>
          <div className="sc-title">{card.program_name || card.program}</div>
          <div className="sc-name">{card.customer_name || card.customer}</div>
        </div>
        {qrValue && <div style={{ padding: 5, background: '#fff', borderRadius: 12, flexShrink: 0 }}><QRImage value={qrValue} size={compact ? 64 : 84} color="#1d1219" /></div>}
      </div>
      <div className="sc-slots">
        {slots.map((_, i) => {
          const on = i < card.stamps;
          return (
            <button key={i} type="button" className={`sc-slot ${on ? 'on' : ''}`} disabled={!onSlotClick} onClick={() => onSlotClick?.(i)} aria-label={on ? `Visit ${i + 1} stamped` : `Visit ${i + 1}`}>
              {on ? <Check size={compact ? 16 : 20} strokeWidth={3} /> : <span>{i + 1}</span>}
            </button>
          );
        })}
        <div className={`sc-slot reward ${card.reward_ready ? 'ready' : ''}`} title={card.reward}><Gift size={compact ? 16 : 20} /><small>FREE</small></div>
      </div>
      <div className="row between sc-foot">
        <span className="truncate">{card.reward_ready ? '🎉 Reward ready!' : `${card.stamps_required - card.stamps} more visit${card.stamps_required - card.stamps === 1 ? '' : 's'} → ${card.reward}`}</span>
        <code>{card.code}</code>
      </div>
    </div>
  );
}

/** Camera QR scanner with a manual card-number fallback. Calls onCode(CODE). */
export function ScannerModal({ open, onClose, onCode, title = 'Scan loyalty card' }) {
  const video = useRef(null), canvas = useRef(null), raf = useRef(0);
  const [mode, setMode] = useState('camera');
  const [err, setErr] = useState('');
  const [manual, setManual] = useState('');
  useEffect(() => {
    if (!open || mode !== 'camera') return undefined;
    let stream, stopped = false, jsQR;
    setErr('');
    (async () => {
      try {
        jsQR = (await import('jsqr')).default;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = () => {
          if (stopped) return;
          const v = video.current, c = canvas.current;
          if (v && c && v.readyState >= 2) {
            const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
            c.width = w; c.height = h;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(v, 0, 0, w, h);
            const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
            const code = hit && parseCardCode(hit.data);
            if (code) { stopped = true; navigator.vibrate?.(80); onCode(code); return; }
          }
          raf.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setErr(e?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access, or type the card number.' : 'No camera available here. Type the card number instead.');
        setMode('manual');
      }
    })();
    return () => { stopped = true; cancelAnimationFrame(raf.current); stream?.getTracks().forEach((t) => t.stop()); };
  }, [open, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e) => { e.preventDefault(); const c = parseCardCode(manual); if (c) onCode(c); else setErr('Enter the 8-character card number printed under the QR.'); };
  return (
    <Modal open={open} onClose={onClose} title={title} size="narrow" footer={<Button icon={mode === 'camera' ? Keyboard : Camera} onClick={() => { setErr(''); setMode(mode === 'camera' ? 'manual' : 'camera'); }}>{mode === 'camera' ? 'Type card number' : 'Use camera'}</Button>}>
      {mode === 'camera' ? (
        <div className="scanner">
          <video ref={video} playsInline muted />
          <div className="scanner-frame" />
          <canvas ref={canvas} hidden />
          <p className="faint small center mt-sm">Point the camera at the QR code on the customer's card</p>
        </div>
      ) : (
        <form onSubmit={submit} className="col">
          <input className="input" autoFocus placeholder="e.g. Z4TZ4TJ7" value={manual} onChange={(e) => setManual(e.target.value.toUpperCase())} aria-label="Card number" style={{ fontSize: 18, letterSpacing: '.12em', textAlign: 'center' }} />
          <Button variant="primary" type="submit">Open card</Button>
        </form>
      )}
      {err && <p className="err small mt-sm" style={{ color: 'var(--danger)' }}><X size={12} /> {err}</p>}
    </Modal>
  );
}
