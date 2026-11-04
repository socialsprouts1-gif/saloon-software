// Loyalty stamp cards: e.g. "4 visits stamped → 5th haircut free".
import crypto from 'node:crypto';
import { all, get, insert, run, update, nowStamp } from '../db.js';
import { HttpError } from './util.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid misreads
export const newCardCode = () => Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');

export function programRow(p) {
  if (!p) return p;
  let ids = [];
  try { ids = JSON.parse(p.eligible_service_ids || '[]'); } catch { /* ignore */ }
  return { ...p, eligible_service_ids: ids, auto_stamp: !!p.auto_stamp, is_active: !!p.is_active };
}

export function cardDetail(code) {
  const c = get(`SELECT lc.*, c.name customer_name, c.phone customer_phone, p.name program_name, p.stamps_required, p.reward, p.reward_service_id,
    p.eligible_service_ids, p.color, p.terms, p.min_gap_hours, p.is_active program_active, s.name reward_service_name
    FROM loyalty_cards lc JOIN customers c ON c.id=lc.customer_id JOIN loyalty_programs p ON p.id=lc.program_id
    LEFT JOIN services s ON s.id=p.reward_service_id WHERE lc.code=?`, String(code).toUpperCase().trim());
  if (!c) return null;
  try { c.eligible_service_ids = JSON.parse(c.eligible_service_ids || '[]'); } catch { c.eligible_service_ids = []; }
  c.reward_ready = c.stamps >= c.stamps_required;
  return c;
}
export function cardOrThrow(code) {
  const c = cardDetail(code);
  if (!c) throw new HttpError(404, 'Loyalty card not found. Check the QR code or card number.');
  return c;
}
export const cardEvents = (cardId, limit = 50) => all('SELECT * FROM loyalty_events WHERE card_id=? ORDER BY id DESC LIMIT ?', cardId, limit);

const log = (card, type, stampsAfter, { user, note, invoiceId } = {}) =>
  insert('loyalty_events', { card_id: card.id, type, invoice_id: invoiceId ?? null, user_id: user?.id ?? null, user_name: user?.name ?? null, note: note || null, stamps_after: stampsAfter });

/** Issue a card (or return the customer's existing active card for that programme). */
export function issueCard(customerId, programId) {
  const p = get('SELECT * FROM loyalty_programs WHERE id=?', programId);
  if (!p || !p.is_active) throw new HttpError(400, 'Choose an active loyalty programme');
  if (!get('SELECT id FROM customers WHERE id=?', customerId)) throw new HttpError(404, 'Customer not found');
  const existing = get(`SELECT code FROM loyalty_cards WHERE customer_id=? AND program_id=? AND status='active'`, customerId, programId);
  if (existing) return { code: existing.code, created: false };
  let code;
  do { code = newCardCode(); } while (get('SELECT 1 FROM loyalty_cards WHERE code=?', code));
  insert('loyalty_cards', { program_id: programId, customer_id: customerId, code });
  return { code, created: true };
}

/**
 * Add one visit stamp. Guards against accidental double scans: if the card was stamped within
 * the programme's minimum gap, a 409 is returned unless force is set.
 */
export function addStamp(code, { user, note, invoiceId, force = false } = {}) {
  const c = cardOrThrow(code);
  if (c.status !== 'active') throw new HttpError(400, 'This card is not active');
  if (!c.program_active) throw new HttpError(400, 'This loyalty programme is paused');
  if (c.reward_ready) throw new HttpError(400, `Card is full — the reward (${c.reward}) is ready. Redeem it first.`);
  if (!force && c.last_stamp_at && c.min_gap_hours > 0) {
    const hours = (Date.now() - new Date(c.last_stamp_at.replace(' ', 'T')).getTime()) / 3600000;
    if (hours < c.min_gap_hours) {
      const err = new HttpError(409, `This card was already stamped ${hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : `${hours.toFixed(1)} h`} ago.`);
      err.details = { code: 'recent_stamp' };
      throw err;
    }
  }
  const stamps = c.stamps + 1;
  update('loyalty_cards', c.id, { stamps, last_stamp_at: nowStamp() });
  log(c, 'stamp', stamps, { user, note, invoiceId });
  return cardDetail(c.code);
}

export function removeStamp(code, { user, reason }) {
  const c = cardOrThrow(code);
  if (c.stamps <= 0) throw new HttpError(400, 'No stamps to remove');
  update('loyalty_cards', c.id, { stamps: c.stamps - 1 });
  log(c, 'remove', c.stamps - 1, { user, note: reason });
  return cardDetail(c.code);
}

/** Use the reward: stamps reset (any extra stamps carry over) and the redemption is recorded. */
export function redeemReward(code, { user, invoiceId, note } = {}) {
  const c = cardOrThrow(code);
  if (!c.reward_ready) throw new HttpError(400, `${c.stamps_required - c.stamps} more visit(s) needed before the reward`);
  const stamps = c.stamps - c.stamps_required;
  update('loyalty_cards', c.id, { stamps, rewards_redeemed: c.rewards_redeemed + 1 });
  log(c, 'redeem', stamps, { user, invoiceId, note: note || c.reward });
  return cardDetail(c.code);
}

/** After a bill: stamp each of the customer's auto-stamp cards once if an eligible service was bought. */
export function autoStampForInvoice(invoiceId, user) {
  const inv = get('SELECT id, customer_id FROM invoices WHERE id=?', invoiceId);
  if (!inv?.customer_id) return [];
  const lines = all(`SELECT ref_id, reward_card_id FROM invoice_items WHERE invoice_id=? AND item_type='service'`, invoiceId);
  const stamped = [];
  for (const card of all(`SELECT lc.code, p.eligible_service_ids FROM loyalty_cards lc JOIN loyalty_programs p ON p.id=lc.program_id
    WHERE lc.customer_id=? AND lc.status='active' AND p.is_active=1 AND p.auto_stamp=1`, inv.customer_id)) {
    let eligible = [];
    try { eligible = JSON.parse(card.eligible_service_ids || '[]'); } catch { /* ignore */ }
    // the free reward visit itself doesn't earn a stamp
    const qualifies = lines.some((l) => !l.reward_card_id && (!eligible.length || eligible.includes(l.ref_id)));
    if (!qualifies) continue;
    try { addStamp(card.code, { user, invoiceId, note: 'Auto-stamped from bill', force: true }); stamped.push(card.code); }
    catch { /* card full or paused: skip silently */ }
  }
  return stamped;
}

/** Undo loyalty effects of a voided bill. */
export function reverseInvoiceLoyalty(invoiceId, user) {
  for (const e of all('SELECT e.*, lc.code FROM loyalty_events e JOIN loyalty_cards lc ON lc.id=e.card_id WHERE e.invoice_id=?', invoiceId)) {
    const c = cardDetail(e.code);
    if (e.type === 'stamp' && c.stamps > 0) { update('loyalty_cards', c.id, { stamps: c.stamps - 1 }); log(c, 'remove', c.stamps - 1, { user, note: 'Bill voided' }); }
    if (e.type === 'redeem') { update('loyalty_cards', c.id, { stamps: c.stamps + c.stamps_required, rewards_redeemed: Math.max(0, c.rewards_redeemed - 1) }); log(c, 'unredeem', c.stamps + c.stamps_required, { user, note: 'Bill voided' }); }
  }
  run('UPDATE loyalty_events SET invoice_id=NULL WHERE invoice_id=?', invoiceId);
}
