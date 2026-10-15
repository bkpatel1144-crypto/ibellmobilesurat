import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { labelLayout } from '../lib/labels';

const PT = 0.3528;

/** On-screen preview of a device label, drawn from the same layout as the printed PDF. */
export default function LabelPreview({ device, settings, scale = 5 }) {
  const svg = useRef();
  const L = labelLayout(device, settings);
  const k = scale; // px per mm
  const px = (mm) => mm * k;
  const font = (p) => p * PT * k;

  useEffect(() => {
    if (svg.current && L.code) {
      JsBarcode(svg.current, L.code, { format: 'CODE128', displayValue: false, margin: 0, width: 2, height: 60, background: 'transparent', lineColor: '#000' });
    }
  }, [L.code]);

  const line = (top, size, extra) => ({
    position: 'absolute',
    top: px(top),
    left: px(L.pad),
    right: px(L.pad),
    height: px(L.lineH(size)),
    fontSize: font(size),
    lineHeight: `${px(L.lineH(size))}px`,
    ...extra,
  });

  return (
    <div className="label-preview" style={{ width: px(L.w), height: px(L.h) }} aria-label="Label preview">
      <div className="label-line" style={line(L.titleTop, L.fTitle, { fontWeight: 700, textAlign: 'center' })}>{L.title}</div>
      <svg
        ref={svg}
        style={{ position: 'absolute', top: px(L.barcodeTop), left: px(L.quiet), width: px(L.w - 2 * L.quiet), height: px(L.barcodeH) }}
        preserveAspectRatio="none"
      />
      <div className="label-line" style={line(L.codeTop, L.fCode, { textAlign: 'center' })}>{L.code}</div>
      {L.info.map((ln, n) => (
        <div key={n} className="label-line" style={line(L.infoTop + n * L.lineH(L.fInfo), L.fInfo, { fontWeight: 700, display: 'flex', justifyContent: 'space-between', gap: 8 })}>
          <span className="label-ellipsis">{ln.left}</span>
          {ln.right && <span style={{ flex: 'none' }}>{ln.right}</span>}
        </div>
      ))}
    </div>
  );
}
