import AdminShell from '../../../components/admin/AdminShell';
import AuditLog from '../../../components/admin/AuditLog';
import { parseAuditParams } from '../../../lib/admin-api';
import { requireRole } from '../../../lib/auth';

// Same as /dashboard: the role check reads cookies at request time, so this page blocks on the server.
export const instant = false;

export default async function AdminAuditLogPage({ searchParams }: PageProps<'/admin/audit-log'>) {
  await requireRole(['admin']);
  // Invalid filters or ?page= fall back to the defaults.
  const params = parseAuditParams(await searchParams);
  return (
    <AdminShell>
      <AuditLog params={params} />
    </AdminShell>
  );
}
