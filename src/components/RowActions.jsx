import { Pencil, Trash2 } from 'lucide-react';
import MoreMenu from './MoreMenu';

/**
 * Standard row actions. Clicks never open the row (React events also bubble out of portals, so the
 * whole cell stops them).
 *   lead / children  the row's main action(s), shown first
 *   onEdit           pencil, always visible
 *   more             extra actions for a "⋯" menu - when given, Delete moves into it too, so a row
 *                    shows at most: main action · Edit · ⋯
 * Pass only the handlers the user is allowed to use - a missing handler hides its button.
 */
export default function RowActions({ onEdit, onDelete, editLabel = 'Edit', deleteLabel = 'Delete', children, lead, more }) {
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };
  const extra = (more || []).filter((i) => i && !i.hidden);
  const menu = extra.length > 0;
  return (
    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
      {lead}
      {children}
      {onEdit && (
        <button type="button" className="btn btn-sm btn-icon" onClick={stop(onEdit)} aria-label={editLabel} title={editLabel}>
          <Pencil size={14} />
        </button>
      )}
      {onDelete && !menu && (
        <button type="button" className="btn btn-sm btn-icon btn-danger" onClick={stop(onDelete)} aria-label={deleteLabel} title={deleteLabel}>
          <Trash2 size={14} />
        </button>
      )}
      {menu && (
        <MoreMenu
          small
          label="More actions"
          items={[...extra, onDelete && { label: deleteLabel, icon: Trash2, onClick: onDelete, danger: true }]}
        />
      )}
    </div>
  );
}
