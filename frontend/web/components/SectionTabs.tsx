'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type SectionTab = { href: string; label: string };

/**
 * Section menu: real links, one per route (not client-side tabs). Exact path match, so an item's
 * own page (e.g. /lost-found/<id>) highlights nothing. Query strings (?type, ?page) don't affect it.
 * Scrolls sideways on narrow screens instead of wrapping.
 */
export default function SectionTabs({ label, tabs }: { label: string; tabs: readonly SectionTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-1 border-b border-slate-200">
        {tabs.map((tab) => {
          const current = pathname === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? 'page' : undefined}
                className={[
                  '-mb-px inline-block whitespace-nowrap rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600',
                  current
                    ? 'border-emerald-700 text-emerald-800'
                    : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
                ].join(' ')}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
