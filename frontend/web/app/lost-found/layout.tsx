import LostFoundTabs from '../../components/lost-found/LostFoundTabs';

/**
 * Shared chrome for every lost-and-found page: title and section menu. A Server Component with no
 * request-time reads, so it never holds the pages back. Each page checks the login itself.
 */
export default function LostFoundLayout({ children }: LayoutProps<'/lost-found'>) {
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lost and Found</h1>
          <p className="mt-1 text-sm text-slate-600">Report missing items and find possible matches within your campus.</p>
        </div>
        <LostFoundTabs />
      </header>
      {children}
    </main>
  );
}
