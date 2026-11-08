'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../DataStates';
import GroupBadges from './GroupBadges';
import { FILTER_LIMITS, listGroups, listHref, parseListParams, type GroupList as Loaded, type ListParams } from '../../lib/study-groups-api';
import { useApiQuery } from '../../lib/use-api-query';

/**
 * Open groups on the viewer's campus. `course`, `topic` and `page` come from the URL, already
 * validated by the page. Filters apply on submit (not per keystroke) and navigate, so Back,
 * refresh and shared links keep the same view.
 */
export default function GroupList({ course, topic, page }: ListParams) {
  const router = useRouter();
  const query = useApiQuery<Loaded>(
    `${course ?? ''}|${topic ?? ''}|${page}`,
    (signal) => listGroups({ course, topic, page }, signal),
    (result) => {
      const pages = Math.max(result.pagination.pages, 1);
      if (page <= pages) return true;
      // A page past the end (old link, or groups were archived): show the last real page.
      router.replace(listHref({ course, topic, page: pages }));
      return false;
    },
  );

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // Same cleaning as the URL parser, so the address bar shows exactly what was searched.
    const next = parseListParams({ course: String(form.get('course') ?? ''), topic: String(form.get('topic') ?? '') });
    router.push(listHref({ ...next, page: 1 }));
  }

  const groups = query.data?.data ?? [];
  const pages = Math.max(query.data?.pagination.pages ?? 1, 1);
  const hasFilters = Boolean(course || topic);

  return (
    <section aria-labelledby="groups-heading" className="space-y-4">
      {/* key: Back/forward to a different filter resets the inputs to the URL's values. */}
      <form key={`${course ?? ''}|${topic ?? ''}`} onSubmit={applyFilters} role="search" className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-[1fr_1fr_auto]">
        <label className="text-sm font-medium">
          Course
          <input name="course" defaultValue={course ?? ''} maxLength={FILTER_LIMITS.course} placeholder="e.g. CSE220" className="mt-1 block w-full rounded-lg border p-2 font-normal" />
        </label>
        <label className="text-sm font-medium">
          Topic
          <input name="topic" defaultValue={topic ?? ''} maxLength={FILTER_LIMITS.topic} placeholder="e.g. Graphs" className="mt-1 block w-full rounded-lg border p-2 font-normal" />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Apply</button>
          {hasFilters && (
            <Link href="/study-groups" className="rounded-lg border px-4 py-2 text-sm font-medium">Clear</Link>
          )}
        </div>
      </form>

      <div>
        <h2 id="groups-heading" className="text-lg font-semibold">Open groups</h2>
        {!query.loading && query.data && (
          <p className="text-sm text-slate-500">
            {query.data.pagination.total} group{query.data.pagination.total === 1 ? '' : 's'} in your campus{hasFilters ? ' matching your filters' : ''}
          </p>
        )}
      </div>

      {query.error ? (
        <ErrorState message={query.error.message} onRetry={query.reload} />
      ) : query.loading && groups.length === 0 ? (
        <LoadingState>Loading groups...</LoadingState>
      ) : groups.length === 0 ? (
        <EmptyState>
          {hasFilters ? 'No open groups match these filters.' : 'No open groups yet.'}{' '}
          <Link href="/study-groups/new" className="font-semibold text-emerald-700 hover:underline">Create a group</Link>
        </EmptyState>
      ) : (
        <ul aria-busy={query.loading} className={`grid gap-4 lg:grid-cols-2 ${query.loading ? 'opacity-60' : ''}`}>
          {groups.map((group) => (
            <li key={group.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">
                    <Link href={`/study-groups/${group.id}`} className="text-slate-900 hover:text-emerald-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
                      {group.title}
                    </Link>
                  </h3>
                  <p className="mt-1 text-sm font-medium text-emerald-800">{group.courseCode} · {group.topic}</p>
                </div>
                <GroupBadges group={group} />
              </div>
              <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-slate-700">{group.description}</p>
              <p className="mt-2 text-sm text-slate-500">{group.schedule}</p>
              <Link href={`/study-groups/${group.id}`} className="mt-3 inline-block self-start text-sm font-semibold text-emerald-800 hover:underline" aria-label={`View group: ${group.title}`}>
                View group →
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!query.error && query.data && pages > 1 && (
        <nav aria-label="Group pages" className="flex items-center justify-between">
          {page > 1 ? (
            <Link href={listHref({ course, topic, page: page - 1 })} className="rounded-lg border px-3 py-2 text-sm">Previous</Link>
          ) : (
            <span aria-disabled="true" className="rounded-lg border px-3 py-2 text-sm opacity-40">Previous</span>
          )}
          <span className="text-sm text-slate-600">Page {page} of {pages}</span>
          {page < pages ? (
            <Link href={listHref({ course, topic, page: page + 1 })} className="rounded-lg border px-3 py-2 text-sm">Next</Link>
          ) : (
            <span aria-disabled="true" className="rounded-lg border px-3 py-2 text-sm opacity-40">Next</span>
          )}
        </nav>
      )}
    </section>
  );
}
