import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Resource } from '../resources/entities/resource.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { BorrowRequest, BorrowStatus } from './entities/borrow-request.entity.js';
import { LoanEventType } from './entities/loan-event.entity.js';
import { recordLoanEvent } from './loan-events.js';

export const DEFAULT_PICKUP_WINDOW_HOURS = 48;
const SWEEP_INTERVAL_MS = 5 * 60_000;
const SWEEP_BATCH = 200;
/** Bounds one sweep run; anything left over is picked up by the next run. */
const SWEEP_MAX_BATCHES = 10;

export type ExpiryReason = 'due-date-passed' | 'pickup-window-elapsed';

export interface ExpirySweepResult {
  expiredPending: number;
  expiredApproved: number;
}

const NOTES: Record<ExpiryReason, string> = {
  'due-date-passed': 'Expired automatically: the due date passed before the loan started',
  'pickup-window-elapsed': 'Expired automatically: the item was not picked up within the pickup window',
};

/**
 * Pure policy, shared by the candidate query and the locked re-check.
 * PENDING expires once its due date passes (it can no longer be fulfilled).
 * APPROVED also expires when nobody picked it up within the window, so an
 * abandoned approval cannot hold the resource forever.
 */
export function expiryReason(
  request: Pick<BorrowRequest, 'status' | 'dueDate' | 'approvedAt'>,
  now: Date,
  pickupCutoff: Date,
): ExpiryReason | null {
  const duePassed = new Date(request.dueDate).getTime() <= now.getTime();
  if (request.status === BorrowStatus.PENDING) return duePassed ? 'due-date-passed' : null;
  if (request.status === BorrowStatus.APPROVED) {
    if (duePassed) return 'due-date-passed';
    if (request.approvedAt && new Date(request.approvedAt).getTime() <= pickupCutoff.getTime()) {
      return 'pickup-window-elapsed';
    }
  }
  return null;
}

@Injectable()
export class BorrowExpiryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BorrowExpiryService.name);
  private readonly pickupWindowMs: number;
  private readonly enabled: boolean;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
    @Inject(forwardRef(() => NotificationsService)) private readonly notifications: NotificationsService,
  ) {
    const hours = Number(config.get<string>('BORROW_PICKUP_WINDOW_HOURS', String(DEFAULT_PICKUP_WINDOW_HOURS)));
    if (!Number.isFinite(hours) || hours <= 0) {
      throw new Error('BORROW_PICKUP_WINDOW_HOURS must be a positive number');
    }
    this.pickupWindowMs = hours * 3_600_000;
    this.enabled = config.get<string>('BORROW_EXPIRY_SWEEP_ENABLED', 'true') !== 'false';
  }

  /**
   * In-process timer, deliberately not BullMQ: releasing locked resources must not depend on Redis.
   * Safe with several API instances, because every expiry re-checks its row under a lock.
   */
  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.warn('Borrow expiry sweep disabled (BORROW_EXPIRY_SWEEP_ENABLED=false)');
      return;
    }
    this.timer = setInterval(() => void this.runScheduled(), SWEEP_INTERVAL_MS);
    this.timer.unref();
    void this.runScheduled();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Idempotent and safe to call concurrently: each row is re-checked under a row lock. */
  async expireStale(now: Date = new Date()): Promise<ExpirySweepResult> {
    const pickupCutoff = new Date(now.getTime() - this.pickupWindowMs);
    const result: ExpirySweepResult = { expiredPending: 0, expiredApproved: 0 };

    for (let batch = 0; batch < SWEEP_MAX_BATCHES; batch++) {
      const candidates = await this.findCandidates(now, pickupCutoff);
      let progressed = 0;

      for (const candidate of candidates) {
        const expired = await this.expireOne(candidate.id, candidate.resourceId, now, pickupCutoff);
        if (!expired) continue; // changed since it was selected: someone else acted first
        progressed++;
        if (expired.from === BorrowStatus.PENDING) result.expiredPending++;
        else result.expiredApproved++;
        // After commit, never inside the transaction: notification failures must not undo the expiry.
        const event = expired.from === BorrowStatus.APPROVED ? 'pickup-expired' : 'expired';
        void this.notifications.notifyBorrowEvent(candidate.id, event).catch((e: unknown) =>
          this.logger.error(`Expiry notification for ${candidate.id} failed: ${String(e)}`),
        );
      }
      // A short batch means nothing is left; zero progress means every candidate was taken by
      // a concurrent writer, and looping again would spin on the same rows.
      if (candidates.length < SWEEP_BATCH || progressed === 0) break;
    }
    return result;
  }

  private findCandidates(now: Date, pickupCutoff: Date) {
    return this.dataSource
      .getRepository(BorrowRequest)
      .createQueryBuilder('br')
      .select(['br.id', 'br.resourceId'])
      .where('br.status = :pending AND br.dueDate <= :now')
      .orWhere('br.status = :approved AND (br.dueDate <= :now OR br.approvedAt <= :cutoff)')
      .setParameters({
        pending: BorrowStatus.PENDING,
        approved: BorrowStatus.APPROVED,
        now,
        cutoff: pickupCutoff,
      })
      .orderBy('br.dueDate', 'ASC')
      .limit(SWEEP_BATCH)
      .getMany();
  }

  private expireOne(
    requestId: string,
    resourceId: string,
    now: Date,
    pickupCutoff: Date,
  ): Promise<{ from: BorrowStatus; reason: ExpiryReason } | null> {
    return this.dataSource.transaction(async (manager) => {
      // Same lock order as every other borrow writer: resource first, then request.
      // withDeleted: a soft-deleted resource can still have requests to clean up.
      await manager.findOne(Resource, {
        where: { id: resourceId },
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      });
      const request = await manager.findOne(BorrowRequest, {
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!request) return null;

      const reason = expiryReason(request, now, pickupCutoff);
      if (!reason) return null;

      const from = request.status;
      await manager.update(BorrowRequest, { id: requestId }, { status: BorrowStatus.EXPIRED });
      await recordLoanEvent(manager, {
        borrowRequestId: requestId,
        resourceId,
        actorId: null,
        eventType: LoanEventType.EXPIRED,
        fromStatus: from,
        toStatus: BorrowStatus.EXPIRED,
        note: NOTES[reason],
      });
      return { from, reason };
    });
  }

  private async runScheduled(): Promise<void> {
    if (this.running) return; // a slow run must not overlap the next tick
    this.running = true;
    try {
      const { expiredPending, expiredApproved } = await this.expireStale();
      if (expiredPending || expiredApproved) {
        this.logger.log(`Expired ${expiredPending} pending and ${expiredApproved} approved borrow requests`);
      }
    } catch (e) {
      this.logger.error(`Borrow expiry sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }
}
