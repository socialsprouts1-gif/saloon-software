import { all, get, insert, run, tx, update, getSettings, nowStamp } from '../db.js';
import { HttpError, money, today, addDays, localISO } from './util.js';
import { randomToken } from './auth.js';
import { notify } from './util.js';
import { cardDetail, redeemReward, autoStampForInvoice, reverseInvoiceLoyalty } from './loyalty.js';

export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank_transfer', 'other'];

/** Validates a coupon against a cart; returns { coupon, discount } or throws 400. */
export function evaluateCoupon(code, { customerId, lines, baseAmount }) {
  const c = get('SELECT * FROM coupons WHERE code=?', String(code).trim());
  if (!c || !c.is_active) throw new HttpError(400, 'Invalid or inactive coupon');
  const t = today();
  if (c.valid_from && t < c.valid_from) throw new HttpError(400, `Coupon is valid from ${c.valid_from}`);
  if (c.valid_to && t > c.valid_to) throw new HttpError(400, 'Coupon has expired');
  if (c.usage_limit && c.used_count >= c.usage_limit) throw new HttpError(400, 'Coupon usage limit reached');
  if (c.customer_id && c.customer_id !== customerId) throw new HttpError(400, 'This coupon is reserved for another customer');
  if (c.per_customer_limit && customerId) {
    const n = get('SELECT COUNT(*) n FROM coupon_usages WHERE coupon_id=? AND customer_id=?', c.id, customerId).n;
    if (n >= c.per_customer_limit) throw new HttpError(400, 'Customer has already used this coupon');
  }
  if (baseAmount < c.min_invoice) throw new HttpError(400, `Minimum bill of ${c.min_invoice} required for this coupon`);
  const applicable = lines.filter((l) => {
    if (c.applies_to === 'services') return l.item_type === 'service';
    if (c.applies_to === 'products') return l.item_type === 'product';
    if (c.applies_to === 'service') return l.item_type === 'service' && l.ref_id === c.service_id;
    if (c.applies_to === 'product') return l.item_type === 'product' && l.ref_id === c.product_id;
    return true;
  });
  const base = Math.min(baseAmount, applicable.reduce((a, l) => a + l.total, 0));
  if (base <= 0) throw new HttpError(400, 'Coupon does not apply to any item in this bill');
  let d = c.discount_type === 'percent' ? (base * c.value) / 100 : Math.min(c.value, base);
  if (c.max_discount) d = Math.min(d, c.max_discount);
  return { coupon: c, discount: money(d) };
}

/** Highest active membership discount % for a customer. */
export function membershipDiscountPct(customerId) {
  if (!customerId) return 0;
  return get(`SELECT COALESCE(MAX(p.discount_pct),0) pct FROM customer_packages cp JOIN packages p ON p.id=cp.package_id
    WHERE cp.customer_id=? AND cp.status='active' AND cp.expires_at >= ?`, customerId, today()).pct;
}

function commissionFor(item, emp) {
  if (!emp || !['commission', 'fixed_plus_commission'].includes(emp.salary_type)) return 0;
  if (item.item_type === 'service') {
    const svc = get('SELECT commission_pct FROM services WHERE id=?', item.ref_id);
    const pct = svc?.commission_pct ?? emp.service_commission_pct;
    return money((item.total * (pct || 0)) / 100);
  }
  if (item.item_type === 'product') return money((item.total * (emp.product_commission_pct || 0)) / 100);
  return 0;
}

/** Price a cart without saving it (used for the live POS preview and by createInvoice). */
export function priceCart({ customerId, items, discount, couponCode, redeemPoints, taxEnabled, branchId }) {
  const s = getSettings();
  const lines = items.map((it) => {
    const qty = Number(it.qty) || 1;
    let name, unit, meta = {};
    if (it.type === 'service') {
      const sv = get('SELECT * FROM services WHERE id=?', it.ref_id);
      if (!sv) throw new HttpError(400, 'Service not found');
      name = sv.name; unit = it.unit_price ?? sv.price;
      if (it.use_credit_id) {
        const cr = get(`SELECT cpc.*, cp.customer_id, cp.expires_at, cp.status FROM customer_package_credits cpc JOIN customer_packages cp ON cp.id=cpc.customer_package_id WHERE cpc.id=?`, it.use_credit_id);
        if (!cr || cr.customer_id !== customerId || cr.service_id !== sv.id) throw new HttpError(400, 'Package credit not valid for this customer/service');
        if (cr.status !== 'active' || cr.expires_at < today()) throw new HttpError(400, 'Package has expired');
        if (cr.total - cr.used < qty) throw new HttpError(400, `Only ${cr.total - cr.used} package credit(s) left for ${sv.name}`);
        unit = 0; name = `${sv.name} (package credit)`; meta.package_credit_id = cr.id;
      }
      if (it.use_reward_card_id) {
        const card = get('SELECT code FROM loyalty_cards WHERE id=?', it.use_reward_card_id);
        const c = card && cardDetail(card.code);
        if (!c || c.customer_id !== customerId || c.status !== 'active') throw new HttpError(400, 'Loyalty card not valid for this customer');
        if (!c.reward_ready) throw new HttpError(400, `${c.stamps_required - c.stamps} more visit(s) needed before the loyalty reward`);
        if (c.reward_service_id && c.reward_service_id !== sv.id) throw new HttpError(400, `The loyalty reward is for ${c.reward_service_name}`);
        if (!c.reward_service_id && c.eligible_service_ids.length && !c.eligible_service_ids.includes(sv.id)) throw new HttpError(400, 'This service is not covered by the loyalty reward');
        if (qty !== 1) throw new HttpError(400, 'A loyalty reward covers one service');
        unit = 0; name = `${sv.name} (loyalty reward)`; meta.reward_card_id = c.id;
      }
    } else if (it.type === 'product') {
      const p = get('SELECT * FROM products WHERE id=?', it.ref_id);
      if (!p || p.is_archived) throw new HttpError(400, 'Product not found');
      if (branchId && p.branch_id !== branchId) throw new HttpError(400, `${p.name} belongs to another branch's inventory`);
      if (p.stock < qty) throw new HttpError(400, `Only ${p.stock} unit(s) of ${p.name} in stock`);
      name = p.name; unit = it.unit_price ?? p.selling_price;
    } else if (it.type === 'package') {
      const pk = get('SELECT * FROM packages WHERE id=? AND is_active=1', it.ref_id);
      if (!pk) throw new HttpError(400, 'Package not found');
      if (!customerId) throw new HttpError(400, 'Select a customer to sell a package');
      name = pk.name; unit = it.unit_price ?? pk.price;
    } else throw new HttpError(400, 'Unknown item type');
    const gross = money(qty * unit);
    const disc = Math.min(gross, money(it.discount || 0));
    return { item_type: it.type, ref_id: it.ref_id, name, qty, unit_price: money(unit), discount: disc, total: money(gross - disc), employee_id: it.employee_id || null, ...meta };
  });
  const subtotal = money(lines.reduce((a, l) => a + l.qty * l.unit_price, 0));
  const itemDiscount = money(lines.reduce((a, l) => a + l.discount, 0));
  let running = money(subtotal - itemDiscount);

  const memPct = membershipDiscountPct(customerId);
  const serviceTotal = lines.filter((l) => l.item_type === 'service').reduce((a, l) => a + l.total, 0);
  const membershipDiscount = money((serviceTotal * memPct) / 100);
  running = money(running - membershipDiscount);

  let discountAmount = 0;
  if (discount?.value) discountAmount = money(discount.type === 'percent' ? (running * Math.min(100, discount.value)) / 100 : Math.min(running, discount.value));
  running = money(running - discountAmount);

  let coupon = null, couponDiscount = 0;
  if (couponCode) { const r = evaluateCoupon(couponCode, { customerId, lines, baseAmount: running }); coupon = r.coupon; couponDiscount = Math.min(r.discount, running); }
  running = money(running - couponDiscount);

  let pointsUsed = 0, pointsValue = 0;
  if (redeemPoints && s.loyalty.enabled) {
    const cust = customerId && get('SELECT loyalty_points FROM customers WHERE id=?', customerId);
    if (!cust) throw new HttpError(400, 'Select a customer to redeem points');
    if (redeemPoints > cust.loyalty_points) throw new HttpError(400, `Customer has only ${cust.loyalty_points} points`);
    if (redeemPoints < s.loyalty.min_redeem) throw new HttpError(400, `Minimum ${s.loyalty.min_redeem} points to redeem`);
    pointsValue = money(Math.min(running, redeemPoints * s.loyalty.point_value));
    pointsUsed = Math.ceil(pointsValue / s.loyalty.point_value);
  }
  running = money(running - pointsValue);

  const taxOn = taxEnabled ?? s.tax.enabled;
  const rate = taxOn ? Number(s.tax.rate) || 0 : 0;
  let taxable = Math.max(0, running), tax = 0, total = 0;
  if (s.tax.inclusive) { tax = money(taxable - taxable / (1 + rate / 100)); total = money(taxable); taxable = money(taxable - tax); }
  else { tax = money((taxable * rate) / 100); total = money(taxable + tax); }

  return {
    lines, subtotal, item_discount: itemDiscount, membership_discount: membershipDiscount, membership_pct: memPct,
    discount_amount: discountAmount, coupon, coupon_discount: couponDiscount, loyalty_redeemed: pointsUsed, loyalty_value: pointsValue,
    taxable_amount: money(taxable), tax_rate: rate, tax_amount: tax, total,
  };
}

function nextInvoiceNo() {
  const s = getSettings();
  const year = today().slice(0, 4);
  const prefix = `${s.invoice.prefix || 'INV'}-${year}-`;
  const last = get(`SELECT invoice_no FROM invoices WHERE invoice_no LIKE ? ORDER BY id DESC LIMIT 1`, `${prefix}%`);
  const n = last ? Number(last.invoice_no.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(5, '0')}`;
}

export function createInvoice(input, user) {
  return tx(() => {
    const priced = priceCart(input);
    if (!priced.lines.length) throw new HttpError(400, 'Add at least one item');
    const payments = (input.payments || []).filter((p) => Number(p.amount) > 0);
    const paid = money(payments.reduce((a, p) => a + Number(p.amount), 0));
    if (paid - priced.total > 0.009) throw new HttpError(400, 'Payment exceeds the invoice total');
    const balance = money(priced.total - paid);
    const status = balance <= 0.009 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    const date = input.date || today();

    const id = insert('invoices', {
      branch_id: input.branchId, invoice_no: nextInvoiceNo(), public_token: randomToken(16), customer_id: input.customerId || null,
      appointment_id: input.appointmentId || null, date, subtotal: priced.subtotal, item_discount: priced.item_discount,
      discount_amount: priced.discount_amount, coupon_id: priced.coupon?.id ?? null, coupon_discount: priced.coupon_discount,
      loyalty_redeemed: priced.loyalty_redeemed, loyalty_value: priced.loyalty_value, membership_discount: priced.membership_discount,
      taxable_amount: priced.taxable_amount, tax_rate: priced.tax_rate, tax_amount: priced.tax_amount, total: priced.total,
      paid_amount: paid, balance, status, notes: input.notes || null, source: input.source || 'pos', created_by: user?.id ?? null,
    });

    for (const l of priced.lines) {
      const emp = l.employee_id ? get('SELECT * FROM employees WHERE id=?', l.employee_id) : null;
      insert('invoice_items', { invoice_id: id, ...l, commission_amount: commissionFor(l, emp) });
      if (l.item_type === 'product') {
        run('UPDATE products SET stock = stock - ?, updated_at=? WHERE id=?', l.qty, nowStamp(), l.ref_id);
        const p = get('SELECT stock, min_stock, name, branch_id FROM products WHERE id=?', l.ref_id);
        insert('stock_movements', { product_id: l.ref_id, branch_id: p.branch_id, type: 'sale', qty: -l.qty, reason: 'POS sale', invoice_id: id, user_id: user?.id, balance_after: p.stock });
        if (p.stock <= p.min_stock) notify({ type: 'low_stock', title: p.stock <= 0 ? `Out of stock: ${p.name}` : `Low stock: ${p.name}`, message: `${p.stock} left (minimum ${p.min_stock})`, link: '/inventory', branchId: p.branch_id, dedupeKey: `stock-${l.ref_id}-${p.stock}` });
      }
      if (l.package_credit_id) run('UPDATE customer_package_credits SET used = used + ? WHERE id=?', l.qty, l.package_credit_id);
      if (l.item_type === 'package') {
        const pk = get('SELECT * FROM packages WHERE id=?', l.ref_id);
        for (let q = 0; q < l.qty; q++) {
          const cpId = insert('customer_packages', { customer_id: input.customerId, package_id: pk.id, invoice_id: id, purchased_at: date, expires_at: addDays(date, pk.validity_days), status: status === 'paid' ? 'active' : 'pending', price: l.unit_price });
          for (const pi of all('SELECT * FROM package_items WHERE package_id=?', pk.id)) insert('customer_package_credits', { customer_package_id: cpId, service_id: pi.service_id, total: pi.credits });
        }
      }
    }
    for (const p of payments) insert('payments', { invoice_id: id, amount: money(p.amount), method: p.method, reference: p.reference || null, paid_at: localISO(), user_id: user?.id });
    for (const l of priced.lines.filter((x) => x.reward_card_id)) {
      redeemReward(get('SELECT code FROM loyalty_cards WHERE id=?', l.reward_card_id).code, { user, invoiceId: id, note: `Used on ${l.name}` });
    }
    autoStampForInvoice(id, user);
    if (priced.coupon) {
      run('UPDATE coupons SET used_count = used_count + 1 WHERE id=?', priced.coupon.id);
      insert('coupon_usages', { coupon_id: priced.coupon.id, invoice_id: id, customer_id: input.customerId || null, discount: priced.coupon_discount, invoice_total: priced.total });
    }
    if (priced.loyalty_redeemed) run('UPDATE customers SET loyalty_points = loyalty_points - ? WHERE id=?', priced.loyalty_redeemed, input.customerId);
    if (input.appointmentId) run(`UPDATE appointments SET status='completed', invoice_id=?, updated_at=? WHERE id=?`, id, nowStamp(), input.appointmentId);
    if (status === 'paid') onInvoicePaid(id);
    return id;
  });
}

/** Side effects once an invoice is fully settled: activate packages, award loyalty points. */
export function onInvoicePaid(invoiceId) {
  const inv = get('SELECT * FROM invoices WHERE id=?', invoiceId);
  run(`UPDATE customer_packages SET status='active' WHERE invoice_id=? AND status='pending'`, invoiceId);
  const s = getSettings();
  if (inv.customer_id && s.loyalty.enabled && !inv.loyalty_earned) {
    const pts = Math.floor((inv.total / 100) * (s.loyalty.points_per_100 || 0));
    if (pts > 0) {
      run('UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id=?', pts, inv.customer_id);
      run('UPDATE invoices SET loyalty_earned=? WHERE id=?', pts, invoiceId);
    }
  }
}

export function addPayment(invoiceId, { amount, method, reference }, user) {
  return tx(() => {
    const inv = get('SELECT * FROM invoices WHERE id=?', invoiceId);
    if (!inv) throw new HttpError(404, 'Invoice not found');
    if (inv.status === 'void') throw new HttpError(400, 'Invoice is void');
    amount = money(amount);
    if (amount <= 0) throw new HttpError(400, 'Amount must be positive');
    if (amount - inv.balance > 0.009) throw new HttpError(400, `Balance due is only ${inv.balance}`);
    insert('payments', { invoice_id: invoiceId, amount, method, reference: reference || null, paid_at: localISO(), user_id: user?.id });
    const paid = money(inv.paid_amount + amount), balance = money(inv.total - paid);
    const status = balance <= 0.009 ? 'paid' : 'partial';
    update('invoices', invoiceId, { paid_amount: paid, balance, status });
    if (status === 'paid') onInvoicePaid(invoiceId);
  });
}

/** Void an invoice and reverse every side effect (stock, coupon, credits, points, packages). */
export function voidInvoice(invoiceId, reason, user) {
  return tx(() => {
    const inv = get('SELECT * FROM invoices WHERE id=?', invoiceId);
    if (!inv) throw new HttpError(404, 'Invoice not found');
    if (inv.status === 'void') throw new HttpError(400, 'Already void');
    for (const l of all('SELECT * FROM invoice_items WHERE invoice_id=?', invoiceId)) {
      if (l.item_type === 'product') {
        run('UPDATE products SET stock = stock + ? WHERE id=?', l.qty, l.ref_id);
        const p = get('SELECT stock, branch_id FROM products WHERE id=?', l.ref_id);
        insert('stock_movements', { product_id: l.ref_id, branch_id: p.branch_id, type: 'return', qty: l.qty, reason: `Invoice ${inv.invoice_no} voided`, invoice_id: invoiceId, user_id: user?.id, balance_after: p.stock });
      }
      if (l.package_credit_id) run('UPDATE customer_package_credits SET used = MAX(0, used - ?) WHERE id=?', l.qty, l.package_credit_id);
    }
    run(`UPDATE customer_packages SET status='cancelled' WHERE invoice_id=?`, invoiceId);
    reverseInvoiceLoyalty(invoiceId, user);
    if (inv.coupon_id) { run('UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE id=?', inv.coupon_id); run('DELETE FROM coupon_usages WHERE invoice_id=?', invoiceId); }
    if (inv.customer_id) run('UPDATE customers SET loyalty_points = MAX(0, loyalty_points + ? - ?) WHERE id=?', inv.loyalty_redeemed, inv.loyalty_earned, inv.customer_id);
    if (inv.appointment_id) run(`UPDATE appointments SET status='checked_in', invoice_id=NULL WHERE id=?`, inv.appointment_id);
    update('invoices', invoiceId, { status: 'void', void_reason: reason, balance: 0 });
  });
}

export function invoiceDetail(where, val) {
  const inv = get(`SELECT i.*, c.name customer_name, c.phone customer_phone, c.email customer_email, c.loyalty_points,
    b.name branch_name, b.address branch_address, b.phone branch_phone, co.code coupon_code, u.name created_by_name
    FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id LEFT JOIN branches b ON b.id=i.branch_id
    LEFT JOIN coupons co ON co.id=i.coupon_id LEFT JOIN users u ON u.id=i.created_by WHERE i.${where}=?`, val);
  if (!inv) return null;
  inv.items = all(`SELECT ii.*, e.name employee_name FROM invoice_items ii LEFT JOIN employees e ON e.id=ii.employee_id WHERE invoice_id=? ORDER BY ii.id`, inv.id);
  inv.payments = all('SELECT * FROM payments WHERE invoice_id=? ORDER BY id', inv.id);
  return inv;
}
