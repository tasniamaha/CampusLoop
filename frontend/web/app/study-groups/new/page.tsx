import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../lib/auth';
import VerifyBanner from '../../../components/verify-banner';
import GroupForm from '../../../components/study-groups/GroupForm';

// Same as /dashboard: the login check reads cookies at request time, so this page blocks on the server.
export const instant = false;

export default async function NewStudyGroupPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  // The section title and the highlighted "Create a group" tab come from app/study-groups/layout.tsx.
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Start a group for a course or topic. You&apos;ll be its creator and first member.</p>
      {/* Creating a group needs a verified email; without this the user only learns it from a 403 on submit. */}
      {!user.emailVerifiedAt && <VerifyBanner email={user.email} />}
      <GroupForm />
    </div>
  );
}
