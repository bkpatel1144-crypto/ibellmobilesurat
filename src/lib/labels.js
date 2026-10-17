// Device barcode labels, e.g.
//   I PHONE 15 PRO | 256 | WHITE
//   ||||||||||||||||||||||||||||   ← CODE128 of the IMEI (scan it in New Sale / Stock Audit)
//        355262965973925
//   SN: G-523              BH: 95%
//   W: 6 MONTHS
// One label per PDF page, page size = label size, so thermal label printers print 1:1.
// Text sizes come from Settings; the barcode takes whatever height is left.

const PT = 0.3528; // mm per typographic point
const lineH = (pt) => pt * PT * 1.18;

export const LABEL_FONT_DEFAULTS = { labelTitlePt: 9, labelCodePt: 8, labelInfoPt: 10 };

export const labelTitle = (d) => [d.model || d.brand, d.variant, d.color].filter(Boolean).join(' | ').toUpperCase();

export const labelCode = (d) => d.imei || d.sn || '';

export function labelSize(settings) {
  const w = Math.min(Math.max(Number(settings?.labelWidth) || 50, 25), 120);
  const h = Math.min(Math.max(Number(settings?.labelHeight) || 25, 12), 80);
  return { w, h };
}

const pt = (v, def) => Math.min(Math.max(Number(v) || def, 5), 24);

/** Blank margin left and right of the barcode, in mm (scanners need ~10 bar widths). */
export const barcodeQuiet = (w) => Math.max(3.5, w * 0.07);

/** Every position on the label in mm - shared by the PDF and the on-screen preview. */
export function labelLayout(d, settings) {
  const { w, h } = labelSize(settings);
  const pad = 1.5;
  const fTitle = pt(settings?.labelTitlePt, LABEL_FONT_DEFAULTS.labelTitlePt);
  const fCode = pt(settings?.labelCodePt, LABEL_FONT_DEFAULTS.labelCodePt);
  const fInfo = pt(settings?.labelInfoPt, LABEL_FONT_DEFAULTS.labelInfoPt);

  const battery = settings?.labelShowBattery !== false && d.battery != null && d.battery !== '' ? `BH: ${d.battery}%` : '';
  const warranty = settings?.labelShowWarranty !== false ? String(d.warranty || '').trim() : '';
  const info = [];
  if (d.sn || battery) info.push({ left: d.sn ? `SN: ${d.sn}` : '', right: battery });
  if (warranty) info.push({ left: `W: ${warranty.toUpperCase()}`, right: '' });

  const titleTop = pad;
  const barcodeTop = titleTop + lineH(fTitle) + 0.4;
  const infoTop = h - pad - info.length * lineH(fInfo);
  const free = infoTop - lineH(fCode) - 0.3 - barcodeTop;
  const barcodeH = Math.max(free, 3);
  const quiet = barcodeQuiet(w);

  return {
    w,
    h,
    pad,
    quiet,
    fTitle,
    fCode,
    fInfo,
    title: labelTitle(d),
    code: labelCode(d),
    info,
    titleTop,
    barcodeTop,
    barcodeH,
    codeTop: barcodeTop + barcodeH + 0.3,
    infoTop,
    lineH,
    tooTight: free < 5, // barcode shorter than 5 mm is hard to scan
  };
}

async function barcodePng(JsBarcode, value) {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value, { format: 'CODE128', displayValue: false, margin: 0, width: 3, height: 90, background: '#ffffff', lineColor: '#000000' });
  return canvas.toDataURL('image/png');
}

/** Sets the font size, shrinking it until `text` fits in `maxW` mm. */
function fitFont(doc, text, size, maxW) {
  let s = size;
  doc.setFontSize(s);
  while (doc.getTextWidth(text) > maxW && s > 5) {
    s -= 0.25;
    doc.setFontSize(s);
  }
}

/** Builds the label PDF and opens the print dialog (falls back to a download if pop-ups are blocked). */
export async function printLabels(devices, settings) {
  const list = devices.filter((d) => labelCode(d));
  if (!list.length) throw new Error('No device with an IMEI or SN to print.');
  const [{ jsPDF }, { default: JsBarcode }] = await Promise.all([import('jspdf'), import('jsbarcode')]);
  const { w, h } = labelSize(settings);
  const orientation = w >= h ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation, unit: 'mm', format: [w, h] });
  // baseline sits ~0.8 of the font size below the top of its line
  const base = (top, size) => top + size * PT * 0.95;

  for (const [i, d] of list.entries()) {
    if (i) doc.addPage([w, h], orientation);
    const L = labelLayout(d, settings);
    doc.setTextColor(0);

    doc.setFont('helvetica', 'bold');
    fitFont(doc, L.title, L.fTitle, w - 2 * L.pad);
    doc.text(L.title, w / 2, base(L.titleTop, L.fTitle), { align: 'center' });

    doc.addImage(await barcodePng(JsBarcode, L.code), 'PNG', L.quiet, L.barcodeTop, w - 2 * L.quiet, L.barcodeH);

    doc.setFont('helvetica', 'normal');
    fitFont(doc, L.code, L.fCode, w - 2 * L.pad);
    doc.text(L.code, w / 2, base(L.codeTop, L.fCode), { align: 'center' });

    doc.setFont('helvetica', 'bold');
    L.info.forEach((line, n) => {
      const y = base(L.infoTop + n * L.lineH(L.fInfo), L.fInfo);
      const room = w - 2 * L.pad;
      if (line.right) {
        doc.setFontSize(L.fInfo);
        doc.text(line.right, w - L.pad, y, { align: 'right' });
        fitFont(doc, line.left, L.fInfo, room - doc.getTextWidth(line.right) - 2);
      } else fitFont(doc, line.left, L.fInfo, room);
      if (line.left) doc.text(line.left, L.pad, y);
    });
  }

  doc.autoPrint();
  const url = doc.output('bloburl');
  const win = window.open(url, '_blank');
  if (!win) doc.save(list.length === 1 ? `label-${list[0].sn || list[0].imei}.pdf` : 'labels.pdf');
}
