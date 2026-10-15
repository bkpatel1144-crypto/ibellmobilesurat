import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, Download, Printer, X } from 'lucide-react';
import { Modal } from './ui';
import RowActions from './RowActions';
import { useToast } from '../context/ToastContext';
import { sharePdf } from '../lib/share';

/** WhatsApp mark (drawn in the current text colour so it follows the theme). */
export function WhatsAppIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.23 8.23 0 0 1-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.23 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.17-.48-.29Z" />
    </svg>
  );
}

const loadViewer = () => import('../lib/pdfview');

/**
 * Preview + WhatsApp for one document, as a hook so table rows can put them in a "⋯" menu.
 *   build(output)  makes the PDF: 'blob' → File, 'save' downloads, 'print' prints
 *   message        the WhatsApp text; phone → the chat to open when files can't be shared
 * Returns { preview(), share(), busy, ui, warm() } - render `ui` once (viewer + "PDF ready" step).
 */
export function useDocShare({ build, message, phone, title = 'Document' }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(null); // File being previewed
  const [ready, setReady] = useState(null); // File waiting for a fresh tap to share

  const shareFile = async (file) => {
    try {
      const r = await sharePdf({ file, text: message, phone });
      if (r === 'needs-tap') setReady(file);
      else {
        setReady(null);
        if (r === 'fallback') toast('PDF saved · WhatsApp opened with the message - attach the PDF in the chat');
      }
    } catch (e) {
      toast(e.message || 'Could not share', 'error');
    }
  };

  const run = async (what) => {
    setBusy(what);
    if (what === 'preview') loadViewer(); // fetch the viewer while the PDF is made
    try {
      const file = await build('blob');
      if (what === 'preview') setPreview(file);
      else await shareFile(file);
    } catch (e) {
      toast(e.message || 'Could not make the PDF', 'error');
    } finally {
      setBusy('');
    }
  };

  const out = async (what) => {
    setBusy(what);
    try {
      await build(what);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const ui = (
    <>
      {preview && (
        <PdfViewer
          file={preview}
          title={title}
          onClose={() => setPreview(null)}
          busy={busy}
          onDownload={() => out('save')}
          onPrint={() => out('print')}
          onShare={() => shareFile(preview)}
        />
      )}

      <Modal open={Boolean(ready)} onClose={() => setReady(null)} title="PDF ready" subtitle={ready?.name} size="narrow">
        <p className="muted small" style={{ marginTop: 0 }}>Tap to open WhatsApp with the PDF and message.</p>
        <div className="modal-foot" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => setReady(null)}>Cancel</button>
          <button type="button" className="btn btn-primary btn-whatsapp" onClick={() => ready && shareFile(ready)} autoFocus><WhatsAppIcon /> Send on WhatsApp</button>
        </div>
      </Modal>
    </>
  );

  return { preview: () => run('preview'), share: () => run('wa'), busy, ui, warm: loadViewer };
}

/**
 * A table row's actions for a document: WhatsApp · Edit · ⋯ (Preview PDF, extra items, Delete).
 *   doc: { build, message, phone, title }   other props go to RowActions
 */
export function DocRowActions({ doc, more = [], ...row }) {
  const d = useDocShare(doc);
  return (
    <RowActions
      {...row}
      lead={
        <>
          <button type="button" className="btn btn-sm btn-icon btn-whatsapp" onClick={d.share} disabled={Boolean(d.busy)} aria-label="Send on WhatsApp" title="Send on WhatsApp">
            <WhatsAppIcon size={15} />
          </button>
          {d.ui}
        </>
      }
      more={[{ label: d.busy === 'preview' ? 'Opening…' : 'Preview PDF', icon: Eye, onClick: d.preview }, ...more]}
    />
  );
}

/** Preview + WhatsApp buttons (page headers, toolbars). */
export default function DocActions({ build, message, phone, title, small, iconOnly = false, only }) {
  const doc = useDocShare({ build, message, phone, title });
  const cls = `btn ${small ? 'btn-sm' : ''} ${iconOnly ? 'btn-icon' : ''}`;
  return (
    <>
      {only !== 'whatsapp' && (
        <button type="button" className={cls} onClick={doc.preview} onPointerEnter={doc.warm} disabled={Boolean(doc.busy)} aria-label="Preview PDF" title="Preview">
          <Eye size={16} /> {!iconOnly && (doc.busy === 'preview' ? 'Opening…' : 'Preview')}
        </button>
      )}
      <button type="button" className={`${cls} btn-whatsapp`} onClick={doc.share} disabled={Boolean(doc.busy)} aria-label="Send on WhatsApp" title="Send on WhatsApp">
        <WhatsAppIcon size={16} /> {!iconOnly && (doc.busy === 'wa' ? 'Preparing…' : 'WhatsApp')}
      </button>
      {doc.ui}
    </>
  );
}

/** Full-screen document viewer: top bar with the actions, paper pages on a dark backdrop. */
function PdfViewer({ file, title, onClose, busy, onDownload, onPrint, onShare }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closeBtn = useRef();

  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtn.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`${title} preview`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="viewer-bar glass--large">
        <div className="viewer-title">
          <b>{title}</b>
          <span>{file.name}</span>
        </div>
        <div className="viewer-tools">
          <button type="button" className="btn btn-sm" onClick={onDownload} disabled={Boolean(busy)} aria-label="Download PDF" title="Download">
            <Download size={16} /> <span className="hide-sm">Download</span>
          </button>
          <button type="button" className="btn btn-sm" onClick={onPrint} disabled={Boolean(busy)} aria-label="Print" title="Print">
            <Printer size={16} /> <span className="hide-sm">Print</span>
          </button>
          <button type="button" className="btn btn-sm btn-primary btn-whatsapp" onClick={onShare} aria-label="Send on WhatsApp" title="Send on WhatsApp">
            <WhatsAppIcon size={16} /> <span className="hide-sm">WhatsApp</span>
          </button>
          <button ref={closeBtn} type="button" className="btn btn-sm btn-icon" onClick={onClose} aria-label="Close preview" title="Close (Esc)">
            <X size={18} />
          </button>
        </div>
      </div>
      <PdfPages file={file} />
    </div>,
    document.body,
  );
}

/** The PDF's pages, drawn one by one to fit the width (redrawn when the window resizes). */
function PdfPages({ file }) {
  const wrap = useRef();
  const box = useRef();
  const [state, setState] = useState('loading'); // loading | done | native
  const [width, setWidth] = useState(0);
  const [url, setUrl] = useState('');

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    const measure = () => setWidth(Math.min(820, Math.floor(wrap.current?.clientWidth || 0)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!width || state === 'native') return undefined;
    const token = { cancelled: false };
    // the browser's own viewer if drawing fails or is very slow
    const slow = setTimeout(() => !token.cancelled && !box.current?.childElementCount && setState('native'), 12000);
    loadViewer()
      .then(({ renderPdf }) => renderPdf(file, box.current, width, token, () => !token.cancelled && setState('done')))
      .catch(() => !token.cancelled && setState('native'));
    return () => {
      token.cancelled = true;
      clearTimeout(slow);
    };
  }, [file, width]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="viewer-body" ref={wrap}>
      {state === 'native' ? (
        <iframe className="viewer-native" src={url} title="PDF" />
      ) : (
        <>
          {state === 'loading' && <div className="pdf-page pdf-skeleton skeleton" style={{ width: width || 600 }} aria-label="Loading preview" />}
          <div ref={box} className="pdf-pages" />
        </>
      )}
    </div>
  );
}
