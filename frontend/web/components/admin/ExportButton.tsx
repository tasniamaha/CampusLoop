'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { download } from '../../lib/api-client';

/**
 * Downloads an admin CSV export with the given filters. Every export is recorded in the audit log
 * by the API. Errors (e.g. more than 50,000 rows, or the rate limit) show next to the button.
 */
export default function ExportButton({ path, fallbackName, label = 'Export CSV' }: { path: string; fallbackName: string; label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; message: string | null; error: boolean }>({ busy: false, message: null, error: false });

  async function run() {
    setState({ busy: true, message: null, error: false });
    try {
      const result = await download(path, fallbackName);
      if (!result.ok && result.status === 401) {
        router.replace('/login');
        return;
      }
      setState(result.ok ? { busy: false, message: `Downloaded ${result.data.filename}`, error: false } : { busy: false, message: result.message, error: true });
    } catch {
      setState({ busy: false, message: 'The export could not be downloaded. Try again.', error: true });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={run} disabled={state.busy} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50">
        {state.busy ? 'Preparing...' : label}
      </button>
      <span role={state.error ? 'alert' : 'status'} className={`text-sm ${state.error ? 'text-rose-700' : 'text-slate-500'}`}>
        {state.message}
      </span>
    </div>
  );
}
