# Phase 4.9C: API Simplification & Firebase Bearer Removal Report

**Document Status:** COMPLETE — READY FOR STAGE 3 REVIEW  
**Execution Date:** 2026-10-23  
**Target Package:** `apps/api` (`@growspace/api`)  
**Scope:** Stage 2 of Full Firebase Retirement ([`docs/auth/phase-4.9a-firebase-retirement-plan.md`](file:///C:/Real%20Project/GrowSpace/docs/auth/phase-4.9a-firebase-retirement-plan.md))  
**Verdict:** **`PASS`**

---

## 1. Executive Summary

Phase 4.9C completes Stage 2 of the Firebase Retirement Plan. The GrowSpace API now authenticates incoming requests exclusively through first-party server sessions stored in PostgreSQL (Neon) and transmitted via secure, HttpOnly cookies (`gs_session` / `__Host-gs_session`).

All legacy Firebase Bearer-token authentication paths (`Authorization: Bearer <token>`), dual-credential conflict resolution, and Firebase Admin SDK runtime logic have been completely removed from API middleware. Requests presenting a Bearer token are rejected with `401 unauthenticated` stating:
> `"Bearer token authentication has been retired. Please sign in with your credentials."`

All quality gates and test suites passed cleanly:
- **API Test Suite:** 120 / 120 passed (`pnpm --filter @growspace/api test`).
- **Monorepo Test Suite:** 157 / 157 passed across shared (23), web (14), and api (120) (`pnpm test`).
- **TypeScript Static Verification:** 0 errors across all workspaces (`pnpm typecheck`).
- **Code Quality & Linting:** 0 warnings / 0 errors (`pnpm lint`).
- **Production Builds:** Both `@growspace/web` and `@growspace/api` compiled and built successfully (`pnpm build`).

---

## 2. Safety Boundaries & Guardrails Verification

- [x] **Zero Remote Database Alterations:** No database migrations were executed, no remote Neon connections were established, and Neon branches were not modified.
- [x] **Frontend Isolation:** Zero modifications were made to `apps/web/` in this phase.
- [x] **No Premature Dependency Removal:** `firebase-admin` remains in `apps/api/package.json` and `firebase` remains in `apps/web/package.json` pending Stage 3 package manifest pruning.
- [x] **Version Control Shielding:** Git remains completely uninitialized (`Test-Path .git` is `False`). No files were staged and no commits were created.
- [x] **Zero Secret Leakage:** No credentials or environment secrets were printed, exposed, or committed.

---

## 3. Inventory of Changes

### 3.1 Deleted Files
| File Path | Technical Justification |
|---|---|
| [`apps/api/src/lib/firebase-admin.ts`](file:///C:/Real%20Project/GrowSpace/apps/api/src/lib/firebase-admin.ts) | Obsolete Firebase Admin SDK initialization, credential parsing, and mock override helpers. Verified 0 callers remaining. |
| [`apps/api/src/lib/firestore.ts`](file:///C:/Real%20Project/GrowSpace/apps/api/src/lib/firestore.ts) | Obsolete Firestore document snapshot helpers (`readDoc`, `timestampToIso`, `assertDocumentOwner`). Verified 0 callers across the entire repository. |

### 3.2 Modified Files
| File Path | Description of Changes |
|---|---|
| [`apps/api/src/lib/auth.ts`](file:///C:/Real%20Project/GrowSpace/apps/api/src/lib/auth.ts) | Removed `firebase-admin` import and all Bearer token verification branches (Cases 1 & 3). Constrained `AuthenticatedUser` to `authProvider: 'first_party'`. Rewrote `requireUser()` to validate first-party session cookies exclusively. Implemented explicit 401 rejection for any incoming `Authorization: Bearer` token. Updated `assertOwnership()` to strictly verify against canonical Neon user UUID (`resourceUserId === user.id`). |
| [`apps/api/src/lib/env.ts`](file:///C:/Real%20Project/GrowSpace/apps/api/src/lib/env.ts) | Removed obsolete Firebase environment configuration properties (`firebaseProjectId`, `firebaseClientEmail`, `firebasePrivateKey`, `isFirebaseConfigured`, `isEmulator`). Preserved `allowedOrigins` and `getDatabaseUrl()`. |
| [`apps/api/src/app/api/health/route.ts`](file:///C:/Real%20Project/GrowSpace/apps/api/src/app/api/health/route.ts) | Replaced legacy `firebaseAdminConfigured: env.isFirebaseConfigured` with `databaseConfigured: Boolean(process.env.DATABASE_URL?.trim())`. |
| [`apps/api/next.config.ts`](file:///C:/Real%20Project/GrowSpace/apps/api/next.config.ts) | Removed obsolete `serverExternalPackages: ['firebase-admin']`. |
| [`apps/api/scripts/seed-catalog.ts`](file:///C:/Real%20Project/GrowSpace/apps/api/scripts/seed-catalog.ts) | Converted from Firestore batch set (`db.collection('plantCatalog')`) to PostgreSQL-native upsert (`INSERT INTO plant_catalog ... ON CONFLICT (id) DO UPDATE ...`) using `getDatabase()`. Removed all Firebase imports. |
| [`apps/api/src/app/api/auth/auth-routes.test.ts`](file:///C:/Real%20Project/GrowSpace/apps/api/src/app/api/auth/auth-routes.test.ts) | Renamed legacy `Firebase Regression Verification` suite to `Authentication Helper Verification` and verified unauthenticated requests reject with 401. |
| [`apps/api/src/app/api/dual-auth.test.ts`](file:///C:/Real%20Project/GrowSpace/apps/api/src/app/api/dual-auth.test.ts) | Completely refactored from Firebase mock tests into a comprehensive 28-test pure session auth suite covering Bearer token rejection, missing credentials, session validation, expiration, revocation, idle timeouts, CSRF/Origin enforcement, ownership validation, endpoint integrity, and response safety. |

---

## 4. Firebase References Remaining in API

A recursive inspection of `apps/api/` reveals the following remaining references:

| Location | Content | Reason Preserved |
|---|---|---|
| `apps/api/package.json` | `"firebase-admin": "^14.5.0"` | Preserved strictly until Stage 3 package manifest pruning. |
| `apps/api/.env.example` | Comments for `FIREBASE_*` and `FIRESTORE_*` | Preserved until Stage 3 template cleanup. |
| `apps/api/src/app/api/dual-auth.test.ts` | Test titles and headers | Explicit regression test cases asserting that Bearer tokens and legacy Firebase UIDs are rejected. |

**Runtime Code:** Zero runtime imports or dependencies on `firebase-admin` or Firestore remain in `apps/api/src`.

---

## 5. Route Compatibility & Data Integrity Audit

All 13 API endpoints were audited for compatibility with pure first-party session authentication:

| Endpoint | Method | Auth Requirement | Status / Compatibility Finding |
|---|---|---|---|
| `/api/auth/register` | `POST` | Public | Unchanged. Creates user in Neon `users` with Argon2id hash; delivers verification token. |
| `/api/auth/login` | `POST` | Public | Unchanged. Authenticates credentials; issues `gs_session` and `gs_csrf` HttpOnly cookies. |
| `/api/auth/logout` | `POST` | Cookie Session | Enforces Origin and session-bound CSRF token; revokes session in Neon `sessions`. |
| `/api/auth/session` | `GET` | Cookie Session | Restores session; returns `SessionUser` without secrets. |
| `/api/auth/csrf` | `GET` | Public | Issues initial CSRF token for non-authenticated sessions. |
| `/api/auth/verify-email` | `POST` | Public / Token | Consumes verification token; updates `users.email_verified_at`. |
| `/api/auth/resend-verification` | `POST` | Public / Rate-limited | Dispatches new email verification token. |
| `/api/auth/forgot-password` | `POST` | Public / Rate-limited | Generates single-use reset token digest in `auth_tokens`. |
| `/api/auth/reset-password` | `POST` | Public / Token | Atomically revokes existing sessions and updates password hash. |
| `/api/me` | `GET` | Cookie Session (`requireUser`) | Returns `{ user: SafeUser }` with `id`, `uid`, `emailVerified`, and `authProvider: 'first_party'`. Sets `Cache-Control: no-store`. |
| `/api/health` | `GET` | Public | Returns `{ status: 'ok', service: 'growspace-api', timestamp, databaseConfigured: boolean }`. |
| `/api/catalog` | `GET` | Public | Unchanged. Reads catalog data directly from `@growspace/shared`. Zero Firestore dependency. |
| `/api/catalog/[slug]` | `GET` | Public | Unchanged. Reads individual entry from `@growspace/shared`. Zero Firestore dependency. |

### Unresolved Firestore Dependencies:
**None.** No application route, service, or repository queries Firestore. The catalog endpoints read from the shared library, and user data is maintained exclusively in Neon PostgreSQL.

---

## 6. Tests and Quality Gates Results

### 6.1 API Test Suite (`pnpm --filter @growspace/api test`)
Executed 8 test suites utilizing in-memory PGlite with the official auth migration schema:
- `src/lib/env.test.ts`: Database URL parsing, protocol validation, and secret masking (6 tests).
- `src/lib/auth/auth-primitives.test.ts`: Password hashing, timing attacks, tokens, cookies, CSRF, and schemas (27 tests).
- `src/lib/auth/auth-db-integration.test.ts`: User and session repository CRUD in PostgreSQL (14 tests).
- `src/app/api/auth/auth-routes.test.ts`: Registration, login, session restoration, logout, and rate limiting (13 tests).
- `src/lib/auth/email-verification.test.ts`: Email verification token lifecycle, single-use, and expiry (11 tests).
- `src/lib/auth/password-reset.test.ts`: Password reset lifecycle, session invalidation, and atomicity (12 tests).
- `src/lib/auth/concurrent-dispatch.test.ts`: Concurrency and race condition safety (9 tests).
- `src/app/api/dual-auth.test.ts`: Pure session authentication, Bearer rejection, CSRF/Origin enforcement, and ownership checks (28 tests).

**API Test Results:**
```text
# tests 120
# suites 24
# pass 120
# fail 0
# cancelled 0
# skipped 0
# duration_ms 67716
```

### 6.2 Full Monorepo Test Suite (`pnpm test`)
```text
@growspace/shared test: 23 passed (3 test files)
@growspace/web test:    14 passed (1 test file)
@growspace/api test:   120 passed (8 test files)
Total: 157 passed, 0 failed
```

### 6.3 TypeScript Typecheck Gate (`pnpm typecheck`)
```text
$ pnpm --filter @growspace/shared typecheck && pnpm --filter @growspace/web typecheck && pnpm --filter @growspace/api typecheck
$ tsc --noEmit (shared) -> Exit code: 0
$ tsc --noEmit (web)    -> Exit code: 0
$ tsc --noEmit (api)    -> Exit code: 0
```

### 6.4 ESLint Linter Gate (`pnpm lint`)
```text
$ eslint .
Exit code: 0
```

### 6.5 Production Build Gate (`pnpm build`)
```text
$ pnpm --filter @growspace/web build && pnpm --filter @growspace/api build
✓ @growspace/web: 2066 modules transformed, dist built in 1.72s
✓ @growspace/api: Next.js 16.4.2 optimized production build in 4.1s
Exit code: 0
```

---

## 7. Next Steps: Readiness for Stage 3

With Stage 1 (Frontend Transition) and Stage 2 (API Simplification & Bearer Removal) verified and passing:
- The system is ready for **Stage 3: Package & Config Deletion**.
- In Stage 3, `firebase` and `firebase-admin` will be uninstalled from `package.json` manifests, `pnpm-workspace.yaml` pruned, `firebase.json` and `.firebaserc` deleted, and the root `firebase/` directory removed.

---

## 8. Final Verdict

# `PASS`

Stage 2 is fully implemented, verified, and complete. All quality gates passed with zero failures. Awaiting user instruction before proceeding to Stage 3.
