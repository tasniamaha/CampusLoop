import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearSessionCookies,
  refreshSession,
  setSessionCookies,
} from './lib/session';

/**
 * Silent session renewal. When the access cookie has expired but a refresh cookie exists,
 * rotate once here, then:
 *  - set the new cookies on the response (browser), and
 *  - rewrite the request cookies (so server components and /api/backend see the new token now).
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const hasAccess = Boolean(request.cookies.get(ACCESS_COOKIE)?.value);
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (hasAccess || !refreshToken) return NextResponse.next();

  const result = await refreshSession(refreshToken, request);

  if (result.ok) {
    request.cookies.set(ACCESS_COOKIE, result.session.accessToken);
    request.cookies.set(REFRESH_COOKIE, result.session.refreshToken);
    const response = NextResponse.next({ request: { headers: request.headers } });
    setSessionCookies(response, result.session);
    return response;
  }

  if (result.fatal) {
    request.cookies.delete(REFRESH_COOKIE);
    const response = NextResponse.next({ request: { headers: request.headers } });
    clearSessionCookies(response);
    return response;
  }

  // Transient (API down): keep the refresh cookie so the next request can retry.
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except static assets and the auth routes, which manage cookies themselves.
    '/((?!_next/static|_next/image|favicon.ico|api/auth/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
