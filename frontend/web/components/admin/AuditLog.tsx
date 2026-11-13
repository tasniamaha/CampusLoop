'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  FILTER_LIMITS,
  auditExportPath,
  auditHref,
  hasAuditFilters,
  listAuditLogs,
  parseAuditParams,
  type AuditEntry,
  type AuditListParams,
  type Paginated,
} from '../../lib/admin-api';
import { useApiQuery } from '../../lib/use-api-query';
import { EmptyState, ErrorState, LoadingState } from '../DataStates';
import Pager from '../Pager';
import ExportButton from './ExportButton';

const formatTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const inputClass = 'mt-1 block w-full rounded-lg border p-2 font-normal';

/**
 * The audit log, newest first, filtered from the URL (already validated by the page). Read only:
 * the log is append-only in the database. IP addresses show here but are left out of the CSV.
 */
export default function AuditLog({ params }: { params: AuditListParams }) {
  const router = useRouter();
  const { page } = params;
  const key = auditHref(params);
  const query = useApiQuery<Paginated<AuditEntry>>(
    key,
    (signal) => listAuditLogs(params, signal),
    (result) => {
      const pages = Math.max(result.pagination.pages, 1);
      if (page <= pages) return true;
      router.replace(auditHref({ ...params, page: pages }));
      return false;
    },
  );
  const [formError, setFormError] = useState<string | null>(null);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = Object.fromEntries(['action', 'actorId', 'from', 'to'].map((name) => [name, String(form.get(name) ?? '').trim()]));
    const next = parseAuditParams(raw);
    // Say what is wrong instead of silently dropping a filter the user typed.
    if (raw.action && !next.action) return setFormError('Action looks like user.role_changed: lower-case words joined by dots.');
    if (raw.actorId && !next.actorId) return setFormError('Actor ID must be a full user ID (a UUID).');
    if (next.from && next.to && next.from > next.to) return setFormError('"From" must be on or before "To".');
    setFormError(null);
    router.push(auditHref({ ...next, page: 1 }));
  }

  const entries = query.data?.data ?? [];
  const pagination = query.data?.pagination;
  const filtered = hasAuditFilters(params);

  return (
    <section aria-labelledby="audit-heading" className="space-y-4">
      <form key={key} onSubmit={applyFilters} noValidate role="search" className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto]">
        <label className="text-sm font-medium">
          Action
          <input name="action" defaultValue={params.action ?? ''} maxLength={FILTER_LIMITS.action} placeholder="e.g. user.role_changed" className={inputClass} />
        </label>
        <label className="text-sm font-medium">
          Actor ID
          <input name="actorId" defaultValue={params.actorId ?? ''} maxLength={36} placeholder="User ID" className={inputClass} />
        </label>
        <label className="text-sm font-medium">
          From
          <input type="date" name="from" defaultValue={params.from ?? ''} className={inputClass} />
        </label>
        <label className="text-sm font-medium">
          To
          <input type="date" name="to" defaultValue={params.to ?? ''} className={inputClass} />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Apply</button>
          {filtered && <Link href="/admin/audit-log" className="rounded-lg border px-4 py-2 text-sm font-medium">Clear</Link>}
        </div>
        {formError && <p role="alert" className="text-sm text-rose-700 sm:col-span-2 lg:col-span-5">{formError}</p>}
      </form>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="audit-heading" className="text-lg font-semibold">Audit log</h2>
          <p className="text-sm text-slate-500">
            Times show in your time zone; the From and To filters are whole days in UTC.
            {!query.loading && pagination && ` ${pagination.total} entr${pagination.total === 1 ? 'y' : 'ies'}${filtered ? ' matching your filters' : ''}.`}
          </p>
        </div>
        <ExportButton path={auditExportPath(params)} fallbackName="campusloop-audit-logs.csv" label="Export CSV (no IP addresses)" />
      </div>

      {query.error ? (
        <ErrorState message={query.error.message} onRetry={query.reload} />
      ) : query.loading && entries.length === 0 ? (
        <LoadingState>Loading the audit log...</LoadingState>
      ) : entries.length === 0 ? (
        <EmptyState>{filtered ? 'No entries match these filters.' : 'No entries yet.'}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table aria-busy={query.loading} className={`w-full min-w-[56rem] text-left text-sm ${query.loading ? 'opacity-60' : ''}`}>
            <caption className="sr-only">Audit log entries</caption>
            <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">When</th>
                <th scope="col" className="px-4 py-3">Actor</th>
                <th scope="col" className="px-4 py-3">Action</th>
                <th scope="col" className="px-4 py-3">Target</th>
                <th scope="col" className="px-4 py-3">IP</th>
                <th scope="col" className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatTime(entry.createdAt)}</td>
                  <td className="px-4 py-3">
                    {entry.actor ? (
                      <>
                        <p className="font-medium text-slate-900">{entry.actor.name}</p>
                        <p className="break-all text-slate-600">{entry.actor.email}</p>
                      </>
                    ) : (
                      <p className="text-slate-600">{entry.actorId ? 'Deleted account' : 'System'}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-800">{entry.action}</td>
                  <td className="px-4 py-3">
                    <p className="text-slate-700">{entry.targetType}</p>
                    {entry.targetId && <p className="break-all font-mono text-xs text-slate-500">{entry.targetId}</p>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{entry.ipAddress ?? '-'}</td>
                  <td className="max-w-xs px-4 py-3">
                    {entry.metadata ? (
                      <details>
                        <summary className="cursor-pointer text-emerald-800">Show</summary>
                        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-xs">{JSON.stringify(entry.metadata, null, 2)}</pre>
                      </details>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!query.error && pagination && <Pager label="Audit log pages" page={page} pages={Math.max(pagination.pages, 1)} hrefFor={(p) => auditHref({ ...params, page: p })} />}
    </section>
  );
}
