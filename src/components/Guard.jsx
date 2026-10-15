import { ShieldCheck } from 'lucide-react';
import { useData } from '../context/DataContext';
import { PageHeader } from './Layout';
import { Empty } from './ui';

/** Shows the page only if the signed-in member has the permission (owners always do). */
export default function Guard({ perm, owner, title, children }) {
  const { can, me } = useData();
  const allowed = owner ? me.isOwner : can(perm);
  if (allowed) return children;
  return (
    <div className="page">
      <PageHeader title={title || 'No access'} />
      <div className="card">
        <Empty icon={ShieldCheck} title="You don't have access to this page">
          Ask the shop owner to switch it on for staff in Settings → Team.
        </Empty>
      </div>
    </div>
  );
}
