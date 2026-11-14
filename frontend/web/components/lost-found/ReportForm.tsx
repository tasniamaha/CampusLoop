'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import PhotoDropzone, { preparePhotos, releasePhotos, type PendingPhoto } from '../PhotoDropzone';
import { COLORS, createReport, MAX_WINDOW_DAYS, uploadPhoto, type LostFoundType } from '../../lib/lost-found-api';

const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getToday = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
// The local date only exists in the browser: render '' on the server and during hydration, then today.
const subscribeNoop = () => () => {};
const getServerToday = () => '';

/**
 * Creates a report, then uploads its photos one per request. When every photo is in, it opens the
 * report's own page. If some photos fail, the report is kept and the form switches to retrying
 * only those photos.
 */
export default function ReportForm() {
  const router = useRouter();
  const [type, setType] = useState<LostFoundType>('lost');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  // '' means "not chosen yet": the field shows and submits today until the user picks a date.
  const [itemDate, setItemDate] = useState('');
  const todayDate = useSyncExternalStore(subscribeNoop, getToday, getServerToday);
  const effectiveItemDate = itemDate || todayDate;
  // Optional end of a time window; '' means a single day.
  const [itemDateTo, setItemDateTo] = useState('');
  const [color, setColor] = useState('');
  const [brand, setBrand] = useState('');
  const latestDateTo = effectiveItemDate && todayDate
    ? [addDays(effectiveItemDate, MAX_WINDOW_DAYS), todayDate].sort()[0]
    : undefined;
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);
  // Set when the report was created but some photos failed: the form then only retries those photos.
  const [savedReportId, setSavedReportId] = useState<string | null>(null);
  const [uploadStep, setUploadStep] = useState<{ current: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // Stays true while navigating to the new report, so a second click cannot create a duplicate.
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');
  // Preview URLs still alive, released on unmount (including when we navigate to the new report).
  const previewUrls = useRef(new Set<string>());

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

  function openReport(reportId: string) {
    setLeaving(true);
    router.push(`/lost-found/${reportId}?submitted=1`);
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setPhotoErrors([]);
    try {
      // Step 1: create the report (skipped when retrying photos for a report that already exists).
      let reportId = savedReportId;
      if (!reportId) {
        const created = await createReport({
          type, title, description, category, location, itemDate: effectiveItemDate,
          ...(itemDateTo && itemDateTo !== effectiveItemDate ? { itemDateTo } : {}),
          ...(color ? { color } : {}),
          ...(brand.trim() ? { brand: brand.trim() } : {}),
        });
        if (!created.ok) {
          if (created.status === 401) { router.replace('/login'); return; }
          throw new Error(created.message);
        }
        reportId = created.data.id;
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

      if (failures.length) {
        setSavedReportId(reportId);
        setPhotoErrors(failures);
        setError(`Your report was saved, but ${failures.length} photo${failures.length === 1 ? '' : 's'} could not be uploaded. Retry, or remove ${failures.length === 1 ? 'it' : 'them'} and finish.`);
        return;
      }
      openReport(reportId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create report');
    } finally {
      setBusy(false);
      setUploadStep(null);
    }
  }

  return (
    <form onSubmit={submitReport} aria-busy={busy || leaving} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 sm:col-span-2">{error}</p>}
      {/* Locked once the report is saved: retrying only re-sends the photos. `contents` keeps the grid. */}
      <fieldset disabled={busy || leaving || savedReportId !== null} className="contents">
        <label className="text-sm font-medium">Report type
          <select value={type} onChange={(e) => setType(e.target.value as LostFoundType)} className="mt-1 block w-full rounded-lg border p-2">
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
        <label className="text-sm font-medium">Colour (optional)
          <select value={color} onChange={(e) => setColor(e.target.value)} className="mt-1 block w-full rounded-lg border p-2">
            <option value="">Not sure</option>
            {COLORS.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Brand (optional)
          <input maxLength={60} placeholder="e.g. Casio, Milton, Samsung" value={brand} onChange={(e) => setBrand(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" />
        </label>
        <label className="text-sm font-medium">{type === 'lost' ? 'Date lost (or first possible day)' : 'Date found'}
          <input
            required type="date" max={todayDate || undefined} value={effectiveItemDate}
            onChange={(e) => { setItemDate(e.target.value); if (itemDateTo && itemDateTo < e.target.value) setItemDateTo(''); }}
            className="mt-1 block w-full rounded-lg border p-2"
          />
        </label>
        <label className="text-sm font-medium">Last possible day (optional)
          <input
            type="date" min={effectiveItemDate || undefined} max={latestDateTo} value={itemDateTo}
            onChange={(e) => setItemDateTo(e.target.value)} aria-describedby="item-date-to-help"
            className="mt-1 block w-full rounded-lg border p-2"
          />
          <span id="item-date-to-help" className="mt-1 block text-xs font-normal text-slate-500">
            Not sure of the exact day? Give a range of up to {MAX_WINDOW_DAYS} days. Leave empty for a single day.
          </span>
        </label>
        <label className="text-sm font-medium sm:col-span-2">Description
          <textarea required minLength={5} maxLength={3000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the item and where you last saw it." aria-describedby="private-details-hint" className="mt-1 block w-full rounded-lg border p-2" />
        </label>
        <p id="private-details-hint" className="-mt-2 text-xs text-slate-500 sm:col-span-2">
          Do not enter serial numbers or engravings; those belong in claim proof. Also leave out passwords and ID numbers.
        </p>
      </fieldset>
      <div className="sm:col-span-2">
        <p className="text-sm font-medium">Photos (optional)</p>
        <p className="mb-2 text-xs text-slate-500">
          {type === 'found'
            ? 'Photos of found items are shown only to you and moderators, so nobody can copy details from them to make a false claim.'
            : 'Photos of lost items are shown to everyone on your campus. Location data is removed from every photo.'}
        </p>
        <PhotoDropzone photos={photos} errors={photoErrors} disabled={busy || leaving} onAdd={addPhotos} onRemove={removePhoto} />
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
        <button disabled={busy || leaving || (savedReportId !== null && photos.length === 0)} className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50 sm:flex-1">
          {leaving ? 'Opening your report...' : uploadStep ? `Uploading photo ${uploadStep.current} of ${uploadStep.total}...` : busy ? 'Submitting...' : savedReportId ? 'Retry photo upload' : 'Submit report'}
        </button>
        {savedReportId && !busy && !leaving && (
          <button type="button" onClick={() => openReport(savedReportId)} className="rounded-lg border px-4 py-2 font-medium">Finish without these photos</button>
        )}
      </div>
    </form>
  );
}
