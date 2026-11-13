// Browser-side client for the admin API (/admin/*). Shared fetch helpers live in ./api-client.
// Every call is checked by the API against the caller's current role in the database.

import { call, firstParam, json, parsePage, type RawSearchParams } from './api-client';
import type { UserRole } from './auth';

export type Pagination = { page: number; limit: number; total: number; pages: number };
export type Paginated<T> = { data: T[]; pagination: Pagination };

export const ROLES: readonly UserRole[] = ['student', 'moderator', 'admin'];

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  campus: string;
  role: UserRole;
  emailVerifiedAt: string | null;
  deactivatedAt: string | null;
  createdAt: string;
};

export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  deactivatedAt: string | null;
  createdAt: string;
  /** Resources (not deleted) using this category. */
  resourceCount: number;
};

export type AuditEntry = {
  id: string;
  createdAt: string;
  /** null = the system (the admin:promote CLI, expiry sweeps). */
  actorId: string | null;
  actor: { name: string; email: string } | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
};

export const LOAN_STATUSES = ['pending', 'approved', 'active', 'returned', 'rejected', 'cancelled', 'expired'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

type OpenResolved = { open: number; resolved: number };
export type CampusCounts = {
  users: { total: number; active: number; deactivated: number };
  resources: number;
  activeLoans: number;
  loans: Record<LoanStatus, number>;
  lostFound: { lost: OpenResolved; found: OpenResolved };
  claims: Record<string, number>;
  studyGroups: { open: number; archived: number };
};
export type Analytics = { generatedAt: string; campuses: Array<{ campus: string } & CampusCounts>; totals: CampusCounts };

// ---------------- URL state ----------------

// Same limits as the API's filter DTOs.
const TEXT_MAX = 100;
const ACTION_MAX = 60;
const ACTION_PATTERN = /^[a-z_]+(\.[a-z_]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const FILTER_LIMITS = { text: TEXT_MAX, action: ACTION_MAX } as const;

/** Trimmed text, or null when empty or over the limit. */
function text(value: string | string[] | undefined, max = TEXT_MAX): string | null {
  const cleaned = firstParam(value)?.trim();
  return cleaned && cleaned.length <= max ? cleaned : null;
}

function oneOf<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | null {
  const v = firstParam(value);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** A real calendar date (YYYY-MM-DD), or null. */
function date(value: string | string[] | undefined): string | null {
  const v = firstParam(value);
  if (!v || !DATE_PATTERN.test(v)) return null;
  const parsed = new Date(`${v}T00:00:00Z`);
  // Rejects dates that roll over, such as 2026-02-31.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(v) ? v : null;
}

/** Builds `?a=1&b=2` from the non-empty values, or '' when there are none. */
function queryString(values: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

export type UserFilters = {
  q: string | null;
  campus: string | null;
  role: UserRole | null;
  verified: 'true' | 'false' | null;
  status: 'active' | 'deactivated' | null;
};
export type UserListParams = UserFilters & { page: number };

/** Anything unexpected falls back to "no filter" and page 1 instead of failing. */
export function parseUserParams(raw: RawSearchParams): UserListParams {
  return {
    q: text(raw.q),
    campus: text(raw.campus),
    role: oneOf(raw.role, ROLES),
    verified: oneOf(raw.verified, ['true', 'false'] as const),
    status: oneOf(raw.status, ['active', 'deactivated'] as const),
    page: parsePage(raw.page),
  };
}

const userFilterValues = ({ q, campus, role, verified, status }: UserFilters) => ({ q, campus, role, verified, status });
export const usersHref = (params: UserListParams) => `/admin${queryString({ ...userFilterValues(params), page: params.page > 1 ? params.page : null })}`;
export const hasUserFilters = (f: UserFilters) => Boolean(f.q || f.campus || f.role || f.verified || f.status);

export type AuditFilters = { action: string | null; actorId: string | null; from: string | null; to: string | null };
export type AuditListParams = AuditFilters & { page: number };

export function parseAuditParams(raw: RawSearchParams): AuditListParams {
  const action = text(raw.action, ACTION_MAX);
  const actorId = text(raw.actorId);
  return {
    action: action && ACTION_PATTERN.test(action) ? action : null,
    actorId: actorId && UUID_PATTERN.test(actorId) ? actorId.toLowerCase() : null,
    from: date(raw.from),
    to: date(raw.to),
    page: parsePage(raw.page),
  };
}

const auditFilterValues = ({ action, actorId, from, to }: AuditFilters) => ({ action, actorId, from, to });
export const auditHref = (params: AuditListParams) => `/admin/audit-log${queryString({ ...auditFilterValues(params), page: params.page > 1 ? params.page : null })}`;
export const hasAuditFilters = (f: AuditFilters) => Boolean(f.action || f.actorId || f.from || f.to);

export type LoanFilters = { status: LoanStatus | null; campus: string | null; from: string | null; to: string | null };

export function parseLoanFilters(raw: RawSearchParams): LoanFilters {
  return { status: oneOf(raw.status, LOAN_STATUSES), campus: text(raw.campus), from: date(raw.from), to: date(raw.to) };
}

// ---------------- calls ----------------

export const USERS_PAGE_SIZE = 20;
export const AUDIT_PAGE_SIZE = 50;

const userPath = (id: string) => `/admin/users/${encodeURIComponent(id)}`;
const categoryPath = (id: string) => `/admin/categories/${encodeURIComponent(id)}`;

export const listUsers = (params: UserListParams, signal?: AbortSignal) =>
  call<Paginated<AdminUser>>(`/admin/users${queryString({ ...userFilterValues(params), page: params.page, limit: USERS_PAGE_SIZE })}`, { signal });
export const changeRole = (id: string, role: UserRole) => call<AdminUser>(`${userPath(id)}/role`, json('PATCH', { role }));
export const deactivateUser = (id: string) => call<AdminUser>(`${userPath(id)}/deactivate`, { method: 'PATCH' });
export const reactivateUser = (id: string) => call<AdminUser>(`${userPath(id)}/reactivate`, { method: 'PATCH' });

export const listCategories = (signal?: AbortSignal) => call<AdminCategory[]>('/admin/categories', { signal });
export const createCategory = (name: string) => call<AdminCategory>('/admin/categories', json('POST', { name }));
export const renameCategory = (id: string, name: string) => call<AdminCategory>(categoryPath(id), json('PATCH', { name }));
export const deactivateCategory = (id: string) => call<AdminCategory>(`${categoryPath(id)}/deactivate`, { method: 'PATCH' });
export const reactivateCategory = (id: string) => call<AdminCategory>(`${categoryPath(id)}/reactivate`, { method: 'PATCH' });

export const listAuditLogs = (params: AuditListParams, signal?: AbortSignal) =>
  call<Paginated<AuditEntry>>(`/admin/audit-logs${queryString({ ...auditFilterValues(params), page: params.page, limit: AUDIT_PAGE_SIZE })}`, { signal });

export const getAnalytics = (signal?: AbortSignal) => call<Analytics>('/admin/analytics', { signal });

// Export paths: the same filters as the lists (no paging), for ExportButton.
export const usersExportPath = (f: UserFilters) => `/admin/exports/users.csv${queryString(userFilterValues(f))}`;
export const auditExportPath = (f: AuditFilters) => `/admin/exports/audit-logs.csv${queryString(auditFilterValues(f))}`;
export const loansExportPath = ({ status, campus, from, to }: LoanFilters) => `/admin/exports/loans.csv${queryString({ status, campus, from, to })}`;
