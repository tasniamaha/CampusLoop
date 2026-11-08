import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../lib/auth';
import MyGroups from '../../../components/study-groups/MyGroups';

// Same as /dashboard: the login check reads cookies at request time, so this page blocks on the server.
export const instant = false;

export default async function MyStudyGroupsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  return <MyGroups />;
}
