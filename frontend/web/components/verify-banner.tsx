'use client';

import { useState } from 'react';

export default function VerifyBanner({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function resend() {
    setBusy(true);
    setNote('');
    try {
      const response = await fetch('/api/backend/auth/resend-verification', { method: 'POST' });
      setNote(
        response.status === 429
          ? 'Too many requests. Please try again in an hour.'
          : response.ok
            ? 'If your email is not verified yet, a new link is on its way.'
            : 'Could not send the link. Please try again later.',
      );
    } catch {
      setNote('Unable to connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="status" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
      <p>
        Verify <strong>{email}</strong> to list items and request loans. Check your inbox for the link.
      </p>
      <button type="button" onClick={resend} disabled={busy} className="mt-2 font-semibold underline disabled:opacity-50">
        {busy ? 'Sending...' : 'Resend link'}
      </button>
      {note && <p className="mt-2 text-gray-700">{note}</p>}
    </div>
  );
}