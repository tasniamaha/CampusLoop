'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorState, LoadingState } from '../DataStates';
import GroupBadges from './GroupBadges';
import type { ApiResult } from '../../lib/api-client';
import {
  archiveGroup,
  canSeeMembers,
  getGroup,
  isFull,
  joinGroup,
  leaveGroup,
  listMembers,
  listRequests,
  reviewRequest,
  type Group,
  type JoinRequest,
  type Member,
} from '../../lib/study-groups-api';
import { useApiQuery } from '../../lib/use-api-query';

const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });

/**
 * One group. Visibility is decided by the API (404 when the viewer may not see it). The member
 * list loads only for the creator and active members; join requests only for the creator of an
 * open group. Every successful action reloads all three.
 */
export default function GroupDetail({ id, created }: { id: string; created: boolean }) {
  const router = useRouter();
  // Bumped after each successful action; part of every query key, so all three reload together.
  const [version, setVersion] = useState(0);
  const groupQuery = useApiQuery<Group>(`group|${id}|${version}`, (signal) => getGroup(id, signal));
  const group = groupQuery.data;
  const membersQuery = useApiQuery<Member[]>(group && canSeeMembers(group) ? `members|${id}|${version}` : null, (signal) => listMembers(id, signal));
  const showRequests = Boolean(group?.isCreator && group.status === 'open');
  const requestsQuery = useApiQuery<JoinRequest[]>(showRequests ? `requests|${id}|${version}` : null, (signal) => listRequests(id, signal));

  const [notice, setNotice] = useState(created ? "Group created. You're its creator and first member." : '');
  const [actionError, setActionError] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Drop ?created=1 so a refresh doesn't repeat the message. Same route: no remount, no refetch.
  useEffect(() => {
    if (created) router.replace(`/study-groups/${id}`, { scroll: false });
  }, [created, id, router]);

  /** Runs an action and reloads on success; on failure redirects (401) or shows the error. */
  async function act(name: string, run: () => Promise<ApiResult<unknown>>, success: string, fallback: string) {
    setBusyAction(name);
    setActionError('');
    setNotice('');
    try {
      const result = await run();
      if (!result.ok) {
        if (result.status === 401) { router.replace('/login'); return; }
        setActionError(result.message);
        setVersion((v) => v + 1); // the group may have changed under us (filled up, archived)
        return;
      }
      setNotice(success);
      setVersion((v) => v + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusyAction(null);
    }
  }

  const backLink = <Link href="/study-groups" className="text-sm font-semibold text-emerald-700 hover:underline">← Back to groups</Link>;

  if (groupQuery.error) {
    // 400 = malformed id; 404 = missing, another campus, or archived and not ours. Same message.
    const notFound = groupQuery.error.status === 404 || groupQuery.error.status === 400;
    return (
      <div className="space-y-4">
        {backLink}
        {notFound ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <h2 className="text-lg font-semibold text-slate-900">Group not found</h2>
            <p className="mt-1 text-sm text-slate-500">It may have been archived, or it isn&apos;t visible to your account.</p>
          </div>
        ) : (
          <ErrorState message={groupQuery.error.message} onRetry={groupQuery.reload} />
        )}
      </div>
    );
  }
  if (!group) {
    return <div className="space-y-4">{backLink}<LoadingState>Loading group...</LoadingState></div>;
  }

  const isOpen = group.status === 'open';
  const status = group.myMembershipStatus;
  const full = isFull(group);
  const canJoin = isOpen && !group.isCreator && (status === null || status === 'rejected') && !full;
  const canLeave = isOpen && !group.isCreator && (status === 'active' || status === 'pending');
  const busy = busyAction !== null;

  return (
    <div className={`space-y-6 ${groupQuery.loading ? 'opacity-60' : ''}`} aria-busy={groupQuery.loading}>
      {backLink}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {actionError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{actionError}</p>}

      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            {/* h2: the section layout provides the page's h1. */}
            <h2 className="text-2xl font-bold text-slate-900">{group.title}</h2>
            <p className="mt-1 text-sm font-medium text-emerald-800">{group.courseCode} · {group.topic}</p>
          </div>
          <GroupBadges group={group} />
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">{group.description}</p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="font-medium text-slate-900">Schedule</dt>
            <dd className="text-slate-600">{group.schedule}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">Participants</dt>
            <dd className="text-slate-600">{group.memberCount} of {group.participantLimit}{full ? ' (full)' : ''}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">Joining</dt>
            <dd className="text-slate-600">{group.approvalRequired ? 'Creator approval required' : 'Open join'}</dd>
          </div>
        </dl>

        {!isOpen && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">This group is archived. It no longer accepts members.</p>}
        {isOpen && status === 'pending' && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Your join request is waiting for the creator&apos;s approval.</p>}
        {isOpen && status === 'rejected' && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Your earlier join request was not approved.</p>}
        {isOpen && full && !group.isCreator && status !== 'active' && <p className="mt-4 text-sm text-slate-600">This group is full.</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          {canJoin && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act('join', () => joinGroup(id), group.approvalRequired ? 'Join request sent to the group creator.' : 'You joined the group.', 'Could not join the group')}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busyAction === 'join' ? 'Sending...' : group.approvalRequired ? 'Request to join' : 'Join group'}
            </button>
          )}
          {canLeave && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const pending = status === 'pending';
                if (!window.confirm(pending ? 'Withdraw your join request?' : `Leave “${group.title}”?`)) return;
                void act('leave', () => leaveGroup(id), pending ? 'Join request withdrawn.' : 'You left the group.', 'Could not leave the group');
              }}
              className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busyAction === 'leave' ? 'Saving...' : status === 'pending' ? 'Cancel request' : 'Leave group'}
            </button>
          )}
          {group.isCreator && isOpen && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Archive “${group.title}”? It will no longer accept members.`)) return;
                void act('archive', () => archiveGroup(id), 'Group archived.', 'Could not archive the group');
              }}
              className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 disabled:opacity-50"
            >
              {busyAction === 'archive' ? 'Archiving...' : 'Archive group'}
            </button>
          )}
        </div>
      </article>

      {showRequests && (
        <section aria-labelledby="requests-heading" className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 id="requests-heading" className="text-lg font-semibold">Join requests</h2>
          {requestsQuery.error ? (
            <div className="mt-2"><ErrorState message={requestsQuery.error.message} onRetry={requestsQuery.reload} /></div>
          ) : !requestsQuery.data ? (
            <p role="status" className="mt-2 text-sm text-slate-500">Loading join requests...</p>
          ) : requestsQuery.data.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No pending requests.</p>
          ) : (
            <>
              {full && <p className="mt-2 text-sm text-slate-600">The group is full, so requests can only be rejected for now.</p>}
              <ul className="mt-3 space-y-2">
                {requestsQuery.data.map((request) => (
                  <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{request.name}</p>
                      <p className="text-xs text-slate-500">Requested {formatDate(request.requestedAt)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy || full}
                        onClick={() => void act(`review:${request.id}`, () => reviewRequest(id, request.id, 'active'), `${request.name} was approved and added to the group.`, 'Could not approve the request')}
                        aria-label={`Approve ${request.name}`}
                        className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void act(`review:${request.id}`, () => reviewRequest(id, request.id, 'rejected'), `${request.name}'s request was rejected.`, 'Could not reject the request')}
                        aria-label={`Reject ${request.name}`}
                        className="rounded-md border bg-white px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {canSeeMembers(group) && (
        <section aria-labelledby="members-heading" className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 id="members-heading" className="text-lg font-semibold">Members</h2>
          {membersQuery.error ? (
            <div className="mt-2"><ErrorState message={membersQuery.error.message} onRetry={membersQuery.reload} /></div>
          ) : !membersQuery.data ? (
            <p role="status" className="mt-2 text-sm text-slate-500">Loading members...</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {/* Members carry no id (display fields only); order is stable per load. */}
              {membersQuery.data.map((member, index) => (
                <li key={`${index}-${member.name}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3">
                  <span className="text-sm font-medium text-slate-900">{member.name}</span>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">{member.role === 'owner' ? 'Creator' : 'Member'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
