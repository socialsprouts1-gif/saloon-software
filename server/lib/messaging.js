import { insert, getSettings } from '../db.js';

/** Normalise an Indian/intl number to digits with country code (defaults to +91). */
export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) d = `91${d}`;
  return d;
}
export const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;

/**
 * Send a WhatsApp message through the Meta Cloud API when configured.
 * Without credentials it records the message and returns a click-to-chat link instead.
 */
export async function sendWhatsApp(phone, text) {
  const cfg = getSettings().whatsapp;
  const link = waLink(phone, text);
  if (!cfg.enabled || cfg.provider !== 'cloud_api' || !cfg.phone_number_id || !cfg.access_token) {
    insert('message_log', { channel: 'whatsapp', recipient: waNumber(phone), body: text, status: 'link_only' });
    return { sent: false, link };
  }
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${cfg.phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: waNumber(phone), type: 'text', text: { body: text } }),
      signal: AbortSignal.timeout(10000),
    });
    const ok = r.ok;
    insert('message_log', { channel: 'whatsapp', recipient: waNumber(phone), body: text, status: ok ? 'sent' : 'failed', error: ok ? null : (await r.text()).slice(0, 500) });
    return { sent: ok, link };
  } catch (e) {
    insert('message_log', { channel: 'whatsapp', recipient: waNumber(phone), body: text, status: 'failed', error: e.message });
    return { sent: false, link };
  }
}
