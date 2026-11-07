@AGENTS.md

# Frontend (Next.js App Router)

- **Read the docs first.** Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` from this directory. Don't rely on memory of older Next.js APIs.
- **Auth.**
  - Two httpOnly cookies: `campusloop_token` (short-lived access JWT) and `campusloop_refresh` (rotating refresh token).
  - `lib/session.ts` is the only place that sets, clears, refreshes or revokes these cookies. Use its exports; never write cookie logic elsewhere.
  - `proxy.ts` renews the session silently: when the access cookie is gone but a refresh cookie exists, it rotates once and passes the new cookies on. In Next.js 16, `proxy.ts` replaces `middleware.ts`, so do not add a `middleware.ts`.
  - Server code reads the user via `lib/auth.ts` (`getCurrentUser`).
  - Never expose either token to client JavaScript.
- **API calls.**
  - Browser-side calls go through the proxy at `/api/backend/[...path]`, which attaches the bearer token.
  - Do not call the NestJS API directly from client components, and do not duplicate fetch or auth logic.
- **Component model.**
  - Server Components by default.
  - Use `'use client'` only for interactivity or browser APIs (forms, QR scanner, notification bell).
- **States.**
  - Every data view handles loading, empty, error and unauthorised states.
  - Validate forms on the client for usability. The server remains the authority.
- **Authorization display.** UI permission checks are cosmetic. Never treat them as authorization.
- **Accessibility.** Pages must be keyboard-operable and have labelled form controls.
- **Verify.** Run `npm run lint` and `npm run build` before reporting.
