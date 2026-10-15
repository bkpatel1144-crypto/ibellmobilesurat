import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Upload, X, FileText, Paperclip } from 'lucide-react';
import { db } from '../firebase';
import { fileToAttachment } from '../lib/files';
import { ID_TYPES } from '../lib/format';
import { useToast } from '../context/ToastContext';
import { Field, Modal } from './ui';

/** Editor: ID type, number and files. files = pending {name,type,dataUrl} or saved ids. */
export function IdProofEditor({ value, onChange, title = 'ID proof (optional)' }) {
  const toast = useToast();
  const input = useRef();
  const [viewing, setViewing] = useState(null);
  const files = value.idFiles || [];

  const add = async (e) => {
    const picked = [...e.target.files];
    e.target.value = '';
    const out = [];
    for (const f of picked) {
      try {
        out.push(await fileToAttachment(f));
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    if (out.length) onChange({ ...value, idFiles: [...files, ...out] });
  };

  return (
    <div className="sub-box">
      <div className="field-label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Paperclip size={14} /> {title}
      </div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <Field label="ID type">
          <select className="select" value={value.idType || ''} onChange={(e) => onChange({ ...value, idType: e.target.value })}>
            <option value="">— None —</option>
            {ID_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="ID number">
          <input className="input" value={value.idNumber || ''} onChange={(e) => onChange({ ...value, idNumber: e.target.value })} />
        </Field>
      </div>
      <div className="thumbs">
        {files.map((f, i) => (
          <div key={typeof f === 'string' ? f : `${f.name}-${i}`} className="thumb" role="button" tabIndex={0} onClick={() => setViewing(f)}>
            {typeof f === 'string' ? (
              <SavedThumb id={f} />
            ) : f.type.startsWith('image/') ? (
              <img src={f.dataUrl} alt={f.name} />
            ) : (
              <FileText size={24} />
            )}
            <button
              type="button"
              className="x"
              aria-label="Remove file"
              onClick={(e) => {
                e.stopPropagation();
                onChange({ ...value, idFiles: files.filter((_, j) => j !== i) });
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button type="button" className="upload" onClick={() => input.current.click()} aria-label="Upload ID proof">
          <Upload size={20} />
        </button>
        <input ref={input} type="file" accept="image/*,application/pdf" capture="environment" multiple hidden onChange={add} />
      </div>
      <AttachmentViewer item={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

/** Read-only list of saved attachment ids */
export function IdProofView({ ids = [], idType, idNumber }) {
  const [viewing, setViewing] = useState(null);
  if (!ids.length && !idType && !idNumber) return <span className="muted small">No ID proof</span>;
  return (
    <div className="stack-sm">
      {(idType || idNumber) && (
        <div className="small">
          <span className="muted">{idType || 'ID'}:</span> <b>{idNumber || '—'}</b>
        </div>
      )}
      {ids.length > 0 && (
        <div className="thumbs">
          {ids.map((id) => (
            <button type="button" key={id} className="thumb" onClick={() => setViewing(id)} aria-label="View ID proof">
              <SavedThumb id={id} />
            </button>
          ))}
        </div>
      )}
      <AttachmentViewer item={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function useAttachment(id) {
  const [att, setAtt] = useState(null);
  useEffect(() => {
    if (!id) return undefined;
    return onSnapshot(doc(db, 'attachments', id), (s) => setAtt(s.exists() ? s.data() : { missing: true }));
  }, [id]);
  return att;
}

function SavedThumb({ id }) {
  const att = useAttachment(id);
  if (!att) return <span className="skeleton" style={{ width: '100%', height: '100%', borderRadius: 0 }} />;
  if (att.missing) return <span className="xs muted">Missing</span>;
  return att.type?.startsWith('image/') ? <img src={att.dataUrl} alt={att.name} /> : <FileText size={24} />;
}

function AttachmentViewer({ item, onClose }) {
  const saved = useAttachment(typeof item === 'string' ? item : null);
  const att = typeof item === 'string' ? saved : item;
  return (
    <Modal open={Boolean(item)} onClose={onClose} title={att?.name || 'ID proof'} size="wide">
      {!att ? (
        <div className="skeleton" style={{ height: 300 }} />
      ) : att.type?.startsWith('image/') ? (
        <img className="viewer-img" src={att.dataUrl} alt={att.name} />
      ) : (
        <div className="stack" style={{ alignItems: 'center' }}>
          <FileText size={48} />
          <a className="btn btn-primary" href={att.dataUrl} download={att.name}>Download PDF</a>
        </div>
      )}
    </Modal>
  );
}
