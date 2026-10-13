
import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/auth';
import LogoutButton from '../../components/logout-button';
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
        </p>
        <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">CampusLoop Dashboard</h1>
          <LogoutButton />
        </header>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">Resource Sharing</h2>
            <p className="mt-2 text-sm text-gray-600">
              Share and discover campus resources.
            </p>
          </section>

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
