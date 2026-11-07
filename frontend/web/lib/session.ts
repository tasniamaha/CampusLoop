import type { NextRequest, NextResponse } from 'next/server';
import { forwardedForHeader } from './client-ip';

export const ACCESS_COOKIE = 'campusloop_token';
export const REFRESH_COOKIE = 'campusloop_refresh';
/** Drop the access cookie a little before the JWT expires so the proxy refreshes ahead of a 401. */
const ACCESS_EXPIRY_SKEW_SECONDS = 30;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  campus: string;
  role: string;
  emailVerifiedAt: string | null;
}

export interface BackendSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: string;
  user: SessionUser;
}

export type RefreshResult =
  | { ok: true; session: BackendSession }
  /** fatal: the backend rejected the token, so the session is over. Otherwise a transient failure. */
  | { ok: false; fatal: boolean };

/**
 * Read-only: does this request carry a session? Signed in = access cookie OR refresh cookie, because
 * the access cookie lasts ~15 minutes and proxy.ts renews it from the refresh cookie on the next request.
 *
 * For display only (which header links to show). It does not validate anything: every page and API
 * call still checks access on its own. Takes the cookie store so this module stays free of next/headers.
 */
export function hasSessionCookie(store: { has(name: string): boolean }): boolean {
  return store.has(ACCESS_COOKIE) || store.has(REFRESH_COOKIE);
}

export function isBackendSession(value: unknown): value is BackendSession {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accessToken === 'string' &&
    typeof v.expiresIn === 'number' &&
    typeof v.refreshToken === 'string' &&
    typeof v.refreshExpiresAt === 'string' &&
    !Number.isNaN(Date.parse(v.refreshExpiresAt)) &&
    typeof v.user === 'object' &&
    v.user !== null
  );
}

const baseCookie = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // lax, not strict: the refresh cookie must reach the proxy on top-level navigations from email links.
  sameSite: 'lax' as const,
  path: '/',
});

export function setSessionCookies(response: NextResponse, session: BackendSession): void {
  response.cookies.set(ACCESS_COOKIE, session.accessToken, {
    ...baseCookie(),
    maxAge: Math.max(session.expiresIn - ACCESS_EXPIRY_SKEW_SECONDS, 1),
  });
  response.cookies.set(REFRESH_COOKIE, session.refreshToken, {
    ...baseCookie(),
    expires: new Date(session.refreshExpiresAt),
  });
}

export function clearSessionCookies(response: NextResponse): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
    response.cookies.set(name, '', { ...baseCookie(), maxAge: 0 });
  }
}

function apiUrl(): string | null {
  const url = process.env.API_URL;
  return url ? url.replace(/\/$/, '') : null;
}

/** Exchanges the refresh token. Never throws. */
export async function refreshSession(refreshToken: string, request: NextRequest): Promise<RefreshResult> {
  const base = apiUrl();
  if (!base) return { ok: false, fatal: false };

  try {
    const response = await fetch(`${base}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': request.headers.get('user-agent') ?? '',
        ...forwardedForHeader(request),
      },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (response.status === 400 || response.status === 401) return { ok: false, fatal: true };
    if (!response.ok) return { ok: false, fatal: false };

    const data: unknown = await response.json();
    return isBackendSession(data) ? { ok: true, session: data } : { ok: false, fatal: false };
  } catch {
    return { ok: false, fatal: false };
  }
}

/** Best effort: the cookies are cleared regardless of the outcome. */
export async function revokeSession(refreshToken: string): Promise<void> {
  const base = apiUrl();
  if (!base) return;
  try {
    await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
  } catch {
    // The refresh token still expires on its own; nothing more to do here.
  }
}
