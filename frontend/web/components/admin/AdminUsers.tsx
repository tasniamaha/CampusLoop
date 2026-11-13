'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { ApiResult } from '../../lib/api-client';
import {
  FILTER_LIMITS,
  ROLES,
  changeRole,
  deactivateUser,
  hasUserFilters,
  listUsers,
  parseUserParams,
  reactivateUser,
  usersExportPath,
  usersHref,
  type AdminUser,
  type Paginated,
  type UserListParams,
} from '../../lib/admin-api';
import type { UserRole } from '../../lib/auth';
import { useApiQuery } from '../../lib/use-api-query';
import ConfirmButton from '../ConfirmButton';
import { EmptyState, ErrorState, LoadingState } from '../DataStates';
import Pager from '../Pager';
import ExportButton from './ExportButton';

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const selectClass = 'mt-1 block w-full rounded-lg border bg-white p-2 font-normal';

type Notice = { id: string; text: string; error: boolean } | null;

/**
 * Users, newest first, with the filters from the URL (already validated by the page). Role changes
 * and (de)activation ask for confirmation. The API enforces every rule (no self-demotion or
 * self-deactivation, the last admin stays); the disabled buttons for your own row are cosmetic.
 */
export default function AdminUsers({ params, currentUserId }: { params: UserListParams; currentUserId: string }) {
  const router = useRouter();
  const { page } = params;
  const key = usersHref(params);
  const query = useApiQuery<Paginated<AdminUser>>(
    key,
    (signal) => listUsers(params, signal),
    (result) => {
      const pages = Math.max(result.pagination.pages, 1);
      if (page <= pages) return true;
      router.replace(usersHref({ ...params, page: pages }));
      return false;
    },
  );
  const [drafts, setDrafts] = useState<Record<string, UserRole>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = Object.fromEntries(['q', 'campus', 'role', 'verified', 'status'].map((name) => [name, String(form.get(name) ?? '')]));
    router.push(usersHref({ ...parseUserParams(raw), page: 1 }));
  }

  async function act(user: AdminUser, run: () => Promise<ApiResult<AdminUser>>, done: (updated: AdminUser) => string) {
    setBusyId(user.id);
    setNotice(null);
    const result = await run();
    setBusyId(null);
    if (!result.ok) {
      if (result.status === 401) {
        router.replace('/login');
        return;
      }
      setNotice({ id: user.id, text: result.message, error: true });
      return;
    }
    setDrafts((d) => {
      const next = { ...d };
      delete next[user.id];
      return next;
    });
    setNotice({ id: user.id, text: done(result.data), error: false });
    query.reload();
  }

  const users = query.data?.data ?? [];
  const pagination = query.data?.pagination;
  const filtered = hasUserFilters(params);

  return (
    <section aria-labelledby="users-heading" className="space-y-4">
      <form key={key} onSubmit={applyFilters} role="search" className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
        <label className="text-sm font-medium">
          Name or email
          <input name="q" defaultValue={params.q ?? ''} maxLength={FILTER_LIMITS.text} className="mt-1 block w-full rounded-lg border p-2 font-normal" />
        </label>
        <label className="text-sm font-medium">
          Campus
          <input name="campus" defaultValue={params.campus ?? ''} maxLength={FILTER_LIMITS.text} placeholder="Exactly as stored" className="mt-1 block w-full rounded-lg border p-2 font-normal" />
        </label>
        <label className="text-sm font-medium">
          Role
          <select name="role" defaultValue={params.role ?? ''} className={selectClass}>
            <option value="">Any</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Email
          <select name="verified" defaultValue={params.verified ?? ''} className={selectClass}>
            <option value="">Any</option>
            <option value="true">Verified</option>
            <option value="false">Not verified</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          Account
          <select name="status" defaultValue={params.status ?? ''} className={selectClass}>
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="deactivated">Deactivated</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Apply</button>
          {filtered && <Link href="/admin" className="rounded-lg border px-4 py-2 text-sm font-medium">Clear</Link>}
        </div>
      </form>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="users-heading" className="text-lg font-semibold">Users</h2>
          {!query.loading && pagination && (
            <p className="text-sm text-slate-500">
              {pagination.total} user{pagination.total === 1 ? '' : 's'}{filtered ? ' matching your filters' : ''}
            </p>
          )}
        </div>
        <ExportButton path={usersExportPath(params)} fallbackName="campusloop-users.csv" label={filtered ? 'Export these users (CSV)' : 'Export all users (CSV)'} />
      </div>

      {query.error ? (
        <ErrorState message={query.error.message} onRetry={query.reload} />
      ) : query.loading && users.length === 0 ? (
        <LoadingState>Loading users...</LoadingState>
      ) : users.length === 0 ? (
        <EmptyState>{filtered ? 'No users match these filters.' : 'No users yet.'}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table aria-busy={query.loading} className={`w-full min-w-[56rem] text-left text-sm ${query.loading ? 'opacity-60' : ''}`}>
            <caption className="sr-only">Users</caption>
            <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">User</th>
                <th scope="col" className="px-4 py-3">Campus</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Role</th>
                <th scope="col" className="px-4 py-3">Account</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((user) => {
                const self = user.id === currentUserId;
                const draft = drafts[user.id] ?? user.role;
                const busy = busyId === user.id;
                return (
                  <tr key={user.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{user.name}{self && <span className="ml-1 text-slate-500">(you)</span>}</p>
                      <p className="break-all text-slate-600">{user.email}</p>
                      <p className="text-xs text-slate-500">Joined {formatDate(user.createdAt)}</p>
                      {notice?.id === user.id && (
                        <p role={notice.error ? 'alert' : 'status'} className={`mt-1 text-sm ${notice.error ? 'text-rose-700' : 'text-emerald-800'}`}>{notice.text}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{user.campus}</td>
                    <td className="space-y-1 px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${user.deactivatedAt ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
                        {user.deactivatedAt ? 'Deactivated' : 'Active'}
                      </span>
                      <span className={`ml-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${user.emailVerifiedAt ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-800'}`}>
                        {user.emailVerifiedAt ? 'Verified' : 'Not verified'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`role-${user.id}`}>Role for {user.name}</label>
                        <select
                          id={`role-${user.id}`}
                          value={draft}
                          disabled={busy || self}
                          onChange={(event) => setDrafts((d) => ({ ...d, [user.id]: event.target.value as UserRole }))}
                          className="rounded-lg border bg-white p-1.5"
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>{role}</option>
                          ))}
                        </select>
                        {draft !== user.role && (
                          <ConfirmButton
                            label="Save role"
                            question={`Make ${user.name} a ${draft}?`}
                            confirmLabel="Change role"
                            disabled={busy}
                            onConfirm={() => void act(user, () => changeRole(user.id, draft), (u) => `Role changed to ${u.role}.`)}
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {self ? (
                        <span className="text-xs text-slate-500">You cannot change your own account here.</span>
                      ) : user.deactivatedAt ? (
                        <ConfirmButton
                          label="Reactivate"
                          question={`Let ${user.name} sign in again?`}
                          confirmLabel="Reactivate"
                          disabled={busy}
                          onConfirm={() => void act(user, () => reactivateUser(user.id), () => 'Account reactivated.')}
                        />
                      ) : (
                        <ConfirmButton
                          label="Deactivate"
                          tone="danger"
                          question={`Deactivate ${user.name}? They are signed out everywhere and cannot sign in. Their content stays.`}
                          confirmLabel="Deactivate"
                          disabled={busy}
                          onConfirm={() => void act(user, () => deactivateUser(user.id), () => 'Account deactivated and signed out.')}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!query.error && pagination && <Pager label="User pages" page={page} pages={Math.max(pagination.pages, 1)} hrefFor={(p) => usersHref({ ...params, page: p })} />}
    </section>
  );
}
