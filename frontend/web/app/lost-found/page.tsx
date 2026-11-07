import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/auth';
import { parseListParams } from '../../lib/lost-found-api';
import LostFoundList from '../../components/lost-found/LostFoundList';

// Same as /dashboard: the login check reads cookies at request time, so this page blocks on the server.
export const instant = false;

export default async function LostFoundPage({ searchParams }: PageProps<'/lost-found'>) {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  // Invalid ?type= or ?page= falls back to the defaults.
  const { type, page } = parseListParams(await searchParams);

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lost and Found</h1>
          <p className="mt-1 text-sm text-slate-600">Report missing items and find possible matches within your campus.</p>
        </div>
        <Link href="/lost-found/new" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2">
          Report an item
        </Link>
      </header>
      <LostFoundList type={type} page={page} />
    </main>
  );
}
