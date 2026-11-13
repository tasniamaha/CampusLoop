import { cookies } from 'next/headers';
import { getCurrentUser } from '../../lib/auth';
import { hasSessionCookie } from '../../lib/session';
import SiteNav from './SiteNav';

/**
 * Reads whether the request carries a session (access OR refresh cookie) and renders the bar.
 * Request-time read, so app/layout.tsx wraps this in <Suspense>. The root layout persists across
 * client navigations; login and logout call router.refresh(), which re-renders it with the new state.
 *
 * Signed in, it also asks /auth/me for the role, to show the Moderation and Admin links. If that
 * call fails, the bar still renders the normal signed-in links, just without those two. The links
 * are display only: /admin and /moderation check the role themselves, and so does the API.
 */
export default async function SiteHeader() {
  const signedIn = hasSessionCookie(await cookies());
  const role = signedIn ? ((await getCurrentUser())?.role ?? null) : null;
  return <SiteNav signedIn={signedIn} role={role} />;
}
