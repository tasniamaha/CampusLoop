'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export default function ResetPasswordPage() {
  const tokenRef = useRef('');
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');

useEffect(() => {
  if (!tokenRef.current) {
    tokenRef.current = new URLSearchParams(window.location.search).get('token') ?? '';
    if (tokenRef.current) window.history.replaceState(null, '', '/reset-password');
  }
  setHasToken(tokenRef.current.length > 0);
}, []);

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setMessage('Passwords do not match.');
      setState('error');
      return;
    }
    setState('busy');
    setMessage('');
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenRef.current, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return setState('ok');
      const m = data.message;
      setMessage(Array.isArray(m) ? m.join(', ') : m || 'Reset failed.');
      setState('error');
    } catch {
      setMessage('Unable to connect. Please try again.');
      setState('error');
    }
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-4 text-3xl font-bold">Choose a new password</h1>
      {hasToken === false && (
        <p role="alert" className="text-sm text-red-600">
          This page needs the link from your reset email.{' '}
          <Link href="/forgot-password" className="underline">Request a new one</Link>
        </p>
      )}
      {hasToken && state === 'ok' && (
        <p className="text-emerald-700">
          Password updated. <Link href="/login" className="underline">Log in</Link>
        </p>
      )}
      {hasToken && state !== 'ok' && (
        <form onSubmit={submit} className="space-y-4">
          <input type="password" required minLength={12} maxLength={72} value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="New password (12+ characters)"
            className="w-full rounded border px-3 py-2" />
          <input type="password" required minLength={12} maxLength={72} value={confirm}
            onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password"
            className="w-full rounded border px-3 py-2" />
          {state === 'error' && <p role="alert" className="text-sm text-red-600">{message}</p>}
          <button disabled={state === 'busy'} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
            {state === 'busy' ? 'Saving...' : 'Update password'}
          </button>
        </form>
      )}
    </main>
  );
}