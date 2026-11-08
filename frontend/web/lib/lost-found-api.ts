// Browser-side client for the lost-and-found API. Shared fetch helpers live in ./api-client.

import { call, firstParam, json, parsePage, type RawSearchParams } from './api-client';

export { readError, type ApiResult } from './api-client';

export type LostFoundType = 'lost' | 'found';
export type Photo = { id: string; url: string };

export type Report = {
  id: string;
  type: LostFoundType;
  title: string;
  description: string;
  category: string;
  location: string;
  itemDate: string;
  /** Legacy link, read-only. Only returned to viewers who may see this report's photos. */
  imageUrl: string | null;
  /** Empty when the viewer may not see this report's photos (e.g. someone else's found item). */
  photos: Photo[];
  status: 'open' | 'resolved';
  createdAt: string;
  isMine?: boolean;
};

export type ClaimStatus = 'pending' | 'approved' | 'rejected';
/** The viewer's own claim: no private proof details. */
export type MyClaim = {
  id: string;
  reportId: string;
  status: ClaimStatus;
  reviewerNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};
/** A claim as the finder sees it when reviewing. */
export type Claim = MyClaim & { claimantId: string; proofDetails: string };

export type ReportDetail = Report & { isMine: boolean; myClaim: MyClaim | null };

/** GET /lost-found/mine: only the caller's own reports and claims, each capped at 100 (newest first). */
export type MyActivity = {
  reports: { items: Report[]; truncated: boolean };
  claims: { items: { claim: MyClaim; report: Report }[]; truncated: boolean };
};
export const MY_LIST_LIMIT = 100;

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  pending: 'Pending review by the finder',
  approved: 'Approved: the finder confirmed this item is yours',
  rejected: 'Not approved',
};
export type Match = { report: Report; score: number; reasons: string[] };
export type ReportList = { data: Report[]; pagination: { page: number; limit: number; total: number; pages: number } };
export type NewReport = Pick<Report, 'type' | 'title' | 'description' | 'category' | 'location' | 'itemDate'>;

/** API photo URLs start with /api/; the browser loads them through the authenticated proxy. */
export const proxied = (url: string) => url.replace(/^\/api\//, '/api/backend/');

// ---------------- list URL state ----------------

export const PAGE_SIZE = 20;
export type ListParams = { type: LostFoundType | null; page: number };
/** Anything unexpected falls back to the defaults (all types, page 1) instead of failing. */
export function parseListParams(raw: RawSearchParams): ListParams {
  const type = firstParam(raw.type);
  return {
    type: type === 'lost' || type === 'found' ? type : null,
    page: parsePage(raw.page),
  };
}

/** Canonical list URL; defaults are left out. */
export function listHref({ type, page }: ListParams): string {
  const query = new URLSearchParams();
  if (type) query.set('type', type);
  if (page > 1) query.set('page', String(page));
  const qs = query.toString();
  return qs ? `/lost-found?${qs}` : '/lost-found';
}

// ---------------- calls ----------------

export function listReports({ type, page }: ListParams, signal?: AbortSignal) {
  const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (type) query.set('type', type);
  return call<ReportList>(`/lost-found?${query}`, { signal });
}

export const getReport = (id: string, signal?: AbortSignal) =>
  call<ReportDetail>(`/lost-found/${encodeURIComponent(id)}`, { signal });

export const getMine = (signal?: AbortSignal) => call<MyActivity>('/lost-found/mine', { signal });

export const getMatches = (id: string, signal?: AbortSignal) =>
  call<Match[]>(`/lost-found/${encodeURIComponent(id)}/matches`, { signal });

export const createReport = (report: NewReport) => call<Report>('/lost-found', json('POST', report));

export const submitClaim = (reportId: string, proofDetails: string) =>
  call<MyClaim>(`/lost-found/${encodeURIComponent(reportId)}/claims`, json('POST', { proofDetails }));

export const listClaims = (reportId: string) => call<Claim[]>(`/lost-found/${encodeURIComponent(reportId)}/claims`);

export const reviewClaim = (claimId: string, status: 'approved' | 'rejected', reviewerNote: string) =>
  call<Claim>(`/lost-found/claims/${encodeURIComponent(claimId)}/review`, json('PATCH', { status, reviewerNote }));

export const resolveReport = (id: string) =>
  call<Report>(`/lost-found/${encodeURIComponent(id)}/resolve`, { method: 'PATCH' });

export type UploadResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * One photo per request: keeps each request small and gives real progress (fetch has no upload
 * progress). On failure, `message` reads after the file name, e.g. `"x.gif" is not a supported image...`.
 */
export function uploadPhoto(reportId: string, file: File, onProgress: (percent: number) => void): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/backend/lost-found/${encodeURIComponent(reportId)}/photos`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve({ ok: true });
      let message = `Upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string | string[] };
        if (body.message) message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
      } catch {
        /* not JSON */
      }
      if (xhr.status === 413) message = 'is larger than 5 MB.';
      // The API numbers files within a request; each request carries exactly one.
      resolve({ ok: false, status: xhr.status, message: message.replace(/^File #1 /, '') });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, message: 'could not be uploaded. Check your connection and try again.' });
    const form = new FormData();
    form.append('files', file);
    xhr.send(form);
  });
}
