# GrowSpace

**Grow Smarter. Grow Naturally.**

GrowSpace is a responsive web platform for managing small gardens, tracking plants, recording environmental readings, reviewing trends, and following care tasks. This repository implements the product specification in `GrowSpace_Documentation_11_Files/GrowSpace_Docs` using a **React + Vite frontend**, a **Next.js API backend**, and **Neon PostgreSQL**.

> **Architecture Status:** Full Firebase retirement complete (Phase 4.9). Authentication is 100% first-party using Argon2id password hashing and opaque server-side session cookies validated against Neon PostgreSQL. Cloud Firestore has been decommissioned in favor of relational PostgreSQL schemas. See [`docs/auth/phase-4.9a-firebase-retirement-plan.md`](docs/auth/phase-4.9a-firebase-retirement-plan.md) and [`docs/implementation-status.md`](docs/implementation-status.md).

## Stack

| Layer | Technology |
| --- | --- |
| Web | React 19, Vite 8, TypeScript, React Router 7, Tailwind CSS 4, Lucide icons |
| API | Next.js 16 App Router (API routes only) |
| Auth | GrowSpace First-Party Authentication (Argon2id, server-side sessions, HttpOnly cookies, double-submit CSRF) |
| Data | Neon PostgreSQL (15+) with pooled connection strings |
| Shared domain | TypeScript types, Zod validation, plant catalog, recommendation rules, formatters |
| Tests | Node.js Test Runner + PGlite in-memory PostgreSQL (`@growspace/api`, `@growspace/web`), Vitest (`@growspace/shared`) |
| Tooling | pnpm workspaces, ESLint 10, TypeScript 6 |

## Workspace layout

```text
GrowSpace/
  apps/
    web/                    React + Vite application
      src/
        components/         UI, layout, shared presentation
        features/auth/      First-party auth context, client, and route protection
        lib/                API client and utilities
        pages/              Public, auth, and dashboard routes
    api/                    Next.js API backend
      src/
        app/api/            Health, catalog, me, and /api/auth/* endpoints
        lib/                Auth middleware, db client, session & token repositories, CSRF
        proxy.ts            CORS and baseline response headers
      scripts/              Catalog seeding and database verification
  packages/
    shared/                 Domain types, schemas, catalog, recommendations
  migrations/               PostgreSQL schema migrations (Neon)
  docs/                     Architecture, database schema, and migration documentation
```

## Prerequisites

- Node.js 22.12 or newer
- pnpm 12
- Neon PostgreSQL connection string (or local PostgreSQL 15+)

## Quick start

1. Install dependencies:

   ```powershell
   pnpm install
   ```

2. Configure environment variables:

   ```powershell
   Copy-Item apps/web/.env.example apps/web/.env.local
   Copy-Item apps/api/.env.example apps/api/.env.local
   ```

   Set `DATABASE_URL` in `apps/api/.env.local` to your Neon PostgreSQL connection string.

3. Run both applications:

   ```powershell
   pnpm dev
   ```

   - Web: http://localhost:5173
   - API: http://localhost:3001
   - Vite dev server proxies `/api` to the Next.js API backend.

4. Seed plant reference catalog into PostgreSQL:

   ```powershell
   pnpm seed:catalog
   ```

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run web and API concurrently |
| `pnpm dev:web` | Run Vite development server only |
| `pnpm dev:api` | Run Next.js API server only on port 3001 |
| `pnpm build` | Type-check and production build for all workspaces |
| `pnpm typecheck` | Strict TypeScript verification across all workspaces |
| `pnpm lint` | Run ESLint across workspace |
| `pnpm test` | Run complete unit, integration, and isolated-database migration suite |
| `pnpm test:migrations` | Run migration runner tests against disposable PostgreSQL (PGlite) |
| `pnpm db:check` | Verify database connection string and connectivity |
| `pnpm seed:catalog` | Upsert the reference plant catalog into PostgreSQL |

## API endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | Public | System health & database readiness status |
| GET | `/api/catalog?q=&category=` | Public | Botanical plant reference catalog |
| GET | `/api/catalog/[slug]` | Public | Individual plant reference by slug |
| POST | `/api/auth/register` | Public | Register new user account with Argon2id hash |
| POST | `/api/auth/login` | Public | Authenticate user & issue HttpOnly session cookie |
| POST | `/api/auth/logout` | Session | Revoke server session & clear cookies |
| GET | `/api/auth/session` | Session | Session restoration & current user details |
| GET | `/api/auth/csrf` | Public | Obtain CSRF protection token |
| POST | `/api/auth/verify-email` | Public | Verify user email with single-use token digest |
| POST | `/api/auth/resend-verification` | Public | Resend email verification link |
| POST | `/api/auth/forgot-password` | Public | Dispatch password-reset link with opaque token |
| POST | `/api/auth/reset-password` | Public | Reset password and invalidate active sessions |
| GET | `/api/me` | Session | Current authenticated user profile |

## Security Architecture

- **Opaque Server Sessions:** Session tokens are 32-byte cryptographically random values transmitted strictly via `HttpOnly`, `SameSite=Lax`, `Secure` cookies (`gs_session` / `__Host-gs_session`). Tokens are stored in PostgreSQL only as SHA-256 hashes (`token_hash`).
- **Session-Bound Double-Submit CSRF:** All state-mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) require both strict `Origin` header validation and cryptographic matching between `X-CSRF-Token` header, CSRF cookie, and the active session's `csrf_token_hash`.
- **Argon2id Password Hashing:** User passwords are never stored in plaintext and are hashed using `@node-rs/argon2` with timing attack protection.
- **Fail-Closed Authorization:** Missing, expired, revoked, or idle-timed-out (>24h) sessions reject with `401 unauthenticated`. Resource ownership checks strictly verify canonical UUID matching (`resourceUserId === user.id`).

See [`docs/auth/architecture.md`](docs/auth/architecture.md) and [`docs/auth/phase-4.9a-firebase-retirement-plan.md`](docs/auth/phase-4.9a-firebase-retirement-plan.md) for full architectural documentation.

## Production deployment

- [`docs/deployment/production.md`](docs/deployment/production.md) — recommended topology, required production environment variables (names only), health-check contract, security limitations, verification results, blockers, and the operator checklist.
- [`docs/database/cutover-0007-0008.md`](docs/database/cutover-0007-0008.md) — operator-run migration cutover for migrations `0007` and `0008`, including preflight queries, snapshot/recovery steps, postflight verification, and smoke tests.

No hosting provider is configured in this repository. The API requires a Node.js 22.12+ target; the SPA is a static Vite build that needs an SPA fallback rewrite for deep links.
