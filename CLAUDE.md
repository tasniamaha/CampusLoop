# CampusLoop

Campus resource sharing, lost & found and study-group platform. This is a monorepo with an existing codebase. Extend it; do not re-scaffold it.

## Requirements

`project.md` holds the product requirements: roles, workflows, invariants, matching spec, acceptance criteria and open decisions.

- **Before any feature work,** read the relevant section of `project.md`.
- **If it is silent or lists the point under "Open decisions",** ask. Do not invent business rules.
- Refer to project.md open decisions by name, not number.
- **Never edit `project.md` without being asked.**

## Layout

- `backend/api/`: NestJS 12 API, the only writer to the database. Has its own `CLAUDE.md`.
- `frontend/web/`: Next.js 16 App Router app plus a backend proxy. Has its own `CLAUDE.md`.
- `.github/workflows/ci.yml`: CI. It runs backend e2e tests against MySQL 8.4 and Redis.

Inspect the actual files before assuming where something lives.

## Commands

| Where | Command |
|---|---|
| `backend/api` | `npm run start:dev` · `npm run build` · `npm run lint` · `npm run format` · `npm test` · `npm run test:e2e` |
| `frontend/web` | `npm run dev` · `npm run lint` · `npm run build` |
| Test DB + Redis | `docker compose -f backend/api/docker-compose.test.yml up -d` (MySQL on 3317, Redis on 6390) |

Node 24 (see `.nvmrc`), the same version CI uses.

**e2e on Windows:** from `backend/api`, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e.ps1 [spec files]`. It targets `campusloop_test` on port 3317, runs migrations first and exits non-zero on any failure. Plain `npm run test:e2e` needs `DB_*` pointing at a migrated `*_test` database, and it does not run migrations. See `backend/api/README.md`.

Environment: copy `backend/api/.env.example` to `backend/api/.env` and `frontend/web/.env.example` to `frontend/web/.env.local`. The API refuses to boot unless the MySQL server clock runs in UTC.

## Non-negotiables

1. **Database engine.** `project.md` specifies MySQL 8 and CI runs MySQL 8.4, but the TypeORM config uses `type: 'mariadb'`. Do not change the engine, driver or DataSource type without asking.
2. **Migrations.**
   - Schema changes go through new migrations only, and every migration needs a working `down()`.
   - Never edit a migration that has already been committed.
   - Never enable `synchronize`.
   - The API runs pending migrations on boot (`migrationsRun: true`). Starting the app against a database migrates it, so check which database the environment points at first.
3. **Invariants.** The invariants in `project.md` §6 are enforced in the database layer: a transaction plus a `pessimistic_write` lock or a conditional update. Application checks or UI checks alone are not enough.
4. **Ownership.** Never trust a client-supplied user ID or ownership field. Authorise in the service layer against the authenticated user.
5. **Secrets.** Never hardcode secrets or commit `.env` files. Never return password hashes, token hashes or stack traces.
6. **Dependencies.** Do not add a dependency without saying why the existing stack can't do the job.
7. **Destructive commands.** No destructive database or git commands without explicit approval: no drop, truncate, reset, force-push or discarding uncommitted work.

## How to work

1. **Inspect.** Read the relevant code, entities, DTOs, guards, migrations and tests. Check whether the feature already partly exists.
2. **Plan.** For anything larger than a small fix, post a short plan (files to touch, schema changes, risks) before editing.
3. **Implement.** Make minimal, targeted changes in the existing style. Avoid unrelated refactors or reformatting, and do not change API contracts without a requirement.
4. **Verify.** Run build, lint and tests for every package you touched.
   - Add tests for new behaviour: success, invalid input, unauthorised access, wrong owner, duplicates and state transitions.
   - Add concurrency tests where an invariant is involved.
   - If MySQL or Redis is unavailable, say so. Never report unexecuted tests as passing.
5. **Report.** Cover:
   - What changed.
   - Files created or modified.
   - Migrations.
   - Commands run and their results.
   - What is untested.

## Git

- **Work on `main`.** No feature branches. Before starting, run `git switch main` and `git pull`.
- Check `git status` before substantial changes.
- **Commits.** One commit per logical change, with the prefixes `feat:`, `fix:`, `refactor:`, `test:`, `docs:` or `chore:`.
- **The user runs all git writes.** Never run `git add`, `git commit`, `git push`, `git reset` or `git stash`. When a change is ready:
  1. Show the diff summary (files and line counts).
  2. Below it, give the exact commands in a PowerShell-ready code block: `git add` with each file listed explicitly (never `git add .` or `-A`), then `git commit` with one `-m` per paragraph.
  3. After the user says they've committed, run `git log --oneline -1` and `git status` to confirm, then continue.
- **No attribution.** Never add a `Co-Authored-By` line or any other AI attribution to commit messages.
- **Before any push,** run all of these and never push if any fail:
  - Backend: `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e` (against the test containers; on Windows use `scripts/e2e.ps1`).
  - Frontend: `npm run lint`, `npm run build`.
- **Pushing.** Push only when asked. Never force-push to `main`. To undo a pushed commit, use `git revert`, never `reset`.
