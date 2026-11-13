import AdminShell from '../../components/admin/AdminShell';
import AdminUsers from '../../components/admin/AdminUsers';
import { parseUserParams } from '../../lib/admin-api';
import { requireRole } from '../../lib/auth';

// Same as /dashboard: the role check reads cookies at request time, so this page blocks on the server.
export const instant = false;

export default async function AdminUsersPage({ searchParams }: PageProps<'/admin'>) {
  const me = await requireRole(['admin']);
  // Invalid filters or ?page= fall back to the defaults.
  const params = parseUserParams(await searchParams);
  return (
    <AdminShell>
      <AdminUsers params={params} currentUserId={me.id} />
    </AdminShell>
  );
}
