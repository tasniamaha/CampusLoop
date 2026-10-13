import { EntityManager } from 'typeorm';
import { BorrowStatus } from './entities/borrow-request.entity.js';
import { LoanEvent, LoanEventType } from './entities/loan-event.entity.js';

export interface LoanEventInput {
  borrowRequestId: string;
  resourceId: string;
  actorId: string | null;
  eventType: LoanEventType;
  fromStatus: BorrowStatus | null;
  toStatus: BorrowStatus;
  note?: string;
}

/**
 * Always pass the SAME EntityManager as the state change, so the status update and its
 * event commit or roll back together.
 */
export async function recordLoanEvent(manager: EntityManager, input: LoanEventInput) {
  const repo = manager.getRepository(LoanEvent);
  await repo.save(repo.create({ ...input, note: input.note ?? null }));
}