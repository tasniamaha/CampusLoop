import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../lib/auth';
import VerifyBanner from '../../../components/verify-banner';
import ReportForm from '../../../components/lost-found/ReportForm';

// Same as /dashboard: the login check reads cookies at request time, so this page blocks on the server.
export const instant = false;

export default async function NewLostFoundReportPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <Link href="/lost-found" className="text-sm font-semibold text-emerald-700 hover:underline">← All reports</Link>
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Report an item</h1>
        <p className="mt-1 text-sm text-slate-600">Tell your campus what you lost or found. We&apos;ll look for possible matches once it&apos;s submitted.</p>
      </header>
      {/* Creating a report needs a verified email; without this the user only learns it from a 403 on submit. */}
      {!user.emailVerifiedAt && <VerifyBanner email={user.email} />}
      <ReportForm />
    </main>
  );
}
