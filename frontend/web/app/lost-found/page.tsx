'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

type Report = {
  id: string;
  type: 'lost' | 'found';
  title: string;
  description: string;
  category: string;
  location: string;
  itemDate: string;
  imageUrl: string | null;
  status: 'open' | 'resolved';
  createdAt: string;
  isMine?: boolean;
};

type Match = { report: Report; score: number; reasons: string[] };
type Claim = { id: string; reportId: string; claimantId: string; status: 'pending' | 'approved' | 'rejected'; proofDetails: string; reviewerNote: string | null; createdAt: string; reviewedAt: string | null };
type ListResponse = { data: Report[]; pagination: { page: number; limit: number; total: number; pages: number } };

const getToday = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

async function readError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
  if (Array.isArray(body?.message)) return body.message.join(', ');
  return body?.message || `Request failed (${response.status})`;
}

export default function LostFoundPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState<'lost' | 'found'>('lost');
  const [filter, setFilter] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [itemDate, setItemDate] = useState('');
  const [todayDate, setTodayDate] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [matches, setMatches] = useState<Record<string, Match[]>>({});
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [claims, setClaims] = useState<Record<string, Claim[]>>({});
  const [claimBusy, setClaimBusy] = useState<string | null>(null);

  useEffect(() => {
    const currentDate = getToday();
    setTodayDate(currentDate);
    setItemDate(currentDate);
  }, []);

  const loadReports = useCallback(async (requestedPage: number) => {
    setError('');
    const params = new URLSearchParams({ page: String(requestedPage), limit: '20' });
    if (filter) params.set('type', filter);
    try {
      const response = await fetch(`/api/backend/lost-found?${params}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json() as ListResponse;
      setReports(result.data);
      setPage(result.pagination.page);
      setPages(Math.max(result.pagination.pages, 1));
      setTotal(result.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load reports');
    }
  }, [filter]);

  useEffect(() => { void loadReports(1); }, [filter, loadReports]);

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/backend/lost-found', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, title, description, category, location, itemDate,
          ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
        }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setTitle(''); setDescription(''); setCategory(''); setLocation(''); setItemDate(getToday()); setImageUrl('');
      setFilter('');
      setNotice('Your report has been submitted.');
      await loadReports(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create report');
    } finally {
      setBusy(false);
    }
  }

  async function findMatches(id: string) {
    setBusyAction(`matches:${id}`); setError('');
    try {
      const response = await fetch(`/api/backend/lost-found/${id}/matches`, { cache: 'no-store' });
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json() as Match[];
      setMatches((previous) => ({ ...previous, [id]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not find matches');
    } finally {
      setBusyAction(null);
    }
  }

  async function submitClaim(report: Report) {
    const proofDetails = window.prompt(
      'Describe private details that prove this item belongs to you (at least 20 characters). Do not enter passwords or full ID numbers.',
    );
    if (proofDetails === null) return;
    if (proofDetails.trim().length < 20) {
      setError('Please provide at least 20 characters of ownership evidence.');
      return;
    }
    setClaimBusy(report.id); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/backend/lost-found/${report.id}/claims`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proofDetails: proofDetails.trim() }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setNotice('Claim submitted. The person who reported the found item can review your ownership evidence.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit claim');
    } finally {
      setClaimBusy(null);
    }
  }

  async function loadClaims(reportId: string) {
    setClaimBusy(`list:${reportId}`); setError('');
    try {
      const response = await fetch(`/api/backend/lost-found/${reportId}/claims`, { cache: 'no-store' });
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json() as Claim[];
      setClaims((previous) => ({ ...previous, [reportId]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load claims');
    } finally {
      setClaimBusy(null);
    }
  }

  async function reviewClaim(reportId: string, claimId: string, status: 'approved' | 'rejected') {
    const reviewerNote = window.prompt(
      status === 'approved' ? 'Optional note for the claimant:' : 'Optional reason for rejecting this claim:',
      '',
    );
    if (reviewerNote === null) return;
    setClaimBusy(claimId); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/backend/lost-found/claims/${claimId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reviewerNote: reviewerNote.trim() }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setNotice(status === 'approved' ? 'Claim approved and item marked resolved.' : 'Claim rejected.');
      await loadClaims(reportId);
      await loadReports(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not review claim');
    } finally {
      setClaimBusy(null);
    }
  }

  async function resolveReport(id: string) {
    if (!window.confirm('Mark this report as resolved? It will be removed from open reports.')) return;
    setBusyAction(`resolve:${id}`); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/backend/lost-found/${id}/resolve`, { method: 'PATCH' });
      if (!response.ok) throw new Error(await readError(response));
      setNotice('Report marked as resolved.');
      setMatches((previous) => { const next = { ...previous }; delete next[id]; return next; });
      await loadReports(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve report');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Lost and Found</h1>
        <p className="mt-1 text-sm text-slate-600">Report missing items and find possible matches within your campus.</p>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <form onSubmit={submitReport} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <h2 className="text-lg font-semibold sm:col-span-2">Submit a report</h2>
        <label className="text-sm font-medium">Report type
          <select value={type} onChange={(e) => setType(e.target.value as 'lost' | 'found')} className="mt-1 block w-full rounded-lg border p-2">
            <option value="lost">I lost an item</option><option value="found">I found an item</option>
          </select>
        </label>
        <label className="text-sm font-medium">Item name
          <input required minLength={2} maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" />
        </label>
        <label className="text-sm font-medium">Category
          <input required minLength={2} maxLength={80} placeholder="e.g. Electronics, ID card, Bag" value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" />
        </label>
        <label className="text-sm font-medium">Location
          <input required minLength={2} maxLength={180} placeholder="General campus location; avoid private details" value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" />
        </label>
        <label className="text-sm font-medium">Date lost or found
          <input required type="date" max={todayDate || undefined} value={itemDate} onChange={(e) => setItemDate(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" />
        </label>
        <label className="text-sm font-medium">Image URL (optional)
          <input type="url" maxLength={500} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." className="mt-1 block w-full rounded-lg border p-2" />
        </label>
        <label className="text-sm font-medium sm:col-span-2">Description
          <textarea required minLength={5} maxLength={3000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe colour, brand, or distinguishing marks. Do not include passwords or sensitive ID details." className="mt-1 block w-full rounded-lg border p-2" />
        </label>
        <button disabled={busy} className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50 sm:col-span-2">{busy ? 'Submitting...' : 'Submit report'}</button>
      </form>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold">Open reports</h2><p className="text-sm text-slate-500">{total} report{total === 1 ? '' : 's'} in your campus</p></div>
          <select aria-label="Filter reports by type" value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border bg-white p-2 text-sm">
            <option value="">Lost and found</option><option value="lost">Lost only</option><option value="found">Found only</option>
          </select>
        </div>

        {reports.length === 0 ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">No open reports found.</p> : (
          <ul className="space-y-4">
            {reports.map((report) => (
              <li key={report.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{report.title}</h3><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase">{report.type}</span></div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{report.description}</p>
                <p className="mt-2 text-sm text-slate-500">{report.category} · {report.location} · {String(report.itemDate).slice(0, 10)}</p>
                {report.imageUrl && <a href={report.imageUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-emerald-800 underline">View item image</a>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" disabled={busyAction !== null} onClick={() => void findMatches(report.id)} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50">{busyAction === `matches:${report.id}` ? 'Searching...' : 'Find possible matches'}</button>
                  {report.type === 'found' && !report.isMine && <button type="button" disabled={claimBusy !== null} onClick={() => void submitClaim(report)} className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-medium text-emerald-800 disabled:opacity-50">{claimBusy === report.id ? 'Submitting claim...' : 'Claim this item'}</button>}
                  {report.type === 'found' && report.isMine && <button type="button" disabled={claimBusy !== null} onClick={() => void loadClaims(report.id)} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50">{claimBusy === `list:${report.id}` ? 'Loading claims...' : 'Review ownership claims'}</button>}
                  {report.isMine && <button type="button" disabled={busyAction !== null} onClick={() => void resolveReport(report.id)} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busyAction === `resolve:${report.id}` ? 'Saving...' : 'Mark resolved'}</button>}
                </div>
                {claims[report.id] && <div className="mt-4 border-t pt-4"><h4 className="font-medium">Ownership claims</h4>
                  {claims[report.id].length === 0 ? <p className="mt-2 text-sm text-slate-500">No claims have been submitted.</p> : <ul className="mt-2 space-y-3">{claims[report.id].map((claim) => <li key={claim.id} className="rounded-lg bg-slate-50 p-3"><p className="text-sm font-medium">Status: {claim.status}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">Private ownership evidence: {claim.proofDetails}</p>{claim.reviewerNote && <p className="mt-1 text-sm text-slate-600">Note: {claim.reviewerNote}</p>}{claim.status === 'pending' && <div className="mt-3 flex gap-2"><button type="button" disabled={claimBusy !== null} onClick={() => void reviewClaim(report.id, claim.id, 'approved')} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Approve ownership</button><button type="button" disabled={claimBusy !== null} onClick={() => void reviewClaim(report.id, claim.id, 'rejected')} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50">Reject claim</button></div>}</li>)}</ul>}
                </div>}
                {matches[report.id] && <div className="mt-4 border-t pt-4"><h4 className="font-medium">Possible matches</h4>
                  {matches[report.id].length === 0 ? <p className="mt-2 text-sm text-slate-500">No likely matches found yet.</p> : <ul className="mt-2 space-y-3">{matches[report.id].map((match) => <li key={match.report.id} className="rounded-lg bg-slate-50 p-3"><p className="font-medium">{match.report.title}<span className="ml-2 text-xs text-slate-500">Match score: {match.score}/100</span></p><p className="text-sm text-slate-600">{match.report.category} · {match.report.location} · {String(match.report.itemDate).slice(0, 10)}</p><p className="mt-1 text-xs text-slate-500">{match.reasons.join(' · ')}</p></li>)}</ul>}
                </div>}
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && <nav aria-label="Report pages" className="mt-5 flex items-center justify-between"><button type="button" disabled={page <= 1} onClick={() => void loadReports(page - 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Previous</button><span className="text-sm text-slate-600">Page {page} of {pages}</span><button type="button" disabled={page >= pages} onClick={() => void loadReports(page + 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Next</button></nav>}
      </section>
    </main>
  );
}
