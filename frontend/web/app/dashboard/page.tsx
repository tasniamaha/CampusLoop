
import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/auth';
import LogoutButton from '../../components/logout-button';
import VerifyBanner from '../../components/verify-banner';
import Link from 'next/link';
// export const dynamic = 'force-dynamic';
export const instant = false
export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-12">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold text-gray-900">
          CampusLoop Dashboard
        </h1>

        <p className="mt-3 text-gray-600">
          Welcome, {user.name}.
          {!user.emailVerifiedAt && <VerifyBanner email={user.email} />}
        </p>

        <header className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Your campus, connected</h2>
            <p className="mt-1 text-sm text-gray-500">Choose a space to get started.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/resources" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Open resource marketplace</Link>
            <Link
              href="/borrowings"
              className="text-sm font-semibold text-emerald-700 hover:underline"
            >
              My borrowings
            </Link>
            <LogoutButton />
          </div>
        </header>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Link href="/resources" className="rounded-xl border bg-white p-5 transition hover:border-emerald-300 hover:shadow-sm">
            <h2 className="font-semibold text-emerald-800">Resource Sharing ↗</h2>
            <p className="mt-2 text-sm text-gray-600">
              Browse listings, save favorites, create a listing, and request to borrow available items.
            </p>
          </Link>

          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">Lost and Found</h2>
            <p className="mt-2 text-sm text-gray-600">
              Find or report missing items.
            </p>
          </section>

          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">Study Collaboration</h2>
            <p className="mt-2 text-sm text-gray-600">
              Connect with other students.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
