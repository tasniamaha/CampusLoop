'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setNote('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      setNote(
        res.status === 429
          ? 'Too many requests. Please try again later.'
          : res.ok
            ? data.message
            : 'Could not send the link. Check the email address and try again.',
      );
    } catch {
      setNote('Unable to connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-4 text-3xl font-bold">Forgot password</h1>
      <form onSubmit={submit} className="space-y-4">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded border px-3 py-2"
        />
        <button disabled={busy} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          {busy ? 'Sending...' : 'Send reset link'}
        </button>
      </form>
      {note && <p role="status" className="mt-4 text-sm text-gray-700">{note}</p>}
      <Link href="/login" className="mt-6 inline-block text-sm underline">Back to login</Link>
    </main>
  );
}