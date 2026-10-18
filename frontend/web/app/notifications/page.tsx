
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Notice = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

type PageData = {
  items: Notice[];
  total: number;
  page: number;
  limit: number;
  unreadCount: number;
};

const btn =
  'rounded-xl px-3 py-2 text-sm font-semibold transition disabled:opacity-50';

async function errorText(response: Response) {
  try {
    const data = await response.json();
    return Array.isArray(data.message)
      ? data.message.join(', ')
      : data.message || 'Request failed';
  } catch {
    return 'Request failed';
  }
}

export default function NotificationsPage() {
  const router = useRouter();

  const [data, setData] = useState<PageData | null>(null);
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const query = new URLSearchParams({
        page: String(page),
        limit: '20',
        ...(unreadOnly ? { unreadOnly: 'true' } : {}),
      });

      const response = await fetch(
        `/api/backend/notifications?${query}`,
        { cache: 'no-store' },
      );

      if (response.status === 401) {
        router.replace('/login');
        return;
      }

      if (!response.ok) {
        throw new Error(await errorText(response));
      }

      setData(await response.json());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not load notifications',
      );
    } finally {
      setLoading(false);
    }
  }, [page, unreadOnly, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function markAsRead(id: string, path: string) {
    setBusy(id);
    setError('');
    setNotice('');

    try {
      const response = await fetch(`/api/backend/notifications${path}`, {
        method: 'PATCH',
      });

      if (!response.ok) {
        throw new Error(await errorText(response));
      }

      setNotice(
        id === 'all'
          ? 'All notifications marked as read.'
          : 'Notification marked as read.',
      );

      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy('');
    }
  }

  async function deleteNotification(id: string) {
    const confirmed = window.confirm(
      'Are you sure you want to delete this notification? This action cannot be undone.',
    );

    if (!confirmed) return;

    setBusy(id);
    setError('');
    setNotice('');

    try {
      const response = await fetch(
        `/api/backend/notifications/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );

      if (!response.ok) {
        throw new Error(await errorText(response));
      }

      setNotice('Notification deleted successfully.');
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not delete notification',
      );
    } finally {
      setBusy('');
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Notifications & reminders
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Borrowing updates, due-date reminders and account alerts.
          </p>
        </div>

        <Link
          href="/dashboard"
          className={`${btn} border border-slate-200 bg-white text-slate-700`}
        >
          Dashboard
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <span className="mr-auto text-sm text-slate-600">
          Unread: <strong>{data?.unreadCount ?? '—'}</strong>
        </span>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => {
              setUnreadOnly(e.target.checked);
              setPage(1);
            }}
          />
          Unread only
        </label>

        <button
          className={`${btn} border border-slate-200 text-slate-700`}
          disabled={busy !== '' || !data?.unreadCount}
          onClick={() => void markAsRead('all', '/read-all')}
        >
          Mark all read
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800"
        >
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}

      {loading ? (
        <p className="py-12 text-center text-slate-500">
          Loading notifications…
        </p>
      ) : !data?.items.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center">
          <h2 className="font-semibold text-slate-800">
            You’re all caught up
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            New borrowing activity and due-date reminders will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((notification) => (
            <article
              key={notification.id}
              className={`rounded-2xl border p-4 ${
                notification.readAt
                  ? 'border-slate-200 bg-white'
                  : 'border-emerald-200 bg-emerald-50/50'
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                    notification.readAt
                      ? 'bg-slate-300'
                      : 'bg-emerald-600'
                  }`}
                  aria-label={notification.readAt ? 'Read' : 'Unread'}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="font-semibold text-slate-900">
                      {notification.title}
                    </h2>

                    <time className="text-xs text-slate-500">
                      {new Date(notification.createdAt).toLocaleString()}
                    </time>
                  </div>

                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {notification.body}
                  </p>

                  <p className="mt-2 text-xs text-slate-500">
                    {notification.type}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {!notification.readAt && (
                    <button
                      className={`${btn} border border-slate-200 bg-white text-slate-700`}
                      disabled={busy !== ''}
                      onClick={() =>
                        void markAsRead(
                          notification.id,
                          `/${encodeURIComponent(notification.id)}/read`,
                        )
                      }
                    >
                      {busy === notification.id ? 'Saving…' : 'Mark read'}
                    </button>
                  )}

                  <button
                    type="button"
                    title="Delete notification"
                    aria-label={`Delete notification: ${notification.title}`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={busy !== ''}
                    onClick={() => void deleteNotification(notification.id)}
                  >
                    {busy === notification.id ? (
                      <span className="text-xs">...</span>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="m19 6-1 14H6L5 6" />
                        <path d="M10 11v5" />
                        <path d="M14 11v5" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-slate-500">
          Page {page} · {data?.total ?? 0} notifications
        </span>

        <div className="flex gap-2">
          <button
            className={`${btn} border border-slate-200 bg-white text-slate-700`}
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>

          <button
            className={`${btn} border border-slate-200 bg-white text-slate-700`}
            disabled={loading || page * 20 >= (data?.total ?? 0)}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </main>
  );
}
