'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../DataStates';
import GroupBadges from './GroupBadges';
import { getMyGroups, isFullGroup, MY_LIST_LIMIT, type Group, type MyGroups as Loaded, type MyRequest } from '../../lib/study-groups-api';
import { useApiQuery } from '../../lib/use-api-query';

const REQUEST_STATUS_LABEL: Record<MyRequest['request']['status'], string> = {
  pending: "Waiting for the creator's approval",
  rejected: 'Not approved',
};

/**
 * The caller's own groups and requests (GET /study-groups/mine). Loading, error (without any
 * empty text), empty per section, and 401 -> /login.
 */
export default function MyGroups() {
  const query = useApiQuery<Loaded>('mine', (signal) => getMyGroups(signal));

  if (query.error) return <ErrorState message={query.error.message} onRetry={query.reload} />;
  if (!query.data) return <LoadingState>Loading your groups...</LoadingState>;

  const { created, memberships, requests } = query.data;
  return (
    <div className="space-y-8">
      <section aria-labelledby="created-heading">
        <SectionHeading id="created-heading" title="Groups I created" truncated={created.truncated} />
        {created.items.length === 0 ? (
          <EmptyState>
            You haven&apos;t created any groups yet. <Link href="/study-groups/new" className="font-semibold text-emerald-700 hover:underline">Create a group</Link>
          </EmptyState>
        ) : (
          <GroupRows groups={created.items} />
        )}
      </section>

      <section aria-labelledby="joined-heading">
        <SectionHeading id="joined-heading" title="Groups I'm a member of" truncated={memberships.truncated} />
        {memberships.items.length === 0 ? (
          <EmptyState>
            You aren&apos;t a member of any other groups. <Link href="/study-groups" className="font-semibold text-emerald-700 hover:underline">Browse groups</Link>
          </EmptyState>
        ) : (
          <GroupRows groups={memberships.items} />
        )}
      </section>

      <section aria-labelledby="requests-heading">
        <SectionHeading id="requests-heading" title="My join requests" truncated={requests.truncated} />
        {requests.items.length === 0 ? (
          <EmptyState>You have no pending or rejected join requests.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {requests.items.map(({ request, group }) => (
              <li key={request.id}>
                {isFullGroup(group) ? (
                  <GroupRow group={group}>
                    <RequestStatus status={request.status} />
                  </GroupRow>
                ) : (
                  // Archived since the request: the requester can no longer open it, so no link.
                  <article className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="font-semibold text-slate-700">{group.title}</h3>
                      <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">Archived</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{group.courseCode} · {group.topic}</p>
                    <RequestStatus status={request.status} />
                    <p className="mt-1 text-xs text-slate-500">This group was archived and no longer accepts members.</p>
                  </article>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SectionHeading({ id, title, truncated }: { id: string; title: string; truncated: boolean }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="text-lg font-semibold">{title}</h2>
      {truncated && <p className="text-sm text-slate-500">Showing your {MY_LIST_LIMIT} most recent</p>}
    </div>
  );
}

function RequestStatus({ status }: { status: MyRequest['request']['status'] }) {
  return (
    <p className="mt-2 text-sm">
      <span className="font-medium">Your request:</span> {REQUEST_STATUS_LABEL[status]}
    </p>
  );
}

function GroupRows({ groups }: { groups: Group[] }) {
  return (
    <ul className="space-y-3">
      {groups.map((group) => (
        <li key={group.id}><GroupRow group={group} /></li>
      ))}
    </ul>
  );
}

function GroupRow({ group, children }: { group: Group; children?: ReactNode }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-semibold">
          <Link href={`/study-groups/${group.id}`} className="text-slate-900 hover:text-emerald-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
            {group.title}
          </Link>
        </h3>
        <GroupBadges group={group} />
      </div>
      <p className="mt-1 text-sm text-slate-500">{group.courseCode} · {group.topic} · {group.schedule}</p>
      {children}
    </article>
  );
}
