import { NextResponse, type NextRequest } from 'next/server';
import { REFRESH_COOKIE, clearSessionCookies, revokeSession } from '../../../../lib/session';

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) await revokeSession(refreshToken);

  const response = NextResponse.json({ ok: true });
  clearSessionCookies(response);
  return response;
}
