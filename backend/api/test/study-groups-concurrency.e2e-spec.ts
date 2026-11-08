import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { StudyGroupMemberStatus } from '../src/study-groups/entities/study-group-member.entity.js';
import { StudyGroupsTestApp, type Actor } from './helpers/study-groups-app.js';

// INV-4: a study group never exceeds its participant limit, under concurrent joins and concurrent
// approvals. Calls the real service against real MySQL (the HTTP throttles would serialise the
// requests and hide the race). The creator's owner row counts towards the limit.

const t = new StudyGroupsTestApp('sgc', '198.51.105');
const CONTENDERS = 10;
const LIMIT = 3; // creator + 2 seats
const ROUNDS = 5;

let creator: Actor;
let contenders: Actor[];

const activeCount = async (groupId: string) =>
  Number(
    (
      await t.ds.query(`SELECT COUNT(*) AS n FROM study_group_members WHERE groupId = ? AND status = 'active'`, [groupId])
    )[0].n,
  );

function expectOnlyLimitConflicts(results: PromiseSettledResult<unknown>[]) {
  for (const result of results) {
    if (result.status === 'rejected') {
      expect(result.reason).toBeInstanceOf(ConflictException);
      expect((result.reason as Error).message).toBe('This group has reached its participant limit');
    }
  }
}

beforeAll(async () => {
  await t.start();
  creator = await t.makeUser('creator', { login: false });
  contenders = [];
  for (let i = 0; i < CONTENDERS; i++) contenders.push(await t.makeUser(`c${i}`, { login: false }));
}, 90_000);

afterAll(() => t.stop());

describe('INV-4: participant limit under concurrency', () => {
  it(`${CONTENDERS} concurrent joins to an open-join group with ${LIMIT - 1} free seats: exactly ${LIMIT - 1} succeed`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const group = await t.createGroup(creator, { participantLimit: LIMIT, approvalRequired: false });
      const results = await Promise.allSettled(contenders.map((c) => t.service.join(group.id, c.id)));

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(LIMIT - 1);
      expectOnlyLimitConflicts(results);
      expect(await activeCount(group.id)).toBe(LIMIT);
    }
  });

  it(`${CONTENDERS} concurrent approvals with ${LIMIT - 1} free seats: exactly ${LIMIT - 1} succeed, the rest stay pending`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const group = await t.createGroup(creator, { participantLimit: LIMIT, approvalRequired: true });
      const requests = [];
      for (const c of contenders) requests.push(await t.service.join(group.id, c.id));
      expect(requests.every((r) => r.status === StudyGroupMemberStatus.PENDING)).toBe(true);

      const results = await Promise.allSettled(
        requests.map((r) => t.service.review(group.id, r.id, creator.id, StudyGroupMemberStatus.ACTIVE)),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(LIMIT - 1);
      expectOnlyLimitConflicts(results);
      expect(await activeCount(group.id)).toBe(LIMIT);
      const pending = await t.ds.query(`SELECT COUNT(*) AS n FROM study_group_members WHERE groupId = ? AND status = 'pending'`, [group.id]);
      expect(Number(pending[0].n)).toBe(CONTENDERS - (LIMIT - 1));
    }
  });

  it('concurrent joins and approvals racing for the last seat never exceed the limit', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      // Approval group with one seat left; half the contenders are pending, the creator approves them
      // while the group is flipped to open join and the other half joins directly.
      const group = await t.createGroup(creator, { participantLimit: 2, approvalRequired: true });
      const half = contenders.slice(0, CONTENDERS / 2);
      const requests = [];
      for (const c of half) requests.push(await t.service.join(group.id, c.id));
      await t.ds.query('UPDATE study_groups SET approvalRequired = 0 WHERE id = ?', [group.id]);

      const results = await Promise.allSettled([
        ...requests.map((r) => t.service.review(group.id, r.id, creator.id, StudyGroupMemberStatus.ACTIVE)),
        ...contenders.slice(CONTENDERS / 2).map((c) => t.service.join(group.id, c.id)),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expectOnlyLimitConflicts(results);
      expect(await activeCount(group.id)).toBe(2);
    }
  });
});
