import { cookies } from 'next/headers';
import { hasSessionCookie } from '../../lib/session';
import SiteNav from './SiteNav';

/**
 * Reads whether the request carries a session (access OR refresh cookie) and renders the bar.
 * Request-time read, so app/layout.tsx wraps this in <Suspense>. The root layout persists across
 * client navigations; login and logout call router.refresh(), which re-renders it with the new state.
 */
export default async function SiteHeader() {
  const signedIn = hasSessionCookie(await cookies());
  return <SiteNav signedIn={signedIn} />;
}
