import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { User, UserRole } from '../../src/users/entities/user.entity.js';
import { VerificationToken } from '../../src/verification/entities/verification-token.entity.js';
import { MIGRATIONS_GLOB } from '../../src/database/migrations-glob.js';
import { AuditLog } from '../../src/audit/entities/audit-log.entity.js';
import { Notification } from '../../src/notifications/entities/notification.entity.js';
import { RefreshToken } from '../../src/auth/entities/refresh-token.entity.js';
const createdUserIds: string[] = [];
export const rand = () => Math.random().toString(36).slice(2, 10);

export async function createTestDataSource(): Promise<DataSource> {
  const ds = new DataSource({
    type: 'mariadb',
    host: process.env.TEST_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_DB_PORT ?? 3317),
    username: process.env.TEST_DB_USER ?? 'root',
    password: process.env.TEST_DB_PASSWORD ?? 'root',
    database: process.env.TEST_DB_NAME ?? 'campusloop_test',
    entities: [User, VerificationToken, AuditLog, Notification, RefreshToken],
    migrations: [MIGRATIONS_GLOB],
  });
  await ds.initialize();
  await ds.runMigrations(); // no-op when the migration step already ran
  return ds;
}

export async function seedUser(
  ds: DataSource,
  opts: { password?: string; verifiedAt?: Date | null; email?: string } = {},
) {
  const repo = ds.getRepository(User);
  const password = opts.password ?? 'old-password-123';
  const user = await repo.save(
    repo.create({
      name: 'Reset Test',
      email: opts.email ?? `reset-${rand()}@example.com`,
      passwordHash: await bcrypt.hash(password, 4), // cheap on purpose: only the code under test needs cost 12
      role: UserRole.STUDENT,
      campus: 'test',
      emailVerifiedAt: opts.verifiedAt ?? null,
    }),
  );
  createdUserIds.push(user.id);
  return { user, password };
}

export function passwordHashOf(ds: DataSource, id: string) {
  return ds
    .getRepository(User)
    .createQueryBuilder('u')
    .addSelect('u.passwordHash')
    .where('u.id = :id', { id })
    .getOneOrFail();
}

export async function cleanupUsers(ds: DataSource) {
  if (createdUserIds.length) await ds.getRepository(User).delete(createdUserIds); // tokens cascade
}