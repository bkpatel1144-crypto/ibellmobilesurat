import { Pencil, Trash2 } from 'lucide-react';

/**
 * Standard Edit / Delete buttons for a table row. Clicks don't open the row.
 * Pass only the handlers the user is allowed to use - a missing handler hides its button.
 */
export default function RowActions({ onEdit, onDelete, editLabel = 'Edit', deleteLabel = 'Delete', children }) {
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div className="row-actions">
      {children}
      {onEdit && (
        <button type="button" className="btn btn-sm btn-icon" onClick={stop(onEdit)} aria-label={editLabel} title={editLabel}>
          <Pencil size={14} />
        </button>
      )}
      {onDelete && (
        <button type="button" className="btn btn-sm btn-icon btn-danger" onClick={stop(onDelete)} aria-label={deleteLabel} title={deleteLabel}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
