process.env.TZ ||= 'Asia/Kolkata';
import { fileURLToPath } from 'node:url';
import { db, all, get, insert, run, tx, setSetting, getSettings } from './db.js';
import { hashPassword, randomToken } from './lib/auth.js';
import { today, addDays, parseDate, toMin, fromMin, addMinutes, money } from './lib/util.js';
import { createAppointment } from './lib/scheduling.js';
import { createInvoice } from './lib/billing.js';
import { computeAttendance, computePayroll } from './lib/hr.js';
import { runNotificationJobs } from './lib/jobs.js';

// Deterministic PRNG so demo data is stable between runs
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const chance = (p) => rnd() < p;

export const DEMO_STAFF_PASSWORD = 'Demo@1234';

export function seedDemo({ salonName = 'Lumière Salon & Spa', ownerName = 'Salon Owner', email = 'owner@demo.salon', password = 'Owner@1234' } = {}) {
  const T = today();
  tx(() => {
    // ---- settings & branches -------------------------------------------------------------
    const s = getSettings();
    setSetting('salon', { ...s.salon, name: salonName, tagline: 'Hair · Skin · Spa · Bridal', address: '12, 100 Feet Road, Indiranagar, Bengaluru 560038', phone: '+91 98450 12345', email: 'hello@lumiere.example', website: '' });
    setSetting('booking', { ...s.booking, token: randomToken(9) });
    setSetting('tax', { ...s.tax, gstin: '29ABCDE1234F1Z5' });
    const b1 = insert('branches', { name: 'Indiranagar', address: '12, 100 Feet Road, Indiranagar, Bengaluru', phone: '+91 98450 12345', email: 'indiranagar@lumiere.example' });
    const b2 = insert('branches', { name: 'Koramangala', address: '45, 5th Block, Koramangala, Bengaluru', phone: '+91 98450 67890', email: 'koramangala@lumiere.example' });

    // ---- catalog ------------------------------------------------------------------------------
    const cats = Object.fromEntries(['Haircut', 'Hair Styling', 'Hair Colouring', 'Facial', 'Cleanup', 'Waxing', 'Manicure', 'Pedicure', 'Spa', 'Bridal Makeup'].map((n, i) => [n, insert('service_categories', { name: n, sort: i })]));
    const S = (cat, name, price, dur, desc, comm = null) => insert('services', { category_id: cats[cat], name, price, duration_min: dur, description: desc, commission_pct: comm });
    const svc = {
      menCut: S('Haircut', "Men's Haircut", 350, 30, 'Consultation, wash, precision cut and style'),
      womenCut: S('Haircut', "Women's Haircut", 700, 45, 'Wash, cut and blow-dry'),
      kidsCut: S('Haircut', 'Kids Haircut', 250, 20, 'For children under 12'),
      beard: S('Haircut', 'Beard Trim & Shape', 200, 20, 'Line-up and beard styling'),
      blowdry: S('Hair Styling', 'Blow Dry', 500, 30, 'Smooth or bouncy finish'),
      ironing: S('Hair Styling', 'Hair Ironing / Curls', 800, 45, 'Straightening or tong curls'),
      updo: S('Hair Styling', 'Party Updo', 1500, 60, 'Occasion hair styling'),
      globalColor: S('Hair Colouring', 'Global Hair Colour', 3500, 120, 'Ammonia-free global colour', 12),
      highlights: S('Hair Colouring', 'Highlights', 4500, 150, 'Foil highlights, includes toner', 12),
      rootTouch: S('Hair Colouring', 'Root Touch-up', 1500, 60, 'Up to 1 inch regrowth'),
      keratin: S('Spa', 'Keratin Treatment', 6000, 180, 'Frizz control smoothing treatment', 15),
      hairSpa: S('Spa', 'Hair Spa', 1200, 60, 'Deep conditioning and scalp massage'),
      bodySpa: S('Spa', 'Aromatherapy Body Massage', 2500, 75, 'Full-body relaxation massage'),
      goldFacial: S('Facial', 'Gold Radiance Facial', 2200, 60, 'Brightening facial with gold serum'),
      hydraFacial: S('Facial', 'Hydra Facial', 3500, 60, 'Deep cleanse, extraction and hydration'),
      cleanup: S('Cleanup', 'Express Cleanup', 800, 30, 'Cleanse, scrub and mask'),
      fullWax: S('Waxing', 'Full Arms & Legs Wax', 1100, 45, 'Rica wax'),
      underarm: S('Waxing', 'Underarm Wax', 200, 10, 'Rica wax'),
      mani: S('Manicure', 'Classic Manicure', 600, 40, 'Shape, cuticle care and polish'),
      gelMani: S('Manicure', 'Gel Manicure', 1200, 50, 'Long-lasting gel polish'),
      pedi: S('Pedicure', 'Spa Pedicure', 900, 50, 'Soak, scrub, massage and polish'),
      bridal: S('Bridal Makeup', 'Bridal HD Makeup', 15000, 180, 'HD makeup with hairstyling and draping', 10),
      partyMakeup: S('Bridal Makeup', 'Party Makeup', 3500, 75, 'Evening makeup look'),
    };
    const hairSvcs = [svc.menCut, svc.womenCut, svc.kidsCut, svc.beard, svc.blowdry, svc.ironing, svc.updo, svc.globalColor, svc.highlights, svc.rootTouch, svc.keratin, svc.hairSpa];
    const skinSvcs = [svc.goldFacial, svc.hydraFacial, svc.cleanup, svc.fullWax, svc.underarm, svc.mani, svc.gelMani, svc.pedi, svc.bodySpa, svc.partyMakeup, svc.bridal];

    // ---- employees & users ------------------------------------------------------------------------
    const E = (branch, name, role, designation, dept, salary_type, extra, services = []) => {
      const id = insert('employees', { branch_id: branch, name, role, designation, department: dept, salary_type, phone: `98${int(10000000, 99999999)}`, email: `${name.split(' ')[0].toLowerCase()}@lumiere.example`, joining_date: addDays(T, -int(200, 900)), work_start: '10:00', work_end: '19:00', weekly_off: int(1, 4), address: 'Bengaluru', ...extra });
      for (const sv of services) run('INSERT INTO employee_services (employee_id, service_id) VALUES (?,?)', id, sv);
      return id;
    };
    const emps = {
      manager: E(b1, 'Priya Nair', 'manager', 'Salon Manager', 'Operations', 'fixed_monthly', { base_salary: 35000, weekly_off: null }),
      reception: E(b1, 'Ananya Sharma', 'receptionist', 'Front Desk Executive', 'Front Office', 'fixed_monthly', { base_salary: 16000, work_start: '09:30', work_end: '18:30' }),
      accountant: E(b1, 'Rakesh Iyer', 'accountant', 'Accountant', 'Finance', 'fixed_monthly', { base_salary: 25000, weekly_off: 0 }),
      arjun: E(b1, 'Arjun Mehta', 'hair_stylist', 'Senior Hair Stylist', 'Hair', 'fixed_plus_commission', { base_salary: 22000, service_commission_pct: 10, product_commission_pct: 5 }, hairSvcs),
      sneha: E(b1, 'Sneha Reddy', 'hair_stylist', 'Colour Specialist', 'Hair', 'fixed_plus_commission', { base_salary: 20000, service_commission_pct: 10, product_commission_pct: 5 }, hairSvcs),
      kavya: E(b1, 'Kavya Pillai', 'beautician', 'Senior Beautician', 'Skin & Beauty', 'fixed_plus_commission', { base_salary: 18000, service_commission_pct: 8, product_commission_pct: 5 }, skinSvcs),
      meera: E(b1, 'Meera Joshi', 'beautician', 'Beautician', 'Skin & Beauty', 'commission', { service_commission_pct: 35, product_commission_pct: 10 }, skinSvcs),
      ravi: E(b1, 'Ravi Kumar', 'assistant', 'Junior Stylist', 'Hair', 'daily', { daily_rate: 700, work_start: '11:00', work_end: '20:00' }, [svc.menCut, svc.kidsCut, svc.beard, svc.blowdry, svc.hairSpa]),
      vikram: E(b2, 'Vikram Singh', 'hair_stylist', 'Hair Stylist', 'Hair', 'fixed_plus_commission', { base_salary: 18000, service_commission_pct: 10, product_commission_pct: 5 }, hairSvcs),
      divya: E(b2, 'Divya Menon', 'beautician', 'Beautician', 'Skin & Beauty', 'fixed_plus_commission', { base_salary: 17000, service_commission_pct: 8 }, skinSvcs),
      farhan: E(b2, 'Farhan Ali', 'hair_stylist', 'Barber', 'Hair', 'hourly', { hourly_rate: 120 }, [svc.menCut, svc.kidsCut, svc.beard, svc.hairSpa]),
      pooja: E(b2, 'Pooja Desai', 'receptionist', 'Front Desk Executive', 'Front Office', 'fixed_monthly', { base_salary: 15000 }),
    };
    const staffPw = hashPassword(DEMO_STAFF_PASSWORD);
    insert('users', { name: ownerName, email, password_hash: hashPassword(password), role: 'owner' });
    insert('users', { name: 'Priya Nair', email: 'manager@demo.salon', password_hash: staffPw, role: 'manager', employee_id: emps.manager });
    insert('users', { name: 'Ananya Sharma', email: 'reception@demo.salon', password_hash: staffPw, role: 'receptionist', employee_id: emps.reception, branch_id: b1 });
    insert('users', { name: 'Rakesh Iyer', email: 'accounts@demo.salon', password_hash: staffPw, role: 'accountant', employee_id: emps.accountant });
    insert('users', { name: 'Arjun Mehta', email: 'stylist@demo.salon', password_hash: staffPw, role: 'employee', employee_id: emps.arjun, branch_id: b1 });

    // ---- suppliers & products -----------------------------------------------------------------------
    const sup1 = insert('suppliers', { name: "L'Oréal Professional Distributor", contact_person: 'Sanjay Rao', phone: '9845011111', email: 'orders@lorealdist.example', gstin: '29AAACL1234M1Z2', address: 'Peenya, Bengaluru' });
    const sup2 = insert('suppliers', { name: 'Beauty Wholesale Co.', contact_person: 'Nisha Kapoor', phone: '9845022222', email: 'sales@bwc.example', address: 'Chickpet, Bengaluru' });
    const sup3 = insert('suppliers', { name: 'SpaCare Supplies', contact_person: 'Imran Khan', phone: '9845033333', address: 'HSR Layout, Bengaluru' });
    const P = (branch, name, category, brand, pp, sp, stock, min, supplier, expiryDays) => {
      const id = insert('products', { branch_id: branch, name, category, brand, sku: `${brand.slice(0, 3).toUpperCase()}-${int(1000, 9999)}`, barcode: `890${int(1000000000, 9999999999)}`, purchase_price: pp, selling_price: sp, stock, min_stock: min, supplier_id: supplier, purchase_date: addDays(T, -int(20, 90)), expiry_date: expiryDays ? addDays(T, expiryDays) : null });
      insert('stock_movements', { product_id: id, branch_id: branch, type: 'opening', qty: stock, unit_cost: pp, reason: 'Opening stock', supplier_id: supplier, balance_after: stock });
      return id;
    };
    const productDefs = [
      ['Absolut Repair Shampoo 300ml', 'Hair Care', "L'Oréal", 520, 850, sup1, 540], ['Absolut Repair Conditioner 200ml', 'Hair Care', "L'Oréal", 480, 790, sup1, 540],
      ['Hair Serum 100ml', 'Hair Care', 'Moroccanoil', 1450, 2400, sup2, 700], ['Argan Oil Hair Mask 250g', 'Hair Care', 'Moroccanoil', 1100, 1850, sup2, 600],
      ['Heat Protect Spray 150ml', 'Styling', 'Schwarzkopf', 450, 750, sup2, 500], ['Matte Hair Wax 75g', 'Styling', 'Schwarzkopf', 280, 499, sup2, 720],
      ['Vitamin C Face Serum 30ml', 'Skin Care', 'Lotus Professional', 380, 695, sup3, 400], ['Sunscreen SPF 50 100ml', 'Skin Care', 'Lotus Professional', 290, 545, sup3, 365],
      ['Gold Facial Kit', 'Skin Care', 'VLCC', 420, 750, sup3, 300], ['Nail Polish – Ruby Red', 'Nails', 'O.P.I', 350, 650, sup2, 900],
      ['Cuticle Oil 15ml', 'Nails', 'O.P.I', 300, 550, sup2, 900], ['Beard Oil 30ml', "Men's Grooming", 'Beardo', 210, 399, sup2, 540],
      ['Keratin Aftercare Shampoo', 'Hair Care', 'GK Hair', 900, 1600, sup1, 700], ['Hair Colour Tube – Majirel', 'Salon Use', "L'Oréal", 310, 0, sup1, 720],
    ];
    const products = { [b1]: [], [b2]: [] };
    for (const d of productDefs) {
      products[b1].push(P(b1, d[0], d[1], d[2], d[3], d[4], int(6, 30), 5, d[5], d[6]));
      if (chance(0.6)) products[b2].push(P(b2, d[0], d[1], d[2], d[3], d[4], int(4, 18), 4, d[5], d[6]));
    }
    const sellable = { [b1]: products[b1].filter((id) => get('SELECT selling_price FROM products WHERE id=?', id).selling_price > 0), [b2]: products[b2].filter((id) => get('SELECT selling_price FROM products WHERE id=?', id).selling_price > 0) };

    // ---- packages & coupons ----------------------------------------------------------------------------
    const pk = (name, type, price, validity, discount, desc, items) => { const id = insert('packages', { name, type, price, validity_days: validity, discount_pct: discount, description: desc }); for (const [sid, c] of items) insert('package_items', { package_id: id, service_id: sid, credits: c }); return id; };
    const pkgs = [
      pk('Monthly Glow Membership', 'monthly', 1999, 30, 10, '10% off all services + 1 express cleanup', [[svc.cleanup, 1]]),
      pk('Hair Spa Pack (4 sessions)', 'prepaid', 3999, 90, 0, 'Four hair spa sessions at a saving of ₹800', [[svc.hairSpa, 4]]),
      pk('Quarterly Grooming Plan', 'quarterly', 2499, 90, 5, '6 haircuts + 3 beard trims for men', [[svc.menCut, 6], [svc.beard, 3]]),
      pk('Gold Annual Membership', 'annual', 9999, 365, 15, '15% off everything, 2 facials and 2 pedicures', [[svc.goldFacial, 2], [svc.pedi, 2]]),
    ];
    insert('coupons', { code: 'WELCOME10', description: '10% off on first visit', discount_type: 'percent', value: 10, min_invoice: 500, max_discount: 500, per_customer_limit: 1, valid_from: addDays(T, -120), valid_to: addDays(T, 120) });
    insert('coupons', { code: 'FESTIVE500', description: '₹500 off on bills above ₹3,000', discount_type: 'fixed', value: 500, min_invoice: 3000, usage_limit: 200, valid_from: addDays(T, -60), valid_to: addDays(T, 30) });
    insert('coupons', { code: 'SPA20', description: '20% off hair spa', discount_type: 'percent', value: 20, applies_to: 'service', service_id: svc.hairSpa, valid_to: addDays(T, 60) });
    insert('coupons', { code: 'PRODUCT15', description: '15% off retail products', discount_type: 'percent', value: 15, applies_to: 'products', valid_to: addDays(T, 45) });

    // ---- customers ----------------------------------------------------------------------------------------
    const first = ['Aditi', 'Rohan', 'Ishita', 'Karan', 'Nisha', 'Siddharth', 'Tanvi', 'Aman', 'Riya', 'Varun', 'Neha', 'Kabir', 'Shreya', 'Aarav', 'Pallavi', 'Nikhil', 'Sanya', 'Harsh', 'Diya', 'Manish', 'Swati', 'Yash', 'Ira', 'Gaurav', 'Lavanya', 'Deepak', 'Anjali', 'Rahul', 'Kriti', 'Suresh', 'Megha', 'Vivek', 'Bhavna', 'Arnav', 'Simran', 'Tarun', 'Pooja', 'Abhishek', 'Zoya', 'Naveen'];
    const last = ['Gupta', 'Rao', 'Verma', 'Patel', 'Kulkarni', 'Banerjee', 'Shetty', 'Agarwal', 'Bhat', 'Chopra', 'Hegde', 'Saxena', 'Naidu', 'Malhotra', 'Krishnan'];
    const female = new Set(['Aditi', 'Ishita', 'Nisha', 'Tanvi', 'Riya', 'Neha', 'Shreya', 'Pallavi', 'Sanya', 'Diya', 'Swati', 'Ira', 'Lavanya', 'Anjali', 'Kriti', 'Megha', 'Bhavna', 'Simran', 'Pooja', 'Zoya']);
    const customers = [];
    for (let i = 0; i < 420; i++) {
      const fn = pick(first), name = `${fn} ${pick(last)}`;
      const created = addDays(T, -Math.floor(Math.pow(rnd(), 0.7) * 175));
      const bday = i === 3 ? `1994-${T.slice(5)}` : `19${int(75, 99)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`;
      const id = insert('customers', { name, phone: `9${int(100000000, 999999999)}`, email: chance(0.6) ? `${fn.toLowerCase()}${i}@mail.example` : null, gender: female.has(fn) ? 'female' : 'male', birthday: chance(0.7) ? bday : null, branch_id: chance(0.7) ? b1 : b2, source: pick(['walk_in', 'walk_in', 'phone', 'online', 'qr', 'referral']), notes: chance(0.15) ? pick(['Prefers ammonia-free colour', 'Sensitive skin – patch test first', 'Likes quiet service', 'Allergic to fragrance']) : null });
      run('UPDATE customers SET created_at=? WHERE id=?', `${created} 11:00:00`, id);
      customers.push({ id, female: female.has(fn), created, branch: chance(0.75) ? b1 : b2, loyalty: rnd() });
    }

    // ---- appointments, invoices, attendance (history + upcoming) ------------------------------------------
    const branchEmps = (b) => all(`SELECT * FROM employees WHERE branch_id=? AND status='active' AND id IN (SELECT employee_id FROM employee_services)`, b);
    const empSvcs = Object.fromEntries(all('SELECT employee_id, GROUP_CONCAT(service_id) s FROM employee_services GROUP BY employee_id').map((r) => [r.employee_id, r.s.split(',').map(Number)]));
    const DAYS = 175;
    for (let back = DAYS; back >= -7; back--) {
      const date = addDays(T, -back);
      const wd = parseDate(date).getDay();
      for (const b of [b1, b2]) {
        for (const e of branchEmps(b)) {
          if (Number(e.weekly_off) === wd) continue;
          if (back > 0 && chance(0.04)) continue; // occasional absence
          const shiftStart = toMin(e.work_start), shiftEnd = toMin(e.work_end);
          let cursor = shiftStart + int(0, 4) * 15;
          const busy = (wd === 0 || wd === 6) ? 0.6 : 0.38;
          while (cursor < shiftEnd - 30) {
            if (!chance(busy)) { cursor += int(2, 4) * 15; continue; }
            const options = empSvcs[e.id];
            const pool = customers.filter((c) => c.created <= date && (c.branch === b || chance(0.1)));
            if (!pool.length) break;
            const cust = pick(pool);
            const sids = [pick(options)];
            if (chance(0.25)) { const extra = pick(options); if (!sids.includes(extra)) sids.push(extra); }
            const dur = sids.reduce((a, sid) => a + get('SELECT duration_min FROM services WHERE id=?', sid).duration_min, 0);
            if (cursor + dur > shiftEnd) break;
            const start = `${date}T${fromMin(cursor)}`;
            const future = back < 0 || (back === 0 && cursor > toMin('13:00'));
            const source = future ? pick(['manual', 'phone', 'online', 'qr', 'qr']) : pick(['manual', 'walk_in', 'walk_in', 'phone', 'online', 'qr']);
            const roll = rnd();
            let status = future ? (chance(0.6) ? 'confirmed' : 'pending') : roll < 0.06 ? 'cancelled' : roll < 0.1 ? 'no_show' : 'completed';
            const apptId = createAppointment({ branchId: b, customerId: cust.id, employeeId: e.id, serviceIds: sids, start, source, status: status === 'completed' ? 'checked_in' : status, notes: null });
            const bookedOn = addDays(date, -int(0, 3));
            run('UPDATE appointments SET created_at=? WHERE id=?', `${bookedOn < T ? bookedOn : T} 09:${String(int(10, 59))}:00`, apptId);
            if (status === 'cancelled') run(`UPDATE appointments SET cancel_reason=? WHERE id=?`, pick(['Customer rescheduled', 'Not feeling well', 'Travel plans changed']), apptId);
            if (status === 'completed') {
              const items = sids.map((sid) => ({ type: 'service', ref_id: sid, qty: 1, employee_id: e.id }));
              if (chance(0.25) && sellable[b].length) { const pid = pick(sellable[b]); if (get('SELECT stock FROM products WHERE id=?', pid).stock > 2) items.push({ type: 'product', ref_id: pid, qty: 1, employee_id: e.id }); }
              if (chance(0.02)) items.push({ type: 'package', ref_id: pick(pkgs), qty: 1, employee_id: null });
              let coupon = null;
              if (chance(0.08)) coupon = pick(['WELCOME10', 'FESTIVE500', 'PRODUCT15']);
              const priceInput = { branchId: b, customerId: cust.id, appointmentId: apptId, items, date, payments: [], discount: chance(0.1) ? { type: 'percent', value: 10 } : null };
              let invId;
              try { invId = createInvoice({ ...priceInput, couponCode: coupon }, null); }
              catch { invId = createInvoice(priceInput, null); }
              const inv = get('SELECT total FROM invoices WHERE id=?', invId);
              const payRoll = rnd();
              const amount = back <= 3 && payRoll < 0.15 ? 0 : payRoll < 0.04 && back <= 25 ? money(inv.total * 0.5) : inv.total;
              if (amount > 0) {
                const method = pick(['upi', 'upi', 'upi', 'cash', 'cash', 'card', 'bank_transfer']);
                run('INSERT INTO payments (invoice_id, amount, method, paid_at) VALUES (?,?,?,?)', invId, amount, method, `${date}T${fromMin(Math.min(cursor + dur, 1380))}`);
                const bal = money(inv.total - amount);
                run('UPDATE invoices SET paid_amount=?, balance=?, status=?, created_at=? WHERE id=?', amount, bal, bal > 0 ? 'partial' : 'paid', `${date} ${fromMin(Math.min(cursor + dur, 1380))}:00`, invId);
                if (bal <= 0) {
                  run(`UPDATE customer_packages SET status='active' WHERE invoice_id=?`, invId);
                  const pts = Math.floor(inv.total / 100);
                  run('UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id=?', pts, cust.id);
                  run('UPDATE invoices SET loyalty_earned=? WHERE id=?', pts, invId);
                }
              }
              if (chance(0.15)) insert('feedback', { customer_id: cust.id, appointment_id: apptId, employee_id: e.id, rating: pick([5, 5, 5, 4, 4, 4, 3]), comment: pick(['Loved the service!', 'Great experience as always', 'Very professional', 'Good but had to wait a bit', 'Amazing results, thank you', null]) });
            }
            cursor += dur + int(0, 2) * 15;
          }
        }
      }
      // attendance for past/today
      if (back >= 0) {
        for (const e of all(`SELECT * FROM employees WHERE status='active'`)) {
          if (Number(e.weekly_off) === wd) continue;
          if (back === 0 && chance(0.2)) continue; // not yet checked in today
          const r = rnd();
          if (r < 0.03) { insert('attendance', { employee_id: e.id, date, status: 'absent' }); continue; }
          const ci = fromMin(toMin(e.work_start) + int(-10, r < 0.15 ? 40 : 12));
          const co = back === 0 ? null : fromMin(toMin(e.work_end) + int(r < 0.08 ? -300 : -20, 60));
          insert('attendance', { employee_id: e.id, date, check_in: ci, check_out: co, ...computeAttendance(e, ci, co, 'present') });
        }
      }
    }
    // a few approved leaves & holidays
    insert('leaves', { employee_id: emps.sneha, from_date: addDays(T, 3), to_date: addDays(T, 4), leave_type: 'paid', reason: 'Family function', status: 'approved' });
    insert('leaves', { employee_id: emps.ravi, from_date: addDays(T, 1), to_date: addDays(T, 1), leave_type: 'sick', reason: 'Fever', status: 'pending' });
    insert('holidays', { date: `${T.slice(0, 4)}-08-15`, name: 'Independence Day' });
    insert('holidays', { date: `${T.slice(0, 4)}-10-02`, name: 'Gandhi Jayanti' });

    // ---- expenses ---------------------------------------------------------------------------------------------
    for (let m = 6; m >= 0; m--) {
      const monthStart = `${addDays(T, -30 * m).slice(0, 7)}-01`;
      if (monthStart > T) continue;
      const d = (day) => { const x = `${monthStart.slice(0, 8)}${String(day).padStart(2, '0')}`; return x <= T ? x : null; };
      for (const [b, rent] of [[b1, 85000], [b2, 60000]]) {
        const E2 = (day, category, amount, desc, method = 'bank_transfer') => { const dt = d(day); if (dt) insert('expenses', { branch_id: b, category, amount, date: dt, payment_method: method, description: desc }); };
        E2(1, 'Rent', rent, 'Monthly shop rent');
        E2(7, 'Electricity', int(9000, 15000), 'BESCOM bill');
        E2(8, 'Water', int(800, 1500), 'BWSSB bill', 'upi');
        E2(10, 'Internet', 1499, 'Fibre broadband', 'upi');
        E2(int(11, 25), 'Marketing', int(3000, 12000), pick(['Instagram ads', 'Google ads', 'Flyers and banners']), 'card');
        if (chance(0.5)) E2(int(5, 25), 'Maintenance', int(1500, 6000), pick(['AC servicing', 'Chair repair', 'Plumbing']), 'cash');
        E2(int(12, 20), 'Product purchases', int(15000, 30000), 'Salon-use consumables', 'bank_transfer');
        if (chance(0.25)) E2(int(5, 25), 'Equipment', int(4000, 18000), pick(['New hair dryer', 'Steamer', 'Trolley']), 'card');
        E2(int(3, 27), 'Miscellaneous', int(500, 2500), pick(['Tea & snacks', 'Cleaning supplies', 'Courier']), 'cash');
      }
    }
    // recurring templates for upcoming months
    const nextMonth = addDays(`${T.slice(0, 7)}-28`, 4).slice(0, 7);
    insert('expenses', { branch_id: b1, category: 'Rent', amount: 85000, date: `${T.slice(0, 7)}-01`, payment_method: 'bank_transfer', description: 'Monthly shop rent (auto)', is_recurring: 1, recurrence: 'monthly', next_due: `${nextMonth}-01` });
    run(`DELETE FROM expenses WHERE branch_id=? AND category='Rent' AND date=? AND is_recurring=0`, b1, `${T.slice(0, 7)}-01`);
    const lastMonth = addDays(`${T.slice(0, 7)}-01`, -1).slice(0, 7);
    insert('expenses', { branch_id: b1, category: 'Internet', amount: 1499, date: `${lastMonth}-10`, payment_method: 'upi', description: 'Fibre broadband (auto)', is_recurring: 1, recurrence: 'monthly', next_due: `${T.slice(0, 7)}-10` });
    run(`DELETE FROM expenses WHERE branch_id=? AND category='Internet' AND date=? AND is_recurring=0`, b1, `${lastMonth}-10`);

    // ---- payroll for the last two months (paid) ---------------------------------------------------------------
    const firstMonth = addDays(T, -DAYS).slice(0, 7);
    for (let back = 6; back >= 1; back--) {
      const month = addDays(`${T.slice(0, 7)}-15`, -30 * back).slice(0, 7);
      if (month < firstMonth) continue;
      for (const e of all(`SELECT * FROM employees WHERE status='active'`)) {
        const calc = computePayroll(e, month, { incentives: chance(0.3) ? int(5, 20) * 100 : 0 });
        let paidAt = `${addDays(`${month}-28`, 6).slice(0, 7)}-0${int(1, 5)}`;
        if (paidAt > T) paidAt = T;
        const paid = back > 1 || e.id % 3 !== 0;
        const pid = insert('payroll', { ...calc, status: paid ? 'paid' : 'pending', paid_at: paid ? paidAt : null, payment_method: paid ? 'bank_transfer' : null });
        if (paid) insert('expenses', { branch_id: e.branch_id, category: 'Employee salaries', amount: calc.net_payable, date: paidAt <= T ? paidAt : T, payment_method: 'bank_transfer', description: `Salary ${month} — ${e.name}`, payroll_id: pid });
      }
    }
    // restock most low products through a supplier purchase
    for (const p of all('SELECT * FROM products WHERE stock <= min_stock')) {
      if (!chance(0.75)) continue;
      const qty = int(10, 20), bal = p.stock + qty, dt = addDays(T, -int(1, 10));
      run('UPDATE products SET stock=?, purchase_date=? WHERE id=?', bal, dt, p.id);
      run(`INSERT INTO stock_movements (product_id, branch_id, type, qty, unit_cost, reason, supplier_id, balance_after, created_at) VALUES (?,?,?,?,?,?,?,?,?)`, p.id, p.branch_id, 'purchase', qty, p.purchase_price, 'Restock order', p.supplier_id, bal, `${dt} 11:00:00`);
    }
    insert('salary_advances', { employee_id: emps.ravi, amount: 2000, date: addDays(T, -5), note: 'Medical emergency' });

    // ---- QR booking analytics ----------------------------------------------------------------------------------
    for (let back = DAYS; back >= 0; back--) {
      const day = addDays(T, -back);
      const booked = get(`SELECT COUNT(*) n FROM appointments WHERE source IN ('online','qr') AND substr(created_at,1,10)=?`, day).n;
      const visits = booked + int(3, 12), scans = Math.round(visits * (0.45 + rnd() * 0.2));
      for (let i = 0; i < scans; i++) run(`INSERT INTO booking_events (type, visitor, created_at) VALUES ('scan', ?, ?)`, `seed${back}-${i}`, `${day} 12:00:00`);
      for (let i = 0; i < visits; i++) run(`INSERT INTO booking_events (type, visitor, created_at) VALUES ('visit', ?, ?)`, `seedv${back}-${i}`, `${day} 12:00:00`);
    }
    for (const a of all(`SELECT id, created_at FROM appointments WHERE source IN ('online','qr')`)) run(`INSERT INTO booking_events (type, appointment_id, created_at) VALUES ('booking', ?, ?)`, a.id, a.created_at);
  });
  runNotificationJobs();
  return { email, password, staffPassword: DEMO_STAFF_PASSWORD };
}

/** CLI: `npm run seed` wipes the database and loads demo data. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tables = all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).map((t) => t.name);
  db.exec('PRAGMA foreign_keys=OFF');
  for (const t of tables) db.exec(`DELETE FROM ${t}`);
  db.exec('PRAGMA foreign_keys=ON');
  const t0 = Date.now();
  const r = seedDemo({});
  console.log(`Demo data loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`Owner login:  ${r.email} / ${r.password}`);
  console.log(`Staff logins: manager@demo.salon, reception@demo.salon, accounts@demo.salon, stylist@demo.salon / ${r.staffPassword}`);
}
