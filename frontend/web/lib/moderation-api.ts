// Browser-side client for the moderation queue. Moderators see their own campus only; admins see
// every campus. The API enforces both, and every action is audit-logged.

import { call, firstParam, json, parsePage, type RawSearchParams } from './api-client';

export type ReportStatus = 'open' | 'resolved' | 'dismissed';
export type ReportTargetType = 'review' | 'resource' | 'lost_found';

/** Display fields only: never photos, descriptions or claim proof. */
export type TargetSummary =
  | { type: 'review'; excerpt: string | null; isHidden: boolean }
  | { type: 'resource'; title: string; removed: boolean }
  | { type: 'lost_found'; title: string; noticeType: 'lost' | 'found' };

export type ModerationReport = {
  id: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  status: ReportStatus;
  resolvedById: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  /** null when the reported item no longer exists. */
  target: TargetSummary | null;
};

/** `openTotal`: open reports in the same campus scope (for the All view heading). */
export type ReportPage = { page: number; limit: number; total: number; openTotal: number; totalPages: number; items: ModerationReport[] };

// ---------------- URL state ----------------

/** In display order. All is the default (see parseQueueParams). */
export const STATUS_FILTERS = ['all', 'open', 'resolved', 'dismissed'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export type QueueParams = { status: StatusFilter; page: number };

/**
 * The queue opens on All (no status in the URL): open reports first, oldest first, then closed
 * ones, newest first, sorted by the API. Anything unexpected falls back to All and page 1.
 */
export function parseQueueParams(raw: RawSearchParams): QueueParams {
  const status = firstParam(raw.status);
  return {
    status: STATUS_FILTERS.includes(status as StatusFilter) ? (status as StatusFilter) : 'all',
    page: parsePage(raw.page),
  };
}

export function queueHref({ status, page }: QueueParams): string {
  const query = new URLSearchParams();
  if (status !== 'all') query.set('status', status);
  if (page > 1) query.set('page', String(page));
  const qs = query.toString();
  return qs ? `/moderation?${qs}` : '/moderation';
}

// Same limits as the API: ResolveReportDto.note and ModerateReviewDto.reason.
export const NOTE_MAX = 255;
export const QUEUE_PAGE_SIZE = 20;

// ---------------- calls ----------------

export function listReports({ status, page }: QueueParams, signal?: AbortSignal) {
  const query = new URLSearchParams({ page: String(page), limit: String(QUEUE_PAGE_SIZE) });
  if (status !== 'all') query.set('status', status);
  return call<ReportPage>(`/moderation/reports?${query}`, { signal });
}

export const closeReport = (id: string, status: 'resolved' | 'dismissed', note: string) =>
  call<{ id: string; status: ReportStatus }>(`/moderation/reports/${encodeURIComponent(id)}/resolve`, json('PATCH', note ? { status, note } : { status }));

/** Hiding needs a reason, and resolves every open report about the review. */
export const hideReview = (id: string, reason: string) =>
  call<{ id: string; isHidden: boolean }>(`/reviews/${encodeURIComponent(id)}/hide`, json('PATCH', { reason }));

export const unhideReview = (id: string, reason: string) =>
  call<{ id: string; isHidden: boolean }>(`/reviews/${encodeURIComponent(id)}/unhide`, json('PATCH', reason ? { reason } : {}));
