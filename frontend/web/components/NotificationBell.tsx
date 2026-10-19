
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
];

export default function NotificationBell() {
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (isPublic) {
      return;
    }

    let stopped = false;
    const loadUnreadCount = async () => {
      if (stopped || document.hidden) return;

      try {
        const response = await fetch(
          '/api/backend/notifications/unread-count',
          { cache: 'no-store' },
        );

        if (response.status === 401) {
          stopped = true;

          window.clearInterval(interval);

          setUnreadCount(0);
          return;
        }

        if (!response.ok) return;

        const data: { unreadCount?: number; count?: number } =
          await response.json();

        if (!stopped) {
          setUnreadCount(data.unreadCount ?? data.count ?? 0);
        }
      } catch {
        // Keep the last known count if the request fails.
      }
    };

    // Fetch immediately after the effect starts.
    const first = window.setTimeout(() => {
      void loadUnreadCount();
    }, 0);

    // Poll every 30 seconds.
    const interval = window.setInterval(() => {
      void loadUnreadCount();
    }, 30_000);

    // Refresh when the user returns to this browser tab.
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void loadUnreadCount();
      }
    };

    document.addEventListener(
      'visibilitychange',
      handleVisibilityChange,
    );

    return () => {
      stopped = true;
      window.clearTimeout(first);

      window.clearInterval(interval);

      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange,
      );
    };
  }, [isPublic]);

  // Don't display the bell or poll on public pages.
  if (isPublic) return null;

  return (
    <Link
      href="/notifications"
      aria-label={
        unreadCount > 0
          ? `Notifications, ${unreadCount} unread`
          : 'Notifications'
      }
      className="relative inline-flex items-center justify-center rounded-full p-2 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </svg>

      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-semibold leading-none text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
