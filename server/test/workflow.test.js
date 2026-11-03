// End-to-end workflow tests against a throwaway database.
// Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TZ = 'Asia/Kolkata';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salon-test-'));

const { app } = await import('../index.js');
const { get, run, insert } = await import('../db.js');
const util = await import('../lib/util.js');
const { computePayroll } = await import('../lib/hr.js');
const { createInvoice } = await import('../lib/billing.js');

let server, base, owner;
const T = util.today();
const tomorrow = util.addDays(T, 1);

async function call(method, url, body, token = owner) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  return { status: r.status, data };
}

const ids = {};
before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await call('POST', '/api/auth/setup', { salonName: 'Test Salon', ownerName: 'Owner', email: 'o@test.in', password: 'password123' }, null);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  owner = r.data.token;
});
after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

test('rejects requests without a token and bad logins', async () => {
  assert.equal((await call('GET', '/api/dashboard', null, null)).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: 'o@test.in', password: 'wrong' }, null)).status, 401);
});

test('set up catalogue, staff and customer', async () => {
  const cats = (await call('GET', '/api/catalog/categories')).data;
  ids.branch = (await call('GET', '/api/branches')).data[0].id;
  ids.cut = (await call('POST', '/api/catalog/services', { name: 'Haircut', category_id: cats[0].id, price: 1000, duration_min: 60 })).data.id;
  ids.emp = (await call('POST', '/api/staff/employees', { name: 'Asha Stylist', role: 'hair_stylist', salary_type: 'fixed_plus_commission', base_salary: 15000, service_commission_pct: 10, product_commission_pct: 5, work_start: '09:00', work_end: '21:00', weekly_off: null, service_ids: [ids.cut] })).data.id;
  ids.cust = (await call('POST', '/api/customers', { name: 'Riya Rao', phone: '9876543210' })).data.id;
  assert.ok(ids.cut && ids.emp && ids.cust);
  const dupe = await call('POST', '/api/customers', { name: 'Dupe', phone: '9876543210' });
  assert.equal(dupe.status, 409);
});

test('prevents double booking the same stylist', async () => {
  const a = await call('POST', '/api/appointments', { customer_id: ids.cust, employee_id: ids.emp, service_ids: [ids.cut], start_at: `${tomorrow}T11:00` });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  ids.appt = a.data.id;
  assert.equal(a.data.end_at, `${tomorrow}T12:00`);
  const clash = await call('POST', '/api/appointments', { customer_id: ids.cust, employee_id: ids.emp, service_ids: [ids.cut], start_at: `${tomorrow}T11:30` });
  assert.equal(clash.status, 409);
  const adjacent = await call('POST', '/api/appointments', { customer_id: ids.cust, employee_id: ids.emp, service_ids: [ids.cut], start_at: `${tomorrow}T12:00` });
  assert.equal(adjacent.status, 200);
  // rescheduling onto an existing booking is also blocked
  const resched = await call('PUT', `/api/appointments/${adjacent.data.id}`, { start_at: `${tomorrow}T11:15` });
  assert.equal(resched.status, 409);
  // slots exclude booked times
  const slots = (await call('GET', `/api/appointments/slots?date=${tomorrow}&service_ids=${ids.cut}&employee_id=${ids.emp}`)).data;
  assert.ok(!slots.slots.some((s) => s.time === '11:00' || s.time === '12:30'));
  assert.ok(slots.slots.some((s) => s.time === '13:00'));
});

test('QR booking works end-to-end without an account', async () => {
  const token = (await call('GET', '/api/settings')).data.settings.booking.token;
  const pub = await call('GET', `/api/public/book/${token}`, null, null);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.salon.name, 'Test Salon');
  assert.ok(pub.data.services.some((s) => s.id === ids.cut));
  await call('POST', `/api/public/book/${token}/track`, { type: 'scan' }, null);
  await call('POST', `/api/public/book/${token}/track`, { type: 'visit' }, null);
  const slots = (await call('GET', `/api/public/book/${token}/slots?branch_id=${ids.branch}&date=${tomorrow}&service_ids=${ids.cut}`, null, null)).data;
  const slot = slots.slots.find((s) => s.time >= '15:00');
  const booking = await call('POST', `/api/public/book/${token}/appointments`, { branch_id: ids.branch, service_ids: [ids.cut], employee_id: null, date: tomorrow, time: slot.time, name: 'Neha QR', phone: '9000000001', via: 'qr' }, null);
  assert.equal(booking.status, 200, JSON.stringify(booking.data));
  assert.equal(booking.data.employee, 'Asha Stylist'); // auto-assigned the free stylist
  // same slot again must fail
  const again = await call('POST', `/api/public/book/${token}/appointments`, { branch_id: ids.branch, service_ids: [ids.cut], date: tomorrow, time: slot.time, name: 'Late Comer', phone: '9000000002', via: 'qr' }, null);
  assert.equal(again.status, 409);
  // appears in the admin calendar, notification raised, stats updated
  const list = (await call('GET', `/api/appointments?from=${tomorrow}&to=${tomorrow}&all=1`)).data;
  assert.ok(list.some((a) => a.id === booking.data.id && a.source === 'qr' && a.status === 'pending'));
  assert.ok((await call('GET', '/api/notifications')).data.data.some((n) => n.type === 'booking'));
  const stats = (await call('GET', '/api/booking/stats')).data;
  assert.equal(stats.scans, 1); assert.equal(stats.bookings, 1);
  // regenerating the link invalidates the old one
  await call('POST', '/api/settings/booking/regenerate');
  assert.equal((await call('GET', `/api/public/book/${token}`, null, null)).status, 404);
});

test('POS invoice updates stock, revenue, commission, coupons and loyalty', async () => {
  ids.prod = (await call('POST', '/api/inventory/products', { name: 'Shampoo', purchase_price: 200, selling_price: 500, stock: 10, min_stock: 8 })).data.id;
  await call('POST', '/api/catalog/coupons', { code: 'TEN', discount_type: 'percent', value: 10 });
  const before = (await call('GET', '/api/dashboard')).data.finance.revenue.today;
  const inv = await call('POST', '/api/invoices', {
    customer_id: ids.cust, appointment_id: ids.appt, coupon_code: 'TEN', tax_enabled: true,
    items: [{ type: 'service', ref_id: ids.cut, employee_id: ids.emp }, { type: 'product', ref_id: ids.prod, qty: 2, employee_id: ids.emp }],
    payments: [{ method: 'upi', amount: 1000 }],
  });
  assert.equal(inv.status, 200, JSON.stringify(inv.data));
  // 1000 + 2*500 = 2000; coupon 10% = 200 → 1800; GST 18% = 324 → 2124
  assert.equal(inv.data.subtotal, 2000);
  assert.equal(inv.data.coupon_discount, 200);
  assert.equal(inv.data.tax_amount, 324);
  assert.equal(inv.data.total, 2124);
  assert.equal(inv.data.status, 'partial');
  assert.equal(inv.data.balance, 1124);
  // commission: 10% of 1000 service + 5% of 1000 product
  assert.deepEqual(inv.data.items.map((i) => i.commission_amount), [100, 50]);
  assert.equal(get('SELECT stock FROM products WHERE id=?', ids.prod).stock, 8);
  assert.equal(get('SELECT status FROM appointments WHERE id=?', ids.appt).status, 'completed');
  assert.ok(get(`SELECT 1 FROM notifications WHERE type='low_stock'`), 'low stock alert raised');
  const after = (await call('GET', '/api/dashboard')).data.finance.revenue.today;
  assert.equal(Math.round((after - before) * 100) / 100, 2124);
  // billing the same appointment twice is refused
  assert.equal((await call('POST', '/api/invoices', { appointment_id: ids.appt, items: [{ type: 'service', ref_id: ids.cut }] })).status, 409);
  // overselling is refused
  assert.equal((await call('POST', '/api/invoices', { items: [{ type: 'product', ref_id: ids.prod, qty: 99 }] })).status, 400);
  // settle the balance → paid + loyalty points
  const paid = await call('POST', `/api/invoices/${inv.data.id}/payments`, { amount: 1124, method: 'cash' });
  assert.equal(paid.data.status, 'paid');
  assert.equal(get('SELECT loyalty_points FROM customers WHERE id=?', ids.cust).loyalty_points, 21);
  // void reverses stock and points
  ids.inv = inv.data.id;
  await call('POST', `/api/invoices/${ids.inv}/void`, { reason: 'Test void' });
  assert.equal(get('SELECT stock FROM products WHERE id=?', ids.prod).stock, 10);
  assert.equal(get('SELECT loyalty_points FROM customers WHERE id=?', ids.cust).loyalty_points, 0);
  assert.equal(get('SELECT used_count FROM coupons WHERE code=?', 'TEN').used_count, 0);
});

test('packages give credits that redeem in POS', async () => {
  const pkg = (await call('POST', '/api/catalog/packages', { name: '3 cuts', type: 'prepaid', price: 2500, validity_days: 30, items: [{ service_id: ids.cut, credits: 3 }] })).data.id;
  const sale = await call('POST', '/api/invoices', { customer_id: ids.cust, tax_enabled: false, items: [{ type: 'package', ref_id: pkg }], payments: [{ method: 'cash', amount: 2500 }] });
  assert.equal(sale.data.status, 'paid');
  const credits = (await call('GET', `/api/customers/${ids.cust}/credits`)).data;
  assert.equal(credits.length, 1);
  const use = await call('POST', '/api/invoices', { customer_id: ids.cust, tax_enabled: false, items: [{ type: 'service', ref_id: ids.cut, employee_id: ids.emp, use_credit_id: credits[0].id }], payments: [] });
  assert.equal(use.data.total, 0);
  assert.equal(use.data.status, 'paid');
  assert.equal(get('SELECT used FROM customer_package_credits WHERE id=?', credits[0].id).used, 1);
});

test('attendance corrections are audited', async () => {
  const r = await call('PUT', '/api/staff/attendance', { employee_id: ids.emp, date: T, status: 'present', check_in: '09:30', check_out: '21:30', reason: 'Manual entry' });
  assert.equal(r.status, 200);
  assert.equal(r.data.late_minutes, 30);
  assert.equal(r.data.work_minutes, 720);
  const audit = (await call('GET', '/api/staff/attendance/audit')).data;
  assert.equal(audit[0].reason, 'Manual entry');
  const noReason = await call('PUT', '/api/staff/attendance', { employee_id: ids.emp, date: T, status: 'absent', reason: '' });
  assert.equal(noReason.status, 400);
});

test('payroll matches the worked example (15,000 + 2,000 + 500 − 500 = 17,000)', () => {
  const month = util.addDays(`${T.slice(0, 7)}-01`, -1).slice(0, 7);
  const days = util.daysInMonth(month);
  const empId = insert('employees', { branch_id: ids.branch, name: 'Example A', role: 'hair_stylist', salary_type: 'fixed_plus_commission', base_salary: 15000, service_commission_pct: 10, product_commission_pct: 5, joining_date: '2020-01-01', work_start: '10:00', work_end: '19:00' });
  for (let d = 1; d <= days; d++) insert('attendance', { employee_id: empId, date: `${month}-${String(d).padStart(2, '0')}`, check_in: '10:00', check_out: '19:00', status: 'present', work_minutes: 540 });
  const date = `${month}-15`;
  const svc = insert('services', { name: 'Big Service', price: 20000, duration_min: 60 });
  const prod = insert('products', { branch_id: ids.branch, name: 'Big Product', purchase_price: 1, selling_price: 10000, stock: 5 });
  createInvoice({ branchId: ids.branch, date, taxEnabled: false, items: [{ type: 'service', ref_id: svc, employee_id: empId }, { type: 'product', ref_id: prod, employee_id: empId }], payments: [] }, null);
  const emp = get('SELECT * FROM employees WHERE id=?', empId);
  const p = computePayroll(emp, month, { deductions: 500 });
  assert.equal(p.earned_base, 15000);
  assert.equal(p.service_commission, 2000);
  assert.equal(p.product_commission, 500);
  assert.equal(p.net_payable, 17000);
});

test('generated payroll, paying salary records an expense', async () => {
  const month = util.addDays(`${T.slice(0, 7)}-01`, -1).slice(0, 7);
  await call('POST', '/api/staff/payroll/generate', { month });
  const rows = (await call('GET', `/api/staff/payroll?month=${month}`)).data.rows;
  const a = rows.find((r) => r.name === 'Example A');
  assert.equal(a.net_payable, 17500); // no deductions entered via API
  await call('PUT', `/api/staff/payroll/${a.id}`, { deductions: 500 });
  const pay = await call('POST', `/api/staff/payroll/${a.id}/pay`, { paid_at: T, payment_method: 'bank_transfer' });
  assert.equal(pay.status, 200);
  assert.equal(get(`SELECT amount FROM expenses WHERE payroll_id=?`, a.id).amount, 17000);
});

test('expenses flow into profit reports', async () => {
  const before = (await call('GET', `/api/reports/profit?from=${T}&to=${T}`)).data.statement;
  await call('POST', '/api/expenses', { category: 'Electricity', amount: 1234, date: T, payment_method: 'upi' });
  const after = (await call('GET', `/api/reports/profit?from=${T}&to=${T}`)).data.statement;
  assert.equal(Math.round((before.net_profit - after.net_profit) * 100) / 100, 1234);
});

test('role permissions hide finance from receptionists and isolate employees', async () => {
  await call('POST', '/api/auth/users', { name: 'Front', email: 'front@test.in', role: 'receptionist', password: 'password123' });
  const rec = (await call('POST', '/api/auth/login', { email: 'front@test.in', password: 'password123' }, null)).data.token;
  assert.equal((await call('GET', '/api/expenses', null, rec)).status, 403);
  assert.equal((await call('GET', '/api/staff/payroll', null, rec)).status, 403);
  const dash = (await call('GET', '/api/dashboard', null, rec)).data;
  assert.equal(dash.finance, undefined);
  assert.equal((await call('GET', '/api/invoices', null, rec)).status, 200);
  const emps = (await call('GET', '/api/staff/employees', null, rec)).data;
  assert.equal(emps[0].base_salary, undefined, 'salary hidden');

  await call('POST', '/api/auth/users', { name: 'Asha', email: 'asha@test.in', role: 'employee', employee_id: ids.emp, password: 'password123' });
  const st = (await call('POST', '/api/auth/login', { email: 'asha@test.in', password: 'password123' }, null)).data.token;
  assert.equal((await call('GET', '/api/invoices', null, st)).status, 403);
  const mine = (await call('GET', '/api/appointments?all=1', null, st)).data;
  assert.ok(mine.length > 0 && mine.every((a) => a.employee_id === ids.emp));
  assert.equal((await call('GET', '/api/dashboard', null, st)).data.personal, true);
});

test('AI assistant answers from real data', async () => {
  const r = await call('POST', '/api/ai/ask', { question: 'Which products need restocking?' });
  assert.equal(r.status, 200);
  assert.match(r.data.answer, /Big Product|Shampoo|above their minimum/);
});

test('auto-login works only from this computer and can be switched off', async () => {
  const r = await call('POST', '/api/auth/auto-login', {}, null);
  assert.equal(r.status, 200);
  const me = await call('GET', '/api/auth/me', null, r.data.token);
  assert.equal(me.data.user.role, 'owner');
  process.env.AUTO_LOGIN = '0';
  assert.equal((await call('POST', '/api/auth/auto-login', {}, null)).status, 403);
  delete process.env.AUTO_LOGIN;
  // a request forwarded from another machine is refused
  const remote = await fetch(base + '/api/auth/auto-login', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.9' } });
  assert.equal(remote.status, 403);
});
