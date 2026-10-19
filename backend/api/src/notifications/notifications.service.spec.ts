import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Priv = {
  queue?: { add: ReturnType<typeof vi.fn>; getJob: ReturnType<typeof vi.fn> };
  processReminder(id: string, kind: 'due-soon' | 'due-now' | 'overdue'): Promise<void>;
  processEmail(id: string): Promise<void>;
};

function build(env: Record<string, string> = {}) {
  const mail = { send: vi.fn().mockResolvedValue(undefined) };
  const qb = {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({ affected: 3 }),
  };
  const notifications = {
    findOne: vi.fn().mockResolvedValue(null),
    findAndCount: vi.fn().mockResolvedValue([[], 0]),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn((v: object) => v),
    save: vi.fn(async (v: object) => ({ id: 'n1', ...v })),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: vi.fn(() => qb),
  };
  const requests = { findOne: vi.fn() };
  const resources = { findOne: vi.fn() };
  const users = { findOne: vi.fn() };
  const service = new NotificationsService(
    new ConfigService(env), mail as never, notifications as never,
    requests as never, resources as never, users as never,
  );
  const queue = { add: vi.fn().mockResolvedValue(undefined), getJob: vi.fn().mockResolvedValue(undefined) };
  (service as unknown as Priv).queue = queue;
  return { service, priv: service as unknown as Priv, mail, notifications, requests, resources, users, queue, qb };
}
type H = ReturnType<typeof build>;

function seedLoan(h: H, opts: { status?: string; dueInMs: number }) {
  const dueDate = new Date(NOW.getTime() + opts.dueInMs);
  h.requests.findOne.mockResolvedValue({ id: 'r1', resourceId: 'res1', borrowerId: 'b1', status: opts.status ?? 'active', dueDate });
  h.resources.findOne.mockResolvedValue({ id: 'res1', title: 'Calculator', ownerId: 'o1' });
  const people: Record<string, object> = {
    b1: { id: 'b1', name: 'Bob', email: 'bob@x.test' },
    o1: { id: 'o1', name: 'Olga', email: 'olga@x.test' },
  };
  h.users.findOne.mockImplementation(async ({ where }: { where: { id: string } }) => people[where.id] ?? null);
  return vi.spyOn(h.service, 'notify').mockResolvedValue({} as never);
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('bootstrap', () => {
  it('does nothing and opens no Redis connection when disabled', async () => {
    const { service } = build({ NOTIFICATIONS_QUEUE_ENABLED: 'false' });
    (service as unknown as Priv).queue = undefined;
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect((service as unknown as Priv).queue).toBeUndefined();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('queueHealth reports 503 when the queue is not initialised', async () => {
    const { service } = build();
    (service as unknown as Priv).queue = undefined;
    await expect(service.queueHealth()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('notify', () => {
  const input = { userId: 'u1', type: 't', title: 'T', body: 'B' };

  it('returns the existing row for a known dedupeKey without saving', async () => {
    const h = build();
    h.notifications.findOne.mockResolvedValue({ id: 'old' });
    await expect(h.service.notify({ ...input, dedupeKey: 'k' })).resolves.toEqual({ id: 'old' });
    expect(h.notifications.save).not.toHaveBeenCalled();
  });

  it('recovers from a unique-key race by returning the winner', async () => {
    const h = build();
    h.notifications.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner' });
    h.notifications.save.mockRejectedValueOnce(new Error('ER_DUP_ENTRY'));
    await expect(h.service.notify({ ...input, dedupeKey: 'k' })).resolves.toEqual({ id: 'winner' });
  });

  it('rethrows save errors that have no dedupeKey', async () => {
    const h = build();
    h.notifications.save.mockRejectedValueOnce(new Error('db down'));
    await expect(h.service.notify(input)).rejects.toThrow('db down');
  });

  it('enqueues an email job only when email is requested', async () => {
    const h = build();
    await h.service.notify(input);
    expect(h.queue.add).not.toHaveBeenCalled();
    await h.service.notify({ ...input, email: true });
    expect(h.queue.add).toHaveBeenCalledWith('send-email', { kind: 'email', notificationId: 'n1' }, { jobId: 'email-n1' });
  });

  it('still saves and resolves when the email enqueue fails', async () => {
    const h = build();
    h.queue.add.mockRejectedValue(new Error('redis down'));
    await expect(h.service.notify({ ...input, email: true })).resolves.toMatchObject({ id: 'n1' });
  });
});

describe('inbox operations', () => {
  it('list filters unread only when asked', async () => {
    const h = build();
    await h.service.list('u1', { page: 1, limit: 20, unreadOnly: true });
    expect(h.notifications.findAndCount.mock.calls[0][0].where).toHaveProperty('readAt');
    await h.service.list('u1', { page: 1, limit: 20 });
    expect(h.notifications.findAndCount.mock.calls[1][0].where).not.toHaveProperty('readAt');
  });

  it('markRead 404s for another user\'s id and skips saving when already read', async () => {
    const h = build();
    await expect(h.service.markRead('u1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    h.notifications.findOne.mockResolvedValue({ id: 'x', readAt: new Date() });
    await h.service.markRead('u1', 'x');
    expect(h.notifications.save).not.toHaveBeenCalled();
    h.notifications.findOne.mockResolvedValue({ id: 'y', readAt: null });
    await h.service.markRead('u1', 'y');
    expect(h.notifications.save).toHaveBeenCalledTimes(1);
  });

  it('markAllRead reports how many rows changed', async () => {
    const h = build();
    await expect(h.service.markAllRead('u1')).resolves.toEqual({ updated: 3 });
  });

  it('delete is scoped by user and 404s when nothing matched', async () => {
    const h = build();
    await h.service.deleteNotification('u1', 'n');
    expect(h.notifications.delete).toHaveBeenCalledWith({ id: 'n', userId: 'u1' });
    h.notifications.delete.mockResolvedValue({ affected: 0 });
    await expect(h.service.deleteNotification('u1', 'n')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('notifyBorrowEvent', () => {
  it('ignores unknown requests', async () => {
    const h = build();
    h.requests.findOne.mockResolvedValue(null);
    const spy = vi.spyOn(h.service, 'notify');
    await h.service.notifyBorrowEvent('nope', 'requested');
    expect(spy).not.toHaveBeenCalled();
  });

  it('requested -> owner only, with an idempotent dedupeKey', async () => {
    const h = build();
    const spy = seedLoan(h, { status: 'pending', dueInMs: 2 * DAY });
    await h.service.notifyBorrowEvent('r1', 'requested');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'o1', type: 'borrow.requested', email: true, dedupeKey: 'borrow-r1-requested-o1',
    }));
  });

  it('approved -> borrower, and schedules three reminders with correct delays', async () => {
    const h = build();
    const spy = seedLoan(h, { status: 'approved', dueInMs: 2 * DAY });
    await h.service.notifyBorrowEvent('r1', 'approved');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ userId: 'b1', type: 'borrow.approved' }));
    const jobs = Object.fromEntries(h.queue.add.mock.calls.map(c => [c[2].jobId, c[2].delay]));
    expect(jobs).toEqual({
      'reminder-r1-due-soon': DAY,
      'reminder-r1-due-now': 2 * DAY,
      'reminder-r1-overdue': 2 * DAY + HOUR,
    });
  });

  it('approved with a due date under 24h away clamps the due-soon delay to 0', async () => {
    const h = build();
    seedLoan(h, { status: 'approved', dueInMs: 2 * HOUR });
    await h.service.notifyBorrowEvent('r1', 'approved');
    const soon = h.queue.add.mock.calls.find(c => c[2].jobId === 'reminder-r1-due-soon');
    expect(soon?.[2].delay).toBe(0);
  });

  it('does not re-add reminder jobs that already exist', async () => {
    const h = build();
    seedLoan(h, { status: 'approved', dueInMs: 2 * DAY });
    h.queue.getJob.mockImplementation(async (id: string) => (id.endsWith('due-soon') ? {} : undefined));
    await h.service.notifyBorrowEvent('r1', 'approved');
    expect(h.queue.add).toHaveBeenCalledTimes(2);
  });

  it.each(['rejected', 'cancelled', 'returned', 'expired'] as const)('%s removes pending reminders', async (event) => {
    const h = build();
    seedLoan(h, { dueInMs: 2 * DAY });
    const remove = vi.fn().mockResolvedValue(undefined);
    h.queue.getJob.mockResolvedValue({ remove });
    await h.service.notifyBorrowEvent('r1', event);
    expect(remove).toHaveBeenCalledTimes(3);
  });

  it('swallows a failing job removal (job already active)', async () => {
    const h = build();
    seedLoan(h, { dueInMs: 2 * DAY });
    h.queue.getJob.mockResolvedValue({ remove: vi.fn().mockRejectedValue(new Error('locked')) });
    await expect(h.service.notifyBorrowEvent('r1', 'cancelled')).resolves.toBeUndefined();
  });

  it('picked-up notifies both parties and (re)schedules reminders', async () => {
    const h = build();
    const spy = seedLoan(h, { dueInMs: 2 * DAY });
    await h.service.notifyBorrowEvent('r1', 'picked-up');
    expect(spy.mock.calls.map(c => c[0].userId).sort()).toEqual(['b1', 'o1']);
    expect(h.queue.add).toHaveBeenCalledTimes(3);
  });
});

describe('processReminder windows', () => {
  it('skips stale reminders once the loan is no longer active', async () => {
    const h = build();
    const spy = seedLoan(h, { status: 'returned', dueInMs: 2 * HOUR });
    await h.priv.processReminder('r1', 'due-soon');
    expect(spy).not.toHaveBeenCalled();
  });
  it('skips due-soon when the loan was approved less than 24h before it was due', async () => {
  const h = build();
  const spy = seedLoan(h, { dueInMs: 10 * HOUR });
  h.notifications.findOne.mockResolvedValue({ createdAt: new Date(NOW.getTime() - HOUR) }); // approved 11h before due
  await h.priv.processReminder('r1', 'due-soon');
  expect(spy).not.toHaveBeenCalled();
});

it('sends due-soon when the loan was approved with more than 24h of lead time', async () => {
  const h = build();
  const spy = seedLoan(h, { dueInMs: 10 * HOUR });
  h.notifications.findOne.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 3 * DAY) });
  await h.priv.processReminder('r1', 'due-soon');
  expect(spy).toHaveBeenCalledTimes(1);
});
  it.each([
    ['due-soon', 20 * HOUR, true],
    ['due-soon', 3 * DAY, false],
    ['due-soon', -HOUR, false],
    ['due-now', -10 * 60_000, true],
    ['due-now', 2 * HOUR, false],
    ['due-now', -2 * HOUR, false],
    ['overdue', -30 * 60_000, false],
    ['overdue', -2 * HOUR, true],
  ] as const)('%s with due offset %i ms -> sent=%s', async (kind, dueInMs, sent) => {
    const h = build();
    const spy = seedLoan(h, { dueInMs: dueInMs });
    await h.priv.processReminder('r1', kind);
    expect(spy).toHaveBeenCalledTimes(sent ? 1 : 0);
  });

  it('uses a stable dedupeKey for due-soon and a per-day key for overdue', async () => {
    const h = build();
    const spy = seedLoan(h, { dueInMs: 20 * HOUR });
    await h.priv.processReminder('r1', 'due-soon');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'b1', dedupeKey: 'loan-r1-due-soon', type: 'loan.reminder.due-soon' }));
    seedLoan(h, { dueInMs: -2 * HOUR });
    await h.priv.processReminder('r1', 'overdue');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ dedupeKey: 'loan-r1-overdue-2026-10-19' }));
  });

  it('overdue chains the next daily reminder', async () => {
    const h = build();
    seedLoan(h, { dueInMs: -2 * HOUR });
    await h.priv.processReminder('r1', 'overdue');
    expect(h.queue.add).toHaveBeenCalledWith(
      'loan-reminder',
      { kind: 'loan-reminder', requestId: 'r1', reminderKind: 'overdue' },
      { jobId: 'reminder-r1-overdue-2026-10-19', delay: DAY },
    );
  });

  it('does nothing when the borrower no longer exists', async () => {
    const h = build();
    const spy = seedLoan(h, { dueInMs: 20 * HOUR });
    h.users.findOne.mockResolvedValue(null);
    await h.priv.processReminder('r1', 'due-soon');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('processEmail', () => {
  it('sends to the user and HTML-escapes content', async () => {
    const h = build();
    h.notifications.findOne.mockResolvedValue({ id: 'n1', userId: 'u1', title: '<b>Hi</b>', body: 'a & b' });
    h.users.findOne.mockResolvedValue({ id: 'u1', email: 'u@x.test' });
    await h.priv.processEmail('n1');
    const msg = h.mail.send.mock.calls[0][0];
    expect(msg.to).toBe('u@x.test');
    expect(msg.html).toContain('&lt;b&gt;Hi&lt;/b&gt;');
    expect(msg.html).toContain('a &amp; b');
  });

  it('does not send for a deleted notification or user', async () => {
    const h = build();
    await h.priv.processEmail('gone');
    h.notifications.findOne.mockResolvedValue({ id: 'n1', userId: 'u1', title: 't', body: 'b' });
    await h.priv.processEmail('n1');
    expect(h.mail.send).not.toHaveBeenCalled();
  });

  it('propagates mail failures so BullMQ retries the job', async () => {
    const h = build();
    h.notifications.findOne.mockResolvedValue({ id: 'n1', userId: 'u1', title: 't', body: 'b' });
    h.users.findOne.mockResolvedValue({ id: 'u1', email: 'u@x.test' });
    h.mail.send.mockRejectedValue(new Error('smtp'));
    await expect(h.priv.processEmail('n1')).rejects.toThrow('smtp');
  });
});