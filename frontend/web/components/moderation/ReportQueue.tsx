'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { ApiResult } from '../../lib/api-client';
import {
  NOTE_MAX,
  STATUS_FILTERS,
  closeReport,
  hideReview,
  listReports,
  queueHref,
  unhideReview,
  type ModerationReport,
  type QueueParams,
  type ReportPage,
  type StatusFilter,
} from '../../lib/moderation-api';
import { useApiQuery } from '../../lib/use-api-query';
import ConfirmButton from '../ConfirmButton';
import { EmptyState, ErrorState, LoadingState } from '../DataStates';
import Pager from '../Pager';

const STATUS_LABELS: Record<StatusFilter, string> = { open: 'Open', resolved: 'Resolved', dismissed: 'Dismissed', all: 'All' };
const TYPE_LABELS = { review: 'Review', resource: 'Listing', lost_found: 'Lost & found' } as const;
const formatTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Badge({ children, tone = 'slate' }: { children: string; tone?: 'slate' | 'amber' | 'rose' | 'emerald' }) {
  const tones = { slate: 'bg-slate-100 text-slate-700', amber: 'bg-amber-100 text-amber-800', rose: 'bg-rose-100 text-rose-800', emerald: 'bg-emerald-100 text-emerald-800' };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

/** What was reported: a short summary from the API, with a link where the item has its own page. */
function TargetSummary({ report }: { report: ModerationReport }) {
  const { target } = report;
  if (!target) return <p className="text-sm italic text-slate-500">This item no longer exists.</p>;
  switch (target.type) {
    case 'review':
      return (
        <div className="space-y-1">
          <p className="text-sm text-slate-800">{target.excerpt ? `"${target.excerpt}"` : <span className="italic text-slate-500">A rating with no comment.</span>}</p>
          {target.isHidden && <Badge tone="rose">Hidden</Badge>}
        </div>
      );
    case 'resource':
      return (
        <p className="text-sm">
          {target.removed ? (
            <span className="text-slate-800">{target.title}</span>
          ) : (
            <Link href={`/resources/${report.targetId}`} className="font-medium text-emerald-800 hover:underline">{target.title}</Link>
          )}{' '}
          {target.removed && <Badge>Removed by owner</Badge>}
        </p>
      );
    case 'lost_found':
      return (
        <p className="text-sm">
          <Badge>{target.noticeType === 'found' ? 'Found' : 'Lost'}</Badge>{' '}
          <Link href={`/lost-found/${report.targetId}`} className="font-medium text-emerald-800 hover:underline">{target.title}</Link>
        </p>
      );
  }
}

function ReportCard({ report, onChanged }: { report: ModerationReport; onChanged: (message: string) => void }) {
  const router = useRouter();
  const noteId = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOpen = report.status === 'open';
  const review = report.target?.type === 'review' ? report.target : null;
  const trimmed = note.trim();

  async function run(action: () => Promise<ApiResult<unknown>>, done: string) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      if (result.status === 401) router.replace('/login');
      else setError(result.message);
      return;
    }
    setNote('');
    onChanged(done);
  }

  return (
    <li className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{TYPE_LABELS[report.targetType]}</Badge>
          <Badge tone={isOpen ? 'amber' : report.status === 'resolved' ? 'emerald' : 'slate'}>{STATUS_LABELS[report.status]}</Badge>
        </div>
        <p className="text-xs text-slate-500">Reported {formatTime(report.createdAt)}</p>
      </div>

      <TargetSummary report={report} />

      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        <p className="font-medium text-slate-700">Reason given</p>
        <p className="mt-1 whitespace-pre-wrap text-slate-800">{report.reason}</p>
      </div>

      {!isOpen && (
        <p className="text-sm text-slate-600">
          {STATUS_LABELS[report.status]}{report.resolvedAt ? ` ${formatTime(report.resolvedAt)}` : ''}
          {report.resolutionNote ? `: ${report.resolutionNote}` : '.'}
        </p>
      )}

      {(isOpen || review?.isHidden) && (
        <div className="space-y-2 border-t pt-3">
          <label htmlFor={noteId} className="block text-sm font-medium text-slate-700">
            {review && !review.isHidden ? 'Note (optional; required to hide the review)' : 'Note (optional)'}
          </label>
          <textarea id={noteId} value={note} onChange={(event) => setNote(event.target.value)} maxLength={NOTE_MAX} rows={2} className="block w-full rounded-lg border p-2 text-sm" />
          <div className="flex flex-wrap items-center gap-2">
            {isOpen && (
              <>
                <ConfirmButton label="Resolve" question="Close this report as resolved?" confirmLabel="Resolve" disabled={busy} onConfirm={() => void run(() => closeReport(report.id, 'resolved', trimmed), 'Report resolved.')} />
                <ConfirmButton label="Dismiss" question="Dismiss this report? No action is taken." confirmLabel="Dismiss" disabled={busy} onConfirm={() => void run(() => closeReport(report.id, 'dismissed', trimmed), 'Report dismissed.')} />
              </>
            )}
            {review && !review.isHidden && (
              <ConfirmButton
                label="Hide review"
                tone="danger"
                question="Hide this review from everyone? Every open report about it is resolved with your note."
                confirmLabel="Hide"
                disabled={busy || !trimmed}
                onConfirm={() => void run(() => hideReview(report.targetId, trimmed), 'Review hidden, and its open reports resolved.')}
              />
            )}
            {review?.isHidden && (
              <ConfirmButton label="Unhide review" question="Show this review again?" confirmLabel="Unhide" disabled={busy} onConfirm={() => void run(() => unhideReview(report.targetId, trimmed), 'Review visible again.')} />
            )}
          </div>
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        </div>
      )}
    </li>
  );
}

/**
 * The report queue, filtered by status from the URL (already validated by the page). All lists
 * open reports first (oldest first), then closed ones (newest first); one status is oldest first. Moderators only get their campus from the API; buttons for reports they cannot act on
 * (their own, or about their own content) still show, and the API's refusal is shown in place.
 */
export default function ReportQueue({ params }: { params: QueueParams }) {
  const router = useRouter();
  const { status, page } = params;
  const query = useApiQuery<ReportPage>(
    queueHref(params),
    (signal) => listReports(params, signal),
    (result) => {
      const pages = Math.max(result.totalPages, 1);
      if (page <= pages) return true;
      router.replace(queueHref({ status, page: pages }));
      return false;
    },
  );
  const [message, setMessage] = useState<string | null>(null);

  const reports = query.data?.items ?? [];

  return (
    <section aria-labelledby="queue-heading" className="space-y-4">
      <nav aria-label="Report status" className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter}
            href={queueHref({ status: filter, page: 1 })}
            aria-current={filter === status ? 'page' : undefined}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${filter === status ? 'border-emerald-700 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
          >
            {STATUS_LABELS[filter]}
          </Link>
        ))}
      </nav>

      <div>
        <h2 id="queue-heading" className="text-lg font-semibold">{STATUS_LABELS[status]} reports</h2>
        {!query.loading && query.data && (
          <p className="text-sm text-slate-500">
            {status === 'all'
              ? `${query.data.openTotal} open, ${query.data.total} total`
              : `${query.data.total} report${query.data.total === 1 ? '' : 's'}`}
          </p>
        )}
        <p role="status" className="text-sm text-emerald-800">{message}</p>
      </div>

      {query.error ? (
        <ErrorState message={query.error.message} onRetry={query.reload} />
      ) : query.loading && reports.length === 0 ? (
        <LoadingState>Loading reports...</LoadingState>
      ) : reports.length === 0 ? (
        <EmptyState>
          {status === 'all' ? 'No reports yet.' : status === 'open' ? 'No open reports. The queue is clear.' : `No ${STATUS_LABELS[status].toLowerCase()} reports.`}
        </EmptyState>
      ) : (
        <ul aria-busy={query.loading} className={`space-y-4 ${query.loading ? 'opacity-60' : ''}`}>
          {reports.map((report) => (
            <ReportCard
              key={`${report.id}|${report.status}|${report.target?.type === 'review' ? report.target.isHidden : ''}`}
              report={report}
              onChanged={(text) => {
                setMessage(text);
                query.reload();
              }}
            />
          ))}
        </ul>
      )}

      {!query.error && query.data && <Pager label="Report pages" page={page} pages={Math.max(query.data.totalPages, 1)} hrefFor={(p) => queueHref({ status, page: p })} />}
    </section>
  );
}
