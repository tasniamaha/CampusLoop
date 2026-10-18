
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type UnreadResponse = {
  unreadCount: number;
};

export default function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);

  const loadUnreadCount = useCallback(async () => {
    try {
      const response = await fetch(
        '/api/backend/notifications/unread-count',
        { cache: 'no-store' },
      );

      if (!response.ok) return;

      const data: UnreadResponse = await response.json();
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // Keep the bell visible if the count cannot be loaded.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUnreadCount();
    }, 0);

    const interval = window.setInterval(() => {
      void loadUnreadCount();
    }, 30000);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [loadUnreadCount]);

  return (
    <Link
      href="/notifications"
      aria-label={
        unreadCount > 0
          ? `Notifications, ${unreadCount} unread`
          : 'Notifications'
      }
      title="Notifications"
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-700"
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
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
