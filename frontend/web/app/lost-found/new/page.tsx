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

  // The section title and the highlighted "Report an item" tab come from app/lost-found/layout.tsx.
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Tell your campus what you lost or found. We&apos;ll look for possible matches once it&apos;s submitted.</p>
      {/* Creating a report needs a verified email; without this the user only learns it from a 403 on submit. */}
      {!user.emailVerifiedAt && <VerifyBanner email={user.email} />}
      <ReportForm />
    </div>
  );
}
