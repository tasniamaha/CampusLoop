'use client';

import { useState, type FormEvent } from 'react';
import { FILTER_LIMITS, LOAN_STATUSES, getAnalytics, loansExportPath, parseLoanFilters, type Analytics, type CampusCounts, type LoanFilters } from '../../lib/admin-api';
import { useApiQuery } from '../../lib/use-api-query';
import { ErrorState, LoadingState } from '../DataStates';
import ExportButton from './ExportButton';

const inputClass = 'mt-1 block w-full rounded-lg border bg-white p-2 font-normal';
const cell = 'px-3 py-2 text-right tabular-nums';

function Stat({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </div>
  );
}

function CountsRow({ name, c, header = false }: { name: string; c: CampusCounts; header?: boolean }) {
  const Cell = header ? 'th' : 'td';
  return (
    <tr className={header ? 'border-t-2 bg-slate-50 font-semibold' : undefined}>
      <th scope="row" className="px-3 py-2 text-left font-medium text-slate-900">{name}</th>
      <Cell className={cell}>{c.users.active}<span className="text-slate-400"> / {c.users.deactivated}</span></Cell>
      <Cell className={cell}>{c.resources}</Cell>
      <Cell className={cell}>{c.activeLoans}</Cell>
      <Cell className={cell}>{c.loans.pending}</Cell>
      <Cell className={cell}>{c.loans.returned}</Cell>
      <Cell className={cell}>{c.lostFound.lost.open}<span className="text-slate-400"> / {c.lostFound.lost.resolved}</span></Cell>
      <Cell className={cell}>{c.lostFound.found.open}<span className="text-slate-400"> / {c.lostFound.found.resolved}</span></Cell>
      <Cell className={cell}>{c.claims.pending ?? 0}</Cell>
      <Cell className={cell}>{c.studyGroups.open}</Cell>
    </tr>
  );
}

/** Loans CSV export. Filters stay on this page (not in the URL): they only shape the download. */
function LoansExport() {
  const [filters, setFilters] = useState<LoanFilters>({ status: null, campus: null, from: null, to: null });
  const [error, setError] = useState<string | null>(null);

  function update(event: FormEvent<HTMLFormElement>) {
    const form = new FormData(event.currentTarget);
    const next = parseLoanFilters(Object.fromEntries(['status', 'campus', 'from', 'to'].map((name) => [name, String(form.get(name) ?? '')])));
    setError(next.from && next.to && next.from > next.to ? '"From" must be on or before "To".' : null);
    setFilters(next);
  }

  return (
    <section aria-labelledby="loans-export-heading" className="space-y-3 rounded-xl border bg-white p-4">
      <div>
        <h2 id="loans-export-heading" className="text-lg font-semibold">Loans export</h2>
        <p className="text-sm text-slate-500">One row per borrow request, with both participants&apos; emails. Loan messages are never included. Dates filter on when the request was made (whole days, UTC).</p>
      </div>
      <form onChange={update} onSubmit={(event) => event.preventDefault()} noValidate className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-medium">
          Status
          <select name="status" defaultValue="" className={inputClass}>
            <option value="">Any</option>
            {LOAN_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Owner campus
          <input name="campus" maxLength={FILTER_LIMITS.text} placeholder="Exactly as stored" className={inputClass} />
        </label>
        <label className="text-sm font-medium">
          From
          <input type="date" name="from" className={inputClass} />
        </label>
        <label className="text-sm font-medium">
          To
          <input type="date" name="to" className={inputClass} />
        </label>
      </form>
      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : <ExportButton path={loansExportPath(filters)} fallbackName="campusloop-loans.csv" label="Export loans (CSV)" />}
    </section>
  );
}

/**
 * Per-campus counts. Campuses are grouped exactly as stored, so one campus typed two ways shows as
 * two rows (project.md, Known limitations). Resources and loans count under the owner's campus.
 */
export default function AdminAnalytics() {
  const query = useApiQuery<Analytics>('analytics', (signal) => getAnalytics(signal));
  const data = query.data;

  return (
    <div className="space-y-6">
      <section aria-labelledby="analytics-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="analytics-heading" className="text-lg font-semibold">Analytics</h2>
            {data && <p className="text-sm text-slate-500">As of {new Date(data.generatedAt).toLocaleString()}. Campuses are grouped exactly as stored, so one campus spelled two ways shows as two rows.</p>}
          </div>
          <button type="button" onClick={query.reload} disabled={query.loading} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50">
            Refresh
          </button>
        </div>

        {query.error ? (
          <ErrorState message={query.error.message} onRetry={query.reload} />
        ) : !data ? (
          <LoadingState>Loading analytics...</LoadingState>
        ) : (
          <>
            <div aria-busy={query.loading} className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-4 ${query.loading ? 'opacity-60' : ''}`}>
              <Stat label="Users" value={data.totals.users.total} detail={`${data.totals.users.active} active, ${data.totals.users.deactivated} deactivated`} />
              <Stat label="Listed resources" value={data.totals.resources} />
              <Stat label="Loans out now" value={data.totals.activeLoans} detail={`${data.totals.loans.pending} pending requests`} />
              <Stat label="Open lost & found" value={data.totals.lostFound.lost.open + data.totals.lostFound.found.open} detail={`${data.totals.claims.pending ?? 0} claims pending`} />
            </div>

            {data.campuses.length === 0 ? (
              <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">No campus data yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border bg-white">
                <table className="w-full min-w-[60rem] text-sm">
                  <caption className="sr-only">Counts per campus</caption>
                  <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-3 text-left">Campus</th>
                      <th scope="col" className="px-3 py-3 text-right">Users <span className="normal-case">(active / off)</span></th>
                      <th scope="col" className="px-3 py-3 text-right">Resources</th>
                      <th scope="col" className="px-3 py-3 text-right">Loans out</th>
                      <th scope="col" className="px-3 py-3 text-right">Pending</th>
                      <th scope="col" className="px-3 py-3 text-right">Returned</th>
                      <th scope="col" className="px-3 py-3 text-right">Lost <span className="normal-case">(open / done)</span></th>
                      <th scope="col" className="px-3 py-3 text-right">Found <span className="normal-case">(open / done)</span></th>
                      <th scope="col" className="px-3 py-3 text-right">Claims pending</th>
                      <th scope="col" className="px-3 py-3 text-right">Open groups</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.campuses.map((c) => (
                      <CountsRow key={c.campus} name={c.campus || '(no campus)'} c={c} />
                    ))}
                    <CountsRow name="All campuses" c={data.totals} header />
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <LoansExport />
    </div>
  );
}
