'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { ApiResult } from '../../lib/api-client';
import {
  createCategory,
  deactivateCategory,
  listCategories,
  reactivateCategory,
  renameCategory,
  type AdminCategory,
} from '../../lib/admin-api';
import { useApiQuery } from '../../lib/use-api-query';
import ConfirmButton from '../ConfirmButton';
import { EmptyState, ErrorState, LoadingState } from '../DataStates';

// Same rule as the API's CategoryNameDto: trimmed, inner whitespace collapsed, 2-60 characters.
const NAME_MIN = 2;
const NAME_MAX = 60;
const cleanName = (value: FormDataEntryValue | null) => String(value ?? '').trim().replace(/\s+/g, ' ');
const nameProblem = (name: string) => (name.length < NAME_MIN || name.length > NAME_MAX ? `Use ${NAME_MIN} to ${NAME_MAX} characters.` : null);

type Notice = { id: string; text: string; error: boolean } | null;

/**
 * Resource categories, including deactivated ones. There is no delete: a category is retired by
 * deactivating it, which hides it from new listings while existing resources keep it. Renaming
 * keeps the slug, so links and filters keep working.
 */
export default function AdminCategories() {
  const router = useRouter();
  const query = useApiQuery<AdminCategory[]>('categories', (signal) => listCategories(signal));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  /** Runs a change; returns true when it worked. `id` decides where the message shows ('new' = the create form). */
  async function act(id: string, run: () => Promise<ApiResult<AdminCategory>>, done: (c: AdminCategory) => string): Promise<boolean> {
    setBusyId(id);
    setNotice(null);
    setCreateError(null);
    const result = await run();
    setBusyId(null);
    if (!result.ok) {
      if (result.status === 401) router.replace('/login');
      else if (id === 'new') setCreateError(result.message);
      else setNotice({ id, text: result.message, error: true });
      return false;
    }
    setNotice({ id: result.data.id, text: done(result.data), error: false });
    query.reload();
    return true;
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = cleanName(new FormData(form).get('name'));
    const problem = nameProblem(name);
    if (problem) {
      setCreateError(problem);
      return;
    }
    if (await act('new', () => createCategory(name), (c) => `Created ${c.name}.`)) form.reset();
  }

  async function rename(event: FormEvent<HTMLFormElement>, category: AdminCategory) {
    event.preventDefault();
    const name = cleanName(new FormData(event.currentTarget).get('name'));
    const problem = nameProblem(name);
    if (problem) {
      setNotice({ id: category.id, text: problem, error: true });
      return;
    }
    if (await act(category.id, () => renameCategory(category.id, name), (c) => `Renamed to ${c.name}. The slug stays ${c.slug}.`)) setRenaming(null);
  }

  const categories = query.data ?? [];

  return (
    <section aria-labelledby="categories-heading" className="space-y-4">
      <form onSubmit={create} noValidate className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4">
        <label className="min-w-64 flex-1 text-sm font-medium">
          New category
          <input
            name="name"
            required
            minLength={NAME_MIN}
            maxLength={NAME_MAX}
            aria-invalid={createError ? true : undefined}
            aria-describedby={createError ? 'create-category-error' : undefined}
            className="mt-1 block w-full rounded-lg border p-2 font-normal"
          />
        </label>
        <button type="submit" disabled={busyId === 'new'} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busyId === 'new' ? 'Creating...' : 'Create'}
        </button>
        {createError && <p id="create-category-error" role="alert" className="basis-full text-sm text-rose-700">{createError}</p>}
      </form>

      <h2 id="categories-heading" className="text-lg font-semibold">Categories</h2>

      {query.error ? (
        <ErrorState message={query.error.message} onRetry={query.reload} />
      ) : query.loading && categories.length === 0 ? (
        <LoadingState>Loading categories...</LoadingState>
      ) : categories.length === 0 ? (
        <EmptyState>No categories yet. Create the first one above.</EmptyState>
      ) : (
        <ul aria-busy={query.loading} className={`divide-y rounded-xl border bg-white ${query.loading ? 'opacity-60' : ''}`}>
          {categories.map((category) => {
            const busy = busyId === category.id;
            return (
              <li key={category.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  {renaming === category.id ? (
                    <form onSubmit={(event) => void rename(event, category)} noValidate className="flex flex-wrap items-end gap-2">
                      <label className="text-sm font-medium">
                        New name for {category.name}
                        <input name="name" defaultValue={category.name} required minLength={NAME_MIN} maxLength={NAME_MAX} className="mt-1 block w-64 rounded-lg border p-2 font-normal" />
                      </label>
                      <button type="submit" disabled={busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Save</button>
                      <button type="button" onClick={() => setRenaming(null)} className="rounded-lg border px-3 py-2 text-sm">Cancel</button>
                    </form>
                  ) : (
                    <p className="font-medium text-slate-900">
                      {category.name}
                      {category.deactivatedAt && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">Deactivated</span>}
                    </p>
                  )}
                  <p className="mt-1 text-sm text-slate-500">
                    Slug {category.slug} · {category.resourceCount} resource{category.resourceCount === 1 ? '' : 's'}
                  </p>
                  {notice?.id === category.id && (
                    <p role={notice.error ? 'alert' : 'status'} className={`mt-1 text-sm ${notice.error ? 'text-rose-700' : 'text-emerald-800'}`}>{notice.text}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {renaming !== category.id && (
                    <button type="button" disabled={busy} onClick={() => setRenaming(category.id)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50">
                      Rename
                    </button>
                  )}
                  {category.deactivatedAt ? (
                    <ConfirmButton
                      label="Reactivate"
                      question={`Offer ${category.name} for new listings again?`}
                      confirmLabel="Reactivate"
                      disabled={busy}
                      onConfirm={() => void act(category.id, () => reactivateCategory(category.id), (c) => `${c.name} is active again.`)}
                    />
                  ) : (
                    <ConfirmButton
                      label="Deactivate"
                      tone="danger"
                      question={`Deactivate ${category.name}? New listings cannot use it; its ${category.resourceCount} resource${category.resourceCount === 1 ? '' : 's'} keep it.`}
                      confirmLabel="Deactivate"
                      disabled={busy}
                      onConfirm={() => void act(category.id, () => deactivateCategory(category.id), (c) => `${c.name} is deactivated.`)}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
