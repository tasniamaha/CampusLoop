'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import type { ApiResult } from './api-client';

type Settled = { key: string; ok: true } | { key: string; ok: false; message: string };

export type ApiQuery<T> = {
  /** The last successful result. Kept while a newer request runs, so a list can dim instead of blanking. */
  data: T | null;
  /** The current request has not settled yet. */
  loading: boolean;
  /** Set only when the current request failed. */
  error: { status: number; message: string } | null;
  reload: () => void;
};

/**
 * Loads `fetcher` whenever `key` changes (or on `reload()`), aborting the previous request.
 * A 401 sends the user to /login and stays "loading" until the redirect lands.
 * `key = null` means "don't load" (e.g. the viewer can't see this part): loading false, data null.
 * `onData` can return false to drop a result, e.g. after redirecting a page past the end.
 *
 * Loading is derived (the current key has not settled), so the effect never sets state synchronously.
 */
export function useApiQuery<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<ApiResult<T>>,
  onData?: (data: T) => boolean,
): ApiQuery<T> {
  const router = useRouter();
  const [reloadCount, setReloadCount] = useState(0);
  const requestKey = key === null ? null : `${key}|${reloadCount}`;
  const [settled, setSettled] = useState<(Settled & { status?: number }) | null>(null);
  const [data, setData] = useState<T | null>(null);

  const load = useEffectEvent((signal: AbortSignal) => fetcher(signal));
  const accept = useEffectEvent((value: T) => (onData ? onData(value) : true));

  useEffect(() => {
    if (requestKey === null) return;
    const controller = new AbortController();
    async function run(currentKey: string) {
      try {
        const result = await load(controller.signal);
        if (controller.signal.aborted) return; // a newer request owns the state now
        if (!result.ok) {
          if (result.status === 401) {
            router.replace('/login');
            return;
          }
          setSettled({ key: currentKey, ok: false, status: result.status, message: result.message });
          return;
        }
        if (!accept(result.data)) return;
        setData(result.data);
        setSettled({ key: currentKey, ok: true });
      } catch (err) {
        if (controller.signal.aborted) return;
        setSettled({ key: currentKey, ok: false, status: 0, message: err instanceof Error ? err.message : 'Could not load' });
      }
    }
    void run(requestKey);
    return () => controller.abort();
  }, [requestKey, router]);

  const reload = useCallback(() => setReloadCount((n) => n + 1), []);

  if (requestKey === null) return { data: null, loading: false, error: null, reload };
  const current = settled?.key === requestKey ? settled : null;
  return {
    data,
    loading: current === null,
    error: current && !current.ok ? { status: current.status ?? 0, message: current.message } : null,
    reload,
  };
}
