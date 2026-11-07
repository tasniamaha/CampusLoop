# Backend (NestJS API)

## Module system and tooling

- **ESM package** (`"type": "module"`, `nodenext`). Relative imports must end in `.js`, for example `import { X } from './x.service.js'`.
- **Tooling:**
  - Tests use Vitest, not Jest.
  - Lint uses oxlint (`--type-aware`), not ESLint.
  - TypeScript 6 in strict mode.
- **No `any`** unless justified in a comment.

## Conventions to follow

- **Validation.**
  - A global `ValidationPipe` runs with `whitelist`, `forbidNonWhitelisted` and `transform`.
  - Every input gets a class-validator DTO.
  - Do not introduce Zod or Standard Schema validators alongside it.
- **Auth.** These guards are global (`app.module.ts`): `JwtAuthGuard`, `ThrottlerGuard`, `VerifiedEmailGuard` and `RolesGuard`.
  - Routes are authenticated by default. Opt out with `@Public()`.
  - Use `@Roles(UserRole.X)` for role checks and `@RequireVerifiedEmail()` where verification is required.
  - Do not write new guards for these concerns.
- **Rate limits.** Named throttlers are defined in `app.module.ts` (login, mail). Reuse them; don't create parallel limiters.
- **Transactions.**
  - Multi-write operations use `dataSource.transaction(...)`.
  - Lock the contended row with `lock: { mode: 'pessimistic_write' }`.
  - Pass the **same** `EntityManager` to every write in that transaction.
- **Loan history.**
  - Record every borrow status change with `recordLoanEvent(manager, ...)` inside the same transaction.
  - `OCCUPYING_STATUSES` must stay in sync with the generated column in the migration.
- **Background jobs (BullMQ).**
  - Give every job a deterministic `jobId` derived from its subject (for example `email-<notificationId>`, `reminder-<requestId>-<kind>`), so retries and duplicate calls never queue it twice.
  - Enqueue only after the DB transaction commits: call the notification service after `await dataSource.transaction(...)` returns, never inside the callback. A rolled-back transaction must not produce a notification (`project.md` §4.6).
- **Audit logging.** Record the events required by `project.md` §8 (auth events, role changes, moderation actions, dispute resolution) with `AuditService.record(manager, entry)`: inside the same transaction when the action has one; otherwise record directly (e.g. failed logins), passing `dataSource.manager`.
- **DB errors.** Use the helpers in `src/common/db-errors.ts` (for example `isDuplicateEntry`) and map them to proper HTTP errors. Never leak driver messages.
- **Swagger.**
  - Document new endpoints and DTOs.
  - In dev, the app regenerates `docs/openapi.json`. Commit it whenever the contract changes.

## Migrations

- Location: `src/database/migrations/`, with a timestamp-prefixed class name.
- Review the generated SQL by hand.
- Keep it compatible with MySQL 8.4 (CI) and with the configured DataSource.
- Run with `npm run migration:run` and revert with `npm run migration:revert`, only after confirming which database `.env` points at.

## Tests

- **Unit tests:** `*.spec.ts` next to the source.
- **E2E tests:** `test/*.e2e-spec.ts`, run serially against a real MySQL instance and Redis.
- **Safety guard.** `test/guard-test-db.ts` refuses databases whose name doesn't end in `_test`, and any non-local host. Some specs drop the schema, so never weaken this guard.
- **Real DB for invariants.** Concurrency and invariant tests must hit the real database, not mocks.
- **CI wiring.** CI lists e2e specs one by one. When you add a new `*.e2e-spec.ts`, add a step for it in `.github/workflows/ci.yml`, or it will never run in CI.
