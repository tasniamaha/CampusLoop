import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/entities/audit-log.entity.js';
import { AuditService } from '../src/audit/audit.service.js';
import { User } from '../src/users/entities/user.entity.js';
import { cleanupUsers, createTestDataSource, seedUser } from './helpers/test-db.js';

let ds: DataSource;
const audit = new AuditService();

beforeAll(async () => {
  ds = await createTestDataSource();
}, 60_000);

afterAll(async () => {
  await cleanupUsers(ds); // works only because actorId is not a foreign key
  await ds?.destroy();
});

// Audit rows are permanent by design, so this suite must only run against a throwaway
// test database. test/guard-test-db.ts already refuses anything not ending in "_test".
async function writeOne(action: string) {
  const { user } = await seedUser(ds);
  await audit.record(ds.manager, {
    actorId: user.id,
    action,
    targetType: 'test',
    targetId: user.id,
    metadata: { reason: 'e2e' },
    ipAddress: '203.0.113.5',
  });
  const row = await ds.getRepository(AuditLog).findOneByOrFail({ actorId: user.id, action });
  return { user, row };
}

describe('audit_logs (real database)', () => {
  it('stores an entry written through AuditService', async () => {
    const { row } = await writeOne('test.created');
    expect(row.metadata).toEqual({ reason: 'e2e' });
    expect(row.ipAddress).toBe('203.0.113.5');
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('is written in the caller transaction: a rolled-back action leaves no audit row', async () => {
    const { user } = await seedUser(ds);
    await expect(
      ds.transaction(async (m) => {
        await audit.record(m, { actorId: user.id, action: 'test.rolled_back', targetType: 'test' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await ds.getRepository(AuditLog).countBy({ actorId: user.id })).toBe(0);
  });

  it('rejects UPDATE', async () => {
    const { row } = await writeOne('test.update_blocked');
    await expect(ds.query('UPDATE audit_logs SET action = ? WHERE id = ?', ['tampered', row.id])).rejects.toThrow(
      /append-only/,
    );
  });

  it('rejects DELETE', async () => {
    const { row } = await writeOne('test.delete_blocked');
    await expect(ds.query('DELETE FROM audit_logs WHERE id = ?', [row.id])).rejects.toThrow(/append-only/);
  });

  it('keeps the entry after the actor is deleted', async () => {
    const { user, row } = await writeOne('test.outlives_actor');
    await ds.getRepository(User).delete(user.id); // fails here if actorId is still a foreign key
    const after = await ds.getRepository(AuditLog).findOneByOrFail({ id: row.id });
    expect(after.actorId).toBe(user.id);
  });

  it('refuses metadata keys that look like credentials', async () => {
    await expect(
      audit.record(ds.manager, { actorId: null, action: 'x', targetType: 'x', metadata: { newPassword: 'hunter2' } }),
    ).rejects.toThrow(/sensitive/);
  });
});