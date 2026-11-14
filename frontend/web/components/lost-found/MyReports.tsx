'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import PhotoThumbnails from './PhotoThumbnails';
import { CLAIM_STATUS_LABEL, getMine, MY_LIST_LIMIT, reportMeta, type MyActivity, type Report } from '../../lib/lost-found-api';

type Settled = { key: number; ok: true; data: MyActivity } | { key: number; ok: false; message: string };

/**
 * The caller's own reports and claims (GET /lost-found/mine). Same states as the report list:
 * loading, error (without any empty text), empty per section, and 401 -> /login.
 */
export default function MyReports() {
  const router = useRouter();
  const [reloadKey, setReloadKey] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const loading = settled?.key !== reloadKey;

  useEffect(() => {
    const controller = new AbortController();
    const key = reloadKey;
    async function run() {
      try {
        const result = await getMine(controller.signal);
        if (controller.signal.aborted) return; // a retry replaced this request
        if (!result.ok) {
          if (result.status === 401) { router.replace('/login'); return; }
          setSettled({ key, ok: false, message: result.message });
          return;
        }
        setSettled({ key, ok: true, data: result.data });
      } catch (err) {
        if (controller.signal.aborted) return;
        setSettled({ key, ok: false, message: err instanceof Error ? err.message : 'Could not load your reports' });
      }
    }
    void run();
    return () => controller.abort();
  }, [reloadKey, router]);

  if (loading) {
    return <p role="status" className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">Loading your reports...</p>;
  }
  if (!settled.ok) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        <span>{settled.message}</span>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-medium">Try again</button>
      </div>
    );
  }

  const { reports, claims } = settled.data;
  return (
    <div className="space-y-8">
      <section aria-labelledby="filed-heading">
        <SectionHeading id="filed-heading" title="Reports I filed" truncated={reports.truncated} />
        {reports.items.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">
            You haven&apos;t filed any reports yet. <Link href="/lost-found/new" className="font-semibold text-emerald-700 hover:underline">Report an item</Link>
          </p>
        ) : (
          <ul className="space-y-3">
            {reports.items.map((report) => (
              <li key={report.id}><ReportRow report={report} /></li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="claimed-heading">
        <SectionHeading id="claimed-heading" title="Reports I've claimed" truncated={claims.truncated} />
        {claims.items.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">You haven&apos;t claimed any items.</p>
        ) : (
          <ul className="space-y-3">
            {claims.items.map(({ claim, report }) => (
              <li key={claim.id}>
                <ReportRow report={report}>
                  <p className="mt-2 text-sm">
                    <span className="font-medium">Your claim:</span> {CLAIM_STATUS_LABEL[claim.status] ?? claim.status}
                  </p>
                  {claim.reviewerNote && <p className="mt-1 text-sm text-slate-600">Note from the finder: {claim.reviewerNote}</p>}
                </ReportRow>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SectionHeading({ id, title, truncated }: { id: string; title: string; truncated: boolean }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="text-lg font-semibold">{title}</h2>
      {truncated && <p className="text-sm text-slate-500">Showing your {MY_LIST_LIMIT} most recent</p>}
    </div>
  );
}

function ReportRow({ report, children }: { report: Report; children?: ReactNode }) {
  const isOpen = report.status === 'open';
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-semibold">
          <Link href={`/lost-found/${report.id}`} className="text-slate-900 hover:text-emerald-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
            {report.title}
          </Link>
        </h3>
        <div className="flex gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase">{report.type}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${isOpen ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{isOpen ? 'Open' : 'Resolved'}</span>
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-500">{reportMeta(report)}</p>
      {children}
      <PhotoThumbnails photos={report.photos} title={report.title} size="h-14 w-14" />
    </article>
  );
}
