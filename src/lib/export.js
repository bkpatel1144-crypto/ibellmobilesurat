import { moneyPdf, plain, fmtDate, amountInWords, num } from './format';

const SHOP_DEFAULT = 'IBELL MOBILE';

const blank = (v) => v === '' || v === null || v === undefined;

async function loadPdf() {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  return { jsPDF, autoTable };
}

const imgFormat = (dataUrl) => (dataUrl?.startsWith('data:image/png') ? 'PNG' : 'JPEG');

/** Letterhead used by every PDF. Returns the y position below it. */
function drawHeader(doc, settings, title, rightLines = []) {
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  let x = M;
  const top = 14;
  if (settings?.logo) {
    try {
      doc.addImage(settings.logo, imgFormat(settings.logo), M, top, 20, 20);
      x = M + 25;
    } catch {
      /* unreadable logo - skip it */
    }
  }
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(settings?.shopName || SHOP_DEFAULT, x, top + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(70);
  const info = [
    settings?.address,
    [settings?.phone && `Ph: ${settings.phone}`, settings?.email].filter(Boolean).join('  |  '),
    settings?.gstin && `GSTIN: ${settings.gstin}`,
  ].filter(Boolean);
  let y = top + 11;
  for (const line of info) {
    const wrapped = doc.splitTextToSize(line, W / 2 - 10);
    doc.text(wrapped, x, y);
    y += wrapped.length * 4;
  }

  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(title.toUpperCase(), W - M, top + 6, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let ry = top + 12;
  for (const l of rightLines) {
    doc.text(l, W - M, ry, { align: 'right' });
    ry += 4.6;
  }

  const lineY = Math.max(y, ry, top + 22) + 3;
  doc.setDrawColor(0);
  doc.setLineWidth(0.6);
  doc.line(M, lineY, W - M, lineY);
  return lineY + 6;
}

function drawFooter(doc, settings) {
  const pages = doc.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(`${settings?.shopName || SHOP_DEFAULT} · Generated ${new Date().toLocaleString('en-IN')}`, 14, H - 8);
    doc.text(`Page ${i} of ${pages}`, W - 14, H - 8, { align: 'right' });
  }
}

const tableTheme = {
  theme: 'grid',
  styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.2, textColor: 20, lineColor: 200, lineWidth: 0.2 },
  headStyles: { fillColor: [10, 10, 10], textColor: 255, fontStyle: 'bold', lineColor: [10, 10, 10] },
  footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
  alternateRowStyles: { fillColor: [248, 248, 248] },
  margin: { left: 14, right: 14 },
};

/**
 * Generic report PDF.
 * columns: [{ header, key, align?: 'right', money?: true }]
 */
export async function exportTablePdf({ settings, title, rightLines = [], meta = [], columns, rows, foot, summary = [], filename, landscape }) {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  let y = drawHeader(doc, settings, title, rightLines);

  if (meta.length) {
    doc.setFontSize(9);
    for (const [k, v] of meta) {
      doc.setFont('helvetica', 'bold');
      doc.text(`${k}:`, 14, y);
      doc.setFont('helvetica', 'normal');
      doc.text(String(v ?? ''), 50, y);
      y += 5;
    }
    y += 2;
  }

  const cell = (c, r) => (c.money ? (blank(r[c.key]) ? '' : plain(r[c.key])) : r[c.key] ?? '');
  autoTable(doc, {
    ...tableTheme,
    startY: y,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => cell(c, r))),
    foot: foot ? [columns.map((c) => cell(c, foot))] : undefined,
    showFoot: 'lastPage',
    columnStyles: Object.fromEntries(columns.map((c, i) => [i, c.align === 'right' || c.money ? { halign: 'right' } : {}])),
  });

  if (summary.length) {
    let sy = doc.lastAutoTable.finalY + 8;
    const W = doc.internal.pageSize.getWidth();
    if (sy > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      sy = 20;
    }
    doc.setFontSize(10);
    for (const [k, v] of summary) {
      doc.setFont('helvetica', 'normal');
      doc.text(k, W - 80, sy);
      doc.setFont('helvetica', 'bold');
      doc.text(String(v), W - 14, sy, { align: 'right' });
      sy += 6;
    }
  }

  drawFooter(doc, settings);
  doc.save(`${filename}.pdf`);
}

/** Generic report Excel (.xlsx) with a letterhead block, bold header row and number formats. */
export async function exportExcel({ settings, title, meta = [], columns, rows, foot, summary = [], filename, sheetName }) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = settings?.shopName || SHOP_DEFAULT;
  const ws = wb.addWorksheet((sheetName || title).slice(0, 31));
  const span = Math.max(columns.length, 2);

  const addMerged = (text, font) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, span);
    row.getCell(1).font = font;
    return row;
  };
  addMerged(settings?.shopName || SHOP_DEFAULT, { bold: true, size: 16 });
  const addr = [settings?.address, settings?.phone && `Ph: ${settings.phone}`, settings?.gstin && `GSTIN: ${settings.gstin}`]
    .filter(Boolean)
    .join('  |  ');
  if (addr) addMerged(addr, { size: 9, color: { argb: 'FF555555' } });
  addMerged(title, { bold: true, size: 13 });
  for (const [k, v] of meta) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true };
  }
  ws.addRow([]);

  const head = ws.addRow(columns.map((c) => c.header));
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A0A0A' } };
    c.border = { bottom: { style: 'thin' } };
    c.alignment = { vertical: 'middle' };
  });

  const val = (c, r) => (c.money ? (blank(r[c.key]) ? '' : num(r[c.key])) : r[c.key] ?? '');
  for (const r of rows) {
    const row = ws.addRow(columns.map((c) => val(c, r)));
    columns.forEach((c, i) => {
      if (c.money) row.getCell(i + 1).numFmt = '#,##0.00';
    });
  }
  if (foot) {
    const row = ws.addRow(columns.map((c) => val(c, foot)));
    row.eachCell((c, i) => {
      c.font = { bold: true };
      c.border = { top: { style: 'thin' } };
      if (columns[i - 1]?.money) c.numFmt = '#,##0.00';
    });
  }
  if (summary.length) {
    ws.addRow([]);
    for (const [k, v] of summary) {
      const r = ws.addRow([k, v]);
      r.getCell(1).font = { bold: true };
    }
  }

  columns.forEach((c, i) => {
    let w = c.header.length;
    for (const r of rows) w = Math.max(w, String(r[c.key] ?? '').length);
    ws.getColumn(i + 1).width = Math.min(Math.max(w + 2, 10), 50);
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ------------------------------------------------------------------ invoice */

export async function invoicePdf(sale, settings, { action = 'download' } = {}) {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  const title = num(sale.taxPercent) > 0 ? 'Tax Invoice' : 'Invoice';
  let y = drawHeader(doc, settings, title, [`No: ${sale.invoiceNo}`, `Date: ${fmtDate(sale.date)}`]);

  // bill to
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text('BILL TO', M, y);
  doc.setTextColor(0);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(sale.customerName || 'Walk-in Customer', M, y + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let by = y + 10.5;
  for (const l of [sale.customerPhone && `Ph: ${sale.customerPhone}`, sale.customerAddress].filter(Boolean)) {
    const w = doc.splitTextToSize(l, W / 2);
    doc.text(w, M, by);
    by += w.length * 4.3;
  }

  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text('PAYMENT', W - M, y, { align: 'right' });
  doc.setTextColor(0);
  doc.setFontSize(9);
  doc.text(sale.mode || 'Cash', W - M, y + 5.5, { align: 'right' });
  y = Math.max(by, y + 12) + 3;

  autoTable(doc, {
    ...tableTheme,
    startY: y,
    head: [['#', 'Device', 'IMEI / Serial', 'Condition', 'Warranty', 'Amount']],
    body: sale.items.map((it, i) => [
      i + 1,
      [it.brand, it.model, it.variant, it.color].filter(Boolean).join(' '),
      [it.imei, it.imei2, it.sn && `SN: ${it.sn}`].filter(Boolean).join('\n'),
      it.condition,
      it.warranty || '-',
      plain(it.price),
    ]),
    columnStyles: { 0: { cellWidth: 9 }, 5: { halign: 'right' } },
  });

  // totals
  let ty = doc.lastAutoTable.finalY + 6;
  if (ty > doc.internal.pageSize.getHeight() - 70) {
    doc.addPage();
    ty = 20;
  }
  const lines = [['Subtotal', moneyPdf(sale.subtotal)]];
  if (num(sale.discount)) lines.push(['Discount', `- ${moneyPdf(sale.discount)}`]);
  if (num(sale.tax)) lines.push([`GST (${sale.taxPercent}%)`, moneyPdf(sale.tax)]);
  doc.setFontSize(9.5);
  for (const [k, v] of lines) {
    doc.text(k, W - 80, ty);
    doc.text(v, W - M, ty, { align: 'right' });
    ty += 5.5;
  }
  doc.setLineWidth(0.4);
  doc.line(W - 80, ty - 2, W - M, ty - 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Total', W - 80, ty + 4);
  doc.text(moneyPdf(sale.total), W - M, ty + 4, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  ty += 10;
  doc.text('Received', W - 80, ty);
  doc.text(moneyPdf(sale.received), W - M, ty, { align: 'right' });
  const due = num(sale.total) - num(sale.received);
  if (due > 0.004) {
    ty += 5.5;
    doc.setFont('helvetica', 'bold');
    doc.text('Balance Due', W - 80, ty);
    doc.text(moneyPdf(due), W - M, ty, { align: 'right' });
    doc.setFont('helvetica', 'normal');
  }

  // amount in words + terms (left column)
  let ly = doc.lastAutoTable.finalY + 6;
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text('AMOUNT IN WORDS', M, ly);
  doc.setTextColor(0);
  doc.setFontSize(9);
  const words = doc.splitTextToSize(amountInWords(sale.total), W - 110);
  doc.text(words, M, ly + 5);
  ly += 7 + words.length * 4.3;

  const terms = (settings?.invoiceTerms || '').trim();
  if (terms) {
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text('TERMS & CONDITIONS', M, ly + 3);
    doc.setTextColor(40);
    const tl = doc.splitTextToSize(terms, W - 110);
    doc.text(tl, M, ly + 8);
    ly += 10 + tl.length * 3.8;
  }

  // signatures
  const sy = Math.max(ly, ty) + 22;
  doc.setTextColor(0);
  doc.setFontSize(9);
  doc.setLineWidth(0.3);
  doc.line(M, sy, M + 55, sy);
  doc.text("Customer's Signature", M, sy + 5);
  doc.line(W - M - 60, sy, W - M, sy);
  doc.text(`For ${settings?.shopName || SHOP_DEFAULT}`, W - M, sy + 5, { align: 'right' });

  if (settings?.invoiceFooter) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(settings.invoiceFooter, W / 2, sy + 16, { align: 'center' });
  }

  drawFooter(doc, settings);
  if (action === 'print') {
    doc.autoPrint();
    const url = doc.output('bloburl');
    window.open(url, '_blank');
  } else {
    doc.save(`${sale.invoiceNo}.pdf`);
  }
}
