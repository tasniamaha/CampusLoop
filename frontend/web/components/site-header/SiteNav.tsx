'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import type { UserRole } from '../../lib/auth';
import NotificationBell from '../NotificationBell';
import LogoutButton from '../logout-button';

const SECTIONS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/resources', label: 'Resources' },
  { href: '/borrowings', label: 'Borrowings' },
  { href: '/lost-found', label: 'Lost & Found' },
  { href: '/study-groups', label: 'Study Groups' },
] as const;

/** Staff sections, shown only to these roles. Display only: the pages and the API check the role. */
const STAFF_SECTIONS: ReadonlyArray<{ href: string; label: string; roles: readonly UserRole[] }> = [
  { href: '/moderation', label: 'Moderation', roles: ['moderator', 'admin'] },
  { href: '/admin', label: 'Admin', roles: ['admin'] },
];

/** Prefix match on a path boundary: /lost-found/new matches /lost-found, /resources-x does not match /resources. */
const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The landing page has its own header, so the site bar is hidden there. */
const HIDDEN_ON = '/';

const barClass = 'sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur';
const innerClass = 'mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8';
const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600';

function Logo({ signedIn }: { signedIn: boolean }) {
  return (
    <Link href={signedIn ? '/dashboard' : '/'} className={`shrink-0 rounded text-xl font-bold tracking-tight text-emerald-700 ${focusRing}`}>
      CampusLoop
    </Link>
  );
}

/**
 * Shown while the server reads the session (Suspense fallback): logo only, so no links flash and
 * disappear. It sits outside the boundary, so it can't use usePathname(); globals.css hides it on the
 * landing page instead (via the page's data-landing-page marker).
 */
export function SiteBarFallback() {
  return (
    <header data-site-bar-fallback className={barClass}>
      <div className={innerClass}>
        <span className="text-xl font-bold tracking-tight text-emerald-700">CampusLoop</span>
      </div>
    </header>
  );
}

/**
 * Site-wide top bar. `signedIn` (session cookies) and `role` (from /auth/me, null if unknown) come
 * from SiteHeader; they only decide which links to show, never access. Below md (lg when the staff
 * links show) the section links collapse into a menu button.
 */
export default function SiteNav({ signedIn, role }: { signedIn: boolean; role: UserRole | null }) {
  const pathname = usePathname();
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  // The menu is open only for the path it was opened on, so any navigation (links, Back) closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenOn(null);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (pathname === HIDDEN_ON) return null;

  if (!signedIn) {
    return (
      <header className={barClass}>
        <nav aria-label="Site" className={innerClass}>
          <Logo signedIn={false} />
          <div className="flex items-center gap-2 text-sm">
            <Link href="/login" className={`rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100 ${focusRing}`}>Log in</Link>
            <Link href="/register" className={`rounded-lg bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-800 ${focusRing} focus-visible:ring-offset-2`}>Register</Link>
          </div>
        </nav>
      </header>
    );
  }

  const linkClass = (current: boolean) =>
    `rounded-lg px-3 py-2 text-sm font-medium ${focusRing} ${current ? 'bg-emerald-50 text-emerald-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`;
  const sections = [...SECTIONS, ...STAFF_SECTIONS.filter((section) => role !== null && section.roles.includes(role))];
  // With the staff links the bar no longer fits at md, so it collapses into the menu until lg.
  const bp = sections.length > SECTIONS.length ? { show: 'lg:flex', block: 'lg:block', hide: 'lg:hidden' } : { show: 'md:flex', block: 'md:block', hide: 'md:hidden' };
  const sectionLinks = (onNavigate?: () => void) =>
    sections.map((section) => {
      const current = isCurrent(pathname, section.href);
      return (
        <li key={section.href}>
          <Link href={section.href} aria-current={current ? 'page' : undefined} onClick={onNavigate} className={`block ${linkClass(current)}`}>
            {section.label}
          </Link>
        </li>
      );
    });

  return (
    <header className={barClass}>
      <nav aria-label="Site" className={innerClass}>
        <Logo signedIn />
        <ul className={`hidden flex-1 items-center gap-1 ${bp.show}`}>{sectionLinks()}</ul>
        <div className="flex items-center gap-2">
          <NotificationBell signedIn />
          <div className={`hidden ${bp.block}`}>
            <LogoutButton className={`rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 ${focusRing}`} />
          </div>
          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpenOn(open ? null : pathname)}
            className={`inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 ${bp.hide} ${focusRing}`}
          >
            <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>
      {/* Always in the DOM (hidden when closed) so aria-controls points at a real element. */}
      <div id={menuId} hidden={!open} className={`border-t border-slate-200 bg-white px-4 pb-4 pt-2 ${bp.hide}`}>
        <ul className="space-y-1">{sectionLinks(() => setOpenOn(null))}</ul>
        <div className="mt-3 border-t border-slate-200 pt-3">
          <LogoutButton className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 ${focusRing}`} />
        </div>
      </div>
    </header>
  );
}
