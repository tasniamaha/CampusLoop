'use client';

import Link from 'next/link';
import { ChangeEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ResourceReviews from '../../../components/ResourceReviews';

type Category = { id: string; name: string; slug: string };
type ImageItem = { id: string; url: string; sortOrder: number };
type ResourceDetail = {
  id: string;
  title: string;
  description: string | null;
  category: Category;
  itemCondition: 'new' | 'good' | 'fair' | 'worn';
  maxLoanDays: number;
  pickupLocation: string | null;
  borrowingRules: string | null;
  isListed: boolean;
  onLoan: boolean;
  available: boolean;
  favorited: boolean;
  owner: { id: string; name: string };
  imageUrl: string | null;
  images: ImageItem[];
};

// Image URLs from the API are relative to the API origin (http://localhost:3001).
const apiOrigin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/api\/?$/, '');

const primaryButton =
  'inline-flex items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
  'inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const dangerButton =
  'inline-flex items-center justify-center rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50';
const inputClass =
  'rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10';

async function readError(response: Response) {
  try {
    const data = await response.json();
    const message = data?.message;
    return Array.isArray(message) ? message.join(', ') : message || 'Request failed. Please try again.';
  } catch {
    return 'Request failed. Please try again.';
  }
}

function ResourceDetailContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [resource, setResource] = useState<ResourceDetail | null>(null);
  const [meId, setMeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(3);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [resRes, meRes] = await Promise.all([
        fetch(`/api/backend/resources/${id}`, { cache: 'no-store' }),
        fetch('/api/backend/auth/me', { cache: 'no-store' }),
      ]);
      if (resRes.status === 401 || meRes.status === 401) {
        router.replace('/login');
        return;
      }
      if (resRes.status === 404) {
        setResource(null);
        setError('This resource does not exist or is not available.');
        return;
      }
      if (!resRes.ok) throw new Error(await readError(resRes));
      const data: ResourceDetail = await resRes.json();
      setResource(data);
      setDays((d) => Math.min(Math.max(d, 1), data.maxLoanDays));

      if (meRes.ok) {
        const me = await meRes.json();
        setMeId(me?.id ?? me?.sub ?? me?.user?.id ?? '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load this resource.');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [load]);

  async function send(url: string, init: RequestInit, success: string) {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const response = await fetch(url, init);
      if (response.status === 401) {
        router.replace('/login');
        return false;
      }
      if (!response.ok) throw new Error(await readError(response));
      setNotice(success);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite() {
    if (!resource) return;
    const ok = await send(
      `/api/backend/resources/${resource.id}/favorite`,
      { method: resource.favorited ? 'DELETE' : 'PUT' },
      resource.favorited ? 'Removed from saved resources.' : 'Saved to your favorites.',
    );
    if (ok) await load();
  }

  async function requestBorrow() {
    if (!resource) return;
    // Exactly N days minus a minute, so it is always inside the owner's maximum.
    const dueDate = new Date(Date.now() + days * 24 * 3600 * 1000 - 60_000).toISOString();
    const ok = await send(
      '/api/backend/borrow-requests',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceId: resource.id,
          dueDate,
          ...(message.trim() ? { message: message.trim() } : {}),
        }),
      },
      'Borrow request sent. Track it on the Borrowings page.',
    );
    if (ok) setMessage('');
  }

  async function toggleListed() {
    if (!resource) return;
    const ok = await send(
      `/api/backend/resources/${resource.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isListed: !resource.isListed }),
      },
      resource.isListed ? 'Listing hidden from other students.' : 'Listing is visible again.',
    );
    if (ok) await load();
  }

  async function uploadImages(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!resource || !files || files.length === 0) return;
    const form = new FormData();
    Array.from(files).forEach((file) => form.append('files', file));
    event.target.value = '';

    const ok = await send(
      `/api/backend/resources/${resource.id}/images`,
      { method: 'POST', body: form },
      'Photos uploaded.',
    );
    if (ok) await load();
  }

  async function deleteImage(imageId: string) {
    if (!resource || !window.confirm('Remove this photo?')) return;
    const ok = await send(
      `/api/backend/resources/${resource.id}/images/${imageId}`,
      { method: 'DELETE' },
      'Photo removed.',
    );
    if (ok) await load();
  }

  if (loading) {
    return <main className="mx-auto max-w-4xl px-4 py-10 text-sm text-slate-500">Loading...</main>;
  }

  if (!resource) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error || 'Resource not found.'}
        </p>
        <Link href="/resources" className={secondaryButton}>
          Back to resources
        </Link>
      </main>
    );
  }

  const isOwner = meId !== '' && meId === resource.owner.id;
  const dayOptions = Array.from({ length: resource.maxLoanDays }, (_, i) => i + 1);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href="/resources" className="text-sm font-semibold text-emerald-700 hover:underline">
          Back to resources
        </Link>
        <Link href="/borrowings" className="text-sm font-semibold text-emerald-700 hover:underline">
          My borrowings
        </Link>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          {resource.images.length > 0 ? (
            <div className="space-y-3">
              {resource.images.map((image) => (
                <div key={image.id} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${apiOrigin}${image.url}`}
                    alt={resource.title}
                    className="h-64 w-full object-cover"
                  />
                  {isOwner && (
                    <div className="absolute right-2 top-2">
                      <button type="button" disabled={busy} onClick={() => void deleteImage(image.id)} className={dangerButton}>
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-400">
              No photos yet
            </div>
          )}

          {isOwner && (
            <label className="mt-3 block text-sm text-slate-600">
              <span className="mb-1 block font-medium text-slate-700">Add photos (JPEG, PNG or WebP, up to 5 MB each, 5 total)</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={busy}
                onChange={(e) => void uploadImages(e)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-emerald-700 hover:file:bg-emerald-100"
              />
            </label>
          )}
        </section>

        <section>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
              {resource.category.name}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-700">
              {resource.itemCondition}
            </span>
            {!resource.isListed && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                Hidden
              </span>
            )}
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                resource.available
                  ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                  : 'bg-rose-50 text-rose-800 ring-rose-200'
              }`}
            >
              {resource.available ? 'Available' : resource.onLoan ? 'On loan' : 'Unavailable'}
            </span>
          </div>

          <h1 className="mt-3 text-2xl font-bold text-slate-900">{resource.title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Shared by <span className="font-medium">{resource.owner.name}</span>
          </p>

          {resource.description && <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{resource.description}</p>}

          <dl className="mt-4 space-y-2 text-sm text-slate-600">
            <div>
              <dt className="inline font-medium text-slate-700">Maximum loan: </dt>
              <dd className="inline">{resource.maxLoanDays} days</dd>
            </div>
            {resource.pickupLocation && (
              <div>
                <dt className="inline font-medium text-slate-700">Pickup: </dt>
                <dd className="inline">{resource.pickupLocation}</dd>
              </div>
            )}
            {resource.borrowingRules && (
              <div>
                <dt className="font-medium text-slate-700">Borrowing rules</dt>
                <dd className="mt-1 whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2">{resource.borrowingRules}</dd>
              </div>
            )}
          </dl>

          <div className="mt-6 space-y-4">
            <button type="button" disabled={busy} onClick={() => void toggleFavorite()} className={secondaryButton}>
              {resource.favorited ? 'Remove from favorites' : 'Save to favorites'}
            </button>

            {isOwner ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-3 text-sm text-slate-600">This is your resource.</p>
                <button type="button" disabled={busy} onClick={() => void toggleListed()} className={secondaryButton}>
                  {resource.isListed ? 'Hide listing' : 'Show listing'}
                </button>
                <Link href="/borrowings" className="ml-2 inline-block text-sm font-semibold text-emerald-700 hover:underline">
                  See incoming requests
                </Link>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Request to borrow</h2>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="text-sm text-slate-600">
                    <span className="mr-2">Keep it for</span>
                    <select
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                      className={inputClass}
                    >
                      {dayOptions.map((d) => (
                        <option key={d} value={d}>
                          {d} {d === 1 ? 'day' : 'days'}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Optional message to the owner"
                  className={`${inputClass} mt-3 w-full`}
                />
                <button
                  type="button"
                  disabled={busy || !resource.available}
                  onClick={() => void requestBorrow()}
                  className={`${primaryButton} mt-3`}
                >
                  {busy ? 'Working...' : resource.available ? 'Send request' : 'Not available right now'}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      <ResourceReviews resourceId={resource.id} ownerId={resource.owner.id} currentUserId={meId} />
    </main>
  );
}
export default function ResourceDetailPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-4xl px-4 py-10 text-sm text-slate-500">Loading...</main>}>
      <ResourceDetailContent />
    </Suspense>
  );
}