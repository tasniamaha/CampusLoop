'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import StarRating from './StarRating';

type ReviewItem = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewer: { id: string; name: string };
};
type ReviewList = {
  resourceId: string;
  reviewCount: number;
  averageRating: number | null;
  page: number;
  limit: number;
  totalPages: number;
  items: ReviewItem[];
};
type Reputation = {
  userId: string;
  name: string;
  reviewCount: number;
  rawAverage: number | null;
  reputationScore: number;
};

const buttonClass = 'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50';

async function responseError(response: Response) {
  try {
    const data = await response.json();
    const message = data?.message;
    return Array.isArray(message) ? message.join(', ') : message || 'Request failed.';
  } catch {
    return 'Request failed.';
  }
}

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ResourceReviews({ resourceId, ownerId }: { resourceId: string; ownerId: string }) {
  const router = useRouter();
  const [data, setData] = useState<ReviewList | null>(null);
  const [reputation, setReputation] = useState<Reputation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [reviewsResponse, reputationResponse] = await Promise.all([
        fetch(`/api/backend/reviews/resource/${encodeURIComponent(resourceId)}?page=1&limit=10`, { cache: 'no-store' }),
        fetch(`/api/backend/reviews/reputation/${encodeURIComponent(ownerId)}`, { cache: 'no-store' }),
      ]);
      if (reviewsResponse.status === 401 || reputationResponse.status === 401) {
        router.replace('/login');
        return;
      }
      if (!reviewsResponse.ok) throw new Error(await responseError(reviewsResponse));
      setData((await reviewsResponse.json()) as ReviewList);
      if (reputationResponse.ok) setReputation((await reputationResponse.json()) as Reputation);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load reviews.');
    } finally {
      setLoading(false);
    }
  }, [resourceId, ownerId, router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function report(review: ReviewItem) {
    const reason = window.prompt('Why are you reporting this review? (At least 3 characters)');
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError('Report reason must contain at least 3 characters.');
      return;
    }
    setBusyId(review.id);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/backend/reviews/${encodeURIComponent(review.id)}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (!response.ok) throw new Error(await responseError(response));
      setNotice('Review report submitted for moderation.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to report this review.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="resource-reviews-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="resource-reviews-heading" className="text-lg font-bold text-slate-900">Reviews</h2>
          <p className="mt-1 text-sm text-slate-600">Ratings from borrowers whose reviews are currently visible.</p>
        </div>
        {reputation && (
          <div className="rounded-xl bg-emerald-50 px-3 py-2 text-right ring-1 ring-inset ring-emerald-100">
            <p className="text-xs font-medium text-emerald-800">Owner reputation</p>
            <p className="text-lg font-bold text-emerald-900">{reputation.reputationScore.toFixed(2)} / 5</p>
            <p className="text-xs text-emerald-800">{reputation.reviewCount} distinct reviewer{reputation.reviewCount === 1 ? '' : 's'}</p>
          </div>
        )}
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      {loading ? <p className="mt-4 text-sm text-slate-500">Loading reviews…</p> : null}
      {!loading && data && (
        <>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{data.averageRating === null ? '—' : data.averageRating.toFixed(2)}</span>
            <StarRating value={data.averageRating} size="md" label="Average resource rating" />
            <span className="text-sm text-slate-500">({data.reviewCount} borrower review{data.reviewCount === 1 ? '' : 's'})</span>
          </div>
          {data.items.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">No public reviews for this resource yet. Blind reviews appear after both parties submit or the review window closes.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {data.items.map((review) => (
                <li key={review.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-800">{review.reviewer.name}</p>
                      <p className="text-xs text-slate-500">{dateLabel(review.createdAt)}</p>
                    </div>
                    <StarRating value={review.rating} size="sm" label={`Review by ${review.reviewer.name}`} />
                  </div>
                  {review.comment ? <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{review.comment}</p> : <p className="mt-2 text-sm italic text-slate-500">No written comment.</p>}
                  <button type="button" disabled={busyId === review.id} onClick={() => void report(review)} className={`${buttonClass} mt-3`}>
                    {busyId === review.id ? 'Submitting…' : 'Report review'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {data.totalPages > 1 && <p className="mt-4 text-xs text-slate-500">Showing page 1 of {data.totalPages}. Additional review pagination is not yet exposed in this interface.</p>}
        </>
      )}
    </section>
  );
}
