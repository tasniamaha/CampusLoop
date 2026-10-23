'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QrLoanVerification from '../../components/QrLoanVerification';
import LoanReviewForm from '../../components/LoanReviewForm';
type Status = 'pending' | 'approved' | 'active' | 'returned' | 'rejected' | 'cancelled' | 'expired';
type Role = 'incoming' | 'outgoing';
type Action = 'approve' | 'reject' | 'return' | 'cancel';

type BorrowItem = {
  id: string;
  status: Status;
  dueDate: string;
  message: string | null;
  createdAt: string;
  isOverdue: boolean;
  resource: { id: string; title: string };
  borrower: { id: string; name: string };
  owner: { id: string; name: string };
};
type BorrowResponse = { items: BorrowItem[]; total: number; page: number; limit: number };

type LoanEvent = {
  id: string;
  eventType: string;
  fromStatus: Status | null;
  toStatus: Status;
  note: string | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
};

const STATUS_STYLES: Record<Status, string> = {
  pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  approved: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  active: 'bg-sky-50 text-sky-800 ring-sky-200',
  returned: 'bg-slate-100 text-slate-700 ring-slate-200',
  rejected: 'bg-rose-50 text-rose-800 ring-rose-200',
  cancelled: 'bg-slate-100 text-slate-600 ring-slate-200',
  expired: 'bg-orange-50 text-orange-800 ring-orange-200',
};

const EVENT_LABELS: Record<string, string> = {
  requested: 'Requested',
  approved: 'Approved by owner',
  rejected: 'Rejected by owner',
  cancelled: 'Cancelled',
  returned: 'Return confirmed by owner (handover not verified)',
  expired: 'Expired',
  handed_over: 'Handed over',
};

const ACTION_LABELS: Record<Action, string> = {
  approve: 'Approve',
  reject: 'Reject',
  return: 'Mark returned',
  cancel: 'Cancel request',
};

const primaryButton =
  'inline-flex items-center justify-center rounded-xl bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
  'inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const dangerButton =
  'inline-flex items-center justify-center rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50';

async function readError(response: Response) {
  try {
    const data = await response.json();
    const message = data?.message;
    return Array.isArray(message) ? message.join(', ') : message || 'Request failed. Please try again.';
  } catch {
    return 'Request failed. Please try again.';
  }
}
function actionsFor(role: Role, status: Status): Action[] {
  if (role === 'incoming') {
    if (status === 'pending') return ['approve', 'reject'];
    return [];
  }

  if (status === 'pending' || status === 'approved') return ['cancel'];
  return [];
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function BorrowingsPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('incoming');
  const [statusFilter, setStatusFilter] = useState('');
  const [items, setItems] = useState<BorrowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [openHistory, setOpenHistory] = useState<string>('');
  const [history, setHistory] = useState<Record<string, LoanEvent[]>>({});
  const [historyLoading, setHistoryLoading] = useState('');

  const load = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ role, page: '1', limit: '50' });
      if (statusFilter) params.set('status', statusFilter);
      const response = await fetch(`/api/backend/borrow-requests?${params.toString()}`, { cache: 'no-store' });
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (!response.ok) throw new Error(await readError(response));
      const data: BorrowResponse = await response.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load borrow requests.');
    } finally {
      setLoading(false);
    }
  }, [role, statusFilter, router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const loadHistory = useCallback(
    async (id: string) => {
      setHistoryLoading(id);
      try {
        const response = await fetch(`/api/backend/borrow-requests/${id}/events`, { cache: 'no-store' });
        if (response.status === 401) {
          router.replace('/login');
          return;
        }
        if (!response.ok) throw new Error(await readError(response));
        const data: { items: LoanEvent[] } = await response.json();
        setHistory((prev) => ({ ...prev, [id]: data.items }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to load history.');
      } finally {
        setHistoryLoading('');
      }
    },
    [router],
  );

  async function toggleHistory(id: string) {
    if (openHistory === id) {
      setOpenHistory('');
      return;
    }
    setOpenHistory(id);
    await loadHistory(id);
  }

  async function runAction(item: BorrowItem, action: Action) {
    if (action === 'reject' && !window.confirm('Reject this request?')) return;
    if (action === 'cancel' && !window.confirm('Cancel this request?')) return;
    if (action === 'return' && !window.confirm('Mark this item as returned? This records the owner’s confirmation only; it does not independently verify the physical handover.',)
) {
  return;
}
    setBusyId(item.id);
    setNotice('');
    setError('');
    try {
      const response = await fetch(`/api/backend/borrow-requests/${item.id}/${action}`, { method: 'PATCH' });
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (!response.ok) throw new Error(await readError(response));
      setNotice(`${ACTION_LABELS[action]} completed for "${item.resource.title}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusyId('');
      // Always reload: a failed approve may have turned the request into "expired".
      await load();
      if (openHistory === item.id) await loadHistory(item.id);
    }
  }

  
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Borrowings</h1>
          <p className="text-sm text-slate-600">
            Manage requests for your resources and track what you have asked to borrow.
          </p>
        </div>
        <Link href="/resources" className={secondaryButton}>
          Browse resources
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          {(['incoming', 'outgoing'] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
                role === r
                  ? 'bg-emerald-700 text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {r === 'incoming'
                ? 'Incoming (my resources)'
                : 'Outgoing (my requests)'}
            </button>
          ))}
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
        >
          <option value="">All statuses</option>
          {(
            [
              'pending',
              'approved',
              'active',
              'returned',
              'rejected',
              'cancelled',
              'expired',
            ] as Status[]
          ).map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-500">
          Loading...
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
          {role === 'incoming'
            ? 'Nobody has requested your resources yet.'
            : 'You have not requested anything yet. Browse resources to get started.'}
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => {
            const actions = actionsFor(role, item.status);
            const counterparty =
              role === 'incoming'
                ? item.borrower.name
                : item.owner.name;
            const events = history[item.id];

            return (
              <li
                key={item.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      <Link
                        href={`/resources/${item.resource.id}`}
                        className="hover:underline"
                      >
                        {item.resource.title}
                      </Link>
                    </h2>

                    <p className="text-sm text-slate-600">
                      {role === 'incoming' ? 'Requested by' : 'Owner'}:{' '}
                      <span className="font-medium">{counterparty}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {item.isOverdue && (
                      <span className="rounded-full bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white">
                        Overdue
                      </span>
                    )}

                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ring-inset ${STATUS_STYLES[item.status]}`}
                    >
                      {item.status}
                    </span>
                  </div>
                </div>

                <dl className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                  <div>
                    <dt className="inline font-medium text-slate-700">
                      Due:{' '}
                    </dt>
                    <dd className="inline">
                      {formatDate(item.dueDate)}
                    </dd>
                  </div>

                  <div>
                    <dt className="inline font-medium text-slate-700">
                      Requested:{' '}
                    </dt>
                    <dd className="inline">
                      {formatDate(item.createdAt)}
                    </dd>
                  </div>

                  {item.message && (
                    <div className="sm:col-span-2">
                      <dt className="inline font-medium text-slate-700">
                        Message:{' '}
                      </dt>
                      <dd className="inline">{item.message}</dd>
                    </div>
                  )}
                </dl>

                {/* Existing request actions and history toggle */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {actions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void runAction(item, action)}
                      className={
                        action === 'approve' || action === 'return'
                          ? primaryButton
                          : dangerButton
                      }
                    >
                      {busyId === item.id
                        ? 'Working...'
                        : ACTION_LABELS[action]}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => void toggleHistory(item.id)}
                    className={secondaryButton}
                  >
                    {openHistory === item.id ? 'Hide history' : 'History'}
                  </button>
                </div>

                {/* QR pickup and return verification */}
                <QrLoanVerification
                  requestId={item.id}
                  role={role}
                  status={item.status}
                  onComplete={() => {
                    void load();

                    if (openHistory === item.id) {
                      void loadHistory(item.id);
                    }
                  }}
                />

                {/* Explicit return status disclaimer */}
                {item.status === 'returned' && (
                  <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    Return recorded by the resource owner. Physical handover
                    has not been independently verified.
                  </p>
                )}

                {/* Review is available only after the loan has been returned. The API remains authoritative. */}
                {item.status === 'returned' && <LoanReviewForm borrowRequestId={item.id} />}

                {/* Existing loan-event history */}
                {openHistory === item.id && (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    {historyLoading === item.id && !events ? (
                      <p className="text-sm text-slate-500">
                        Loading history...
                      </p>
                    ) : events && events.length > 0 ? (
                      <ol className="space-y-3">
                        {events.map((event) => (
                          <li
                            key={event.id}
                            className="flex gap-3 text-sm"
                          >
                            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-600" />

                            <div>
                              <p className="font-medium text-slate-800">
                                {EVENT_LABELS[event.eventType] ??
                                  event.eventType}

                                <span className="font-normal text-slate-500">
                                  {' '}
                                  by{' '}
                                  {event.actor
                                    ? event.actor.name
                                    : 'the system'}
                                </span>
                              </p>

                              <p className="text-xs text-slate-500">
                                {formatDate(event.createdAt)}
                                {event.fromStatus
                                  ? ` - ${event.fromStatus} to ${event.toStatus}`
                                  : ` - ${event.toStatus}`}
                              </p>

                              {event.note && (
                                <p className="text-xs text-slate-500">
                                  {event.note}
                                </p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-sm text-slate-500">
                        No history recorded.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );

}