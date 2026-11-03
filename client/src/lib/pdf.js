import { pdfSafe } from './export.js';
import { fmtDate, titleCase, payLabel, monthLabel } from './format.js';

const rs = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function loadImage(url) {
  if (!url) return null;
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob); });
  } catch { return null; }
}

/** Professional A4 tax invoice */
export async function invoicePDF(inv, salon, tax, invoiceSettings) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(109, 42, 82); doc.rect(0, 0, W, 8, 'F');
  const logo = await loadImage(salon.logo);
  let x = 40;
  if (logo) { try { doc.addImage(logo, 40, 30, 48, 48); x = 98; } catch { /* unsupported image */ } }
  doc.setFontSize(18); doc.setFont(undefined, 'bold'); doc.text(pdfSafe(salon.name), x, 50);
  doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.setTextColor(90);
  const addr = [inv.branch_name ? `${inv.branch_name} branch` : '', inv.branch_address || salon.address, [salon.phone, salon.email].filter(Boolean).join(' · '), tax?.gstin && invoiceSettings?.show_gstin ? `GSTIN: ${tax.gstin}` : ''].filter(Boolean);
  doc.text(addr.map(pdfSafe), x, 64);
  doc.setTextColor(30); doc.setFontSize(20); doc.setFont(undefined, 'bold');
  doc.text(tax?.enabled && inv.tax_amount > 0 ? 'TAX INVOICE' : 'INVOICE', W - 40, 50, { align: 'right' });
  doc.setFontSize(9.5); doc.setFont(undefined, 'normal');
  doc.text([`Invoice # ${inv.invoice_no}`, `Date: ${fmtDate(inv.date)}`, `Status: ${titleCase(inv.status)}`], W - 40, 66, { align: 'right' });
  let y = 120;
  doc.setDrawColor(230); doc.line(40, y - 14, W - 40, y - 14);
  doc.setFontSize(9); doc.setTextColor(120); doc.text('BILLED TO', 40, y); doc.setTextColor(30); doc.setFontSize(11);
  doc.text(pdfSafe(inv.customer_name || 'Walk-in customer'), 40, y + 15);
  doc.setFontSize(9); doc.setTextColor(90); if (inv.customer_phone) doc.text(inv.customer_phone, 40, y + 28);
  autoTable(doc, {
    startY: y + 44, head: [['#', 'Item', 'Staff', 'Qty', 'Rate', 'Disc.', 'Amount']],
    body: inv.items.map((it, i) => [i + 1, pdfSafe(it.name), pdfSafe(it.employee_name || '-'), it.qty, rs(it.unit_price), it.discount ? rs(it.discount) : '-', rs(it.total)]),
    styles: { fontSize: 9, cellPadding: 6 }, headStyles: { fillColor: [43, 20, 36] },
    columnStyles: { 0: { cellWidth: 24 }, 3: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } }, margin: { left: 40, right: 40 },
  });
  y = doc.lastAutoTable.finalY + 14;
  const rows = [['Subtotal', rs(inv.subtotal)]];
  if (inv.item_discount) rows.push(['Item discounts', `- ${rs(inv.item_discount)}`]);
  if (inv.membership_discount) rows.push(['Membership discount', `- ${rs(inv.membership_discount)}`]);
  if (inv.discount_amount) rows.push(['Discount', `- ${rs(inv.discount_amount)}`]);
  if (inv.coupon_discount) rows.push([`Coupon ${inv.coupon_code || ''}`, `- ${rs(inv.coupon_discount)}`]);
  if (inv.loyalty_redeemed) rows.push([`Loyalty points (${inv.loyalty_redeemed})`, `- ${rs(inv.loyalty_value)}`]);
  if (inv.tax_amount) {
    rows.push(['Taxable value', rs(inv.taxable_amount)]);
    rows.push([`CGST @ ${inv.tax_rate / 2}%`, rs(inv.tax_amount / 2)]);
    rows.push([`SGST @ ${inv.tax_rate / 2}%`, rs(inv.tax_amount / 2)]);
  }
  rows.push(['TOTAL', rs(inv.total)], ['Paid', rs(inv.paid_amount)]);
  if (inv.balance > 0) rows.push(['Balance due', rs(inv.balance)]);
  autoTable(doc, { startY: y, body: rows, theme: 'plain', styles: { fontSize: 9.5, cellPadding: 3 }, margin: { left: W - 300, right: 40 }, columnStyles: { 1: { halign: 'right' } },
    didParseCell: (d) => { if (['TOTAL', 'Balance due'].includes(d.row.raw[0])) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 11; } } });
  y = doc.lastAutoTable.finalY + 18;
  if (inv.payments?.length) {
    doc.setFontSize(9); doc.setTextColor(120); doc.text('PAYMENTS', 40, y); doc.setTextColor(40);
    inv.payments.forEach((p, i) => doc.text(`${fmtDate(p.paid_at.slice(0, 10))} · ${payLabel(p.method)}${p.reference ? ` (${pdfSafe(p.reference)})` : ''} · ${rs(p.amount)}`, 40, y + 14 + i * 13));
    y += 20 + inv.payments.length * 13;
  }
  doc.setFontSize(10); doc.setTextColor(109, 42, 82);
  if (invoiceSettings?.footer) doc.text(pdfSafe(invoiceSettings.footer), W / 2, Math.max(y + 20, 760), { align: 'center' });
  if (invoiceSettings?.terms) { doc.setFontSize(8); doc.setTextColor(130); doc.text(doc.splitTextToSize(pdfSafe(invoiceSettings.terms), W - 80), 40, Math.max(y + 40, 778)); }
  doc.save(`${inv.invoice_no}.pdf`);
}

/** Employee salary slip */
export async function salarySlipPDF(row, emp, salon) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(109, 42, 82); doc.rect(0, 0, W, 70, 'F');
  doc.setTextColor(255); doc.setFontSize(17); doc.text(pdfSafe(salon.name), 40, 34);
  doc.setFontSize(10); doc.text(`Salary slip — ${monthLabel(row.month)}`, 40, 52);
  doc.setTextColor(30);
  autoTable(doc, { startY: 90, theme: 'plain', styles: { fontSize: 10, cellPadding: 3 },
    body: [['Employee', pdfSafe(emp.name), 'Designation', pdfSafe(emp.designation || '-')], ['Salary type', titleCase(row.salary_type), 'Status', titleCase(row.status)],
      ['Working days', row.working_days, 'Present days', row.present_days], ['Absent / unpaid', row.absent_days, 'Leave days', row.leave_days],
      ['Hours worked', row.worked_hours, 'Overtime hours', row.overtime_hours]], margin: { left: 40, right: 40 } });
  const y = doc.lastAutoTable.finalY + 16;
  const earn = [['Base salary (earned)', rs(row.earned_base)], ['Overtime', rs(row.overtime_pay)], ['Service commission', rs(row.service_commission)], ['Product commission', rs(row.product_commission)], ['Incentives', rs(row.incentives)], ['Bonus', rs(row.bonus)]];
  const ded = [['Deductions', rs(row.deductions)], ['Salary advance recovered', rs(row.advance)]];
  autoTable(doc, { startY: y, head: [['Earnings', 'Amount']], body: earn, margin: { left: 40, right: W / 2 + 6 }, headStyles: { fillColor: [47, 125, 91] }, columnStyles: { 1: { halign: 'right' } }, styles: { fontSize: 9.5 } });
  autoTable(doc, { startY: y, head: [['Deductions', 'Amount']], body: ded, margin: { left: W / 2 + 6, right: 40 }, headStyles: { fillColor: [180, 54, 61] }, columnStyles: { 1: { halign: 'right' } }, styles: { fontSize: 9.5 } });
  const y2 = Math.max(doc.lastAutoTable.finalY, y + 160) + 20;
  doc.setFillColor(243, 230, 238); doc.roundedRect(40, y2, W - 80, 46, 6, 6, 'F');
  doc.setFontSize(12); doc.text('Net payable', 56, y2 + 28); doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.text(rs(row.net_payable), W - 56, y2 + 29, { align: 'right' });
  doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.setTextColor(110);
  if (row.status === 'paid') doc.text(`Paid on ${fmtDate(row.paid_at)} via ${payLabel(row.payment_method)}`, 40, y2 + 70);
  doc.text('This is a computer-generated salary slip.', 40, y2 + 86);
  doc.save(`salary-slip-${emp.name.replace(/\s+/g, '-')}-${row.month}.pdf`);
}
