import Link from 'next/link';

/** Previous / next links for a list whose page lives in the URL. `hrefFor` builds the page's URL. */
export default function Pager({ label, page, pages, hrefFor }: { label: string; page: number; pages: number; hrefFor: (page: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={label} className="flex items-center justify-between">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className="rounded-lg border px-3 py-2 text-sm">Previous</Link>
      ) : (
        <span aria-disabled="true" className="rounded-lg border px-3 py-2 text-sm opacity-40">Previous</span>
      )}
      <span className="text-sm text-slate-600">Page {page} of {pages}</span>
      {page < pages ? (
        <Link href={hrefFor(page + 1)} className="rounded-lg border px-3 py-2 text-sm">Next</Link>
      ) : (
        <span aria-disabled="true" className="rounded-lg border px-3 py-2 text-sm opacity-40">Next</span>
      )}
    </nav>
  );
}
