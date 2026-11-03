import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, update, run, tx, nowStamp } from '../db.js';
import { requirePerm, can } from '../lib/auth.js';
import { h, parse, HttpError, audit, paginate, today, addDays, notify, money, resolveRange } from '../lib/util.js';
import { productRevenue, inventoryStats } from '../lib/analytics.js';
import { resolveBranch } from './appointments.js';

const r = Router();

// ---- suppliers ------------------------------------------------------------------------
const supSchema = z.object({ name: z.string().trim().min(2), contact_person: z.string().optional().nullable(), phone: z.string().optional().nullable(), email: z.string().email().optional().nullable().or(z.literal('')), address: z.string().optional().nullable(), gstin: z.string().optional().nullable(), is_active: z.boolean().optional() });
r.get('/suppliers', requirePerm('inventory'), h((_req, res) => {
  res.json(all(`SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.supplier_id=s.id AND p.is_archived=0) products,
    (SELECT COALESCE(SUM(qty*unit_cost),0) FROM stock_movements m WHERE m.supplier_id=s.id AND m.type='purchase') purchased FROM suppliers s ORDER BY s.is_active DESC, s.name`));
}));
r.post('/suppliers', requirePerm('inventory'), h((req, res) => { const b = parse(supSchema, req.body); const id = insert('suppliers', b); audit(req, 'create', 'supplier', id, b); res.json({ id }); }));
r.put('/suppliers/:id', requirePerm('inventory'), h((req, res) => { const b = parse(supSchema.partial(), req.body); update('suppliers', Number(req.params.id), b); audit(req, 'update', 'supplier', Number(req.params.id), b); res.json({ ok: true }); }));

// ---- products ----------------------------------------------------------------------------
const prodSchema = z.object({
  name: z.string().trim().min(2), category: z.string().optional().nullable(), brand: z.string().optional().nullable(), sku: z.string().optional().nullable(), barcode: z.string().optional().nullable(),
  purchase_price: z.coerce.number().min(0), selling_price: z.coerce.number().min(0), stock: z.coerce.number().min(0).optional(), min_stock: z.coerce.number().min(0).default(0),
  supplier_id: z.coerce.number().int().nullable().optional(), purchase_date: z.string().optional().nullable(), expiry_date: z.string().optional().nullable(), branch_id: z.coerce.number().optional(),
});
r.get('/products', requirePerm('inventory', 'billing'), h((req, res) => {
  const { limit, offset, page, pageSize } = paginate({ pageSize: 50, ...req.query });
  const w = [req.query.archived ? 'p.is_archived=1' : 'p.is_archived=0'], p = [];
  if (req.branchId) { w.push('p.branch_id=?'); p.push(req.branchId); }
  else if (req.query.branch_id) { w.push('p.branch_id=?'); p.push(Number(req.query.branch_id)); }
  if (req.query.sellable) w.push('p.selling_price > 0');
  if (req.query.q) { w.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.brand LIKE ?)'); p.push(...Array(4).fill(`%${req.query.q}%`)); }
  if (req.query.category) { w.push('p.category=?'); p.push(req.query.category); }
  if (req.query.filter === 'low') w.push('p.stock > 0 AND p.stock <= p.min_stock');
  if (req.query.filter === 'out') w.push('p.stock <= 0');
  if (req.query.filter === 'expiring') w.push(`p.expiry_date IS NOT NULL AND p.expiry_date <= '${addDays(today(), 60)}'`);
  if (req.query.in_stock) w.push('p.stock > 0');
  const where = w.join(' AND ');
  const rows = all(`SELECT p.*, s.name supplier, b.name branch_name FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN branches b ON b.id=p.branch_id WHERE ${where} ORDER BY p.name LIMIT ? OFFSET ?`, ...p, limit, offset);
  const hideCost = !can(req.user, 'inventory') && !can(req.user, 'finance');
  res.json({ data: hideCost ? rows.map(({ purchase_price, ...x }) => x) : rows, total: get(`SELECT COUNT(*) n FROM products p WHERE ${where}`, ...p).n, page, pageSize,
    categories: all('SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category').map((c) => c.category) });
}));
r.get('/products/summary', requirePerm('inventory'), h((req, res) => {
  const { from, to } = resolveRange({ period: req.query.period || 'month' });
  res.json({ ...inventoryStats(req.branchId), top_selling: productRevenue(req.branchId, from, to, 10) });
}));
r.get('/products/:id', requirePerm('inventory'), h((req, res) => {
  const id = Number(req.params.id);
  const p = get('SELECT p.*, s.name supplier FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=?', id);
  if (!p) throw new HttpError(404, 'Product not found');
  p.movements = all(`SELECT m.*, u.name user, s.name supplier, i.invoice_no FROM stock_movements m LEFT JOIN users u ON u.id=m.user_id LEFT JOIN suppliers s ON s.id=m.supplier_id
    LEFT JOIN invoices i ON i.id=m.invoice_id WHERE m.product_id=? ORDER BY m.id DESC LIMIT 200`, id);
  p.sales = get(`SELECT COALESCE(SUM(ii.qty),0) qty, COALESCE(SUM(ii.total),0) revenue FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE ii.item_type='product' AND ii.ref_id=? AND i.status<>'void'`, id);
  res.json(p);
}));
r.post('/products', requirePerm('inventory'), h((req, res) => {
  const b = parse(prodSchema, req.body);
  b.branch_id = resolveBranch(req, b.branch_id);
  if (b.sku && get('SELECT id FROM products WHERE sku=? AND branch_id=? AND is_archived=0', b.sku, b.branch_id)) throw new HttpError(409, 'SKU already exists in this branch');
  const opening = b.stock || 0;
  const id = tx(() => {
    const pid = insert('products', { ...b, stock: opening });
    if (opening > 0) insert('stock_movements', { product_id: pid, branch_id: b.branch_id, type: 'opening', qty: opening, unit_cost: b.purchase_price, reason: 'Opening stock', supplier_id: b.supplier_id, user_id: req.user.id, balance_after: opening });
    return pid;
  });
  audit(req, 'create', 'product', id, { name: b.name }); res.json({ id });
}));
r.put('/products/:id', requirePerm('inventory'), h((req, res) => {
  const { stock, branch_id, ...b } = parse(prodSchema.partial(), req.body); // stock changes only via movements
  update('products', Number(req.params.id), b); audit(req, 'update', 'product', Number(req.params.id), b); res.json({ ok: true });
}));
r.post('/products/:id/archive', requirePerm('inventory'), h((req, res) => {
  const archived = req.body?.restore ? 0 : 1;
  update('products', Number(req.params.id), { is_archived: archived }); audit(req, archived ? 'archive' : 'restore', 'product', Number(req.params.id)); res.json({ ok: true });
}));
r.delete('/products/:id', requirePerm('inventory'), h((req, res) => {
  const id = Number(req.params.id);
  if (get(`SELECT 1 FROM invoice_items WHERE item_type='product' AND ref_id=? LIMIT 1`, id)) throw new HttpError(400, 'Product has sales history — archive it instead');
  tx(() => { run('DELETE FROM stock_movements WHERE product_id=?', id); run('DELETE FROM products WHERE id=?', id); });
  audit(req, 'delete', 'product', id); res.json({ ok: true });
}));

/** Stock in / out / adjust / purchase. Purchase can also post an expense. */
r.post('/products/:id/stock', requirePerm('inventory'), h((req, res) => {
  const id = Number(req.params.id);
  const b = parse(z.object({
    type: z.enum(['in', 'out', 'adjust', 'purchase']), qty: z.coerce.number(), reason: z.string().max(300).optional(),
    unit_cost: z.coerce.number().min(0).optional(), supplier_id: z.coerce.number().int().nullable().optional(),
    record_expense: z.boolean().optional(), payment_method: z.string().optional(), date: z.string().optional(),
  }), req.body);
  const out = tx(() => {
    const p = get('SELECT * FROM products WHERE id=?', id);
    if (!p) throw new HttpError(404, 'Product not found');
    let delta;
    if (b.type === 'adjust') { if (b.qty < 0) throw new HttpError(400, 'Counted stock cannot be negative'); delta = b.qty - p.stock; if (!b.reason) throw new HttpError(400, 'Reason is required for adjustments'); }
    else { if (!(b.qty > 0)) throw new HttpError(400, 'Quantity must be positive'); delta = b.type === 'out' ? -b.qty : b.qty; }
    if (p.stock + delta < 0) throw new HttpError(400, `Only ${p.stock} in stock`);
    const balance = p.stock + delta;
    run(`UPDATE products SET stock=?, updated_at=?${b.type === 'purchase' ? ', purchase_date=?, purchase_price=COALESCE(?, purchase_price), supplier_id=COALESCE(?, supplier_id)' : ''} WHERE id=?`,
      ...(b.type === 'purchase' ? [balance, nowStamp(), b.date || today(), b.unit_cost ?? null, b.supplier_id ?? null, id] : [balance, nowStamp(), id]));
    insert('stock_movements', { product_id: id, branch_id: p.branch_id, type: b.type, qty: delta, unit_cost: b.unit_cost ?? p.purchase_price, reason: b.reason || null, supplier_id: b.supplier_id ?? null, user_id: req.user.id, balance_after: balance });
    if (b.type === 'purchase' && b.record_expense) {
      const sup = b.supplier_id ? get('SELECT name FROM suppliers WHERE id=?', b.supplier_id)?.name : null;
      insert('expenses', { branch_id: p.branch_id, category: 'Product purchases', amount: money(b.qty * (b.unit_cost ?? p.purchase_price)), date: b.date || today(), payment_method: b.payment_method || 'cash', description: `${b.qty} × ${p.name}${sup ? ` from ${sup}` : ''}`, created_by: req.user.id });
    }
    if (balance <= p.min_stock) notify({ type: 'low_stock', title: balance <= 0 ? `Out of stock: ${p.name}` : `Low stock: ${p.name}`, message: `${balance} left (minimum ${p.min_stock})`, link: '/inventory?filter=low', branchId: p.branch_id, dedupeKey: `stock-${id}-${balance}` });
    return balance;
  });
  audit(req, `stock_${b.type}`, 'product', id, b);
  res.json({ stock: out });
}));

r.get('/movements', requirePerm('inventory'), h((req, res) => {
  const { limit, offset, page, pageSize } = paginate(req.query);
  const w = ['1=1'], p = [];
  if (req.branchId) { w.push('m.branch_id=?'); p.push(req.branchId); }
  if (req.query.type) { w.push('m.type=?'); p.push(req.query.type); }
  if (req.query.from) { w.push('substr(m.created_at,1,10) >= ?'); p.push(req.query.from); }
  if (req.query.to) { w.push('substr(m.created_at,1,10) <= ?'); p.push(req.query.to); }
  const where = w.join(' AND ');
  res.json({ data: all(`SELECT m.*, pr.name product, u.name user, s.name supplier, i.invoice_no FROM stock_movements m JOIN products pr ON pr.id=m.product_id
    LEFT JOIN users u ON u.id=m.user_id LEFT JOIN suppliers s ON s.id=m.supplier_id LEFT JOIN invoices i ON i.id=m.invoice_id WHERE ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`, ...p, limit, offset),
  total: get(`SELECT COUNT(*) n FROM stock_movements m WHERE ${where}`, ...p).n, page, pageSize });
}));

export default r;
