'use client';

import { useEffect, useRef, useState } from 'react';

const base = 'rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50';
const tones = {
  danger: 'border border-rose-300 bg-white text-rose-800 hover:bg-rose-50',
  default: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
} as const;
const confirmTones = {
  danger: 'bg-rose-700 text-white hover:bg-rose-800',
  default: 'bg-emerald-700 text-white hover:bg-emerald-800',
} as const;

/**
 * A button that asks before acting: the first press shows the question with Confirm and Cancel,
 * in place. Focus moves to Confirm; Escape or Cancel goes back and returns focus to the button.
 */
export default function ConfirmButton({
  label,
  question,
  confirmLabel = 'Confirm',
  onConfirm,
  disabled = false,
  tone = 'default',
}: {
  label: string;
  question: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  tone?: keyof typeof tones;
}) {
  const [asking, setAsking] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (asking) confirmRef.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [asking]);

  const cancel = () => {
    returnFocus.current = true;
    setAsking(false);
  };

  if (!asking) {
    return (
      <button ref={triggerRef} type="button" disabled={disabled} onClick={() => setAsking(true)} className={`${base} ${tones[tone]}`}>
        {label}
      </button>
    );
  }

  return (
    <span
      role="group"
      aria-label={question}
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancel();
      }}
      className="inline-flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2 py-1"
    >
      <span className="text-sm text-slate-700">{question}</span>
      <button
        ref={confirmRef}
        type="button"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        className={`${base} ${confirmTones[tone]}`}
      >
        {confirmLabel}
      </button>
      <button type="button" onClick={cancel} className={`${base} ${tones.default}`}>
        Cancel
      </button>
    </span>
  );
}
