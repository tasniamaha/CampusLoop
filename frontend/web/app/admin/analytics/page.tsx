import AdminAnalytics from '../../../components/admin/AdminAnalytics';
import AdminShell from '../../../components/admin/AdminShell';
import { requireRole } from '../../../lib/auth';

// Same as /dashboard: the role check reads cookies at request time, so this page blocks on the server.
export const instant = false;

export default async function AdminAnalyticsPage() {
  await requireRole(['admin']);
  return (
    <AdminShell>
      <AdminAnalytics />
    </AdminShell>
  );
}
