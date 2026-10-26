# Firebase-to-Neon Migration Plan — GrowSpace

Last updated: 2026-10-20

Status: planned; not executed. This document is Phase 3A design only. No schema, seed, Firebase export, user migration, deployment, or production data change has been performed.

Related documents:

- `docs/database/discovery.md` — current dependency and data inventory.
- `docs/database/schema.md` — proposed target schema.
- `docs/auth/architecture.md` — target authentication design.
- `docs/auth/firebase-exit-plan.md` — dependency removal and release gates.

## 1. Objectives

1. Replace Firebase Authentication with first-party email/password authentication backed by Neon PostgreSQL.
2. Replace Firebase UIDs with internal `users.id` UUIDs everywhere ownership is recorded.
3. Create the application schema, including `users`, `sessions`, `auth_tokens`, and `auth_rate_limits`, plus catalog and garden-domain tables.
4. Replace Firestore catalog seeding with an idempotent Neon seed.
5. Fresh start account model: GrowSpace has no existing Firebase user accounts or user data that need migration (confirmed product decision). The application starts fresh with new first-party user registrations.
6. Cut the web app and API over to sessions and PostgreSQL without accepting two authentication systems indefinitely.
7. Keep Firebase intact and restore the previous application path if verification fails.
8. Remove Firebase code, dependencies, configuration, and data only after a documented soak and explicit approval.

Non-goals:

- MFA, social login, passkeys, or SSO.
- Admin/staff roles.
- Real-time sensors.
- Recommendation-history persistence.
- UI redesign beyond auth-state wiring and removal of Firebase copy.
- Deleting Firebase data during the initial cutover.
- A zero-downtime migration for large data volumes. The current repository has no private CRUD runtime and no verified live project; a small maintenance window is acceptable.

## 2. Current and target state

| Concern | Current state | Target state |
| --- | --- | --- |
| Identity | Firebase Auth | `users.id` UUID; Argon2id password hash |
| Browser session | Firebase SDK persistence | Opaque session cookie; SHA-256 hash in `sessions` |
| API authentication | Firebase Admin bearer verification | `requireSession()` cookie validation |
| Email verification/reset | Firebase email actions | Hashed `auth_tokens` + transactional email provider |
| User ownership | Firebase UID in types/rules | `users.id` FK / composite ownership FKs |
| Plant catalog | Shared TypeScript array, optionally seeded to Firestore | `plant_catalog` + range rows seeded from shared source |
| Gardens/plants/readings/tasks/logs | Types/UI only; no private runtime CRUD | PostgreSQL-backed API routes later |
| Firestore | Rules/indexes scaffold; unused private helpers | Removed after PostgreSQL and Firebase Auth are gone |
| Firebase config/packages | Present in web, API, root | Removed after verification gates |
| Recommendations | In-memory derivation | Unchanged; derived from PostgreSQL inputs later |

## 3. Target schema and migration order

Create tables in dependency order:

1. `users`
2. `sessions`
3. `auth_tokens`
4. `auth_rate_limits`
5. `plant_catalog`
6. `plant_catalog_reference_ranges`
7. `gardens`
8. `plants`
9. `sensor_readings`
10. `care_tasks`
11. `plant_logs`

Notes:

- `sessions`, `auth_tokens`, and all private domain tables reference `users(id)`.
- `auth_rate_limits` is independent and has no user FK.
- `gardens` is the ownership parent for plants, readings, and tasks.
- `plants` carries `user_id` and `garden_id`; composite unique keys support owner-consistent child references.
- Catalog rows are global; they are not user-owned.
- Apply constraints and indexes with the initial schema on an empty database. Do not defer ownership constraints.
- Use `gen_random_uuid()`; verify extension availability before implementation. No extension should be added without review.
- Verify PostgreSQL 15+ support for `ON DELETE SET NULL (plant_id)`; otherwise approve the trigger fallback from `schema.md`.

No SQL is authored or executed in Phase 3A.

## 4. Preconditions

Complete before any schema or data operation:

1. Review and approve `docs/database/schema.md` and `docs/auth/architecture.md`.
2. Confirm the Neon project PostgreSQL version, required UUID function, and column-list `SET NULL` support.
3. Create an isolated Neon branch or verified backup as the rollback point. Record the branch identifier outside the repository; never record credentials or connection strings.
4. Use separate roles:
   - migration/DDL role used only by an operator;
   - runtime role limited to required DML/SELECT, with no DDL and no `BYPASSRLS`.
5. Confirm `DATABASE_URL` remains server-only and is never exposed through Vite or the browser bundle.
6. Record a baseline: `pnpm db:check`, typecheck, lint, tests, and build.
7. Inventory Firebase read-only:
   - Auth user count and metadata;
   - Firestore collection/document counts (including empty collections);
   - any Storage/Hosting/Functions configuration (none found in the repository);
   - current Firebase project ownership and operator access.
8. Select and configure a transactional email provider, sending domain, SPF/DKIM/DMARC, and secrets.
9. Approve these product/security decisions:
   - email verification enforcement;
   - fresh start confirmation (no legacy password migration or reset campaigns);
   - 12-character minimum;
   - session absolute/idle lifetimes;
   - registration auto-login behavior;
   - API-only authorization versus RLS;
   - account deletion/password-change scope.
10. Confirm no browser or untrusted component can reach PostgreSQL directly.
11. Freeze any write path that would write to both Firebase and Neon during the final cutover. Today there is no private runtime write path, so this is a no-op; do not add dual writes later.
12. Do not inspect, copy, or print real `.env` files, service-account JSON, database URLs, or password exports.

## 5. Migration phases

### Phase 0 — Baseline and Firebase inventory

Actions:

- Run read-only schema checks: existing tables, extensions, PostgreSQL version, and current data.
- Read Firebase Auth metadata through an authorized operator. Prefer paginated Admin SDK `listUsers` metadata (UID, email, display name, verification state, creation time, providers) over a password export.
- Inventory Firestore collections read-only. Record counts for gardens, plants, sensor readings, care tasks, plant logs, profiles, and catalog. Do not assume they are empty.
- Record catalog baseline from shared source: 12 entries, 36 reference ranges.
- Confirm which Firebase project (if any) is authoritative. Never infer production vs demo.
- Capture current auth flows and verification baseline.

Exit gate:

- Neon has no unexpected tables/data.
- Rollback branch/backup exists.
- Firebase user count, provider mix, and Firestore counts are recorded.
- Unknown/unowned Firebase projects are resolved before proceeding.
- No secret values are in the migration record.

Rollback:

- No changes made; nothing to roll back.

### Phase 1 — Schema on an isolated Neon branch

Actions:

- Apply the versioned schema from `schema.md` on a disposable branch.
- Create auth tables first, then catalog, then ownership tables.
- Create composite unique keys before child FKs.
- Add enum, length, timestamp, unit, plausibility, and task-completion checks.
- Add indexes for session lookup, revoke-all, token lookup, rate-limit cleanup, ownership, and documented query paths.
- Confirm the runtime role permissions.
- Decide and document whether RLS is enabled. If not, the API and least-privilege role are the boundary.

Verification:

- Every FK references an existing PK/unique key.
- All user-owned rows have a direct or composite path to `users.id`.
- No reading/task can reference another user's garden or plant.
- No plant can reference another user's garden.
- Deletion behavior matches `schema.md`.
- Session/token hashes are constrained to 32 bytes.
- `users.email` is normalized and unique.
- `password_hash` is null or Argon2id-prefixed.
- Catalog count/ranges match the shared source.
- Migration applies cleanly to an empty branch.
- Rollback means discarding the branch or applying a reviewed down migration if the branch has no real data.
- Insert test rows for two users and prove cross-owner inserts fail.

Exit gate:

- Schema review passes.
- Auth/schema decisions are approved.
- No application code points at the new tables yet.
- Public catalog behavior is unchanged.

Rollback:

- Discard the isolated branch. Never run destructive schema changes against a branch containing real data.

### Phase 2 — Catalog seed and parity

Actions:

- Seed `plant_catalog` from `packages/shared/src/catalog.ts` using `catalog-<slug>` IDs.
- Seed 36 reference-range rows.
- Use idempotent upserts keyed by stable IDs/slugs.
- Do not edit slugs after plants reference them.
- Keep the static catalog as the public fallback.
- Keep the old Firestore seed script until Firebase exit; do not point production at Firestore.

Verification:

- 12 catalog rows, 36 range rows.
- Slug set, names, categories, difficulty, and ranges match shared source.
- No duplicate ID/slug.
- Re-running the seed produces no duplicates.
- Each range has min ≤ max.
- Public catalog API still uses static source during this phase.

Exit gate:

- A comparison script/test reports zero drift.
- Catalog writes are restricted to a trusted operator role.

Rollback:

- Delete seed rows only if unreferenced and no real data exists; otherwise restore the branch.
- Keep the static source and Firestore data untouched.

### Phase 3 — Auth implementation and staging verification

This phase is future implementation; Phase 3A only specifies it.

Actions:

- Add Argon2id password hashing dependency and auth modules.
- Implement `users`, `sessions`, `auth_tokens`, and rate-limit repositories.
- Implement registration, login, logout, session, verify-email, resend-verification, forgot-password, and reset-password endpoints.
- Add cookie handling, CSRF, Origin checks, generic errors, and security headers.
- Replace `requireUser()`/Firebase bearer verification with `requireSession()`.
- Add email provider integration.
- Keep `/api/catalog` static until catalog read cutover.
- Do not remove Firebase yet.

Verification:

- Two-account integration tests for every endpoint.
- Session cookie flags/prefixes in production mode.
- CSRF missing/mismatched/cross-origin tests fail closed.
- Reset token single-use and session revocation.
- Verification token expiry and resend invalidation.
- Generic responses for unknown accounts and duplicate registration.
- Rate limits enforce and recover.
- No password, raw token, session cookie, or database URL in logs.
- Argon2 concurrency limit prevents CPU exhaustion.
- Email provider failure is handled without exposing account state.

Exit gate:

- Auth test suite passes in staging.
- The new auth path can run without Firebase configured.
- The web app still uses Firebase in the production configuration until the cutover phase.
- Rollback to the existing Firebase deployment is still available.

Rollback:

- Disable the unreleased auth endpoints/provider.
- Keep Firebase Auth and the old web build intact.
- Delete staging-only users/tokens.

### Phase 4 — Firebase user migration to Neon (Omitted — Fresh Start)

**Status: OMITTED (Confirmed Product Decision)**

GrowSpace has no existing Firebase user accounts that need migration. The application starts fresh with new user registrations.

Key consequences for implementation:
- Every registered account requires an email and an Argon2id `password_hash` (`NOT NULL` enforced by schema constraint `users_password_hash_format_check`).
- No temporary UID mapping table (`legacy_firebase_user_map`) is created in PostgreSQL.
- No bulk password-reset campaigns, invitation flows, or passwordless accounts are required.
- Account creation occurs exclusively through the first-party registration endpoint (`/api/auth/register`).

### Phase 5 — Firestore private-data migration (Omitted — Fresh Start)

**Status: OMITTED (Confirmed Product Decision)**

GrowSpace has no existing Firestore user or private garden data that need migration. The application begins fresh:
- The Neon PostgreSQL database starts with an empty user and garden domain state.
- Only the botanical reference catalog (`plant_catalog` and `plant_catalog_reference_ranges`) is seeded idempotently from `packages/shared/src/catalog.ts` (Phase 2).
- Users will create their own gardens, plants, readings, tasks, and logs through the new API routes.
- No Firestore document extraction, UID mapping, or data reconciliation pipelines are needed.

### Phase 6 — Web/API cutover

Because Firebase sessions cannot be transferred, this is a user-visible auth cutover. Prefer a short maintenance window over dual authentication.

```mermaid
sequenceDiagram
  participant O as Operator
  participant F as Firebase
  participant N as Neon
  participant W as Web/API
  O->>F: Freeze new registrations/writes; final metadata export
  O->>N: Final delta import + reconciliation
  O->>W: Deploy session auth; switch web provider
  W->>N: New logins/sessions
  O->>O: Smoke tests, then unfreeze registrations
  O->>F: Keep unchanged for rollback window
```

Cutover steps:

1. Announce the maintenance window and that users will need to sign in again.
2. Freeze Firebase registration and any Firebase-backed writes.
3. Run the final metadata/data delta import.
4. Verify counts, ownership, and a sample login/reset/verification in staging against the cutover build.
5. Deploy the API with session auth and the web build that no longer initializes Firebase.
6. Remove/disable the Firebase bearer acceptance path in the deployed API. Do not accept both Firebase tokens and session cookies indefinitely.
7. Set production cookies (`__Host-`, `Secure`, `HttpOnly`), exact Origin allowlist, CSP/HSTS, and email provider secrets.
8. Smoke test:
   - register a new account;
   - verify email;
   - log in/out;
   - session reload;
   - forgot/reset password;
   - cross-user denial;
   - public catalog.
9. Unfreeze registrations.
10. Monitor error rates for login, reset, verification, rate limits, email delivery, and 401/403 spikes.
11. Keep the previous Firebase deployment and data available for rollback during the agreed window.

Migration of users with no password:

- After cutover, show clear copy for returning users: “Set or reset your password.”
- The `forgot-password` flow works for `password_hash = NULL`.
- Do not auto-login these users.
- If a bulk email campaign is approved, batch it and monitor provider limits. Do not promise a token lifetime longer than the auth design without approval.

Exit gate:

- All production auth goes through Neon sessions.
- No Firebase token is required or accepted by the current API.
- New registrations work.
- Returning users can set/reset a password.
- No private route trusts a client-supplied user ID.
- Error rates are within the agreed threshold.
- Rollback remains possible.

Rollback:

- Redeploy the previous web/API build configured for Firebase.
- Keep Firebase Auth users and Firestore data intact.
- Because new users/rows may exist only in Neon after cutover, export or reconcile them before another attempt; do not silently discard them.
- Revoke new sessions if the new API remains reachable.
- Do not delete Neon tables during rollback.

### Phase 7 — Soak, verification, and Firebase decommission

Run the full checklist in section 7 for an agreed soak period (for example 7–14 days). Then follow `docs/auth/firebase-exit-plan.md` to remove Firebase in dependency order.

Actions after soak:

1. Confirm no Firebase imports, network calls, env reads, emulator scripts, or Firestore paths remain.
2. Freeze Firebase data; take a final export/backup.
3. Revoke Firebase service-account credentials.
4. Remove Firebase packages, scripts, config, rules/indexes, and env placeholders in a reviewed change.
5. Regenerate the lockfile and remove the `@firebase/util` build allowance.
6. Update README, stack mapping, implementation status, and security/testing docs.
7. Delete Firebase users/Firestore data only after the product owner explicitly approves and the retention/legal requirements are met.
8. Remove the temporary legacy UID mapping after reconciliation and rollback closure.

Exit gate:

- Repository-wide search returns zero Firebase/Firestore runtime references.
- Build, tests, typecheck, and `pnpm db:check` pass with Firebase credentials absent.
- Auth flows work in an environment with no Firebase configuration.
- No secret or credential was committed or printed.
- Product owner signs off on data deletion.

Rollback after decommission:

- Rolling back after deleting Firebase data is not possible without restoring the approved backup.
- This is why decommission is a separate, explicitly approved phase.

## 6. Data mapping rules

| Source | Target | Rule |
| --- | --- | --- |
| Firebase Auth UID | Temporary mapping only | Never a final ownership key; never cast to UUID |
| Firebase email | `users.email` | Trim + lowercase; validate; resolve duplicates before import |
| Firebase display name | `users.display_name` | Optional; reject empty/invalid; ≤ 80 |
| Firebase emailVerified | `users.email_verified_at` | Preserve verified state; do not invent verification |
| Firebase creation time | `users.created_at` | Use only when trustworthy; otherwise import time |
| Firebase password | `users.password_hash` | Default null → reset; optional legacy path separately approved |
| Firebase session/refresh token | No migration | Users sign in again |
| `temperatureUnit` default | `users.temperature_unit` | Default `celsius` unless a valid stored value exists |
| Firestore `userId` | `gardens.user_id` etc. | Map UID → UUID; must match parent owner |
| Firestore document ID | UUID PK | Preserve only if valid/non-colliding; otherwise map |
| Firestore `Timestamp` | `timestamptz` | Preserve instant |
| `YYYY-MM-DD` | `date` | Preserve calendar date |
| `catalogId` | `plant_catalog.id` | Stable `catalog-<slug>` |
| `referenceRanges` | range rows | One row per measurement |
| `simulated` / `manual` / `sensor` | `source` | Preserve exactly |
| `Recommendation` | No table | Recompute; do not migrate derived output |

## 7. Verification checklist

### Schema and integrity

- [ ] All target tables exist with intended names.
- [ ] Every FK references a PK/unique constraint.
- [ ] `users.id` is UUID; no Firebase UID ownership column remains.
- [ ] `users.email` is normalized and unique.
- [ ] `password_hash` is null or Argon2id.
- [ ] Session/token hashes are 32-byte SHA-256 values.
- [ ] Composite garden/plant ownership FKs exist.
- [ ] Enum and length checks match shared Zod limits.
- [ ] Reading unit/plausibility checks are enforced.
- [ ] `completed_at` is consistent with task status.
- [ ] Date-only fields use `date`; event fields use `timestamptz`.
- [ ] Catalog has 12 entries and 36 ranges.
- [ ] Catalog IDs/slugs are unique and deterministic.
- [ ] Deletion behavior matches `schema.md`.
- [ ] Indexes support documented queries, session/token lookup, and cleanup.

### Authentication

- [ ] Registration returns a generic response and does not disclose existing email.
- [ ] Password hashes use Argon2id with approved parameters.
- [ ] Nonexistent-user login uses dummy verification and a generic error.
- [ ] Sessions use opaque random tokens and HttpOnly cookies; no JWT/localStorage.
- [ ] Production cookie has `Secure`, `Path=/`, no `Domain`, correct prefix.
- [ ] Session absolute and idle expiry work; `last_used_at` is throttled.
- [ ] Logout revokes the server session; replay fails.
- [ ] Password reset is single-use, revokes all sessions, and marks email verified.
- [ ] Email verification is single-use and respects policy.
- [ ] CSRF checks fail closed for missing/mismatched/cross-origin requests.
- [ ] Rate limits return `429` and recover.
- [ ] No token/password/hash in logs, URLs (except fragment), or responses.
- [ ] Email links use canonical `APP_ORIGIN` and fragments.
- [ ] Unverified write policy is enforced server-side.

### Authorization and data

- [ ] Missing/invalid session returns `401`.
- [ ] Cross-user object access returns `403`/`404` without disclosure.
- [ ] Cross-user parent attach is rejected.
- [ ] Anonymous private access is rejected.
- [ ] Public catalog exposes published entries only.
- [ ] Runtime DB role cannot execute DDL.
- [ ] RLS decision is documented and approved.
- [ ] Simulated/manual/sensor labels are preserved.
- [ ] Timestamps/timezones display correctly.
- [ ] Empty data produces empty states, not fabricated zeros.

### Migration and operations

- [ ] Firebase Auth inventory is complete and accounted for.
- [ ] Firestore inventory is complete; empty evidence is recorded.
- [ ] Every imported user/row maps to a UUID or quarantine.
- [ ] Counts reconcile per entity.
- [ ] Import is idempotent on rerun.
- [ ] Legacy mapping is inaccessible to the runtime role.
- [ ] Export files are encrypted/restricted and deleted after sign-off.
- [ ] Migration runs on an isolated branch before shared data.
- [ ] Backup/branch rollback point is tested.
- [ ] No secrets are printed or committed.
- [ ] Firebase remains intact through the rollback window.
- [ ] Rollback runbook has an owner and a time limit.

## 8. Risks and controls

| Risk | Control |
| --- | --- |
| Duplicate normalized emails in Firebase | Pre-import report; quarantine conflicts; do not merge silently |
| Firebase password incompatibility | Forced reset default; optional legacy path only with a tested export |
| Users locked out | Clear password-set copy; reset flow for null hashes; support runbook |
| Sessions assumed transferable | Explicit re-login; no token import |
| Firestore data hidden/unknown | Read-only inventory; counts; dry run; skip only with evidence |
| Cross-user ownership after mapping | UID→UUID mapping; composite FKs; two-account tests |
| Partial import | Idempotent rerun; branch restore; reconciliation report |
| Catalog drift | Deterministic seed; parity test |
| Email provider outage | Generic responses; resend; monitor; pause cutover if unusable |
| Password reset abuse | Rate limits; single-use 30-minute tokens; no enumeration |
| CSRF/cookie misconfiguration | Same-origin deployment; `__Host-`; Origin + double-submit tests |
| CPU exhaustion from Argon2 | Hashing bulkhead + rate limits |
| Two auth systems linger | Explicit cutover gate; remove bearer acceptance; exit plan |
| Rollback loses Neon-only writes | Export/reconcile Neon changes before rollback |
| Firebase data deleted too early | Separate approved decommission; final backup |
| Secrets in migration files | No `.env`/service-account contents in repo; redacted records |
| PostgreSQL version mismatch | Preflight; approved trigger fallback |
| RLS requirement mismatch | Explicit approval of API-only boundary or implement session-context RLS |

## 9. Rollback summary

| Stage | Rollback action | Data risk |
| --- | --- | --- |
| Phase 0 | None needed | None |
| Phase 1 | Discard isolated branch | None |
| Phase 2 | Restore branch / delete unreferenced seed | Low |
| Phase 3 | Disable unreleased auth path | Staging users only |
| Phase 4 | Restore pre-import branch; keep Firebase | Imported rows only |
| Phase 5 | Restore pre-load branch; keep Firestore | Imported rows only |
| Phase 6 | Redeploy Firebase-backed web/API; keep Neon data | Neon-only users/writes may need reconciliation |
| Phase 7 | Restore final Firebase backup if data was deleted | High; requires explicit approval |

Rollback is not complete until:
- the previous web/API build is serving,
- Firebase Auth and Firestore are confirmed working,
- Neon-only writes are exported or reconciled,
- new sessions are revoked if the new API remains reachable,
- the incident/decision is recorded.

## 10. Open decisions before execution

1. Email-verification enforcement: recommended allow login/block writes.
2. Registration auto-login versus generic no-session response.
3. Forced reset versus optional legacy Firebase password verification.
4. Password minimum 12 versus current 8-character copy.
5. Session absolute/idle lifetimes and periodic rotation.
6. Email provider, sending domain, and bulk migration campaign policy.
7. RLS now versus API-only initial release with least-privilege role.
8. Account deletion and self-service password change scope.
9. Plant deletion behavior for plant-specific tasks.
10. Whether any Firestore private data actually exists.
11. Rollback window duration and approval owner.
12. Final PostgreSQL version-compatible plant FK behavior.

None of these blocks Phase 3A documentation. They block schema execution, auth implementation, and cutover.
