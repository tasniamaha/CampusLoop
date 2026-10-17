
'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

type Group = {
  id: string;
  title: string;
  courseCode: string;
  topic: string;
  description: string;
  schedule: string;
  participantLimit: number;
  approvalRequired: boolean;
  status: 'open' | 'archived';
  memberCount: number;
  isCreator: boolean;
  myMembershipStatus: 'pending' | 'active' | 'rejected' | null;
  myMembershipRole?: string | null;
};

type RequestItem = {
  id: string;
  userId: string;
  name: string;
  requestedAt: string;
};

type MemberItem = {
  id: string;
  userId: string;
  name: string;
  role: string;
  status: string;
};

type PageResult = {
  data: Group[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
};

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { message?: string | string[] }
    | null;

  if (Array.isArray(body?.message)) {
    return body.message.join(', ');
  }

  return body?.message || `Request failed (${response.status})`;
}

function normalizeMembers(payload: unknown): MemberItem[] {
  let items: unknown[] = [];

  if (Array.isArray(payload)) {
    items = payload;
  } else if (payload && typeof payload === 'object') {
    const result = payload as {
      data?: unknown;
      members?: unknown;
      value?: unknown;
    };

    if (Array.isArray(result.data)) {
      items = result.data;
    } else if (Array.isArray(result.members)) {
      items = result.members;
    } else if (Array.isArray(result.value)) {
      items = result.value;
    }
  }

  return items
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null,
    )
    .map((item) => {
      const user = item.user as Record<string, unknown> | undefined;

      const userId =
        typeof item.userId === 'string'
          ? item.userId
          : typeof user?.id === 'string'
            ? user.id
            : '';

      const rawName =
        item.name ??
        item.fullName ??
        user?.name ??
        user?.fullName ??
        user?.displayName;

      const name =
        typeof rawName === 'string' && rawName.trim()
          ? rawName
          : 'Campus member';

      const rawRole = item.role;
      const role =
        typeof rawRole === 'string' && rawRole.trim()
          ? rawRole
          : 'member';

      const rawStatus = item.status;
      const status =
        typeof rawStatus === 'string' ? rawStatus : 'active';

      return {
        id:
          typeof item.id === 'string'
            ? item.id
            : userId || `${name}-${role}`,
        userId,
        name,
        role,
        status,
      };
    })
    .filter((member) => member.status === 'active');
}

export default function StudyGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [courseFilter, setCourseFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState('');

  const [title, setTitle] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [schedule, setSchedule] = useState('');
  const [participantLimit, setParticipantLimit] = useState(8);
  const [approvalRequired, setApprovalRequired] = useState(true);

  const [requests, setRequests] = useState<
    Record<string, RequestItem[]>
  >({});

  const [membersByGroup, setMembersByGroup] = useState<
    Record<string, MemberItem[]>
  >({});
  const [membersVisible, setMembersVisible] = useState<
    Record<string, boolean>
  >({});
  const [membersLoading, setMembersLoading] = useState<
    Record<string, boolean>
  >({});
  const [membersErrors, setMembersErrors] = useState<
    Record<string, string>
  >({});

  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadGroups = useCallback(async () => {
    setError('');

    const params = new URLSearchParams({
      page: '1',
      limit: '50',
    });

    if (courseFilter.trim()) {
      params.set('courseCode', courseFilter.trim());
    }

    if (topicFilter.trim()) {
      params.set('topic', topicFilter.trim());
    }

    try {
      const response = await fetch(
        `/api/backend/study-groups?${params}`,
        { cache: 'no-store' },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const result = (await response.json()) as PageResult;
      setGroups(result.data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load study groups',
      );
    }
  }, [courseFilter, topicFilter]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  async function loadMembers(groupId: string) {
    setMembersLoading((previous) => ({
      ...previous,
      [groupId]: true,
    }));
    setMembersErrors((previous) => ({
      ...previous,
      [groupId]: '',
    }));

    try {
      const response = await fetch(
        `/api/backend/study-groups/${groupId}/members`,
        { cache: 'no-store' },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const payload: unknown = await response.json();
      const members = normalizeMembers(payload);

      setMembersByGroup((previous) => ({
        ...previous,
        [groupId]: members,
      }));

      setMembersVisible((previous) => ({
        ...previous,
        [groupId]: true,
      }));
    } catch (err) {
      setMembersErrors((previous) => ({
        ...previous,
        [groupId]:
          err instanceof Error
            ? err.message
            : 'Could not load group members.',
      }));
    } finally {
      setMembersLoading((previous) => ({
        ...previous,
        [groupId]: false,
      }));
    }
  }

  async function toggleMembers(groupId: string) {
    if (membersVisible[groupId]) {
      setMembersVisible((previous) => ({
        ...previous,
        [groupId]: false,
      }));
      return;
    }

    await loadMembers(groupId);
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const response = await fetch('/api/backend/study-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          courseCode,
          topic,
          description,
          schedule,
          participantLimit,
          approvalRequired,
        }),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setTitle('');
      setCourseCode('');
      setTopic('');
      setDescription('');
      setSchedule('');
      setParticipantLimit(8);
      setApprovalRequired(true);

      setNotice(
        'Study group created. You are its creator and first member.',
      );

      await loadGroups();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not create group',
      );
    } finally {
      setBusy(false);
    }
  }

  async function joinGroup(group: Group) {
    setBusyId(group.id);
    setError('');
    setNotice('');

    try {
      const response = await fetch(
        `/api/backend/study-groups/${group.id}/join`,
        { method: 'POST' },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setNotice(
        group.approvalRequired
          ? 'Join request sent to the group creator.'
          : 'You joined the study group.',
      );

      await loadGroups();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not join group',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function loadRequests(groupId: string) {
    setBusyId(`requests:${groupId}`);
    setError('');

    try {
      const response = await fetch(
        `/api/backend/study-groups/${groupId}/requests`,
        { cache: 'no-store' },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const result = (await response.json()) as RequestItem[];

      setRequests((previous) => ({
        ...previous,
        [groupId]: result,
      }));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load join requests',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function review(
    group: Group,
    request: RequestItem,
    status: 'active' | 'rejected',
  ) {
    setBusyId(request.id);
    setError('');
    setNotice('');

    try {
      const response = await fetch(
        `/api/backend/study-groups/${group.id}/members/${request.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setRequests((previous) => ({
        ...previous,
        [group.id]: (previous[group.id] ?? []).filter(
          (item) => item.id !== request.id,
        ),
      }));

      setNotice(
        status === 'active'
          ? `${request.name} was approved and added to the group.`
          : `${request.name}'s join request was rejected.`,
      );

      await Promise.all([loadRequests(group.id), loadGroups()]);

      if (membersVisible[group.id]) {
        await loadMembers(group.id);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not review request',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function leaveGroup(group: Group) {
    if (!window.confirm(`Leave “${group.title}”?`)) {
      return;
    }

    setBusyId(group.id);
    setError('');
    setNotice('');

    try {
      const response = await fetch(
        `/api/backend/study-groups/${group.id}/membership`,
        { method: 'DELETE' },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setNotice('You left the study group.');
      await loadGroups();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not leave group',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function archiveGroup(group: Group) {
    if (
      !window.confirm(
        `Archive “${group.title}”? It will no longer accept members.`,
      )
    ) {
      return;
    }

    setBusyId(group.id);
    setError('');
    setNotice('');

    try {
      const response = await fetch(
        `/api/backend/study-groups/${group.id}/archive`,
        { method: 'PATCH' },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setNotice('Study group archived.');
      await loadGroups();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not archive group',
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">
          Study Groups
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Discover course-based groups, coordinate schedules, and manage
          membership within your campus.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
        >
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}

      <form
        onSubmit={createGroup}
        className="grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-2"
      >
        <h2 className="text-lg font-semibold sm:col-span-2">
          Create a study group
        </h2>

        <label className="text-sm font-medium">
          Group name
          <input
            required
            minLength={3}
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 block w-full rounded-lg border p-2"
            placeholder="e.g. Data Structures Revision"
          />
        </label>

        <label className="text-sm font-medium">
          Course code
          <input
            required
            minLength={2}
            maxLength={40}
            value={courseCode}
            onChange={(event) => setCourseCode(event.target.value)}
            className="mt-1 block w-full rounded-lg border p-2"
            placeholder="e.g. CSE220"
          />
        </label>

        <label className="text-sm font-medium">
          Topic
          <input
            required
            minLength={2}
            maxLength={100}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            className="mt-1 block w-full rounded-lg border p-2"
            placeholder="e.g. Graph algorithms"
          />
        </label>

        <label className="text-sm font-medium">
          Schedule / availability
          <input
            required
            minLength={2}
            maxLength={500}
            value={schedule}
            onChange={(event) => setSchedule(event.target.value)}
            className="mt-1 block w-full rounded-lg border p-2"
            placeholder="e.g. Tue/Thu 3–4 PM, Library"
          />
        </label>

        <label className="text-sm font-medium">
          Participant limit
          <input
            type="number"
            required
            min={2}
            max={100}
            value={participantLimit}
            onChange={(event) =>
              setParticipantLimit(Number(event.target.value))
            }
            className="mt-1 block w-full rounded-lg border p-2"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={approvalRequired}
            onChange={(event) =>
              setApprovalRequired(event.target.checked)
            }
          />
          Require creator approval for new members
        </label>

        <label className="text-sm font-medium sm:col-span-2">
          Description
          <textarea
            required
            minLength={10}
            maxLength={3000}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-1 block w-full rounded-lg border p-2"
            placeholder="Learning goals, expected preparation, and how the group will work."
          />
        </label>

        <button
          disabled={busy}
          className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50 sm:col-span-2"
        >
          {busy ? 'Creating…' : 'Create group'}
        </button>
      </form>

      <section className="space-y-4">
        <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3">
          <label className="text-sm font-medium">
            Filter by course
            <input
              value={courseFilter}
              onChange={(event) => setCourseFilter(event.target.value)}
              className="mt-1 block w-full rounded-lg border p-2"
              placeholder="CSE220"
            />
          </label>

          <label className="text-sm font-medium">
            Filter by topic
            <input
              value={topicFilter}
              onChange={(event) => setTopicFilter(event.target.value)}
              className="mt-1 block w-full rounded-lg border p-2"
              placeholder="Algorithms"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setCourseFilter('');
                setTopicFilter('');
              }}
              className="rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Clear filters
            </button>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold">Groups in your campus</h2>
          <p className="text-sm text-slate-500">
            Course and topic filters are applied on the server.
          </p>
        </div>

        {groups.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">
            No groups found. Create one to get started.
          </p>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {groups.map((group) => (
              <li
                key={group.id}
                className="space-y-3 rounded-2xl border bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      {group.title}
                    </h3>
                    <p className="mt-1 text-sm font-medium text-emerald-800">
                      {group.courseCode} · {group.topic}
                    </p>
                  </div>

                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs">
                    {group.memberCount}/{group.participantLimit} members
                  </span>
                </div>

                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {group.description}
                </p>

                <p className="text-sm text-slate-500">
                  Schedule: {group.schedule}
                </p>

                <p className="text-xs text-slate-500">
                  {group.approvalRequired
                    ? 'Creator approval required'
                    : 'Open join'}
                  {group.isCreator ? ' · You are the creator' : ''}
                </p>

                <div className="flex flex-wrap gap-2">
                  {!group.isCreator &&
                    (!group.myMembershipStatus ||
                      group.myMembershipStatus === 'rejected') &&
                    group.memberCount < group.participantLimit && (
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => void joinGroup(group)}
                        className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {busyId === group.id
                          ? 'Sending…'
                          : group.approvalRequired
                            ? 'Request to join'
                            : 'Join group'}
                      </button>
                    )}

                  {group.myMembershipStatus === 'pending' && (
                    <span className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Join request pending
                    </span>
                  )}

                  {group.myMembershipStatus === 'active' &&
                    !group.isCreator && (
                      <>
                        <span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                          Member
                        </span>
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => void leaveGroup(group)}
                          className="rounded-lg border px-3 py-2 text-sm"
                        >
                          Leave group
                        </button>
                      </>
                    )}

                  {group.isCreator && (
                    <>
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => void loadRequests(group.id)}
                        className="rounded-lg border px-3 py-2 text-sm"
                      >
                        {busyId === `requests:${group.id}`
                          ? 'Loading…'
                          : 'Manage join requests'}
                      </button>

                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => void archiveGroup(group)}
                        className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-700"
                      >
                        Archive
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    disabled={membersLoading[group.id]}
                    onClick={() => void toggleMembers(group.id)}
                    aria-expanded={Boolean(membersVisible[group.id])}
                    className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {membersLoading[group.id]
                      ? 'Loading members…'
                      : membersVisible[group.id]
                        ? 'Hide members'
                        : 'View members'}
                  </button>
                </div>

                {membersErrors[group.id] && (
                  <p
                    role="alert"
                    className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700"
                  >
                    {membersErrors[group.id]}
                  </p>
                )}

                {membersVisible[group.id] && (
                  <section
                    aria-label={`Members of ${group.title}`}
                    className="space-y-3 rounded-xl border bg-slate-50 p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-semibold text-slate-900">
                        Group members
                      </h4>
                      <button
                        type="button"
                        disabled={membersLoading[group.id]}
                        onClick={() => void loadMembers(group.id)}
                        className="text-sm font-medium text-emerald-800 underline disabled:opacity-50"
                      >
                        Refresh
                      </button>
                    </div>

                    {membersLoading[group.id] ? (
                      <p className="text-sm text-slate-500">
                        Loading members…
                      </p>
                    ) : (membersByGroup[group.id] ?? []).length === 0 ? (
                      <p className="text-sm text-slate-500">
                        No active members were returned by the API.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {(membersByGroup[group.id] ?? []).map((member) => (
                          <li
                            key={member.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3"
                          >
                            <div>
                              <p className="text-sm font-medium text-slate-900">
                                {member.name}
                              </p>
                              <p className="text-xs text-slate-500">
                                {member.userId}
                              </p>
                            </div>

                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium capitalize text-emerald-800">
                              {member.role}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}

                {requests[group.id] && (
                  <div className="space-y-2 border-t pt-3">
                    <h4 className="text-sm font-semibold">
                      Pending requests ({requests[group.id].length})
                    </h4>

                    {requests[group.id].length === 0 ? (
                      <p className="text-sm text-slate-500">
                        No pending requests.
                      </p>
                    ) : (
                      requests[group.id].map((request) => (
                        <div
                          key={request.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3"
                        >
                          <span className="text-sm">{request.name}</span>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busyId !== null}
                              onClick={() =>
                                void review(group, request, 'active')
                              }
                              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white"
                            >
                              Approve
                            </button>

                            <button
                              type="button"
                              disabled={busyId !== null}
                              onClick={() =>
                                void review(group, request, 'rejected')
                              }
                              className="rounded-md border px-3 py-1.5 text-xs"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
