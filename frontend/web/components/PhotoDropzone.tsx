'use client';

import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';

// Mirrors the API limits (backend src/images/image-limits.ts). The server is the authority.
export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ACCEPTED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
export const TYPE_HINT = 'Please use JPG, PNG or WebP.';

export type PendingPhoto = {
  key: string;
  file: File;
  previewUrl: string;
  status: 'ready' | 'uploading' | 'failed';
  progress: number; // 0-100 while uploading
  error?: string;
};

/** Some systems report an empty MIME type; fall back to the extension. */
const isAcceptedType = (file: File) =>
  file.type ? ACCEPTED_TYPES.includes(file.type) : ACCEPTED_EXTENSIONS.test(file.name);

/**
 * Client-side checks for usability only. Returns the photos to add and one message per problem.
 * Every created preview URL must later be released with releasePhotos().
 */
export function preparePhotos(files: File[], alreadyAdded: number): { added: PendingPhoto[]; errors: string[] } {
  const errors: string[] = [];
  const valid: File[] = [];
  for (const file of files) {
    if (!isAcceptedType(file)) errors.push(`"${file.name}" isn't a supported image. ${TYPE_HINT}`);
    else if (file.size > MAX_PHOTO_BYTES) errors.push(`"${file.name}" is larger than 5 MB.`);
    else valid.push(file);
  }
  const room = Math.max(MAX_PHOTOS - alreadyAdded, 0);
  if (valid.length > room) {
    const skipped = valid.length - room;
    errors.push(`A report can have at most ${MAX_PHOTOS} photos. ${skipped} photo${skipped === 1 ? ' was' : 's were'} not added.`);
  }
  const added = valid.slice(0, room).map((file) => ({
    key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    status: 'ready' as const,
    progress: 0,
  }));
  return { added, errors };
}

export function releasePhotos(photos: PendingPhoto[]) {
  for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
}

type Props = {
  photos: PendingPhoto[];
  errors: string[];
  disabled?: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
};

/**
 * Drop zone plus thumbnail grid. Works with mouse, keyboard (Enter/Space opens the picker) and touch.
 * The file input has no `capture` attribute, so phones offer camera or gallery and desktops get the
 * normal file picker.
 */
export default function PhotoDropzone({ photos, errors, disabled = false, onAdd, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = { title: useId(), hint: useId(), errors: useId() };
  const [dragDepth, setDragDepth] = useState(0); // counts nested dragenter/leave so children don't flicker it
  const full = photos.length >= MAX_PHOTOS;
  const inactive = disabled || full;
  const dragging = dragDepth > 0 && !inactive;

  function openPicker() {
    if (!inactive) inputRef.current?.click();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); // stop Space from scrolling the page
      openPicker();
    }
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); // required for drop to fire
    event.dataTransfer.dropEffect = inactive ? 'none' : 'copy';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragDepth(0);
    if (inactive) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length) onAdd(files);
  }

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={inactive ? -1 : 0}
        aria-disabled={inactive}
        aria-labelledby={ids.title}
        aria-describedby={`${ids.hint}${errors.length ? ` ${ids.errors}` : ''}`}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        onDragEnter={(e) => { e.preventDefault(); setDragDepth((d) => d + 1); }}
        onDragLeave={() => setDragDepth((d) => Math.max(d - 1, 0))}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={[
          'flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2',
          inactive ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
            : dragging ? 'cursor-copy border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-600/30'
              : 'cursor-pointer border-slate-300 bg-white text-slate-700 hover:border-emerald-600 hover:bg-emerald-50/40',
        ].join(' ')}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18v-1.5M16.5 7.5 12 3m0 0L7.5 7.5M12 3v13.5" />
        </svg>
        <span id={ids.title} className="text-sm font-semibold">
          {full ? `${MAX_PHOTOS} of ${MAX_PHOTOS} photos added` : dragging ? 'Drop to add photos' : 'Drag photos here or click to browse'}
        </span>
        <span id={ids.hint} className="text-xs text-slate-500">
          JPG, PNG or WebP · up to 5 MB each · {photos.length}/{MAX_PHOTOS} added
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = ''; // allow choosing the same file again after removing it
          if (files.length) onAdd(files);
        }}
      />

      {errors.length > 0 && (
        <ul id={ids.errors} role="alert" className="space-y-1 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {errors.map((message) => <li key={message}>{message}</li>)}
        </ul>
      )}

      {photos.length > 0 && (
        <ul aria-label="Selected photos" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {photos.map((photo, index) => (
            <li key={photo.key} className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.previewUrl} alt={`Photo ${index + 1}: ${photo.file.name}`} className="aspect-square w-full object-cover" />
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(photo.key)}
                aria-label={`Remove photo ${index + 1} (${photo.file.name})`}
                className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-slate-700 shadow ring-1 ring-slate-200 hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
              {photo.status === 'uploading' && (
                <div className="absolute inset-x-0 bottom-0 bg-white/90 p-1.5">
                  <div
                    role="progressbar"
                    aria-label={`Uploading photo ${index + 1}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={photo.progress}
                    className="h-1.5 overflow-hidden rounded-full bg-slate-200"
                  >
                    <div className="h-full bg-emerald-600 transition-[width]" style={{ width: `${photo.progress}%` }} />
                  </div>
                </div>
              )}
              {photo.status === 'failed' && (
                <p className="absolute inset-x-0 bottom-0 bg-rose-700/90 px-2 py-1 text-xs font-medium text-white">Upload failed</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
