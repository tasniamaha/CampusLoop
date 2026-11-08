// Browser-side client for the study-groups API. Shared fetch helpers live in ./api-client.

import { call, firstParam, json, parsePage, type RawSearchParams } from './api-client';

export type MembershipStatus = 'pending' | 'active' | 'rejected';
export type GroupStatus = 'open' | 'archived';

export type Group = {
  id: string;
  title: string;
  courseCode: string;
  topic: string;
  description: string;
  schedule: string;
  participantLimit: number;
  approvalRequired: boolean;
  status: GroupStatus;
  createdAt: string;
  /** Active members, the creator included. */
  memberCount: number;
  isCreator: boolean;
  myMembershipStatus: MembershipStatus | null;
};

/** Display fields only: the API returns no user ids or emails for members. */
export type Member = { name: string; role: 'owner' | 'member'; joinedAt: string };
/** A pending join request, as the creator sees it. */
export type JoinRequest = { id: string; name: string; requestedAt: string };

/** What /mine returns for a request to a group that has since been archived: no link, no details. */
export type ArchivedGroupSummary = Pick<Group, 'id' | 'title' | 'courseCode' | 'topic'> & { status: 'archived' };
export type MyRequest = {
  request: { id: string; status: 'pending' | 'rejected'; requestedAt: string; reviewedAt: string | null };
  group: Group | ArchivedGroupSummary;
};
type Capped<T> = { items: T[]; truncated: boolean };
/** GET /study-groups/mine: only the caller's own rows, each section capped at 100 (newest first). */
export type MyGroups = { created: Capped<Group>; memberships: Capped<Group>; requests: Capped<MyRequest> };
export const MY_LIST_LIMIT = 100;

export const isFullGroup = (group: Group | ArchivedGroupSummary): group is Group => 'memberCount' in group;
export const isFull = (group: Group) => group.memberCount >= group.participantLimit;
/** Cosmetic: avoids calling the member list when the API would refuse. The server decides. */
export const canSeeMembers = (group: Group) => group.isCreator || group.myMembershipStatus === 'active';

export type NewGroup = Pick<Group, 'title' | 'courseCode' | 'topic' | 'description' | 'schedule' | 'participantLimit' | 'approvalRequired'>;
export type GroupList = { data: Group[]; pagination: { page: number; limit: number; total: number; pages: number } };

// ---------------- list URL state ----------------

export const PAGE_SIZE = 20;
// Same limits as the API's ListStudyGroupsQueryDto.
const COURSE_MAX = 40;
const TOPIC_MAX = 100;

export type ListParams = { course: string | null; topic: string | null; page: number };

/** Trimmed, whitespace collapsed; empty or over the API's limit falls back to "no filter". */
function parseFilter(value: string | string[] | undefined, max: number): string | null {
  const cleaned = firstParam(value)?.trim().replace(/\s+/g, ' ');
  return cleaned && cleaned.length <= max ? cleaned : null;
}

/** Anything unexpected falls back to the defaults (no filters, page 1) instead of failing. */
export function parseListParams(raw: RawSearchParams): ListParams {
  return { course: parseFilter(raw.course, COURSE_MAX), topic: parseFilter(raw.topic, TOPIC_MAX), page: parsePage(raw.page) };
}

/** Canonical list URL; defaults are left out. */
export function listHref({ course, topic, page }: ListParams): string {
  const query = new URLSearchParams();
  if (course) query.set('course', course);
  if (topic) query.set('topic', topic);
  if (page > 1) query.set('page', String(page));
  const qs = query.toString();
  return qs ? `/study-groups?${qs}` : '/study-groups';
}

export const FILTER_LIMITS = { course: COURSE_MAX, topic: TOPIC_MAX } as const;

// ---------------- calls ----------------

const groupPath = (id: string) => `/study-groups/${encodeURIComponent(id)}`;

export function listGroups({ course, topic, page }: ListParams, signal?: AbortSignal) {
  const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (course) query.set('courseCode', course);
  if (topic) query.set('topic', topic);
  return call<GroupList>(`/study-groups?${query}`, { signal });
}

export const getGroup = (id: string, signal?: AbortSignal) => call<Group>(groupPath(id), { signal });

export const getMyGroups = (signal?: AbortSignal) => call<MyGroups>('/study-groups/mine', { signal });

export const createGroup = (group: NewGroup) => call<Group>('/study-groups', json('POST', group));

export const joinGroup = (id: string) => call<{ status: MembershipStatus }>(`${groupPath(id)}/join`, { method: 'POST' });

/** Leaves the group, or withdraws a pending request. */
export const leaveGroup = (id: string) => call<{ success: true }>(`${groupPath(id)}/membership`, { method: 'DELETE' });

export const archiveGroup = (id: string) => call<Group>(`${groupPath(id)}/archive`, { method: 'PATCH' });

export const listMembers = (id: string, signal?: AbortSignal) => call<Member[]>(`${groupPath(id)}/members`, { signal });

export const listRequests = (id: string, signal?: AbortSignal) => call<JoinRequest[]>(`${groupPath(id)}/requests`, { signal });

export const reviewRequest = (groupId: string, requestId: string, status: 'active' | 'rejected') =>
  call<unknown>(`${groupPath(groupId)}/members/${encodeURIComponent(requestId)}`, json('PATCH', { status }));
