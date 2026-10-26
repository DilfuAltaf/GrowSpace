# Production Deployment & Environment Verification — GrowSpace Phase 5.13

Status: deployment-readiness report and operator guide.
Scope: configuration, runtime compatibility, database cutover readiness, and verification.
No product features were added, Firebase remains removed, and no IoT integration exists.

---

## 1. Deployment topology

The repository contains two independently deployable artifacts. There is no Dockerfile, `vercel.json`,
`netlify.toml`, CI workflow, or infrastructure code, and a hosting provider is therefore **not
established by the repository**. The only host-facing file is the SPA fallback
`apps/web/public/_redirects` (`/* /index.html 200`), a Netlify/Cloudflare Pages convention. The
arrangement below is a recommendation constrained by what the code actually requires.

| Artifact | Build | Runtime requirement |
| :--- | :--- | :--- |
| Web (`@growspace/web`) | `pnpm --filter @growspace/web build` → `apps/web/dist` | Static file host or CDN with SPA fallback and HTTPS |
| API (`@growspace/api`) | `pnpm --filter @growspace/api build` → `apps/api/.next` | Node.js ≥ 22.12 (`pnpm --filter @growspace/api start`), HTTPS, env vars |

The API cannot be deployed to a static/CDN or edge-only target: it uses Node built-ins
(`node:crypto`, `node:buffer`), the native `@node-rs/argon2` binding, and route handlers that never
declare `runtime = 'edge'`.

### Recommended arrangement (single origin)

Serve the SPA and the API from **one HTTPS origin**, with `/api/*` proxied to the Next.js server:

```text
https://app.example.com/            → apps/web/dist (index.html + hashed assets)
https://app.example.com/api/*       → Next.js API (reverse proxy or platform rewrite)
```

Why this is recommended:

- `__Host-gs_session` / `__Host-gs_csrf` cookies are host-scoped with `Path=/`, `Secure`, and no
  `Domain` attribute. Same-origin requests always carry them.
- `SameSite=Lax` requires same-site requests; a single origin removes any ambiguity.
- No CORS dependency, no preflight, no third-party-cookie exposure.
- `VITE_API_BASE_URL` stays empty, so the SPA calls relative `/api` paths.

### Supported alternative (same-site subdomains)

```text
https://app.example.com   → SPA
https://api.example.com   → API
```

This works because both hosts are in the same registrable domain (`SameSite=Lax` is satisfied) and
the API's cookies are scoped to the API host. It requires:

- `ALLOWED_ORIGINS=https://app.example.com`
- `VITE_API_BASE_URL=https://api.example.com` (baked in at build time)
- CORS with credentials, which the API already emits for allowlisted origins
- The CSRF token read from the `GET /api/auth/session` / `GET /api/auth/csrf` JSON response (the
  CSRF cookie itself is not readable by the SPA on a different host)

### Not supported without code changes (different sites)

SPA and API on different registrable domains (for example a `*.vercel.app` frontend calling an
`*.onrender.com` API) are **cross-site**. `SameSite=Lax` prevents the session cookie from being sent
on those fetches, so every authenticated request would fail with `401`. Enabling this would require
changing the cookie policy to `SameSite=None; Secure` (and accepting browser third-party-cookie
restrictions), plus a cross-site CSRF strategy. That change was intentionally not made.

### SPA deep-link fallback (required)

The SPA uses client-side routes (`/dashboard`, `/dashboard/gardens/<id>`, `/plants/<slug>`,
`/auth/verify-email`, ...). The build already emits `apps/web/dist/_redirects` containing
`/* /index.html 200`, which gives deep-link fallback on Netlify-style static hosts (including
Cloudflare Pages). On every other host, configure the equivalent. In all cases:

1. Serve existing files from `apps/web/dist/assets/*` directly, with long-lived immutable caching.
2. Return `/index.html` with status `200` (not `302`) for unmatched paths so React Router can route.
3. Serve `index.html` with `Cache-Control: no-cache` so deploys take effect immediately.
4. Send HSTS at the web origin; the API sends HSTS only for its own responses.
5. Keep `/api/*` out of the SPA catch-all. The shipped `_redirects` catch-all would otherwise shadow
   a same-origin API; place the API proxy/rewrite rule before it (or route `/api` at the reverse
   proxy).

Without the fallback, deep links return 404 at the host even though the app works from `/`.

---

## 2. Production environment variables (names only)

Never commit values. Only the `VITE_*` variable is embedded in the browser bundle.

### API server (server-side only)

| Variable | Required | Consumer / effect |
| :--- | :--- | :--- |
| `DATABASE_URL` | Yes | Neon PostgreSQL pooled connection string (`@neondatabase/serverless` HTTP driver, `apps/api/src/lib/db.ts`). Runtime traffic only. |
| `ALLOWED_ORIGINS` | Yes in production | Comma-separated **bare origins** for CORS and CSRF Origin validation (`lib/env.ts`, `proxy.ts`, `lib/auth/csrf.ts`). Production fails closed (503) when unset or malformed; a trailing slash is normalized, a path is rejected. |
| `APP_ORIGIN` | Yes in production | Canonical SPA origin used to build verification/password-reset links (`lib/auth/url.ts`). Must be `https://` and exact. |
| `RATE_LIMIT_SECRET` | Yes for auth | HMAC key for database-backed auth rate limiting; ≥ 32 characters. Missing or short → login/register/reset fail closed. |
| `EMAIL_PROVIDER_API_KEY` (or `RESEND_API_KEY`) | Yes for real users | Resend transactional email for verification and password reset (`lib/auth/mailer.ts`). Without it the API silently uses an in-memory mock mailer: no email is delivered. Health exposes `authConfigured.emailDelivery`. |
| `EMAIL_FROM` | Optional | Verified sender identity for Resend. |
| `GROQ_API_KEY` | Optional | AI plant research and assistant generation. Absent → assistant uses its deterministic fallback; research reports insufficient evidence. |
| `GROQ_MODEL` | Optional | Defaults to `llama-3.3-70b-versatile`. |
| `TAVILY_API_KEY` | Optional | Web research provider (recommended). |
| `BRAVE_SEARCH_API_KEY` | Optional | Alternative search provider. |
| `SEARCH_PROVIDER` | Optional | `tavily` or `brave`; otherwise auto-detected. |
| `TRUST_PROXY` | Conditional | Set `true`/`1` only behind a trusted reverse proxy so `X-Forwarded-For` is used for IP rate limiting (`lib/auth/ip.ts`). If unset behind a proxy, all clients appear as `127.0.0.1` and share the IP login limit. |
| `PORT` | Host-provided | `pnpm --filter @growspace/api start` now honors `PORT` (default 3001). |
| `NODE_ENV` | Yes | `production` enables `__Host-` cookie names, `Secure` cookies, HSTS, and the HTTPS requirement for `APP_ORIGIN`. |

`DATABASE_URL` must be the **pooled** (`-pooler`) string for the serverless HTTP driver. The
migration runner should use the **direct/unpooled** endpoint — see section 4.

### Web build (public)

| Variable | Required | Effect |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | Optional | Empty (default) → relative `/api` calls to the same origin. Set to the API origin for the supported subdomain split. Baked into the bundle at build time; changing it requires a rebuild. |
| `VITE_API_PROXY_TARGET` | Dev only | Vite dev-server proxy target. Ignored in production builds. |

### Build-time vs runtime

Vite reads `VITE_*` at build time in `apps/web`. Next.js reads server variables at request time,
except where a value is captured in a module constant — none of the production secrets are, so the
API can be built once and configured per environment. `ALLOWED_ORIGINS` is read per request, so a
misconfiguration is detectable by the health check/503 instead of being frozen into the bundle.

---

## 3. Security and reliability posture

| Area | Current behavior | Deployment requirement / limitation |
| :--- | :--- | :--- |
| Session cookies | Production names `__Host-gs_session` (HttpOnly) and `__Host-gs_csrf` (readable by SPA JS); `Secure`, `SameSite=Lax`, `Path=/`, no `Domain` | HTTPS only. Because of the `__Host-` rules, the cookie belongs to the API host. |
| Session lifetime | 7-day absolute expiry, 24-hour idle timeout, `last_used_at` refreshed at most every 5 minutes; logout/password reset revoke server-side | Cookie `Max-Age` matches the 7-day absolute lifetime. No sliding renewal beyond the absolute cap. |
| CSRF | State-changing requests require an allowlisted `Origin` (or `Referer`) **and** matching `X-CSRF-Token` header, CSRF cookie, and session `csrf_token_hash` | A missing/malformed allowlist fails closed. Do not disable `ALLOWED_ORIGINS`. |
| HTTPS / origin | `APP_ORIGIN` must be `https` in production; HSTS (`max-age=31536000; includeSubDomains`) is emitted on API responses | The web host must send its own HSTS; TLS terminates before both artifacts. |
| Database driver | `neon()` HTTP driver, one statement per request, no in-process pool | Serverless-instance friendly; no connection-pool exhaustion from the API. Use Neon's pooled string. |
| Auth rate limiting | Database-backed (`auth_rate_limits`, HMAC-keyed, atomic upsert) | Works across instances; adds one DB round trip per attempt. |
| AI rate limiting | In-memory `Map` per process: research 10 / 5 min / user, assistant 20 / 5 min / user | **Not distributed.** With N instances the effective limit is up to N× the configured value and resets on deploy/restart. Do not describe this as global rate limiting. Upgrading would need shared storage. |
| Request size | Proxy rejects `POST`/`PATCH`/`PUT`/`DELETE` above 256 KiB when `Content-Length` is present (413) | Chunked uploads without `Content-Length` are not rejected by this guard; the app has no file upload endpoints, and Zod caps field sizes. |
| Response size | Routes bound list sizes and pagination (`limit`/`offset`) | No global response cap; keep paging limits in place. |
| Error handling | API returns generic `internal_error` bodies; server-side logs are single-line and redact PostgreSQL URLs and `gsk_`/`tvly-`/`BSA`/`re_` credentials | Database row data or provider payloads are never returned to clients. |
| Health disclosure | `GET /api/health` returns status strings, booleans, provider name, and model name only | No secrets, connection strings, versions, or provider error text. `Cache-Control: no-store`. |
| AI provider failure | Groq assistant timeout 20 s with deterministic fallback; research timeout 15 s; Tavily failure degrades to no web evidence | AI outages degrade features but never readiness. |
| Expired-row cleanup | `sessions`, `auth_tokens`, `auth_rate_limits` are never bulk-pruned by the app | Recommend a scheduled cleanup job (e.g. daily `DELETE FROM sessions WHERE expires_at < now() - interval '30 days'`, same idea for consumed/expired tokens). Not implemented in this phase. |

### Health endpoint contract

- `GET /api/health` — public, no auth, `force-dynamic`, `no-store`.
- Runs `SELECT 1` against Neon with a 3-second cap.
- **200** `status: "ok"` when the database answers. AI providers being absent does not change this.
- **503** `status: "degraded"` when `DATABASE_URL` is missing or the probe fails, so managed hosts
  withhold traffic from an instance that cannot serve requests.
- Point the platform readiness/liveness check at `/api/health` and expect 503 while the database is
  unreachable or before migrations are applied.
- `authConfigured.emailDelivery` / `authConfigured.rateLimiting` are non-sensitive readiness flags;
  `false` means auth flows will be degraded (no mail, or failing rate limiting).

---

## 4. Database cutover readiness

Remote production is reported at migration `0006`; `0007` and `0008` are pending. The full
step-by-step operator procedure, preflight SQL, snapshot/recovery options, verification queries, and
post-migration smoke tests are in
[`docs/database/cutover-0007-0008.md`](../database/cutover-0007-0008.md). Nothing is executed
automatically by builds, tests, or startup.

Key points:

- Each migration runs in its own transaction with an advisory lock and a `_schema_migrations` record,
  so a failure rolls back only that file and can be resumed safely.
- **Run migrations against the direct (unpooled) Neon endpoint.** The runner uses a session-level
  advisory lock, which is not reliable through PgBouncer transaction pooling; runtime API queries
  should keep using the pooled endpoint.
- Take a snapshot branch (`pre-0007-0008-snapshot`) before applying; Neon point-in-time restore is
  the second recovery layer. Restoring a branch does not repoint traffic by itself.
- Verify with `node scripts/run-migration.mjs --url "$PROD_DATABASE_URL" --verify` and then
  `--verify-only`. Postflight now validates the post-0008 inventory: 16 application tables,
  26 foreign keys, 7 unique constraints, 75 check constraints, and 8 partial indexes.

The runner previously asserted pre-0007 counts (15 FKs / 51 checks), which would have reported a
false failure *after* successfully applying `0007` and `0008`. That is fixed and covered by the
PGlite regression suite.

---

## 5. Files and configuration changed in this phase

| File | Change |
| :--- | :--- |
| `apps/api/src/lib/env.ts` | Added production-safe `getAllowedOrigins()` (bare-origin validation, trailing-slash normalization, dev-only default, production fail-closed) and non-secret readiness helpers. |
| `apps/api/src/lib/auth/csrf.ts` | Reads the allowlist through `getAllowedOrigins()`. |
| `apps/api/src/proxy.ts` | Rejects non-allowlisted origins (403), fails closed on bad origin config (503), rejects bodies over 256 KiB (413), adds HSTS in production, `Vary: Origin`, preflight max-age. |
| `apps/api/src/proxy.test.ts` | New regression tests for CORS, origin rejection, normalization, body limit, misconfiguration, HSTS. |
| `apps/api/src/lib/health.ts` | New injectable, timeout-bounded Neon readiness probe. |
| `apps/api/src/app/api/health/route.ts` | Readiness 200/503 contract, `no-store`, `authConfigured` flags, unchanged non-sensitive AI indicators. |
| `apps/api/src/app/api/health/health.test.ts` | New tests for readiness states and zero secret disclosure. |
| `apps/api/src/lib/api-error.ts` | Log redaction for connection strings and provider keys. |
| `apps/api/src/lib/api-error.test.ts` | New tests for error envelopes and redaction. |
| `apps/api/src/lib/env.test.ts` | New tests for origin parsing/fail-closed behavior and readiness helpers. |
| `apps/api/src/app/api/dual-auth.test.ts` | Health assertion updated to the async readiness contract with an injected probe. |
| `apps/api/src/proxy.test.ts`, `health.test.ts`, `api-error.test.ts` | Added to the API test script. |
| `apps/api/scripts/run-next.mjs` | `start` honors `PORT`; dev port unchanged. |
| `apps/api/package.json` | `start` no longer hardcodes `-p 3001`; new tests wired in. |
| `apps/api/next.config.ts` | `serverExternalPackages: ['@node-rs/argon2']` for the native binding. |
| `scripts/lib/migration-runner.mjs` | Post-0008 constraint inventory (26/7/75), 8 verified partial indexes, five column-specific SET NULL FKs, dynamic history log. |
| `scripts/test/real-db-integration.test.mjs` | Updated to all 8 migrations/17 tables, portable PGlite resolution, full postflight assertions. |
| `package.json` | New `test:migrations`; `test` now runs the isolated-database migration suite. |
| `apps/api/.env.example`, `apps/web/.env.example` | Documented required production variables and same-origin expectations (names only). |
| `README.md`, `migrations/README.md` | Deployment/cutover links and updated migration list. |
| `docs/database/production-cutover.md` | Marked as the historical Phase 4 runbook. |
| `docs/deployment/production.md`, `docs/database/cutover-0007-0008.md` | New deployment report and operator runbook. |

No secrets, credentials, provider keys, or connection strings were added, read into documentation, or
committed.

---

## 6. Verification results

| Check | Command | Result |
| :--- | :--- | :--- |
| Workspace tests | `pnpm test` | **Pass** (exit 0), including the 22-test migration suite |
| Migration suite (isolated PostgreSQL engine) | `pnpm test:migrations` | **Pass** — 22/22 |
| Typecheck | `pnpm typecheck` | **Pass** (shared, web, API) |
| Lint | `pnpm lint` | **Pass** (exit 0) |
| Production build | `pnpm build` | **Pass** — Vite `dist` + Next.js 16 production build |
| Production-mode API smoke | built `next start` on `PORT=3101` | **Pass** — see below |
| Production-mode SPA smoke | `vite preview` on the built `dist` | **Pass** — `/` and `/dashboard/gardens/abc` return 200 `text/html` with `#root`; hashed asset served |
| Remote Neon migrations 0007/0008 | Operator runbook | **Pending — not executed** |
| Remote DB-connected health check | Deployed URL | **Pending — no deployed URL or credentials available** |
| Deployed auth round trip (cookies/CSRF) | Deployed URL | **Pending — no deployed URL available** |

Production-mode API smoke details (built output, `NODE_ENV=production`, `PORT=3101`, `DATABASE_URL`
pointed at an unreachable local endpoint so no remote data was touched):

- `GET /api/health` → `503` `{"status":"degraded","database":"unreachable",...}` with
  `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, and
  `Cache-Control: no-store`; no credential or provider value in the body.
- `OPTIONS` from the allowlisted origin → `204` with `Access-Control-Allow-Origin`,
  `Allow-Credentials: true`, `Allow-Methods`, `Allow-Headers: ... X-CSRF-Token`.
- `GET` from a non-allowlisted origin → `403` with no CORS headers.
- 300 KB `POST` body → `413` `payload_too_large`.
- A second instance started without `ALLOWED_ORIGINS` → `503 service_misconfigured` on every
  `/api/*` request and a single clear server log line, demonstrating fail-closed behavior.
- The API bound to the host-assigned `PORT` (3101), confirming the new start-script behavior.

### Locally verified vs remotely verified

- **Locally verified:** unit/integration behavior of origin enforcement, body limits, health
  readiness, error redaction, cookie/CSRF/session logic (via the existing PGlite-backed auth and
  dual-auth suites), all eight migrations applied from scratch in an isolated real PostgreSQL engine,
  post-0008 catalog parity, idempotent re-run, drift/out-of-order halt, rollback on failure, the
  production builds, production-mode startup on an assigned port, and the SPA deep-link fallback in
  the built bundle.
- **Not verified remotely:** actual Neon state at `0006`, the 0007/0008 cutover, deployed CORS/cookie
  behavior, TLS/HSTS at the edge, and provider credentials. These need deployed URLs and production
  credentials, which were not available; they are marked pending rather than assumed.

---

## 7. Remaining production blockers

1. **No hosting provider selected / no deployment configuration exists.** A Node 22 target for the
   API and a static host with SPA fallback for the web must be chosen and configured.
2. **Migrations 0007 and 0008 are not applied remotely.** The application must not be released ahead
   of the schema: schedule/assistant endpoints will fail until the tables exist.
3. **`EMAIL_PROVIDER_API_KEY`/`RESEND_API_KEY` is required for real users.** Without it registration
   and password reset return success-shaped responses but send no email (mock mailer), and every new
   account stays unverified.
4. **`ALLOWED_ORIGINS` and `APP_ORIGIN` must be set to the final HTTPS origin(s).** Production now
   fails closed rather than trusting a localhost default.
5. **`RATE_LIMIT_SECRET` must be set (≥ 32 characters).** Auth endpoints fail closed without it.
6. **`TRUST_PROXY=true` required behind the chosen proxy**, otherwise IP-based login limiting sees
   `127.0.0.1` for every client.
7. **AI rate limits remain per-instance.** Acceptable for a single instance; needs shared storage for
   multi-instance enforcement.
8. **No scheduled cleanup of expired sessions/tokens/rate-limit rows.** Operational housekeeping.

---

## 8. Operator checklist

1. [ ] Choose the topology (single origin recommended; same-site subdomains acceptable) and provision
       HTTPS for both the web host and the API.
2. [ ] Configure the web build: `VITE_API_BASE_URL` (empty for single origin). Build and deploy
       `apps/web/dist` with an SPA fallback to `index.html`, `/api/*` excluded, `index.html`
       uncached and hashed assets immutable.
3. [ ] Configure the API runtime: `NODE_ENV=production`, `DATABASE_URL` (pooled),
       `ALLOWED_ORIGINS`, `APP_ORIGIN`, `RATE_LIMIT_SECRET`, `EMAIL_PROVIDER_API_KEY`,
       `EMAIL_FROM`, `TRUST_PROXY`, optional `GROQ_*`/`TAVILY_*`. Do not expose any of these to the
       browser; only `VITE_API_BASE_URL` is public.
4. [ ] Build and start the API (`pnpm --filter @growspace/api build && pnpm --filter @growspace/api start`),
       confirming it binds to the host-provided `PORT`.
5. [ ] Before migrations, expect `GET /api/health` to return 503 `degraded` only if the DB is
       unreachable; with a reachable DB and schema at 0006 it returns 200 `ok` (health does not check
       migration state).
6. [ ] Run the cutover in `docs/database/cutover-0007-0008.md`: preflight ledger (0001–0006,
       14 public tables) → checksum check → optional dry-run branch → snapshot branch → apply
       with the runner → `--verify-only` → smoke tests for schedules and assistant persistence.
7. [ ] Confirm `/api/health` returns 200 and `authConfigured.emailDelivery` / `rateLimiting` are
       `true`.
8. [ ] Exercise a disposable-account flow end to end on the deployed origin: login (cookie set,
       `__Host-` names), CSRF-protected mutation, garden/plant/task creation, schedule creation and
       completion, assistant conversation create/read/delete, logout.
9. [ ] Confirm the platform health check points at `/api/health`, logs are collected, and a
       scheduled cleanup job for expired sessions/tokens is in place.
