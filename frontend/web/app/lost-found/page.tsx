'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import PhotoDropzone, { preparePhotos, releasePhotos, type PendingPhoto } from '../../components/PhotoDropzone';

type Report = {
  id: string;
  type: 'lost' | 'found';
  title: string;
  description: string;
  category: string;
  location: string;
  itemDate: string;
  /** Legacy link, read-only. Only returned to viewers who may see this report's photos. */
  imageUrl: string | null;
  /** Empty when the viewer may not see this report's photos (e.g. someone else's found item). */
  photos: { id: string; url: string }[];
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
// The local date only exists in the browser: render '' on the server and during hydration, then today.
const subscribeNoop = () => () => {};
const getServerToday = () => '';

async function readError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
  if (Array.isArray(body?.message)) return body.message.join(', ');
  return body?.message || `Request failed (${response.status})`;
}

/** API photo URLs start with /api/; the browser loads them through the authenticated proxy. */
const proxied = (url: string) => url.replace(/^\/api\//, '/api/backend/');

type UploadResult = { ok: true } | { ok: false; status: number; message: string };

/** One photo per request: keeps each request small and gives real progress (fetch has no upload progress). */
function uploadPhoto(reportId: string, file: File, onProgress: (percent: number) => void): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/backend/lost-found/${reportId}/photos`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve({ ok: true });
      let message = `Upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string | string[] };
        if (body.message) message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
      } catch { /* not JSON */ }
      if (xhr.status === 413) message = 'is larger than 5 MB.';
      // The API numbers files within a request; each request carries exactly one.
      resolve({ ok: false, status: xhr.status, message: message.replace(/^File #1 /, '') });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, message: 'could not be uploaded. Check your connection and try again.' });
    const form = new FormData();
    form.append('files', file);
    xhr.send(form);
  });
}

function PhotoThumbnails({ photos, title, size = 'h-20 w-20' }: { photos: Report['photos']; title: string; size?: string }) {
  if (!photos.length) return null;
  return (
    <ul aria-label={`Photos of ${title}`} className="mt-3 flex flex-wrap gap-2">
      {photos.map((photo, index) => (
        <li key={photo.id}>
          <a href={proxied(photo.url)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proxied(photo.url)} alt={`${title}, photo ${index + 1}`} loading="lazy" className={`${size} object-cover`} />
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function LostFoundPage() {
  const router = useRouter();
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
  // '' means "not chosen yet": the field shows and submits today until the user picks a date.
  const [itemDate, setItemDate] = useState('');
  const todayDate = useSyncExternalStore(subscribeNoop, getToday, getServerToday);
  const effectiveItemDate = itemDate || todayDate;
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);
  // Set when the report was created but some photos failed: the form then only retries those photos.
  const [savedReportId, setSavedReportId] = useState<string | null>(null);
  const [uploadStep, setUploadStep] = useState<{ current: number; total: number } | null>(null);
  // Preview URLs still alive, released on unmount.
  const previewUrls = useRef(new Set<string>());
  const [matches, setMatches] = useState<Record<string, Match[]>>({});
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [claims, setClaims] = useState<Record<string, Claim[]>>({});
  const [claimBusy, setClaimBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestedPage, setRequestedPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  // Count and empty state are only truthful after a load succeeded; a failed load shows just the error.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  /** Event handlers call this; the effect below does the fetch. */
  function requestReports(nextPage: number) {
    setError('');
    setLoading(true);
    setRequestedPage(nextPage);
    setReloadKey((key) => key + 1); // forces a refetch even when page and filter are unchanged
  }

  function changeFilter(next: string) {
    setFilter(next);
    requestReports(1);
  }

  useEffect(() => {
    const urls = previewUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function addPhotos(files: File[]) {
    const { added, errors } = preparePhotos(files, photos.length);
    added.forEach((photo) => previewUrls.current.add(photo.previewUrl));
    setPhotos((previous) => [...previous, ...added]);
    setPhotoErrors(errors);
  }

  function removePhoto(key: string) {
    const photo = photos.find((p) => p.key === key);
    if (!photo) return;
    releasePhotos([photo]);
    previewUrls.current.delete(photo.previewUrl);
    setPhotos((previous) => previous.filter((p) => p.key !== key));
    setPhotoErrors([]);
  }

  function updatePhoto(key: string, patch: Partial<PendingPhoto>) {
    setPhotos((previous) => previous.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function resetForm() {
    setTitle(''); setDescription(''); setCategory(''); setLocation(''); setItemDate('');
    releasePhotos(photos);
    photos.forEach((p) => previewUrls.current.delete(p.previewUrl));
    setPhotos([]); setPhotoErrors([]); setSavedReportId(null);
  }

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(requestedPage), limit: '20' });
    if (filter) params.set('type', filter);
    async function run() {
      try {
        const response = await fetch(`/api/backend/lost-found?${params}`, { cache: 'no-store', signal: controller.signal });
        if (response.status === 401) {
          router.replace('/login');
          return; // keep the loading state until the redirect lands
        }
        if (!response.ok) throw new Error(await readError(response));
        const result = await response.json() as ListResponse;
        if (controller.signal.aborted) return;
        setReports(result.data);
        setPage(result.pagination.page);
        setPages(Math.max(result.pagination.pages, 1));
        setTotal(result.pagination.total);
        setHasLoaded(true);
        setLoadFailed(false);
        setLoading(false);
      } catch (err) {
        // A newer request replaced this one; it owns error and loading now.
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        setError(err instanceof Error ? err.message : 'Could not load reports');
        setLoading(false);
      }
    }
    void run();
    return () => controller.abort();
  }, [filter, requestedPage, reloadKey, router]);

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setPhotoErrors([]);
    try {
      // Step 1: create the report (skipped when retrying photos for a report that already exists).
      let reportId = savedReportId;
      if (!reportId) {
        const response = await fetch('/api/backend/lost-found', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, title, description, category, location, itemDate: effectiveItemDate }),
        });
        if (response.status === 401) { router.replace('/login'); return; }
        if (!response.ok) throw new Error(await readError(response));
        reportId = ((await response.json()) as Report).id;
      }

      // Step 2: upload photos one at a time. Successful ones leave the list; failed ones stay for a retry.
      const queue = [...photos];
      const failures: string[] = [];
      for (let i = 0; i < queue.length; i++) {
        const photo = queue[i];
        setUploadStep({ current: i + 1, total: queue.length });
        updatePhoto(photo.key, { status: 'uploading', progress: 0, error: undefined });
        const result = await uploadPhoto(reportId, photo.file, (progress) => updatePhoto(photo.key, { progress }));
        if (result.ok) {
          releasePhotos([photo]);
          previewUrls.current.delete(photo.previewUrl);
          setPhotos((previous) => previous.filter((p) => p.key !== photo.key));
        } else if (result.status === 401) {
          router.replace('/login');
          return;
        } else {
          updatePhoto(photo.key, { status: 'failed', progress: 0, error: result.message });
          failures.push(`"${photo.file.name}" ${result.message}`);
        }
      }

      changeFilter(''); // the report exists either way: show it
      if (failures.length) {
        setSavedReportId(reportId);
        setPhotoErrors(failures);
        setError(`Your report was saved, but ${failures.length} photo${failures.length === 1 ? '' : 's'} could not be uploaded. Retry, or remove ${failures.length === 1 ? 'it' : 'them'} and finish.`);
        return;
      }
      const uploaded = queue.length;
      resetForm();
      setNotice(uploaded ? `Your report has been submitted with ${uploaded} photo${uploaded === 1 ? '' : 's'}.` : 'Your report has been submitted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create report');
    } finally {
      setBusy(false);
      setUploadStep(null);
    }
  }

  function finishWithoutFailedPhotos() {
    resetForm();
    setError('');
    setNotice('Your report has been submitted.');
  }

  async function findMatches(id: string) {
    setBusyAction(`matches:${id}`); setError('');
    try {
      const response = await fetch(`/api/backend/lost-found/${id}/matches`, { cache: 'no-store' });
      if (response.status === 401) { router.replace('/login'); return; }
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
      if (response.status === 401) { router.replace('/login'); return; }
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
      if (response.status === 401) { router.replace('/login'); return; }
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
      if (response.status === 401) { router.replace('/login'); return; }
      if (!response.ok) throw new Error(await readError(response));
      setNotice(status === 'approved' ? 'Claim approved and item marked resolved.' : 'Claim rejected.');
      await loadClaims(reportId);
      requestReports(page);
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
      if (response.status === 401) { router.replace('/login'); return; }
      if (!response.ok) throw new Error(await readError(response));
      setNotice('Report marked as resolved.');
      setMatches((previous) => { const next = { ...previous }; delete next[id]; return next; });
      requestReports(page);
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

      <form onSubmit={submitReport} aria-busy={busy} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <h2 className="text-lg font-semibold sm:col-span-2">Submit a report</h2>
        {/* Locked once the report is saved: retrying only re-sends the photos. `contents` keeps the grid. */}
        <fieldset disabled={busy || savedReportId !== null} className="contents">
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
          <input required type="date" max={todayDate || undefined} value={effectiveItemDate} onChange={(e) => setItemDate(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" />
        </label>
        <label className="text-sm font-medium sm:col-span-2">Description
          <textarea required minLength={5} maxLength={3000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe colour, brand, or distinguishing marks. Do not include passwords or sensitive ID details." className="mt-1 block w-full rounded-lg border p-2" />
        </label>
        </fieldset>
        <div className="sm:col-span-2">
          <p className="text-sm font-medium">Photos (optional)</p>
          <p className="mb-2 text-xs text-slate-500">
            {type === 'found'
              ? 'Photos of found items are shown only to you and moderators, so nobody can copy details from them to make a false claim.'
              : 'Photos of lost items are shown to everyone on your campus. Location data is removed from every photo.'}
          </p>
          <PhotoDropzone photos={photos} errors={photoErrors} disabled={busy} onAdd={addPhotos} onRemove={removePhoto} />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
          <button disabled={busy || (savedReportId !== null && photos.length === 0)} className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50 sm:flex-1">
            {uploadStep ? `Uploading photo ${uploadStep.current} of ${uploadStep.total}...` : busy ? 'Submitting...' : savedReportId ? 'Retry photo upload' : 'Submit report'}
          </button>
          {savedReportId && !busy && (
            <button type="button" onClick={finishWithoutFailedPhotos} className="rounded-lg border px-4 py-2 font-medium">Finish without these photos</button>
          )}
        </div>
      </form>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold">Open reports</h2>{hasLoaded && !loadFailed && <p className="text-sm text-slate-500">{total} report{total === 1 ? '' : 's'} in your campus</p>}</div>
          <select aria-label="Filter reports by type" value={filter} onChange={(e) => changeFilter(e.target.value)} className="rounded-lg border bg-white p-2 text-sm">
            <option value="">Lost and found</option><option value="lost">Lost only</option><option value="found">Found only</option>
          </select>
        </div>

        {loading && (!hasLoaded || loadFailed || reports.length === 0) ? <p role="status" className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">Loading reports...</p>
        : loadFailed ? null
        : reports.length === 0 ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">No open reports found.</p> : (
          <ul aria-busy={loading} className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
            {reports.map((report) => (
              <li key={report.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{report.title}</h3><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase">{report.type}</span></div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{report.description}</p>
                <p className="mt-2 text-sm text-slate-500">{report.category} · {report.location} · {String(report.itemDate).slice(0, 10)}</p>
                <PhotoThumbnails photos={report.photos} title={report.title} />
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
                  {matches[report.id].length === 0 ? <p className="mt-2 text-sm text-slate-500">No likely matches found yet.</p> : <ul className="mt-2 space-y-3">{matches[report.id].map((match) => <li key={match.report.id} className="rounded-lg bg-slate-50 p-3"><p className="font-medium">{match.report.title}<span className="ml-2 text-xs text-slate-500">Match score: {match.score}/100</span></p><p className="text-sm text-slate-600">{match.report.category} · {match.report.location} · {String(match.report.itemDate).slice(0, 10)}</p><p className="mt-1 text-xs text-slate-500">{match.reasons.join(' · ')}</p><PhotoThumbnails photos={match.report.photos} title={match.report.title} size="h-16 w-16" /></li>)}</ul>}
                </div>}
              </li>
            ))}
          </ul>
        )}
        {!loadFailed && pages > 1 && <nav aria-label="Report pages" className="mt-5 flex items-center justify-between"><button type="button" disabled={loading || page <= 1} onClick={() => requestReports(page - 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Previous</button><span className="text-sm text-slate-600">Page {page} of {pages}</span><button type="button" disabled={loading || page >= pages} onClick={() => requestReports(page + 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Next</button></nav>}
      </section>
    </main>
  );
}
