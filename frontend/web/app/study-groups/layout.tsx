import SectionTabs from '../../components/SectionTabs';

const TABS = [
  { href: '/study-groups', label: 'Groups' },
  { href: '/study-groups/new', label: 'Create a group' },
  { href: '/study-groups/mine', label: 'My groups' },
] as const;

/**
 * Shared chrome for every study-group page: title and section menu. A Server Component with no
 * request-time reads, so it never holds the pages back. Each page checks the login itself.
 */
export default function StudyGroupsLayout({ children }: LayoutProps<'/study-groups'>) {
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Study Groups</h1>
          <p className="mt-1 text-sm text-slate-600">Discover course-based groups, coordinate schedules, and manage membership within your campus.</p>
        </div>
        <SectionTabs label="Study groups" tabs={TABS} />
      </header>
      {children}
    </main>
  );
}
