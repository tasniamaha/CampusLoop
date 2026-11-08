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

  // Title, intro and the "Report an item" entry point come from app/lost-found/layout.tsx.
  return <LostFoundList type={type} page={page} />;
}
