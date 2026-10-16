'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export default function VerifyEmailPage() {
  const tokenRef = useRef('');
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!tokenRef.current) {
      tokenRef.current = new URLSearchParams(window.location.search).get('token') ?? '';
      // Keep the token out of browser history and the address bar after we've captured it.
      if (tokenRef.current) window.history.replaceState(null, '', '/verify-email');
    }
    setHasToken(tokenRef.current.length > 0);
  }, []);

  async function confirm() {
    setState('busy');
    setMessage('');
    try {
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenRef.current }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setState('ok');
        return;
      }
      const m = data.message;
      setMessage(Array.isArray(m) ? m.join(', ') : m || 'Verification failed.');
      setState('error');
    } catch {
      setMessage('Unable to connect. Please try again.');
      setState('error');
    }
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-4 text-3xl font-bold">Confirm your email</h1>

      {hasToken === null && <p className="text-gray-600">Loading…</p>}

      {hasToken === false && (
        <>
          <p role="alert" className="text-sm text-red-600">
            This page needs the link from your verification email. Open that link, or log in to request a new one.
          </p>
          <Link href="/dashboard" className="mt-4 inline-block underline">Go to your dashboard</Link>
        </>
      )}

      {hasToken && state === 'ok' && (
        <>
          <p className="text-emerald-700">Your email address is verified.</p>
          <Link href="/dashboard" className="mt-4 inline-block underline">Continue to CampusLoop</Link>
        </>
      )}

      {hasToken && state !== 'ok' && (
        <>
          {state === 'error' && (
            <p role="alert" className="mb-4 text-sm text-red-600">
              {message}{' '}
              <Link href="/dashboard" className="underline">Request a new link</Link>
            </p>
          )}
          <button
            type="button"
            onClick={confirm}
            disabled={state === 'busy'}
            className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            {state === 'busy' ? 'Confirming…' : 'Confirm my email'}
          </button>
        </>
      )}
    </main>
  );
}