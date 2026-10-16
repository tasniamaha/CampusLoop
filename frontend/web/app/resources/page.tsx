'use client';

import Link from 'next/link';
import Image from 'next/image';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Category = { id: string; name: string; slug: string };
type Resource = {
  id: string;
  title: string;
  description: string | null;
  category: Category;
  itemCondition: 'new' | 'good' | 'fair' | 'worn';
  maxLoanDays: number;
  pickupLocation: string | null;
  isListed: boolean;
  onLoan: boolean;
  available: boolean;
  favorited: boolean;
  owner: { id: string; name: string };
  imageUrl: string | null;
};
type ResourceResponse = { items: Resource[]; total: number; page: number; limit: number };

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10';
const buttonClass = 'inline-flex items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50';

async function readError(response: Response) {
  try {
    const data = await response.json();
    const message = data?.message;
    return Array.isArray(message) ? message.join(', ') : message || 'Request failed. Please try again.';
  } catch {
    return 'Request failed. Please try again.';
  }
}

export default function ResourcesPage() {
  const router = useRouter();
  const [resources, setResources] = useState<Resource[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState('');
  const [mode, setMode] = useState<'all' | 'available' | 'mine' | 'favorites'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');

  const loadCategories = useCallback(async () => {
    const response = await fetch('/api/backend/resource-categories', { cache: 'no-store' });
    if (response.status === 401) { router.replace('/login'); return null; }
    if (!response.ok) throw new Error(await readError(response));
    return await response.json() as Category[];
  }, [router]);

  const loadResources = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: '1', limit: '50', sort: 'newest' });
      if (query.trim()) params.set('q', query.trim());
      if (category) params.set('category', category);
      if (condition) params.set('condition', condition);
      if (mode === 'available') params.set('available', 'true');
      if (mode === 'mine') params.set('mine', 'true');
      if (mode === 'favorites') params.set('favorites', 'true');
      const response = await fetch(`/api/backend/resources?${params.toString()}`, { cache: 'no-store' });
      if (response.status === 401) { router.replace('/login'); return; }
      if (!response.ok) throw new Error(await readError(response));
      const data: ResourceResponse = await response.json();
      setResources(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load resources.');
    } finally {
      setLoading(false);
    }
  }, [query, category, condition, mode, router]);

  useEffect(() => {
    let active = true;
    loadCategories()
      .then((items) => { if (active && items) setCategories(items); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Could not load categories.'); });
    return () => { active = false; };
  }, [loadCategories]);
  useEffect(() => { const timer = setTimeout(() => { void loadResources(); }, 200); return () => clearTimeout(timer); }, [loadResources]);

  async function toggleFavorite(resource: Resource) {
    setBusyId(resource.id); setNotice(''); setError('');
    try {
      const response = await fetch(`/api/backend/resources/${resource.id}/favorite`, { method: resource.favorited ? 'DELETE' : 'PUT' });
      if (response.status === 401) { router.replace('/login'); return; }
      if (!response.ok) throw new Error(await readError(response));
      setNotice(resource.favorited ? 'Removed from saved resources.' : 'Resource saved to your favorites.');
      await loadResources();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update favorite.'); }
    finally { setBusyId(''); }
  }

  async function requestBorrow(resource: Resource) {
    const due = new Date();
    due.setDate(due.getDate() + Math.min(resource.maxLoanDays || 7, 7));
    due.setTime(due.getTime() - 60_000);
    const dueDate = due.toISOString();
    setBusyId(resource.id); setNotice(''); setError('');
    try {
      const response = await fetch('/api/backend/borrow-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceId: resource.id, dueDate, message: 'Requested through CampusLoop.' }),
      });
      if (response.status === 401) { router.replace('/login'); return; }
      if (!response.ok) throw new Error(await readError(response));
      setNotice(`Borrow request sent for “${resource.title}”.`);
      await loadResources();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send the borrow request.'); }
    finally { setBusyId(''); }
  }

  async function createResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCreating(true); setFormError(''); setNotice('');
    const data = new FormData(event.currentTarget);
    const payload = {
      title: String(data.get('title') || '').trim(),
      description: String(data.get('description') || '').trim(),
      categoryId: String(data.get('categoryId') || ''),
      itemCondition: String(data.get('itemCondition') || 'good'),
      maxLoanDays: Number(data.get('maxLoanDays') || 7),
      pickupLocation: String(data.get('pickupLocation') || '').trim(),
      borrowingRules: String(data.get('borrowingRules') || '').trim(),
    };
    try {
      const response = await fetch('/api/backend/resources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (response.status === 401) { router.replace('/login'); return; }
      if (!response.ok) throw new Error(await readError(response));
      setShowCreate(false); setMode('mine'); setQuery(''); setCategory(''); setCondition('');
      setNotice('Your resource has been listed.');
      await loadResources();
    } catch (e) { setFormError(e instanceof Error ? e.message : 'Could not create the listing.'); }
    finally { setCreating(false); }
  }

  const availableCount = useMemo(() => resources.filter((r) => r.available).length, [resources]);

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
          <Link href="/dashboard" className="flex items-center gap-2.5" aria-label="CampusLoop dashboard">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-700 text-lg font-black text-white">C</span>
            <span className="text-lg font-bold tracking-tight">Campus<span className="text-emerald-700">Loop</span></span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/dashboard" className="rounded-lg px-3 py-2 font-medium text-slate-600 hover:bg-slate-100">Dashboard</Link>
            <span className="rounded-lg bg-emerald-50 px-3 py-2 font-semibold text-emerald-800">Resources</span>
            <Link
                href="/borrowings"
                className="rounded-lg px-3 py-2 font-semibold text-emerald-700 hover:bg-emerald-50"
            >
            My borrowings
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
        <section className="relative overflow-hidden rounded-3xl bg-emerald-950 px-6 py-8 text-white md:px-10 md:py-10">
          <div className="pointer-events-none absolute -right-12 -top-24 h-72 w-72 rounded-full border-[36px] border-emerald-800/60" />
          <div className="pointer-events-none absolute -bottom-28 right-48 h-52 w-52 rounded-full bg-emerald-800/50 blur-2xl" />
          <div className="relative flex flex-col justify-between gap-7 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-emerald-300">Campus marketplace</p>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Useful things, shared.</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-emerald-100/80 md:text-base">Borrow course essentials from fellow students, or list something you can share. Keep it local, simple, and student-powered.</p>
            </div>
            <button className="relative shrink-0 rounded-xl bg-white px-5 py-3 text-sm font-bold text-emerald-950 shadow-sm transition hover:bg-emerald-50" onClick={() => { setFormError(''); setShowCreate(true); }}>＋ List a resource</button>
          </div>
          <div className="relative mt-8 grid max-w-xl grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4"><p className="text-2xl font-semibold">{resources.length}</p><p className="mt-1 text-xs text-emerald-100/75">Resources in this view</p></div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4"><p className="text-2xl font-semibold">{availableCount}</p><p className="mt-1 text-xs text-emerald-100/75">Available right now</p></div>
          </div>
        </section>

        <section className="mt-8 grid gap-7 lg:grid-cols-[245px_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Browse</h2><span className="text-xs text-slate-400">FILTERS</span></div>
            <div className="mt-5 space-y-1">
              {([['all', 'All resources'], ['available', 'Available to borrow'], ['mine', 'My listings'], ['favorites', 'Saved resources']] as const).map(([value, label]) => (
                <button key={value} onClick={() => setMode(value)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${mode === value ? 'bg-emerald-50 font-semibold text-emerald-800' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <span>{label}</span>{mode === value && <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />}
                </button>
              ))}
            </div>
            <div className="my-5 border-t border-slate-100" />
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="category-filter">Category</label>
            <select id="category-filter" className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Every category</option>{categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
            </select>
            <label className="mb-2 mt-5 block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="condition-filter">Condition</label>
            <select id="condition-filter" className={inputClass} value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="">Any condition</option><option value="new">New</option><option value="good">Good</option><option value="fair">Fair</option><option value="worn">Worn</option>
            </select>
            <button className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50" onClick={() => { setQuery(''); setCategory(''); setCondition(''); setMode('all'); }}>Reset filters</button>
            <p className="mt-5 text-xs leading-5 text-slate-400">Borrow requests are sent to the listing owner. Confirm pickup details directly before handover.</p>
          </aside>

          <div className="min-w-0">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Discover</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Find what you need</h2><p className="mt-1 text-sm text-slate-500">Search listings shared by your campus community.</p></div>
              <div className="w-full sm:max-w-xs"><label className="sr-only" htmlFor="resource-search">Search resources</label><div className="relative"><span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">⌕</span><input id="resource-search" className={`${inputClass} pl-9`} placeholder="Search books, calculators…" value={query} onChange={(e) => setQuery(e.target.value)} /></div></div>
            </div>

            {notice && <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}
            {error && <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

            {loading ? <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[1,2,3].map((n) => <div key={n} className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div> : resources.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-2xl text-emerald-700">⌕</span><h3 className="mt-4 text-lg font-semibold">No resources found</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">Try changing the search or filters, or add the first listing for your community.</p><button className={`${buttonClass} mt-5`} onClick={() => setShowCreate(true)}>List a resource</button></div>
            ) : (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {resources.map((resource) => <article key={resource.id} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-lg hover:shadow-slate-200/60">
                  <div className="relative flex h-36 items-center justify-center bg-gradient-to-br from-emerald-50 via-slate-50 to-teal-100">
                    {resource.imageUrl ? <Image src={`${(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(/\/$/, '')}${resource.imageUrl.replace(/^\/api/, '')}`} alt={resource.title} fill sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw" unoptimized className="object-cover" /> : <div className="grid h-16 w-16 place-items-center rounded-2xl border border-white bg-white/80 text-2xl font-semibold text-emerald-800 shadow-sm">{resource.title.slice(0, 1).toUpperCase()}</div>}
                    <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-bold ${resource.available ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{resource.available ? 'Available' : resource.onLoan ? 'On loan' : 'Not listed'}</span>
                    <button aria-label={resource.favorited ? 'Remove from saved resources' : 'Save resource'} disabled={busyId === resource.id} onClick={() => void toggleFavorite(resource)} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full border border-white/80 bg-white/90 text-lg text-slate-500 shadow-sm transition hover:text-rose-600 disabled:opacity-50">{resource.favorited ? '♥' : '♡'}</button>
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex items-center justify-between gap-2"><span className="truncate text-[11px] font-bold uppercase tracking-wide text-emerald-700">{resource.category?.name || 'Resource'}</span><span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold capitalize text-slate-600">{resource.itemCondition}</span></div>
                    <h3 className="mt-2 line-clamp-1 text-base font-semibold"><Link href={`/resources/${resource.id}`} className="hover:underline">{resource.title}</Link></h3>
                    <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-slate-500">{resource.description || 'No description provided.'}</p>
                    <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-xs text-slate-500"><p className="flex items-center gap-2"><span className="text-slate-400">◉</span> Listed by <span className="font-semibold text-slate-700">{resource.owner?.name || 'Campus member'}</span></p><p className="flex items-center gap-2"><span className="text-slate-400">⌖</span>{resource.pickupLocation || 'Pickup location to be agreed'}</p><p className="flex items-center gap-2"><span className="text-slate-400">◷</span>Up to {resource.maxLoanDays} days</p></div>
                    <div className="mt-4 flex gap-2">
                      <Link href={`/resources/${resource.id}`} className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">{mode === 'mine' ? 'Manage listing' : 'View details'}</Link>
                      {mode !== 'mine' && (
                        <button className={`${buttonClass} flex-1`} disabled={!resource.available || busyId === resource.id} onClick={() => void requestBorrow(resource)}>{busyId === resource.id ? 'Please wait...' : resource.available ? 'Request to borrow' : 'Currently unavailable'}</button>
                      )}
                    </div>                  </div>
                </article>)}
              </div>
            )}
          </div>
        </section>
      </div>

      {showCreate && <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="create-title" className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl sm:p-8">
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Share with students</p><h2 id="create-title" className="mt-1 text-2xl font-semibold">List a resource</h2><p className="mt-2 text-sm text-slate-500">Add the basics. You can share pickup details with the borrower.</p></div><button aria-label="Close dialog" onClick={() => setShowCreate(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">✕</button></div>
          <form onSubmit={createResource} className="mt-6 space-y-4">
            <div><label className="mb-1.5 block text-sm font-semibold" htmlFor="resource-title">Resource name *</label><input id="resource-title" name="title" className={inputClass} placeholder="e.g. Casio scientific calculator" minLength={2} maxLength={150} required /></div>
            <div><label className="mb-1.5 block text-sm font-semibold" htmlFor="resource-category">Category *</label><select id="resource-category" name="categoryId" className={inputClass} required defaultValue=""><option value="" disabled>Select a category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{categories.length === 0 && <p className="mt-1 text-xs text-amber-700">No categories were returned by the API. Check whether resource categories are seeded in the database.</p>}</div>
            <div><label className="mb-1.5 block text-sm font-semibold" htmlFor="resource-description">Description</label><textarea id="resource-description" name="description" className={inputClass} rows={3} maxLength={2000} placeholder="Condition, included accessories, or useful details…" /></div>
            <div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-1.5 block text-sm font-semibold" htmlFor="resource-condition">Condition</label><select id="resource-condition" name="itemCondition" className={inputClass} defaultValue="good"><option value="new">New</option><option value="good">Good</option><option value="fair">Fair</option><option value="worn">Worn</option></select></div><div><label className="mb-1.5 block text-sm font-semibold" htmlFor="resource-days">Max loan duration</label><select id="resource-days" name="maxLoanDays" className={inputClass} defaultValue="7">{[1,2,3,5,7,10,14,21,30].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'day' : 'days'}</option>)}</select></div></div>
            <div><label className="mb-1.5 block text-sm font-semibold" htmlFor="resource-pickup">Pickup location</label><input id="resource-pickup" name="pickupLocation" className={inputClass} maxLength={150} placeholder="e.g. Department building lobby" /></div>
            <div><label className="mb-1.5 block text-sm font-semibold" htmlFor="resource-rules">Borrowing rules</label><textarea id="resource-rules" name="borrowingRules" className={inputClass} rows={2} maxLength={1000} placeholder="Any conditions for borrowing…" /></div>
            {formError && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{formError}</p>}
            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button><button className={buttonClass} type="submit" disabled={creating || categories.length === 0}>{creating ? 'Publishing…' : 'Publish listing'}</button></div>
          </form>
        </section>
      </div>}
    </main>
  );
}
