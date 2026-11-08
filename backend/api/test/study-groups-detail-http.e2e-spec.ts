import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { StudyGroupMemberStatus } from '../src/study-groups/entities/study-group-member.entity.js';
import { StudyGroupsTestApp, type Actor } from './helpers/study-groups-app.js';

// GET /study-groups/:id and GET /study-groups/:id/members over the real HTTP stack and MySQL.
// Open group: anyone on the campus sees it; the member list is creator + active members only (403).
// Archived group: only creator + active members see it or its members; everyone else gets 404.

const t = new StudyGroupsTestApp('sgd', '198.51.103');

let creator: Actor; // owns both groups
let member: Actor; // active in both
let pending: Actor; // pending in both
let rejected: Actor; // rejected in both
let outsider: Actor; // same campus, no membership
let elsewhere: Actor; // another campus
let openGroup: { id: string };
let archivedGroup: { id: string };

async function requestAndReview(groupId: string) {
  const m = await t.service.join(groupId, member.id);
  await t.service.review(groupId, m.id, creator.id, StudyGroupMemberStatus.ACTIVE);
  await t.service.join(groupId, pending.id);
  const r = await t.service.join(groupId, rejected.id);
  await t.service.review(groupId, r.id, creator.id, StudyGroupMemberStatus.REJECTED);
}

beforeAll(async () => {
  await t.start();
  creator = await t.makeUser('creator');
  member = await t.makeUser('member');
  pending = await t.makeUser('pending');
  rejected = await t.makeUser('rejected');
  outsider = await t.makeUser('outsider');
  elsewhere = await t.makeUser('elsewhere', { campus: `sgd-other-${t.run}` });

  openGroup = await t.createGroup(creator, { title: 'Open revision group', participantLimit: 4 });
  archivedGroup = await t.createGroup(creator, { title: 'Archived revision group' });
  await requestAndReview(openGroup.id);
  await requestAndReview(archivedGroup.id);
  await t.service.archive(archivedGroup.id, creator.id);
}, 90_000);

afterAll(() => t.stop());

const getGroup = (id: string, who?: Actor) => t.as('get', `/study-groups/${id}`, who);
const getMembers = (id: string, who?: Actor) => t.as('get', `/study-groups/${id}/members`, who);

describe('GET /study-groups/:id', () => {
  it('not logged in: 401', async () => {
    await getGroup(openGroup.id).expect(401);
  });

  it('malformed id: 400; unknown id: 404', async () => {
    await getGroup('not-a-uuid', outsider).expect(400);
    await getGroup(randomUUID(), outsider).expect(404);
  });

  it('open group: anyone on the campus sees details, count vs limit and their own status', async () => {
    const res = await getGroup(openGroup.id, outsider).expect(200);
    expect(res.body).toMatchObject({
      id: openGroup.id,
      title: 'Open revision group',
      courseCode: 'CSE220',
      topic: 'Graphs',
      schedule: 'Tue 3-4 PM, Library',
      participantLimit: 4,
      memberCount: 2, // creator + the approved member; pending and rejected don't count
      status: 'open',
      isCreator: false,
      myMembershipStatus: null,
    });
    expect((await getGroup(openGroup.id, creator).expect(200)).body).toMatchObject({ isCreator: true, myMembershipStatus: 'active' });
    expect((await getGroup(openGroup.id, member).expect(200)).body.myMembershipStatus).toBe('active');
    expect((await getGroup(openGroup.id, pending).expect(200)).body.myMembershipStatus).toBe('pending');
    expect((await getGroup(openGroup.id, rejected).expect(200)).body.myMembershipStatus).toBe('rejected');
  });

  it('open group on another campus: 404', async () => {
    await getGroup(openGroup.id, elsewhere).expect(404);
  });

  it('archived group: creator and active members see it', async () => {
    expect((await getGroup(archivedGroup.id, creator).expect(200)).body).toMatchObject({ status: 'archived', isCreator: true });
    expect((await getGroup(archivedGroup.id, member).expect(200)).body).toMatchObject({ status: 'archived', myMembershipStatus: 'active' });
  });

  it('archived group: pending, rejected, outsiders and other campuses get 404', async () => {
    for (const who of [pending, rejected, outsider, elsewhere]) {
      await getGroup(archivedGroup.id, who).expect(404);
    }
  });

  it('does not leak account fields', async () => {
    const body = JSON.stringify((await getGroup(openGroup.id, outsider).expect(200)).body);
    expect(body).not.toMatch(/password|token|hash/i);
    expect(body).not.toContain(creator.email);
  });
});

describe('GET /study-groups/:id/members', () => {
  it('not logged in: 401', async () => {
    await getMembers(openGroup.id).expect(401);
  });

  it('open group: creator and active members get the list', async () => {
    for (const who of [creator, member]) {
      const res = await getMembers(openGroup.id, who).expect(200);
      expect(res.body.map((m: { name: string; role: string }) => [m.name, m.role])).toEqual([
        ['sgd-creator', 'owner'],
        ['sgd-member', 'member'],
      ]);
    }
  });

  it('open group: non-members on the campus get 403; other campuses 404', async () => {
    for (const who of [pending, rejected, outsider]) {
      await getMembers(openGroup.id, who).expect(403);
    }
    await getMembers(openGroup.id, elsewhere).expect(404);
  });

  it('archived group: creator and active members get the list', async () => {
    for (const who of [creator, member]) {
      expect((await getMembers(archivedGroup.id, who).expect(200)).body).toHaveLength(2);
    }
  });

  it('archived group: outsiders get 404, same as the group page', async () => {
    for (const who of [pending, rejected, outsider, elsewhere]) {
      await getMembers(archivedGroup.id, who).expect(404);
    }
  });

  it('returns display fields only: no ids, emails, password or token fields', async () => {
    const res = await getMembers(openGroup.id, member).expect(200);
    for (const item of res.body as Record<string, unknown>[]) {
      expect(Object.keys(item).sort()).toEqual(['joinedAt', 'name', 'role']);
    }
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/email|password|token|hash/i);
    for (const who of [creator, member]) {
      expect(body).not.toContain(who.email);
      expect(body).not.toContain(who.id);
    }
  });
});
