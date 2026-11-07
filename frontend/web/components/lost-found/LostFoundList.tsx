'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import PhotoThumbnails from './PhotoThumbnails';
import { listHref, listReports, type ListParams, type LostFoundType, type Report } from '../../lib/lost-found-api';

type Loaded = { reports: Report[]; total: number; pages: number };
/** The last request that finished, successfully or not. */
type Settled = { key: string; ok: true } | { key: string; ok: false; message: string };

/**
 * Report list. `type` and `page` come from the URL, already validated by the page. Changing them
 * navigates, so Back, refresh and shared links keep the same view.
 */
export default function LostFoundList({ type, page }: ListParams) {
  const router = useRouter();
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = `${type ?? 'all'}|${page}|${reloadKey}`;
  // Count and empty state are only truthful after a successful load; a failed load shows just the error.
  // Loading is derived (the current request has not settled), so the effect never sets state synchronously.
  const [settled, setSettled] = useState<Settled | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null); // last successful load, kept while the next one runs
  const loading = settled?.key !== requestKey;
  const loadFailed = !loading && settled?.ok === false;

  useEffect(() => {
    const controller = new AbortController();
    async function run() {
      try {
        const result = await listReports({ type, page }, controller.signal);
        // A newer request replaced this one (filter, page or retry changed); it owns the state now.
        if (controller.signal.aborted) return;
        if (!result.ok) {
          if (result.status === 401) {
            router.replace('/login');
            return; // keep the loading state until the redirect lands
          }
          setSettled({ key: requestKey, ok: false, message: result.message });
          return;
        }
        const pages = Math.max(result.data.pagination.pages, 1);
        if (page > pages) {
          // A page past the end (old link, or reports were resolved): show the last real page.
          router.replace(listHref({ type, page: pages }));
          return;
        }
        setLoaded({ reports: result.data.data, total: result.data.pagination.total, pages });
        setSettled({ key: requestKey, ok: true });
      } catch (err) {
        if (controller.signal.aborted) return;
        setSettled({ key: requestKey, ok: false, message: err instanceof Error ? err.message : 'Could not load reports' });
      }
    }
    void run();
    return () => controller.abort();
  }, [type, page, requestKey, router]);

  const changeFilter = (next: string) =>
    router.push(listHref({ type: next === 'lost' || next === 'found' ? (next as LostFoundType) : null, page: 1 }));

  const reports = loaded?.reports ?? [];
  const showCount = !loading && !loadFailed && loaded !== null;
  // While reloading after a failure (or before any success), show the loading message, not a stale list.
  const showLoadingMessage = loading && (reports.length === 0 || settled?.ok === false);

  return (
    <section aria-labelledby="open-reports-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="open-reports-heading" className="text-lg font-semibold">Open reports</h2>
          {showCount && loaded && <p className="text-sm text-slate-500">{loaded.total} report{loaded.total === 1 ? '' : 's'} in your campus</p>}
        </div>
        <select aria-label="Filter reports by type" value={type ?? ''} onChange={(e) => changeFilter(e.target.value)} className="rounded-lg border bg-white p-2 text-sm">
          <option value="">Lost and found</option>
          <option value="lost">Lost only</option>
          <option value="found">Found only</option>
        </select>
      </div>

      {loadFailed ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <span>{settled?.ok === false ? settled.message : ''}</span>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-medium">Try again</button>
        </div>
      ) : showLoadingMessage ? (
        <p role="status" className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">Loading reports...</p>
      ) : reports.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">No open reports found.</p>
      ) : (
        <ul aria-busy={loading} className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
          {reports.map((report) => (
            <li key={report.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-semibold">
                  <Link href={`/lost-found/${report.id}`} className="text-slate-900 hover:text-emerald-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
                    {report.title}
                  </Link>
                </h3>
                <div className="flex gap-2">
                  {report.isMine && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">Your report</span>}
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase">{report.type}</span>
                </div>
              </div>
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-slate-700">{report.description}</p>
              <p className="mt-2 text-sm text-slate-500">{report.category} · {report.location} · {String(report.itemDate).slice(0, 10)}</p>
              <PhotoThumbnails photos={report.photos} title={report.title} size="h-16 w-16" />
              <Link href={`/lost-found/${report.id}`} className="mt-3 inline-block text-sm font-semibold text-emerald-800 hover:underline" aria-label={`View report: ${report.title}`}>
                View report →
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!loadFailed && loaded && loaded.pages > 1 && (
        <nav aria-label="Report pages" className="mt-5 flex items-center justify-between">
          {page > 1 ? (
            <Link href={listHref({ type, page: page - 1 })} className="rounded-lg border px-3 py-2 text-sm">Previous</Link>
          ) : (
            <span aria-disabled="true" className="rounded-lg border px-3 py-2 text-sm opacity-40">Previous</span>
          )}
          <span className="text-sm text-slate-600">Page {page} of {loaded.pages}</span>
          {page < loaded.pages ? (
            <Link href={listHref({ type, page: page + 1 })} className="rounded-lg border px-3 py-2 text-sm">Next</Link>
          ) : (
            <span aria-disabled="true" className="rounded-lg border px-3 py-2 text-sm opacity-40">Next</span>
          )}
        </nav>
      )}
    </section>
  );
}
