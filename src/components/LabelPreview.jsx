import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { labelTitle, labelCode, labelSize, barcodeQuiet } from '../lib/labels';

/** On-screen preview of a device label at true proportions (4 px per mm). */
export default function LabelPreview({ device, settings }) {
  const svg = useRef();
  const { w, h } = labelSize(settings);
  const s = Math.min(w / 50, h / 25);
  const k = 4; // px per mm
  const code = labelCode(device);

  useEffect(() => {
    if (svg.current && code) {
      JsBarcode(svg.current, code, { format: 'CODE128', displayValue: false, margin: 0, width: 2, height: 60, background: 'transparent', lineColor: '#000' });
    }
  }, [code]);

  const showBattery = settings?.labelShowBattery !== false && device.battery != null && device.battery !== '';
  return (
    <div
      className="label-preview"
      style={{ width: w * k, height: h * k, padding: `${1.8 * s * k}px` }}
      aria-label="Label preview"
    >
      <div className="label-title" style={{ fontSize: 7 * s * 0.353 * k }}>{labelTitle(device)}</div>
      <svg
        ref={svg}
        style={{ width: (w - 2 * barcodeQuiet(w, s)) * k, height: 8.6 * s * k, margin: `0 ${(barcodeQuiet(w, s) - 1.8 * s) * k}px`, alignSelf: 'center' }}
        preserveAspectRatio="none"
      />
      <div className="label-code" style={{ fontSize: 6.5 * s * 0.353 * k }}>{code}</div>
      <div className="label-meta" style={{ fontSize: 8.5 * s * 0.353 * k }}>
        {device.sn && <div>SN: {device.sn}</div>}
        {showBattery && <div>BH: {device.battery}%</div>}
      </div>
    </div>
  );
}
