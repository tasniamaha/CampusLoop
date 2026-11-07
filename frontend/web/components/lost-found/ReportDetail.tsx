'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import PhotoThumbnails from './PhotoThumbnails';
import {
  CLAIM_STATUS_LABEL,
  getMatches,
  getReport,
  listClaims,
  resolveReport,
  reviewClaim,
  submitClaim,
  type ApiResult,
  type Claim,
  type Match,
  type ReportDetail as Detail,
} from '../../lib/lost-found-api';

type MatchesState = { status: 'loading' } | { status: 'ready'; items: Match[] } | { status: 'error'; message: string };
type Loaded = { key: number; report: Detail; matches: MatchesState | null };
type Settled = { key: number; ok: true } | { key: number; ok: false; notFound: boolean; message: string };

/**
 * A single report. Visibility is decided by the API (404 when the viewer may not see it); photos are
 * already filtered by it too. Matches load automatically only for the reporter of an open report.
 */
export default function ReportDetail({ id, submitted }: { id: string; submitted: boolean }) {
  const router = useRouter();
  const [reloadKey, setReloadKey] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const loading = settled?.key !== reloadKey;

  const [notice, setNotice] = useState(submitted ? 'Your report has been submitted.' : '');
  const [actionError, setActionError] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claim[] | null>(null);

  // Drop ?submitted=1 so a refresh doesn't repeat the message. Same route: no remount, no refetch.
  useEffect(() => {
    if (submitted) router.replace(`/lost-found/${id}`, { scroll: false });
  }, [submitted, id, router]);

  useEffect(() => {
    const controller = new AbortController();
    const key = reloadKey;
    async function run() {
      try {
        const result = await getReport(id, controller.signal);
        if (controller.signal.aborted) return;
        if (!result.ok) {
          if (result.status === 401) { router.replace('/login'); return; }
          // 400 = malformed id; 404 = missing or not visible to this viewer. Same message either way.
          setSettled({ key, ok: false, notFound: result.status === 404 || result.status === 400, message: result.message });
          return;
        }
        const report = result.data;
        const wantsMatches = report.isMine && report.status === 'open';
        setLoaded({ key, report, matches: wantsMatches ? { status: 'loading' } : null });
        setSettled({ key, ok: true });
        if (!wantsMatches) return;

        const matches = await getMatches(id, controller.signal);
        if (controller.signal.aborted) return;
        if (!matches.ok && matches.status === 401) { router.replace('/login'); return; }
        setLoaded((prev) =>
          prev && prev.key === key
            ? { ...prev, matches: matches.ok ? { status: 'ready', items: matches.data } : { status: 'error', message: matches.message } }
            : prev,
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        setSettled({ key, ok: false, notFound: false, message: err instanceof Error ? err.message : 'Could not load this report' });
      }
    }
    void run();
    return () => controller.abort();
  }, [id, reloadKey, router]);

  const reload = () => setReloadKey((k) => k + 1);

  /** Runs an action; returns null (after redirecting or showing the error) when it failed. */
  async function act<T>(name: string, call: () => Promise<ApiResult<T>>, fallback: string): Promise<T | null> {
    setBusyAction(name);
    setActionError('');
    setNotice('');
    try {
      const result = await call();
      if (!result.ok) {
        if (result.status === 401) { router.replace('/login'); return null; }
        setActionError(result.message);
        return null;
      }
      return result.data;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : fallback);
      return null;
    } finally {
      setBusyAction(null);
    }
  }

  async function claimItem() {
    const proofDetails = window.prompt(
      'Describe private details that prove this item belongs to you (at least 20 characters). Do not enter passwords or full ID numbers.',
    );
    if (proofDetails === null) return;
    if (proofDetails.trim().length < 20) {
      setActionError('Please provide at least 20 characters of ownership evidence.');
      return;
    }
    if (await act('claim', () => submitClaim(id, proofDetails.trim()), 'Could not submit claim')) {
      setNotice('Claim submitted. The person who reported the found item can review your ownership evidence.');
      reload();
    }
  }

  async function loadClaims() {
    const result = await act('claims', () => listClaims(id), 'Could not load claims');
    if (result) setClaims(result);
  }

  async function review(claimId: string, status: 'approved' | 'rejected') {
    const reviewerNote = window.prompt(
      status === 'approved' ? 'Optional note for the claimant:' : 'Optional reason for rejecting this claim:',
      '',
    );
    if (reviewerNote === null) return;
    if (await act(`review:${claimId}`, () => reviewClaim(claimId, status, reviewerNote.trim()), 'Could not review claim')) {
      setNotice(status === 'approved' ? 'Claim approved and item marked resolved.' : 'Claim rejected.');
      await loadClaims();
      reload();
    }
  }

  async function resolve() {
    if (!window.confirm('Mark this report as resolved? It will be removed from open reports.')) return;
    if (await act('resolve', () => resolveReport(id), 'Could not resolve report')) {
      setNotice('Report marked as resolved.');
      reload();
    }
  }

  const backLink = (
    <Link href="/lost-found" className="text-sm font-semibold text-emerald-700 hover:underline">← Back to reports</Link>
  );

  if (loading && !loaded) {
    return <div className="space-y-4">{backLink}<p role="status" className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">Loading report...</p></div>;
  }
  if (!loading && settled?.ok === false) {
    return (
      <div className="space-y-4">
        {backLink}
        {settled.notFound ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <h2 className="text-lg font-semibold text-slate-900">Report not found</h2>
            <p className="mt-1 text-sm text-slate-500">It may have been resolved, or it isn&apos;t visible to your account.</p>
          </div>
        ) : (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <span>{settled.message}</span>
            <button type="button" onClick={reload} className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-medium">Try again</button>
          </div>
        )}
      </div>
    );
  }
  if (!loaded) return null;

  const { report, matches } = loaded;
  const isOpen = report.status === 'open';
  const canClaim = report.type === 'found' && isOpen && !report.isMine && !report.myClaim;

  return (
    <div className={`space-y-6 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
      {backLink}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {actionError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{actionError}</p>}

      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          {/* h2: the section layout provides the page's h1. */}
          <h2 className="text-2xl font-bold text-slate-900">{report.title}</h2>
          <div className="flex gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase">{report.type}</span>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${isOpen ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{isOpen ? 'Open' : 'Resolved'}</span>
          </div>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{report.description}</p>
        <p className="mt-2 text-sm text-slate-500">{report.category} · {report.location} · {String(report.itemDate).slice(0, 10)}</p>
        <PhotoThumbnails photos={report.photos} title={report.title} size="h-32 w-32" />
        {report.imageUrl && <a href={report.imageUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-emerald-800 underline">View item image</a>}
        {report.type === 'found' && !report.isMine && report.photos.length === 0 && (
          <p className="mt-3 text-xs text-slate-500">Photos of found items are only visible to the finder and moderators.</p>
        )}

        {report.myClaim && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium">Your claim: {CLAIM_STATUS_LABEL[report.myClaim.status] ?? report.myClaim.status}</p>
            {report.myClaim.reviewerNote && <p className="mt-1 text-slate-600">Note from the finder: {report.myClaim.reviewerNote}</p>}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {canClaim && (
            <button type="button" disabled={busyAction !== null} onClick={() => void claimItem()} className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-medium text-emerald-800 disabled:opacity-50">
              {busyAction === 'claim' ? 'Submitting claim...' : 'Claim this item'}
            </button>
          )}
          {report.type === 'found' && report.isMine && (
            <button type="button" disabled={busyAction !== null} onClick={() => void loadClaims()} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50">
              {busyAction === 'claims' ? 'Loading claims...' : 'Review ownership claims'}
            </button>
          )}
          {report.isMine && isOpen && (
            <button type="button" disabled={busyAction !== null} onClick={() => void resolve()} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              {busyAction === 'resolve' ? 'Saving...' : 'Mark resolved'}
            </button>
          )}
        </div>

        {claims && (
          <div className="mt-4 border-t pt-4">
            <h2 className="font-medium">Ownership claims</h2>
            {claims.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No claims have been submitted.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {claims.map((claim) => (
                  <li key={claim.id} className="rounded-lg bg-slate-50 p-3">
                    <p className="text-sm font-medium">Status: {claim.status}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">Private ownership evidence: {claim.proofDetails}</p>
                    {claim.reviewerNote && <p className="mt-1 text-sm text-slate-600">Note: {claim.reviewerNote}</p>}
                    {claim.status === 'pending' && isOpen && (
                      <div className="mt-3 flex gap-2">
                        <button type="button" disabled={busyAction !== null} onClick={() => void review(claim.id, 'approved')} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Approve ownership</button>
                        <button type="button" disabled={busyAction !== null} onClick={() => void review(claim.id, 'rejected')} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50">Reject claim</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </article>

      {matches && (
        <section aria-labelledby="matches-heading" className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 id="matches-heading" className="text-lg font-semibold">Possible matches</h2>
          {matches.status === 'loading' ? (
            <p role="status" className="mt-2 text-sm text-slate-500">Looking for possible matches...</p>
          ) : matches.status === 'error' ? (
            <div role="alert" className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <span>{matches.message}</span>
              <button type="button" onClick={reload} className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-medium">Try again</button>
            </div>
          ) : matches.items.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No likely matches found yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {matches.items.map((match) => (
                <li key={match.report.id} className="rounded-lg bg-slate-50 p-3">
                  <p className="font-medium">
                    <Link href={`/lost-found/${match.report.id}`} className="hover:text-emerald-800 hover:underline">{match.report.title}</Link>
                    <span className="ml-2 text-xs text-slate-500">Match score: {match.score}/100</span>
                  </p>
                  <p className="text-sm text-slate-600">{match.report.category} · {match.report.location} · {String(match.report.itemDate).slice(0, 10)}</p>
                  <p className="mt-1 text-xs text-slate-500">{match.reasons.join(' · ')}</p>
                  <PhotoThumbnails photos={match.report.photos} title={match.report.title} size="h-16 w-16" />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
