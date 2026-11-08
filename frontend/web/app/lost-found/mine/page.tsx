import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../lib/auth';
import MyReports from '../../../components/lost-found/MyReports';

// Same as /dashboard: the login check reads cookies at request time, so this page blocks on the server.
export const instant = false;

export default async function MyLostFoundReportsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  return <MyReports />;
}
