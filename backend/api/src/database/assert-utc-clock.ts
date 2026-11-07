import type { DataSource } from 'typeorm';

/**
 * The app reads every DATETIME as UTC (`timezone: 'Z'`), but DEFAULT CURRENT_TIMESTAMP columns are
 * written in the server's own zone. On a non-UTC server, createdAt/updatedAt, due-date reminders
 * and review windows silently shift by the offset. Refuse to start rather than corrupt data.
 *
 * Checks the session clock every pooled connection inherits from the server, so one probe is enough.
 */
export async function assertUtcDatabaseClock(dataSource: Pick<DataSource, 'query'>): Promise<void> {
  const rows = await dataSource.query<Array<{ skewMin: string | number | null }>>(
    'SELECT TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS skewMin',
  );
  const raw = rows[0]?.skewMin;
  // Number(null) is 0: without the explicit null check an unreadable clock would pass as UTC.
  const skew = raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
  if (!Number.isFinite(skew)) {
    throw new Error('Could not read the database clock to verify it runs in UTC');
  }
  if (skew !== 0) {
    throw new Error(
      `Database clock is ${skew} min off UTC; timestamps would be stored shifted. ` +
        `MySQL 8: SET PERSIST time_zone = '+00:00';  ` +
        `MariaDB/XAMPP: add default-time-zone='+00:00' under [mysqld] in my.ini and restart.`,
    );
  }
}
