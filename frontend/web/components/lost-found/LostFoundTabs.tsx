'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/lost-found', label: 'Reports' },
  { href: '/lost-found/new', label: 'Report an item' },
  { href: '/lost-found/mine', label: 'My reports' },
] as const;

/**
 * Section menu: real links, one per route (not client-side tabs). Exact path match, so a report's
 * own page (/lost-found/<id>) highlights nothing. Query strings (?type, ?page) don't affect it.
 * Scrolls sideways on narrow screens instead of wrapping.
 */
export default function LostFoundTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Lost and found" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-1 border-b border-slate-200">
        {TABS.map((tab) => {
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
