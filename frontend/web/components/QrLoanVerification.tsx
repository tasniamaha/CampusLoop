'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';

type Props = {
  requestId: string;
  role: 'incoming' | 'outgoing';
  status: string;
  onComplete: () => void;
};

async function readError(response: Response) {
  try {
    const body = await response.json();
    return Array.isArray(body.message)
      ? body.message.join(', ')
      : body.message || 'Request failed';
  } catch {
    return 'Request failed';
  }
}

export default function QrLoanVerification({
  requestId,
  role,
  status,
  onComplete,
}: Props) {
  const [qrImage, setQrImage] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const mode =
    role === 'outgoing' && status === 'approved'
      ? 'pickup'
      : role === 'incoming' && status === 'active'
        ? 'return'
        : null;

  const canGenerate =
    (role === 'incoming' && status === 'approved') ||
    (role === 'outgoing' && status === 'active');

  async function generateQr() {
    setBusy(true);
    setError('');
    setNotice('');
    setQrImage('');

    try {
      const purpose = role === 'incoming' ? 'pickup-qr' : 'return-qr';
      const response = await fetch(
        `/api/backend/borrow-requests/${requestId}/${purpose}`,
        { method: 'POST' },
      );

      if (!response.ok) throw new Error(await readError(response));

      const data: { token: string } = await response.json();
      setQrImage(await QRCode.toDataURL(data.token));
      setNotice('QR generated. It expires in five minutes.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate QR.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!scanning || !mode) return;

    const elementId = `qr-reader-${requestId}`;
    let disposed = false;
    let completed = false;
    let scanner: Html5Qrcode | null = null;

    async function stopScanner() {
      if (scanner?.isScanning) {
        await scanner.stop();
      }
      scanner?.clear();
    }

    async function processToken(token: string) {
      if (completed || disposed) return;
      completed = true;

      try {
        await stopScanner();

        const endpoint =
          mode === 'pickup' ? 'confirm-pickup' : 'return';
        const method = mode === 'pickup' ? 'POST' : 'PATCH';

        const response = await fetch(
          `/api/backend/borrow-requests/${requestId}/${endpoint}`,
          {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          },
        );

        if (!response.ok) throw new Error(await readError(response));

        setNotice(
          mode === 'pickup'
            ? 'Pickup confirmation recorded.'
            : 'Return confirmation recorded by the resource owner.',
        );
        setScanning(false);
        onComplete();
      } catch (e) {
        completed = false;
        setError(e instanceof Error ? e.message : 'QR verification failed.');
        setScanning(false);
      }
    }

    async function startScanner() {
      try {
        scanner = new Html5Qrcode(elementId);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            void processToken(decodedText);
          },
          () => {},
        );
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : 'Unable to start the camera. Check camera permission.',
        );
        setScanning(false);
      }
    }

    void startScanner();

    return () => {
      disposed = true;
      if (scanner) {
        void stopScanner().catch(() => {});
      }
      scannerRef.current = null;
    };
  }, [scanning, mode, requestId, onComplete]);

  if (!canGenerate && !mode) return null;

  return (
    <section className="mt-4 rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold text-slate-900">QR pickup and return</h3>
      <p className="mt-1 text-sm text-slate-600">
        QR confirmation records the action in loan history. It does not
        independently prove that a physical handover occurred.
      </p>

      {canGenerate && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void generateQr()}
          className="mt-3 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy
            ? 'Generating...'
            : role === 'incoming'
              ? 'Generate pickup QR'
              : 'Generate return QR'}
        </button>
      )}

      {mode && (
        <button
          type="button"
          disabled={scanning}
          onClick={() => {
            setError('');
            setNotice('');
            setScanning(true);
          }}
          className="ml-2 mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
        >
          {scanning
            ? 'Camera active...'
            : mode === 'pickup'
              ? 'Scan pickup QR'
              : 'Scan return QR'}
        </button>
      )}

      {qrImage && (
        <div className="mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrImage} alt="Short-lived loan verification QR code" width={240} height={240} />
          <p className="text-xs text-slate-500">
            Let the other party scan this code before it expires.
          </p>
        </div>
      )}

      {scanning && (
        <div
          id={`qr-reader-${requestId}`}
          className="mt-3 max-w-sm overflow-hidden rounded-lg"
        />
      )}

      {notice && <p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    </section>
  );
}