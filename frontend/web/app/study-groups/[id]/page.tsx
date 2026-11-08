import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../lib/auth';
import GroupDetail from '../../../components/study-groups/GroupDetail';

// Same as /dashboard: the login check reads cookies at request time, so this page blocks on the server.
export const instant = false;

export default async function StudyGroupPage({ params, searchParams }: PageProps<'/study-groups/[id]'>) {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  const { id } = await params;
  const { created } = await searchParams;

  // key: a different group is a fresh component (no state carried over from the previous one).
  return <GroupDetail key={id} id={id} created={created === '1'} />;
}
