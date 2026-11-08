'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { createGroup } from '../../lib/study-groups-api';

/**
 * Creates a group, then opens its page with a "Group created" message. The form stays locked
 * from submit until the navigation lands, so a double click cannot create two groups.
 */
export default function GroupForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [schedule, setSchedule] = useState('');
  const [participantLimit, setParticipantLimit] = useState(8);
  const [approvalRequired, setApprovalRequired] = useState(true);
  const [busy, setBusy] = useState(false);
  // Stays true while navigating to the new group (the component unmounts when it lands).
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');
  const locked = busy || leaving;
  // Synchronous guard: two submits in the same tick both run before the disabled fieldset renders.
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const created = await createGroup({ title, courseCode, topic, description, schedule, participantLimit, approvalRequired });
      if (!created.ok) {
        if (created.status === 401) { router.replace('/login'); return; }
        submitting.current = false;
        setError(created.message);
        return;
      }
      setLeaving(true);
      router.push(`/study-groups/${created.data.id}?created=1`);
    } catch (err) {
      submitting.current = false;
      setError(err instanceof Error ? err.message : 'Could not create the group');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-busy={locked} className="rounded-2xl border bg-white p-5">
      <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">New study group</legend>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 sm:col-span-2">{error}</p>}

        <label className="text-sm font-medium">
          Group name
          <input required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Data Structures Revision" className="mt-1 block w-full rounded-lg border p-2 font-normal" />
        </label>
        <label className="text-sm font-medium">
          Course code
          <input required minLength={2} maxLength={40} value={courseCode} onChange={(e) => setCourseCode(e.target.value)} placeholder="e.g. CSE220" className="mt-1 block w-full rounded-lg border p-2 font-normal" />
        </label>
        <label className="text-sm font-medium">
          Topic
          <input required minLength={2} maxLength={100} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Graph algorithms" className="mt-1 block w-full rounded-lg border p-2 font-normal" />
        </label>
        <label className="text-sm font-medium">
          Schedule / availability
          <input required minLength={2} maxLength={500} value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="e.g. Tue/Thu 3–4 PM, Library" className="mt-1 block w-full rounded-lg border p-2 font-normal" />
        </label>
        <label className="text-sm font-medium">
          Participant limit
          <input type="number" required min={2} max={100} value={participantLimit} onChange={(e) => setParticipantLimit(Number(e.target.value))} aria-describedby="limit-help" className="mt-1 block w-full rounded-lg border p-2 font-normal" />
          <span id="limit-help" className="mt-1 block text-xs font-normal text-slate-500">Includes you, the creator.</span>
        </label>
        <label className="flex items-center gap-2 self-center text-sm">
          <input type="checkbox" checked={approvalRequired} onChange={(e) => setApprovalRequired(e.target.checked)} />
          Require my approval for new members
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          Description
          <textarea required minLength={10} maxLength={3000} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Learning goals, expected preparation, and how the group will work." className="mt-1 block w-full rounded-lg border p-2 font-normal" />
        </label>

        <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50 sm:col-span-2">
          {leaving ? 'Opening your group...' : busy ? 'Creating...' : 'Create group'}
        </button>
      </fieldset>
    </form>
  );
}
