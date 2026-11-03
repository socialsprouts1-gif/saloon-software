// Export helpers: CSV, Excel (.xlsx) and PDF tables. Heavy libraries load on demand.
const save = (blob, filename) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
export const downloadBlob = save;

/** columns: [{ key, label, format? }] */
const cell = (row, c) => { const v = typeof c.key === 'function' ? c.key(row) : row[c.key]; return c.format ? c.format(v, row) : v ?? ''; };

export function exportCSV(filename, columns, rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(cell(r, c))).join(','))].join('\n');
  save(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`);
}

/** sheets: [{ name, columns, rows }] */
export async function exportXLSX(filename, sheets) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const data = [s.columns.map((c) => c.label), ...s.rows.map((r) => s.columns.map((c) => { const v = typeof c.key === 'function' ? c.key(r) : r[c.key]; return c.raw ? c.raw(v, r) : v ?? ''; }))];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = s.columns.map((c) => ({ wch: Math.max(12, String(c.label).length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/** sections: [{ title, columns, rows, summary?: [[label, value]] }] */
export async function exportPDF(filename, title, subtitle, sections, salonName) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(109, 42, 82); doc.rect(0, 0, W, 64, 'F');
  doc.setTextColor(255); doc.setFontSize(16); doc.text(title, 40, 34);
  doc.setFontSize(9.5); doc.text([salonName || '', subtitle || ''].filter(Boolean).join('  ·  '), 40, 50);
  doc.setTextColor(40);
  let y = 90;
  for (const s of sections) {
    if (y > 720) { doc.addPage(); y = 50; }
    if (s.title) { doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.text(s.title, 40, y); doc.setFont(undefined, 'normal'); y += 8; }
    if (s.summary) {
      autoTable(doc, { startY: y + 4, body: s.summary.map(([a, b]) => [a, pdfSafe(b)]), theme: 'plain', styles: { fontSize: 10, cellPadding: 3 }, columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } }, margin: { left: 40, right: 40 } });
      y = doc.lastAutoTable.finalY + 14;
    }
    if (s.columns && s.rows) {
      autoTable(doc, {
        startY: y + 4, head: [s.columns.map((c) => c.label)], body: s.rows.map((r) => s.columns.map((c) => pdfSafe(cell(r, c)))),
        styles: { fontSize: 8.5, cellPadding: 4 }, headStyles: { fillColor: [109, 42, 82] }, alternateRowStyles: { fillColor: [249, 245, 242] },
        columnStyles: Object.fromEntries(s.columns.map((c, i) => [i, c.align === 'right' ? { halign: 'right' } : {}])), margin: { left: 40, right: 40 },
      });
      y = doc.lastAutoTable.finalY + 22;
    }
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(150); doc.text(`Generated ${new Date().toLocaleString('en-IN')} · Page ${i}/${pages}`, 40, doc.internal.pageSize.getHeight() - 20); }
  doc.save(`${filename}.pdf`);
}
// Core PDF fonts lack the ₹ glyph; use "Rs." in PDFs
export const pdfSafe = (v) => String(v ?? '').replace(/₹/g, 'Rs.').replace(/[–—]/g, '-').replace(/[^\x00-\xFF]/g, '');
