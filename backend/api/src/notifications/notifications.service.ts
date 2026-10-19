import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue, Worker } from 'bullmq';
import {Redis} from 'ioredis';
import { IsNull, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service.js';
import { BorrowRequest, BorrowStatus } from '../borrow-requests/entities/borrow-request.entity.js';
import { Resource } from '../resources/entities/resource.entity.js';
import { User } from '../users/entities/user.entity.js';
import { Notification } from './entities/notification.entity.js';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto.js';

type ReminderKind = 'due-soon' | 'due-now' | 'overdue';
type JobData = { kind: 'email'; notificationId: string } | { kind: 'loan-reminder'; requestId: string; reminderKind: ReminderKind } | { kind: 'test-notification'; userId: string } | { kind: 'reconcile-reminders' };
type NoticeInput = { userId: string; type: string; title: string; body: string; data?: Record<string, string | number | boolean | null>; email?: boolean; dedupeKey?: string };
const QUEUE_NAME = 'campusloop-notifications';
const ACTIVE_STATUSES = [BorrowStatus.APPROVED, BorrowStatus.ACTIVE];
const DAY_MS = 86_400_000;
const errorMessage = (e: unknown) => e instanceof Error ? e.message : String(e);
const dateLabel = (date: Date) => new Date(date).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private redis?: Redis; private workerRedis?: Redis; private queue?: Queue<JobData>; private worker?: Worker<JobData>;
  constructor(private readonly config: ConfigService, private readonly mail: MailService,
    @InjectRepository(Notification) private readonly notificationsRepo: Repository<Notification>,
    @InjectRepository(BorrowRequest) private readonly requestsRepo: Repository<BorrowRequest>,
    @InjectRepository(Resource) private readonly resourcesRepo: Repository<Resource>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>) {}
  private closing = false;
    async onModuleInit() {
    if (this.config.get<string>('NOTIFICATIONS_QUEUE_ENABLED', 'true') === 'false') {
      this.logger.warn('Notification queue disabled: in-app notifications work; emails and reminders do not.');
      return;
    }
    const url = this.config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
    const prefix = this.config.get<string>('BULLMQ_PREFIX');
    const base = { enableReadyCheck: true, connectTimeout: 10_000 };
    // Producer fails fast instead of buffering commands forever while Redis is down.
    this.redis = new Redis(url, { ...base, maxRetriesPerRequest: 2 });
    // BullMQ requires null on the worker's blocking connection.
    this.workerRedis = new Redis(url, { ...base, maxRetriesPerRequest: null });
    this.redis.on('error', e => this.logger.error(`Redis queue connection error: ${e.message}`));
    this.workerRedis.on('error', e => this.logger.error(`Redis worker connection error: ${e.message}`));
    const prefixOpt = prefix ? { prefix } : {};
    this.queue = new Queue<JobData>(QUEUE_NAME, { connection: this.redis, ...prefixOpt, defaultJobOptions: {
      attempts: 5, backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 604_800, count: 5_000 }, removeOnFail: { age: 2_592_000, count: 10_000 },
    }});
    this.worker = new Worker<JobData>(QUEUE_NAME, job => this.processJob(job), { connection: this.workerRedis, concurrency: 5, ...prefixOpt });
    this.worker.on('failed', (job, err) => this.logger.error(`BullMQ job ${job?.id ?? 'unknown'} failed: ${err.message}`));
    this.worker.on('error', err => this.logger.error(`BullMQ worker error: ${err.message}`));
    this.queue.on('error', err => this.logger.error(`BullMQ queue error: ${err.message}`));
    // Never block application bootstrap on Redis.
    void this.scheduleStartupJobs();
    this.logger.log(`BullMQ queue ready: ${QUEUE_NAME}`);
  }
  private async scheduleStartupJobs() {
    for (let attempt = 1; attempt <= 5 && !this.closing && this.queue; attempt++) {
      try {
        await this.queue.add('reconcile-reminders', { kind: 'reconcile-reminders' }, { jobId: 'reconcile-reminders-startup' });
        await this.queue.upsertJobScheduler('reconcile-reminders-every-15-minutes', { every: 15 * 60_000 }, { name: 'reconcile-reminders', data: { kind: 'reconcile-reminders' } });
        return;
      } catch (e) {
        this.logger.error(`Reminder scheduling attempt ${attempt}/5 failed: ${errorMessage(e)}`);
        await new Promise(r => setTimeout(r, 5_000 * attempt));
      }
    }
  }

  async onModuleDestroy() {
    this.closing = true;
    await this.worker?.close(); await this.queue?.close();
    await Promise.allSettled([this.workerRedis?.quit(), this.redis?.quit()]);
  }

  async list(userId: string, query: ListNotificationsQueryDto) {
    const page = query.page ?? 1, limit = query.limit ?? 20;
    const where: { userId: string; readAt?: ReturnType<typeof IsNull> } = { userId };
    if (query.unreadOnly) where.readAt = IsNull();
    const [items, total] = await this.notificationsRepo.findAndCount({ where, order: { createdAt: 'DESC', id: 'DESC' }, skip: (page - 1) * limit, take: limit });
    return { items, total, page, limit, unreadCount: await this.notificationsRepo.count({ where: { userId, readAt: IsNull() } }) };
  }
  async unreadCount(userId: string) { return { count: await this.notificationsRepo.count({ where: { userId, readAt: IsNull() } }) }; }
  async markRead(userId: string, id: string) {
    const item = await this.notificationsRepo.findOne({ where: { id, userId } });
    if (!item) throw new NotFoundException('Notification not found');
    if (!item.readAt) { item.readAt = new Date(); await this.notificationsRepo.save(item); }
    return { item };
  }
  async deleteNotification(userId: string, id: string) {
      const result = await this.notificationsRepo.delete({
        id,
        userId,
      });

      if (!result.affected) {
        throw new NotFoundException('Notification not found');
      }

      return { message: 'Notification deleted successfully' };
  }
  async markAllRead(userId: string) {
    const result = await this.notificationsRepo.createQueryBuilder().update(Notification).set({ readAt: new Date() }).where('userId = :userId AND readAt IS NULL', { userId }).execute();
    return { updated: result.affected ?? 0 };
  }
  async notify(input: NoticeInput) {
    if (input.dedupeKey) { const found = await this.notificationsRepo.findOne({ where: { dedupeKey: input.dedupeKey } }); if (found) return found; }
    let saved: Notification;
    try { saved = await this.notificationsRepo.save(this.notificationsRepo.create({ userId: input.userId, type: input.type, title: input.title, body: input.body, data: input.data ?? null, dedupeKey: input.dedupeKey ?? null, readAt: null })); }
    catch (error) { if (input.dedupeKey) { const found = await this.notificationsRepo.findOne({ where: { dedupeKey: input.dedupeKey } }); if (found) return found; } throw error; }
    if (input.email) { try { await this.enqueueEmail(saved.id); } catch (e) { this.logger.error(`Could not enqueue notification email ${saved.id}: ${errorMessage(e)}`); } }
    return saved;
  }
  async sendTestNotification(userId: string) {
    const saved = await this.notify({ userId, type: 'system.test', title: 'CampusLoop notification test', body: 'Your in-app notification system is working. An email will be queued if SMTP is configured.', email: true, dedupeKey: `test-${userId}-${Date.now()}` });
    return { notification: saved, queue: QUEUE_NAME, emailQueued: true };
  }
  async queueHealth() {
    if (!this.queue || !this.redis) throw new ServiceUnavailableException('Notification queue is not initialized');
    const pong = await this.redis.ping(); const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
    return { redis: pong === 'PONG' ? 'connected' : 'unhealthy', queue: QUEUE_NAME, counts };
  }

  /** Call this after a borrowing state transition commits. */
  async notifyBorrowEvent(requestId: string, event: 'requested' | 'approved' | 'rejected' | 'cancelled' | 'picked-up' | 'returned' | 'expired') {
    const request = await this.requestsRepo.findOne({ where: { id: requestId } }); if (!request) return;
    const resource = await this.resourcesRepo.findOne({ where: { id: request.resourceId }, withDeleted: true }); if (!resource) return;
    const borrower = await this.usersRepo.findOne({ where: { id: request.borrowerId } }); const owner = await this.usersRepo.findOne({ where: { id: resource.ownerId } });
    const data = { requestId, resourceId: resource.id, status: request.status };
    const send = (user: User | null, type: string, title: string, body: string) => user ? this.notify({ userId: user.id, type, title, body, data, email: true, dedupeKey: `borrow-${requestId}-${event}-${user.id}` }) : Promise.resolve(null);
    switch (event) {
      case 'requested': await send(owner, 'borrow.requested', 'New borrowing request', `${borrower?.name ?? 'A student'} requested to borrow “${resource.title}”.`); break;
      case 'approved': await send(borrower, 'borrow.approved', 'Borrowing request approved', `Your request for “${resource.title}” was approved. Due ${dateLabel(request.dueDate)}.`); await this.scheduleLoanReminders(request.id, request.dueDate); break;
      case 'rejected': await this.cancelLoanReminders(request.id); await send(borrower, 'borrow.rejected', 'Borrowing request declined', `Your request for “${resource.title}” was declined.`); break;
      case 'cancelled': await this.cancelLoanReminders(request.id); await send(owner, 'borrow.cancelled', 'Borrowing request cancelled', `The request for “${resource.title}” was cancelled.`); break;
      case 'picked-up': await send(owner, 'borrow.picked_up', 'Item pickup confirmed', `Pickup of “${resource.title}” was confirmed.`); await send(borrower, 'borrow.picked_up', 'Pickup confirmed', `Your pickup of “${resource.title}” was recorded. Due ${dateLabel(request.dueDate)}.`); await this.scheduleLoanReminders(request.id, request.dueDate); break;
      case 'returned': await this.cancelLoanReminders(request.id); await send(owner, 'borrow.returned', 'Item return recorded', `The return of “${resource.title}” was recorded.`); await send(borrower, 'borrow.returned', 'Loan completed', `Your loan for “${resource.title}” has been marked returned.`); break;
      case 'expired': await this.cancelLoanReminders(request.id); await send(borrower, 'borrow.expired', 'Borrowing request expired', `Your request for “${resource.title}” expired before approval.`); break;
    }
  }
  private async enqueueEmail(notificationId: string) {
    if (!this.queue) throw new Error('BullMQ queue unavailable');
    await this.queue.add('send-email', { kind: 'email', notificationId }, { jobId: `email-${notificationId}` });
  }
  private async scheduleLoanReminders(requestId: string, dueDate: Date) {
    if (!this.queue) return;
    const due = new Date(dueDate).getTime();
    const reminders: Array<[ReminderKind, number]> = [['due-soon', due - DAY_MS], ['due-now', due], ['overdue', due + 60 * 60_000]];
    for (const [reminderKind, timestamp] of reminders) {
      const jobId = `reminder-${requestId}-${reminderKind}`;
      const existing = await this.queue.getJob(jobId);
      if (existing) continue;
      await this.queue.add('loan-reminder', { kind: 'loan-reminder', requestId, reminderKind }, { jobId, delay: Math.max(0, timestamp - Date.now()) });
    }
  }
  private async cancelLoanReminders(requestId: string) {
    if (!this.queue) return;
    for (const kind of ['due-soon', 'due-now', 'overdue'] as ReminderKind[]) {
      const job = await this.queue.getJob(`reminder-${requestId}-${kind}`); if (job) { try { await job.remove(); } catch { /* active jobs verify current DB status before sending */ } }
    }
  }
  private async reconcileLoanReminders() {
    const requests = await this.requestsRepo.find({ where: ACTIVE_STATUSES.map(status => ({ status })), take: 10_000 });
    for (const request of requests) await this.scheduleLoanReminders(request.id, request.dueDate);
    this.logger.log(`Reminder reconciliation scheduled ${requests.length} active/approved loans`);
  }
  private async processJob(job: Job<JobData>) {
    const data = job.data;
    if (data.kind === 'email') return this.processEmail(data.notificationId);
    if (data.kind === 'loan-reminder') return this.processReminder(data.requestId, data.reminderKind);
    if (data.kind === 'test-notification') return this.sendTestNotification(data.userId);
    if (data.kind === 'reconcile-reminders') return this.reconcileLoanReminders();
  }
  private async processEmail(notificationId: string) {
    const notification = await this.notificationsRepo.findOne({ where: { id: notificationId } }); if (!notification) return;
    const user = await this.usersRepo.findOne({ where: { id: notification.userId } }); if (!user) return;
    await this.mail.send({ to: user.email, subject: notification.title, text: `${notification.body}\n\nCampusLoop` , html: `<h2>${escapeHtml(notification.title)}</h2><p>${escapeHtml(notification.body)}</p><p>CampusLoop</p>` });
  }
    /** "Due soon" is noise if the loan was approved less than 24h before its due date. */
  private async approvedWithLeadTime(request: BorrowRequest, due: number): Promise<boolean> {
    const approved = await this.notificationsRepo.findOne({
      where: { dedupeKey: `borrow-${request.id}-approved-${request.borrowerId}` },
    });
    return !approved || due - new Date(approved.createdAt).getTime() >= DAY_MS;
  }
  private async processReminder(requestId: string, reminderKind: ReminderKind) {
    const request = await this.requestsRepo.findOne({ where: { id: requestId } });
    if (!request || !ACTIVE_STATUSES.includes(request.status)) { this.logger.log(`Skip stale reminder ${requestId}/${reminderKind}: loan is no longer active`); return; }
    const resource = await this.resourcesRepo.findOne({ where: { id: request.resourceId }, withDeleted: true }); if (!resource) return;
    const borrower = await this.usersRepo.findOne({ where: { id: request.borrowerId } }); if (!borrower) return;
    
const due = new Date(request.dueDate).getTime();
const now = Date.now();

// Send due-soon only when the due date is within the next 24 hours,
// and the loan was approved at least 24 hours before its due date.
if (reminderKind === 'due-soon') {
  if (due <= now || due - now > DAY_MS) return;
  if (!(await this.approvedWithLeadTime(request, due))) return;
}

    if (reminderKind === 'due-now' && (now < due || now >= due + 60 * 60_000)) return;
    if (reminderKind === 'overdue' && now < due + 60 * 60_000) return;
    const messages: Record<ReminderKind, [string, string, string]> = {
      'due-soon': ['loan.reminder.due-soon', 'Loan due soon', `“${resource.title}” is due on ${dateLabel(request.dueDate)}.`],
      'due-now': ['loan.reminder.due-now', 'Loan due now', `Your loan for “${resource.title}” is due now (${dateLabel(request.dueDate)}). Please coordinate the return.`],
      overdue: ['loan.reminder.overdue', 'Loan overdue', `Your loan for “${resource.title}” was due ${dateLabel(request.dueDate)}. Please arrange its return.`],
    };
    const [type, title, body] = messages[reminderKind];
    await this.notify({ userId: borrower.id, type, title, body, data: { requestId, resourceId: resource.id, dueDate: new Date(request.dueDate).toISOString() }, email: true, dedupeKey: reminderKind === 'overdue' ? `loan-${requestId}-overdue-${new Date().toISOString().slice(0, 10)}` : `loan-${requestId}-${reminderKind}` });
    // Overdue reminders repeat once daily, but each day has its own dedupe key.
    if (reminderKind === 'overdue' && ACTIVE_STATUSES.includes(request.status) && this.queue) {
      await this.queue.add('loan-reminder', { kind: 'loan-reminder', requestId, reminderKind: 'overdue' }, { jobId: `reminder-${requestId}-overdue-${new Date().toISOString().slice(0, 10)}`, delay: DAY_MS });
    }
  }
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c); }
