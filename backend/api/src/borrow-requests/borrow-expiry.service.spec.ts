import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { BorrowExpiryService, expiryReason } from './borrow-expiry.service.js';
import { BorrowStatus } from './entities/borrow-request.entity.js';

const HOUR = 3_600_000;
const now = new Date('2026-11-03T12:00:00.000Z');
const cutoff = new Date(now.getTime() - 48 * HOUR);
const future = new Date(now.getTime() + 24 * HOUR);
const past = new Date(now.getTime() - HOUR);

describe('expiryReason', () => {
  it('expires a pending request only once its due date has passed', () => {
    expect(expiryReason({ status: BorrowStatus.PENDING, dueDate: past, approvedAt: null }, now, cutoff)).toBe('due-date-passed');
    expect(expiryReason({ status: BorrowStatus.PENDING, dueDate: future, approvedAt: null }, now, cutoff)).toBeNull();
  });

  it('treats the due date as passed at exactly the due instant', () => {
    expect(expiryReason({ status: BorrowStatus.PENDING, dueDate: now, approvedAt: null }, now, cutoff)).toBe('due-date-passed');
  });

  it('expires an approved request after the pickup window, and not a moment before', () => {
    const late = new Date(cutoff.getTime() - 1);
    const onTime = new Date(cutoff.getTime() + 1);
    expect(expiryReason({ status: BorrowStatus.APPROVED, dueDate: future, approvedAt: late }, now, cutoff)).toBe('pickup-window-elapsed');
    expect(expiryReason({ status: BorrowStatus.APPROVED, dueDate: future, approvedAt: onTime }, now, cutoff)).toBeNull();
  });

  it('prefers the due-date reason when both apply', () => {
    expect(expiryReason({ status: BorrowStatus.APPROVED, dueDate: past, approvedAt: past }, now, cutoff)).toBe('due-date-passed');
  });

  it('never expires an approved request with no approval time unless its due date passed', () => {
    expect(expiryReason({ status: BorrowStatus.APPROVED, dueDate: future, approvedAt: null }, now, cutoff)).toBeNull();
  });

  it.each([BorrowStatus.ACTIVE, BorrowStatus.RETURNED, BorrowStatus.REJECTED, BorrowStatus.CANCELLED, BorrowStatus.EXPIRED])(
    'never touches a %s request, even long overdue (an overdue active loan is not expired)',
    (status) => {
      expect(expiryReason({ status, dueDate: past, approvedAt: past }, now, cutoff)).toBeNull();
    },
  );
});

describe('BorrowExpiryService configuration', () => {
  const build = (env: Record<string, string>) =>
    new BorrowExpiryService({} as DataSource, new ConfigService(env), {} as NotificationsService);

  it.each(['0', '-5', 'abc'])('rejects BORROW_PICKUP_WINDOW_HOURS=%s at startup', (value) => {
    expect(() => build({ BORROW_PICKUP_WINDOW_HOURS: value })).toThrow(/positive number/);
  });

  it('accepts the default and fractional windows', () => {
    expect(() => build({})).not.toThrow();
    expect(() => build({ BORROW_PICKUP_WINDOW_HOURS: '0.5' })).not.toThrow();
  });
});
