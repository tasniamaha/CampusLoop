import { proxied, type Photo } from '../../lib/lost-found-api';

/**
 * Report photos as linked thumbnails. Images load through the authenticated proxy; the API has
 * already left out photos the viewer may not see, so an empty list renders nothing.
 * No hooks or handlers: usable from Server and Client Components alike.
 */
export default function PhotoThumbnails({ photos, title, size = 'h-20 w-20' }: { photos: Photo[]; title: string; size?: string }) {
  if (!photos.length) return null;
  return (
    <ul aria-label={`Photos of ${title}`} className="mt-3 flex flex-wrap gap-2">
      {photos.map((photo, index) => (
        <li key={photo.id}>
          <a
            href={proxied(photo.url)}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-lg border border-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proxied(photo.url)} alt={`${title}, photo ${index + 1}`} loading="lazy" className={`${size} object-cover`} />
          </a>
        </li>
      ))}
    </ul>
  );
}
