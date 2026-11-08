import type { ReactNode } from 'react';

// Shared markup for the loading / error / empty states every data view needs.

export function LoadingState({ children }: { children: ReactNode }) {
  return <p role="status" className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">{children}</p>;
}

/** A failed load, with a retry button. Shows only the error: no empty text, no stale count. */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-medium">Try again</button>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">{children}</p>;
}
