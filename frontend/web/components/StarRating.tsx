'use client';

import { useId, useState } from 'react';

type StarRatingProps = {
  value: number | null;
  onChange?: (value: number) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
};

function StarGlyph({ fillPercent, className }: { fillPercent: number; className: string }) {
  return (
    <span aria-hidden="true" className={`relative inline-block leading-none ${className}`}>
      <span className="text-slate-300">★</span>
      <span
        className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap text-amber-500"
        style={{ width: `${fillPercent}%` }}
      >
        ★
      </span>
    </span>
  );
}

export default function StarRating({
  value,
  onChange,
  disabled = false,
  size = 'md',
  label = 'Rating',
}: StarRatingProps) {
  const name = useId();
  const [hover, setHover] = useState<number | null>(null);
  const interactive = Boolean(onChange) && !disabled;
  const shown = hover ?? value ?? 0;
  const text = size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-4xl' : 'text-2xl';
  const fillFor = (star: number) => Math.max(0, Math.min(100, (shown - (star - 1)) * 100));

  if (!interactive) {
    return (
      <span
        role="img"
        aria-label={value === null ? `${label}: no rating yet` : `${label}: ${value} out of 5`}
        className="inline-flex items-center gap-0.5"
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <StarGlyph key={star} fillPercent={fillFor(star)} className={text} />
        ))}
        <span aria-hidden="true" className="ml-1 text-sm font-semibold tabular-nums text-slate-700">
          {value === null ? '—' : `${value.toFixed(1)}/5`}
        </span>
      </span>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex items-center"
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star} className="relative inline-block px-1.5">
          <StarGlyph fillPercent={fillFor(star)} className={text} />
          {[star - 0.5, star].map((step, index) => (
            <span
              key={step}
              className={`absolute inset-y-0 w-1/2 ${index === 0 ? 'left-0' : 'right-0'}`}
            >
              <input
                id={`${name}-${step}`}
                type="radio"
                name={name}
                value={step}
                checked={value === step}
                onChange={() => onChange?.(step)}
                aria-label={`${step} out of 5 stars`}
                className="peer sr-only"
              />
              <label
                htmlFor={`${name}-${step}`}
                onMouseEnter={() => setHover(step)}
                className="absolute inset-0 cursor-pointer rounded-sm peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-600"
              />
            </span>
          ))}
        </span>
      ))}
      <span aria-live="polite" className="ml-2 text-sm font-semibold tabular-nums text-slate-700">
        {value === null ? 'Choose a rating' : `${value.toFixed(1)}/5`}
      </span>
    </div>
  );
}