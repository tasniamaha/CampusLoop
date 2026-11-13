import type { ReactNode } from 'react';
import SectionTabs from '../SectionTabs';

const TABS = [
  { href: '/admin', label: 'Users' },
  { href: '/admin/categories', label: 'Categories' },
  { href: '/admin/audit-log', label: 'Audit log' },
  { href: '/admin/analytics', label: 'Analytics' },
] as const;

/**
 * Title and section menu for the admin pages. Rendered by each page after requireRole(['admin'])
 * (not by a layout), so someone without the role gets a plain 404 and never sees the admin menu.
 */
export default function AdminShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <header className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Admin</h1>
          <p className="mt-1 text-sm text-slate-600">Manage users, roles and categories, review the audit log, and export reports. Every change you make here is recorded in the audit log.</p>
        </div>
        <SectionTabs label="Admin" tabs={TABS} />
      </header>
      {children}
    </main>
  );
}
