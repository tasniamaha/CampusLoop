import 'dotenv/config';
// Refuses to run DB-touching e2e tests against anything that is not clearly a test database.
// borrow-concurrency.e2e-spec.ts uses dropSchema: true, so pointing it at a real DB would wipe it.
const names = { DB_DATABASE: process.env.DB_DATABASE, TEST_DB_NAME: process.env.TEST_DB_NAME };

for (const [key, value] of Object.entries(names)) {
  if (value && !/_test$/.test(value)) {
    throw new Error(
      `Refusing to run e2e tests: ${key}="${value}" does not end with "_test". ` +
        `Point it at a throwaway test database (e.g. campusloop_test).`,
    );
  }
}
const host = process.env.TEST_DB_HOST ?? '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error(`Refusing to run e2e tests against non-local DB host "${host}"`);
}
// Tests must never send real mail (bounces from example.com addresses reach the real Gmail account).
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.NOTIFICATIONS_QUEUE_ENABLED ??= 'false';