// Device barcode labels, e.g.
//   I PHONE 15 PRO | 256 | WHITE
//   ||||||||||||||||||||||||||||   ← CODE128 of the IMEI (scan it in New Sale)
//        355262965973925
//   SN: G-523
//   BH: 95%
// One label per PDF page, page size = label size, so thermal label printers print 1:1.

export const labelTitle = (d) => [d.model || d.brand, d.variant, d.color].filter(Boolean).join(' | ').toUpperCase();

export const labelCode = (d) => d.imei || d.sn || '';

export function labelSize(settings) {
  const w = Math.min(Math.max(Number(settings?.labelWidth) || 50, 25), 120);
  const h = Math.min(Math.max(Number(settings?.labelHeight) || 25, 12), 80);
  return { w, h };
}

/** Blank margin left and right of the barcode, in mm (at least 3.5 mm). */
export const barcodeQuiet = (w, s) => Math.max(3.5 * s, w * 0.07);

async function barcodePng(JsBarcode, value) {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value, { format: 'CODE128', displayValue: false, margin: 0, width: 3, height: 90, background: '#ffffff', lineColor: '#000000' });
  return canvas.toDataURL('image/png');
}

/** Builds the label PDF and opens the print dialog (falls back to a download if pop-ups are blocked). */
export async function printLabels(devices, settings) {
  const list = devices.filter((d) => labelCode(d));
  if (!list.length) throw new Error('No device with an IMEI or SN to print.');
  const [{ jsPDF }, { default: JsBarcode }] = await Promise.all([import('jspdf'), import('jsbarcode')]);
  const { w, h } = labelSize(settings);
  const orientation = w >= h ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation, unit: 'mm', format: [w, h] });
  const s = Math.min(w / 50, h / 25); // layout is designed for 50 × 25 mm and scaled
  const pad = 1.8 * s;
  const showBattery = settings?.labelShowBattery !== false;

  for (const [i, d] of list.entries()) {
    if (i) doc.addPage([w, h], orientation);
    doc.setTextColor(0);

    // title - shrink until it fits on one line
    doc.setFont('helvetica', 'bold');
    let size = 7 * s;
    const title = labelTitle(d);
    doc.setFontSize(size);
    while (doc.getTextWidth(title) > w - 2 * pad && size > 4) {
      size -= 0.25;
      doc.setFontSize(size);
    }
    doc.text(title, w / 2, pad + 2.3 * s, { align: 'center' });

    // barcode - with a white quiet zone each side (scanners need ~10 bar widths of blank space)
    const code = labelCode(d);
    const quiet = barcodeQuiet(w, s);
    doc.addImage(await barcodePng(JsBarcode, code), 'PNG', quiet, 4.4 * s, w - 2 * quiet, 8.6 * s);

    // human-readable code
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5 * s);
    doc.text(code, w / 2, 15.6 * s, { align: 'center' });

    // SN + BH
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5 * s);
    if (d.sn) doc.text(`SN: ${d.sn}`, pad, 19.9 * s);
    if (showBattery && d.battery != null && d.battery !== '') doc.text(`BH: ${d.battery}%`, pad, 23.5 * s);
  }

  doc.autoPrint();
  const url = doc.output('bloburl');
  const win = window.open(url, '_blank');
  if (!win) doc.save(list.length === 1 ? `label-${list[0].sn || list[0].imei}.pdf` : 'labels.pdf');
}
