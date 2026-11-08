import { isFull, type Group } from '../../lib/study-groups-api';

/** Count vs limit, plus the viewer's own relation to the group. Used on cards, rows and the group page. */
export default function GroupBadges({ group }: { group: Group }) {
  const mine = group.isCreator
    ? { label: 'Your group', className: 'bg-emerald-50 text-emerald-800' }
    : group.myMembershipStatus === 'active'
      ? { label: 'Member', className: 'bg-emerald-50 text-emerald-800' }
      : group.myMembershipStatus === 'pending'
        ? { label: 'Request pending', className: 'bg-amber-50 text-amber-800' }
        : null;
  return (
    <div className="flex flex-wrap gap-2">
      {group.status === 'archived' && <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">Archived</span>}
      {mine && <span className={`rounded-full px-3 py-1 text-xs font-medium ${mine.className}`}>{mine.label}</span>}
      <span className={`rounded-full px-3 py-1 text-xs font-medium ${isFull(group) ? 'bg-rose-50 text-rose-800' : 'bg-slate-100 text-slate-700'}`}>
        {group.memberCount}/{group.participantLimit} members{isFull(group) ? ' · Full' : ''}
      </span>
    </div>
  );
}
