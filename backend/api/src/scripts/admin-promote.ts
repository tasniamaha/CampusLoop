/**
 * npm run admin:promote -- <email>
 *
 * Promotes an existing, verified, active account to admin. This is how the first admin is created;
 * it is a command-line script only and is not reachable over HTTP. It uses the same rules, locks
 * and transaction as an admin's own role change (AdminUsersService), and writes the same audit
 * row with the system actor (actorId NULL, metadata.via = "cli").
 *
 * Safety:
 * - DB_DATABASE must be set in the environment of this command. A value that only comes from
 *   .env is not enough, so the target database is always a deliberate choice.
 * - The target host, port and database are printed before anything is changed.
 * - It refuses to run against a database with pending migrations, and never runs them itself.
 */
// Must stay the first import: it reads DB_DATABASE before data-source.ts loads .env.
import { explicitEnv } from './explicit-env.js';
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import configuredDataSource from '../database/data-source.js';
import { MIGRATIONS_GLOB } from '../database/migrations-glob.js';
import { AuditService } from '../audit/audit.service.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { AdminUsersService } from '../admin/admin-users.service.js';

const USAGE = 'Usage: npm run admin:promote -- <email>';

async function main(argv: string[]): Promise<number> {
  const args = argv.filter((arg) => arg !== '--');
  if (args.length !== 1 || !args[0].includes('@')) {
    console.error(USAGE);
    return 2;
  }
  const email = args[0];

  const explicitDatabase = explicitEnv.DB_DATABASE;
  if (!explicitDatabase) {
    console.error(
      'Refusing to run: set DB_DATABASE explicitly for this command, e.g.\n' +
        "  PowerShell:  $env:DB_DATABASE='campusloop_db'; npm run admin:promote -- user@example.com\n" +
        '  bash:        DB_DATABASE=campusloop_db npm run admin:promote -- user@example.com',
    );
    return 2;
  }

  // Same connection settings as the TypeORM CLI, but migrations resolved next to this compiled
  // file (dist/), so the pending-migrations check works from the build.
  const dataSource = new DataSource({ ...configuredDataSource.options, migrations: [MIGRATIONS_GLOB] });
  const { host, port, database } = dataSource.options as { host?: string; port?: number; database?: string };
  console.log(`About to change database "${database}" on ${host}:${port}`);
  if (database !== explicitDatabase) {
    console.error(`Refusing to run: resolved database "${database}" differs from DB_DATABASE "${explicitDatabase}".`);
    return 2;
  }

  await dataSource.initialize();
  try {
    if (await dataSource.showMigrations()) {
      console.error('Refusing to run: this database has pending migrations. Run them first (npm run migration:run).');
      return 2;
    }
    const audit = new AuditService();
    const service = new AdminUsersService(dataSource, audit, new RefreshTokenService(dataSource, audit));
    const user = await service.promoteBySystem(email);
    console.log(`Promoted ${user.email} (${user.id}) to admin. Audited as user.role_changed by the system actor.`);
    return 0;
  } catch (err) {
    if (err instanceof HttpException) {
      console.error(`Not promoted: ${err.message}`);
      return 1;
    }
    throw err;
  } finally {
    await dataSource.destroy();
  }
}

process.exitCode = await main(process.argv.slice(2));
