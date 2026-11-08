import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/auth';
import { parseListParams } from '../../lib/study-groups-api';
import GroupList from '../../components/study-groups/GroupList';

// Same as /dashboard: the login check reads cookies at request time, so this page blocks on the server.
export const instant = false;

export default async function StudyGroupsPage({ searchParams }: PageProps<'/study-groups'>) {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  // Invalid ?course=, ?topic= or ?page= falls back to the defaults.
  const { course, topic, page } = parseListParams(await searchParams);

  // Title and section menu come from app/study-groups/layout.tsx.
  return <GroupList course={course} topic={topic} page={page} />;
}
