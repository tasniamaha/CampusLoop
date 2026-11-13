import AdminCategories from '../../../components/admin/AdminCategories';
import AdminShell from '../../../components/admin/AdminShell';
import { requireRole } from '../../../lib/auth';

// Same as /dashboard: the role check reads cookies at request time, so this page blocks on the server.
export const instant = false;

export default async function AdminCategoriesPage() {
  await requireRole(['admin']);
  return (
    <AdminShell>
      <AdminCategories />
    </AdminShell>
  );
}
