import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

const API_URL = process.env.API_URL;

export type UserRole = 'student' | 'moderator' | 'admin';

/** What GET /auth/me returns. */
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  campus: string;
  role: UserRole;
  emailVerifiedAt: string | null;
  createdAt: string;
}

/**
 * The signed-in user, or null (no session, expired session, or the API could not be reached).
 * Wrapped in cache() so the site header and the page share one /auth/me call per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get('campusloop_token')?.value;

  if (!token || !API_URL) {
    return null;
  }

  try {
    const response = await fetch(`${API_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as CurrentUser;
  } catch {
    return null;
  }
});

/**
 * For pages that only some roles may open. Not signed in: to /login. Signed in with another role:
 * a 404, so the page does not reveal that it exists. The role comes from /auth/me, which reads it
 * from the database on every call.
 *
 * This only decides what the page renders. The API checks the role again on every request, and
 * that check is the real authorisation.
 */
export async function requireRole(roles: readonly UserRole[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!roles.includes(user.role)) notFound();
  return user;
}
