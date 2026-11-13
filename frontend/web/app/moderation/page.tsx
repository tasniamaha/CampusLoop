import ReportQueue from '../../components/moderation/ReportQueue';
import { requireRole } from '../../lib/auth';
import { parseQueueParams } from '../../lib/moderation-api';

// Same as /dashboard: the role check reads cookies at request time, so this page blocks on the server.
export const instant = false;

export default async function ModerationPage({ searchParams }: PageProps<'/moderation'>) {
  const me = await requireRole(['moderator', 'admin']);
  // Invalid ?status= or ?page= falls back to open reports, page 1.
  const params = parseQueueParams(await searchParams);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Moderation</h1>
        <p className="mt-1 text-sm text-slate-600">
          {me.role === 'admin' ? 'Reports from every campus' : `Reports about content on your campus (${me.campus})`}, oldest first. Every decision is recorded in the audit log.
        </p>
      </header>
      <ReportQueue params={params} />
    </main>
  );
}
