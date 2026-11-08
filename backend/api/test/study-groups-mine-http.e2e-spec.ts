import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { StudyGroupMemberStatus } from '../src/study-groups/entities/study-group-member.entity.js';
import { StudyGroupsTestApp, type Actor } from './helpers/study-groups-app.js';

// GET /study-groups/mine over the real HTTP stack and MySQL. Only ever the caller's own rows:
// groups they created, groups they're an active member of, their pending/rejected requests.

const t = new StudyGroupsTestApp('sgm', '198.51.104');

type Group = { id: string; title: string; status: string; memberCount?: number; [k: string]: unknown };
type RequestItem = { request: { id: string; status: string; [k: string]: unknown }; group: Group };
type Mine = {
  created: { items: Group[]; truncated: boolean };
  memberships: { items: Group[]; truncated: boolean };
  requests: { items: RequestItem[]; truncated: boolean };
};

const mine = async (who: Actor) => (await t.as('get', '/study-groups/mine', who).expect(200)).body as Mine;

/** Bulk-inserts groups (and their owner rows) straight into the DB; creating 100+ through the service is slow. */
async function seedGroups(creatorId: string, count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => randomUUID());
  await t.ds.query(
    `INSERT INTO study_groups (id, creatorId, campus, title, courseCode, topic, description, schedule, participantLimit)
     VALUES ${ids.map(() => `(?, ?, ?, 'Seeded group', 'SEED101', 'Seeding', 'Seeded description', 'Any time', 10)`).join(',')}`,
    ids.flatMap((id) => [id, creatorId, t.campus]),
  );
  await seedMemberships(ids, creatorId, 'owner', 'active');
  return ids;
}

async function seedMemberships(groupIds: string[], userId: string, role: 'owner' | 'member', status: 'active' | 'pending') {
  await t.ds.query(
    `INSERT INTO study_group_members (id, groupId, userId, campus, role, status) VALUES ${groupIds.map(() => '(?, ?, ?, ?, ?, ?)').join(',')}`,
    groupIds.flatMap((groupId) => [randomUUID(), groupId, userId, t.campus, role, status]),
  );
}

beforeAll(async () => {
  await t.start();
}, 90_000);

afterAll(() => t.stop());

describe('GET /study-groups/mine', () => {
  let alice: Actor;
  let bob: Actor;
  let aliceOpen: { id: string };
  let aliceArchived: { id: string };
  let bobJoined: { id: string };
  let bobJoinedArchived: { id: string };
  let bobPending: { id: string };
  let bobRejected: { id: string };
  let bobPendingArchived: { id: string };

  beforeAll(async () => {
    alice = await t.makeUser('alice');
    bob = await t.makeUser('bob');

    aliceOpen = await t.createGroup(alice, { title: 'Alice open group' });
    aliceArchived = await t.createGroup(alice, { title: 'Alice archived group' });
    await t.service.archive(aliceArchived.id, alice.id);
    await t.service.join(aliceOpen.id, bob.id); // Bob's request on Alice's group: never in Alice's requests

    bobJoined = await t.createGroup(bob, { title: 'Bob joined group', approvalRequired: false });
    bobJoinedArchived = await t.createGroup(bob, { title: 'Bob joined then archived', approvalRequired: false });
    bobPending = await t.createGroup(bob, { title: 'Bob pending group' });
    bobRejected = await t.createGroup(bob, { title: 'Bob rejected group' });
    bobPendingArchived = await t.createGroup(bob, { title: 'Bob pending then archived', courseCode: 'MAT110', topic: 'Calculus' });

    await t.service.join(bobJoined.id, alice.id);
    await t.service.join(bobJoinedArchived.id, alice.id);
    await t.service.archive(bobJoinedArchived.id, bob.id);
    await t.service.join(bobPending.id, alice.id);
    const r = await t.service.join(bobRejected.id, alice.id);
    await t.service.join(bobPendingArchived.id, alice.id);
    await t.service.review(bobRejected.id, r.id, bob.id, StudyGroupMemberStatus.REJECTED);
    await t.service.archive(bobPendingArchived.id, bob.id);
  }, 60_000);

  it('is not swallowed by GET /study-groups/:id', async () => {
    const res = await t.as('get', '/study-groups/mine', alice);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('created');
  });

  it('lists groups I created, open and archived, newest first', async () => {
    const { created } = await mine(alice);
    expect(created.truncated).toBe(false);
    expect(created.items.map((g) => [g.id, g.status])).toEqual([
      [aliceArchived.id, 'archived'],
      [aliceOpen.id, 'open'],
    ]);
    expect(created.items.every((g) => g.isCreator === true)).toBe(true);
  });

  it("lists groups I'm an active member of (not ones I created), archived included, newest first", async () => {
    const { memberships } = await mine(alice);
    expect(memberships.items.map((g) => [g.id, g.status])).toEqual([
      [bobJoinedArchived.id, 'archived'],
      [bobJoined.id, 'open'],
    ]);
    expect(memberships.items[1]).toMatchObject({ memberCount: 2, myMembershipStatus: 'active', isCreator: false });
  });

  it('lists my pending and rejected requests, newest request first', async () => {
    const { requests } = await mine(alice);
    expect(requests.items.map((i) => [i.group.id, i.request.status])).toEqual([
      [bobPendingArchived.id, 'pending'],
      [bobRejected.id, 'rejected'],
      [bobPending.id, 'pending'],
    ]);
    for (const item of requests.items) {
      expect(Object.keys(item.request).sort()).toEqual(['id', 'requestedAt', 'reviewedAt', 'status']);
    }
    expect(requests.items[1].request.reviewedAt).not.toBeNull();
    expect(requests.items[0].request.reviewedAt).toBeNull();
    expect(requests.items[2].group).toMatchObject({ title: 'Bob pending group', memberCount: 1, participantLimit: 5 });
  });

  it('a request to an archived group carries only a minimal summary', async () => {
    const { requests } = await mine(alice);
    const archived = requests.items.find((i) => i.group.id === bobPendingArchived.id)!;
    expect(archived.group).toEqual({
      id: bobPendingArchived.id,
      title: 'Bob pending then archived',
      courseCode: 'MAT110',
      topic: 'Calculus',
      status: 'archived',
    });
  });

  it("user B's rows never appear in user A's lists", async () => {
    const forAlice = await mine(alice);
    expect(forAlice.requests.items.map((i) => i.group.id)).not.toContain(aliceOpen.id); // Bob's request on Alice's group
    const forBob = await mine(bob);
    expect(forBob.created.items.map((g) => g.id).sort()).toEqual(
      [bobJoined.id, bobJoinedArchived.id, bobPending.id, bobRejected.id, bobPendingArchived.id].sort(),
    );
    expect(forBob.memberships.items).toEqual([]);
    expect(forBob.requests.items.map((i) => [i.group.id, i.request.status])).toEqual([[aliceOpen.id, 'pending']]);
    const all = JSON.stringify(forBob);
    expect(all).not.toContain(aliceArchived.id);
    expect(all).not.toContain(alice.email);
    expect(all).not.toMatch(/password|token|hash/i);
  });

  it('a new user gets three empty lists', async () => {
    const fresh = await t.makeUser('fresh');
    expect(await mine(fresh)).toEqual({
      created: { items: [], truncated: false },
      memberships: { items: [], truncated: false },
      requests: { items: [], truncated: false },
    });
  });

  it('not logged in: 401', async () => {
    await t.as('get', '/study-groups/mine').expect(401);
  });
});

describe('GET /study-groups/mine truncation', () => {
  it('created: 100 is not truncated; 101 returns the 100 newest with truncated: true', async () => {
    const heavy = await t.makeUser('heavy-creator');
    await seedGroups(heavy.id, 100);
    let body = await mine(heavy);
    expect(body.created.items).toHaveLength(100);
    expect(body.created.truncated).toBe(false);

    await new Promise((r) => setTimeout(r, 5)); // newer createdAt than the seeded rows
    const newest = await t.createGroup(heavy, { title: 'Newest of many' });
    body = await mine(heavy);
    expect(body.created.items).toHaveLength(100);
    expect(body.created.truncated).toBe(true);
    expect(body.created.items[0].id).toBe(newest.id);
  });

  it('requests: 101 pending requests return 100 with truncated: true', async () => {
    const owner = await t.makeUser('heavy-owner');
    const requester = await t.makeUser('heavy-requester');
    const groups = await seedGroups(owner.id, 101);
    await seedMemberships(groups.slice(0, 100), requester.id, 'member', 'pending');
    let body = await mine(requester);
    expect(body.requests.items).toHaveLength(100);
    expect(body.requests.truncated).toBe(false);

    await seedMemberships(groups.slice(100), requester.id, 'member', 'pending');
    body = await mine(requester);
    expect(body.requests.items).toHaveLength(100);
    expect(body.requests.truncated).toBe(true);
  });
});
