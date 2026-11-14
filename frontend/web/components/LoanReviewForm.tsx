'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import StarRating from './StarRating';
import { call, json } from '../lib/api-client';

type Eligibility = {
  eligible: boolean;
  reason: string | null;
  role?: 'borrower' | 'owner';
  windowClosesAt?: string;
};

const reasonText: Record<string, string> = {
  already_reviewed: 'You have already reviewed this loan.',
  loan_not_returned: 'Reviews are available after the loan is returned.',
  handover_not_confirmed: 'A verified pickup is required before reviewing.',
  return_not_confirmed: 'A confirmed return is required before reviewing.',
  window_closed: 'The 14-day review window has closed.',
};

export default function LoanReviewForm({ borrowRequestId }: { borrowRequestId: string }) {
  const router = useRouter();
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadEligibility = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await call<Eligibility>(`/reviews/eligibility/${encodeURIComponent(borrowRequestId)}`);
      if (!result.ok) {
        if (result.status === 401) {
          router.replace('/login');
          return;
        }
        throw new Error(result.message);
      }
      setEligibility(result.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to check review eligibility.');
    } finally {
      setLoading(false);
    }
  }, [borrowRequestId, router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadEligibility(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadEligibility]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rating === null) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await call(
        '/reviews',
        json('POST', {
          borrowRequestId,
          rating,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      );
      if (!result.ok) {
        if (result.status === 401) {
          router.replace('/login');
          return;
        }
        throw new Error(result.message);
      }
      setNotice('Review submitted. Blind-review rules may keep it hidden until both parties review or the review window closes.');
      setComment('');
      setRating(null);
      await loadEligibility();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to submit review.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="Loan review">
      <h3 className="text-sm font-semibold text-slate-900">Review this loan</h3>
      {loading ? <p className="mt-2 text-sm text-slate-500">Checking review eligibility…</p> : null}
      {!loading && eligibility && !eligibility.eligible ? (
        <p className="mt-2 text-sm text-slate-600">
          {reasonText[eligibility.reason ?? ''] ?? 'A review is not available for this loan.'}
        </p>
      ) : null}
      {!loading && eligibility?.eligible ? (
        <form className="mt-3 space-y-3" onSubmit={submit}>
          <p className="text-sm text-slate-600">
            You are reviewing the {eligibility.role === 'owner' ? 'borrower' : 'resource owner'}. Reviews must be submitted within 14 days of the confirmed return.
          </p>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Rating</legend>
            <StarRating value={rating} onChange={setRating} size="lg" label="Choose a rating" />
          </fieldset>
          <label className="block text-sm font-medium text-slate-700">
            Comment (optional)
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="Describe your experience with this loan…"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">{comment.length}/1000 characters</span>
          </label>
          <button type="submit" disabled={busy || rating === null} className="inline-flex rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? 'Submitting…' : 'Submit review'}
          </button>
        </form>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p> : null}
      {notice ? <p role="status" className="mt-2 text-sm text-emerald-800">{notice}</p> : null}
    </section>
  );
}
