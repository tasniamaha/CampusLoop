import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../lib/auth';
import ReportDetail from '../../../components/lost-found/ReportDetail';

// Same as /dashboard: the login check reads cookies at request time, so this page blocks on the server.
export const instant = false;

export default async function LostFoundReportPage({ params, searchParams }: PageProps<'/lost-found/[id]'>) {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  const { id } = await params;
  const { submitted } = await searchParams;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {/* key: a different report is a fresh component (no state carried over from the previous one). */}
      <ReportDetail key={id} id={id} submitted={submitted === '1'} />
    </main>
  );
}
