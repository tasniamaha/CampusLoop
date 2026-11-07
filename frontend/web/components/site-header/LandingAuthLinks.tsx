import Link from 'next/link';
import { cookies } from 'next/headers';
import { hasSessionCookie } from '../../lib/session';

/** Signed-out links for the landing page header; also its Suspense fallback. */
export function LandingSignedOutLinks() {
  return (
    <>
      <Link href="/login" className="font-medium hover:text-emerald-700">
        Log in
      </Link>
      <Link
        href="/register"
        className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800"
      >
        Get started
      </Link>
    </>
  );
}

/**
 * The landing page has its own header (the site bar is hidden on /). Signed-in visitors get a way
 * into the app; everyone else gets the existing log-in and sign-up links. Display only.
 */
export default async function LandingAuthLinks() {
  if (!hasSessionCookie(await cookies())) return <LandingSignedOutLinks />;
  return (
    <Link
      href="/dashboard"
      className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800"
    >
      Go to dashboard
    </Link>
  );
}
