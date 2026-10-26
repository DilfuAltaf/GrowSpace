# Firebase Exit Plan — GrowSpace

Last updated: 2026-10-20

Status: planned; not executed. This is Phase 3A documentation. No Firebase code, dependency, configuration, rule, index, user, or data has been removed or changed.

Related documents:

- `docs/database/discovery.md` — complete Firebase/dependency inventory.
- `docs/database/schema.md` — target Neon schema.
- `docs/database/migration-plan.md` — data migration and cutover.
- `docs/auth/architecture.md` — target session authentication.

## 1. Exit definition

Firebase is considered removed only when all of the following are true:

1. The web app authenticates and establishes sessions through the GrowSpace API only.
2. The API validates opaque session cookies through Neon; it does not verify Firebase ID tokens.
3. Users, sessions, verification tokens, reset tokens, and all private data have an approved PostgreSQL path.
4. No runtime code imports `firebase` or `firebase-admin`.
5. No Firebase environment variable is required to build, start, or test the application.
6. No Firebase script, emulator, rules file, index file, or project configuration remains active.
7. `firebase`, `firebase-admin`, `firebase-tools`, and `@firebase/util` build configuration are removed.
8. The lockfile no longer resolves Firebase packages.
9. Firebase data has a final approved backup and retention decision.
10. A soak period and rollback window have passed, with explicit product-owner approval for data deletion.

Removing packages before the replacement is live is not an exit; it is an outage.

## 2. Principles

1. **Replacement first, removal second.** Firebase remains the rollback path until the new auth and data paths pass verification.
2. **No dual authentication indefinitely.** During staging, both implementations may exist. In production, accept one authentication mechanism at a time.
3. **No dual credential writes.** Never write passwords, sessions, or tokens to both systems.
4. **No fabricated parity.** Do not invent users, Firestore documents, or password portability.
5. **No big-bang dependency deletion.** Remove code/config in dependency order after the cutover is stable.
6. **No secret handling in docs.** Never print `.env`, service-account JSON, connection strings, password exports, or raw tokens.
7. **No irreversible data deletion until after soak and sign-off.** Firebase users/Firestore data remain recoverable through the rollback window.
8. **The SPA guard is not security.** API session validation is the boundary.

## 3. Current Firebase dependency graph

```mermaid
flowchart TD
  W[apps/web] --> F1[firebase/app]
  W --> F2[firebase/auth]
  W --> C[auth-context.tsx]
  W --> API[lib/api.ts]
  API --> F2
  A[apps/api] --> FA[firebase-admin]
  A --> AUTH[lib/auth.ts]
  A --> FS[lib/firestore.ts]
  A --> ENV[lib/env.ts]
  A --> SEED[scripts/seed-catalog.ts]
  R[root package.json] --> FT[firebase-tools]
  R --> EM[emulators script]
  CFG[firebase.json / .firebaserc] --> EML[Auth + Firestore emulators]
  CFG --> RULES[Firestore rules/indexes]
  WS[pnpm-workspace.yaml] --> AB[@firebase/util allowBuild]
```

No Firebase Hosting, Functions, Storage, Messaging, Analytics, App Check, Realtime Database, or deployment config is present.

## 4. Exit phases

### Phase 0 — Freeze, inventory, and approvals

Actions:

- Approve `docs/auth/architecture.md`, `docs/database/schema.md`, and `docs/database/migration-plan.md`.
- Record the current verification baseline: typecheck, lint, tests, build, and `pnpm db:check`.
- Confirm the authoritative Firebase project, operator access, Auth user count, provider mix, and Firestore counts.
- Confirm there is no hidden deployment using Firebase, no external consumer of Firebase tokens, and no support tooling that relies on Firebase Auth.
- Select the email provider, sending domain, and secret manager.
- Confirm fresh start decision (no legacy accounts, passwords, or data to migrate; first-party registrations start clean).
- Define the maintenance window, soak period, rollback window, and approval owner.
- Freeze unrelated auth/schema changes during cutover.

Exit gate:

- Inventory and decisions are recorded.
- No Firebase data has been changed.
- The rollback owner and window are known.

Rollback:

- None needed.

### Phase 1 — Build and verify the replacement while Firebase stays live

Actions:

- Create the Neon schema on an isolated branch.
- Implement auth endpoints, session cookies, CSRF, rate limiting, email verification/reset, and Argon2id hashing.
- Implement ownership-scoped repositories for domain routes as they are introduced.
- Seed the PostgreSQL catalog and prove parity.
- Wire the SPA to the new API in staging, not production.
- Keep the Firebase-backed production build unchanged.

Exit gate:

- Auth and ownership integration tests pass with two accounts.
- Email delivery works in staging.
- No secrets or raw tokens are logged.
- `pnpm db:check` passes.
- The new build works with no Firebase environment variables.
- Rollback to the current Firebase production build remains possible.

Rollback:

- Disable unreleased endpoints and staging traffic.
- Keep Firebase production untouched.
- Delete staging-only users/tokens.

### Phase 2 — Data rehearsal and user mapping (Omitted — Fresh Start)

**Status: OMITTED (Confirmed Product Decision)**

GrowSpace has no existing Firebase user accounts or user data that need migration. The application starts fresh with new user registrations.
- No Firebase user export, UID mapping tables (`legacy_firebase_user_map`), or nullable password states are used.
- Catalog data is seeded directly from the shared TypeScript definition (`packages/shared/src/catalog.ts`).
- New user accounts will register directly in the first-party system.

### Phase 3 — Production cutover

Actions:

1. Announce the maintenance window and the need to sign in again.
2. Freeze Firebase registration and any Firebase-backed writes.
3. Run the final metadata/data delta import.
4. Deploy the session-based API and SPA.
5. Stop accepting Firebase bearer tokens in the production API.
6. Configure production cookies, Origin allowlist, CSRF, CSP/HSTS, email secrets, and rate limiting.
7. Smoke test registration, verification, login, session restoration, logout, reset, cross-user denial, and catalog.
8. Unfreeze registrations on the new path.
9. Monitor auth, email, and 401/403/429 rates.

Exit gate:

- New and migrated users can authenticate through Neon sessions.
- No current production request path requires Firebase.
- Returning users can set/reset a password.
- The public catalog and existing UI states work.
- Rollback build and Firebase data remain available.

Rollback:

- Redeploy the previous Firebase-backed web/API build.
- Keep Neon data; export/reconcile any Neon-only users or writes before another attempt.
- Revoke new sessions if the new API remains reachable.
- Do not delete Firebase users/data.

### Phase 4 — Soak

Actions:

- Run production on the new auth path for the agreed period (recommended 7–14 days).
- Review:
  - login failure rate;
  - password-reset completion and expiry;
  - email-provider bounce/failure rates;
  - session 401 rates;
  - CSRF 403 rates;
  - registration and verification completion;
  - support tickets for lockouts;
  - rate-limit 429 spikes;
  - any Firebase network calls or env reads.
- Keep Firebase Auth/Firestore frozen and recoverable.
- Do not remove packages during the soak unless needed for an emergency, with a separate rollback plan.

Exit gate:

- Error rates are stable.
- No unresolved auth/ownership defects.
- No Firebase runtime traffic.
- Product owner approves decommission planning.

Rollback:

- Redeploy the prior Firebase path.
- Preserve Neon data for reconciliation.
- Do not delete Neon tables.

### Phase 5 — Code and configuration removal

Perform in dependency order. Each step must keep the build runnable.

#### 5.1 Web app

1. Confirm `auth-context.tsx`, `protected-route.tsx`, auth pages, dashboard, settings, and `lib/api.ts` use the API session/CSRF path.
2. Remove the Firebase bearer-token injection from `apps/web/src/lib/api.ts`.
3. Remove Firebase imports and initialization from `apps/web/src/lib/firebase.ts`, then delete the file.
4. Remove Firebase configuration checks and error-code mapping from auth UI.
5. Remove Firebase copy from dashboard/settings/feature placeholders.
6. Remove `VITE_FIREBASE_*` declarations from `apps/web/src/vite-env.d.ts`.
7. Replace `apps/web/.env.example` with public API/proxy placeholders only.
8. Remove `firebase` from `apps/web/package.json`.
9. Verify no web bundle contains Firebase or a Firebase API key.

Affected files:

- `apps/web/src/lib/firebase.ts` — delete.
- `apps/web/src/features/auth/auth-context.tsx` — rewrite.
- `apps/web/src/features/auth/protected-route.tsx` — rewrite.
- `apps/web/src/lib/api.ts` — cookies/CSRF.
- `apps/web/src/pages/auth/login-page.tsx` — API login.
- `apps/web/src/pages/auth/register-page.tsx` — API registration and generic response.
- `apps/web/src/pages/auth/forgot-password-page.tsx` — API reset request.
- `apps/web/src/pages/dashboard/dashboard-page.tsx` — API verification state.
- `apps/web/src/pages/dashboard/settings-page.tsx` — API user and logout.
- `apps/web/src/pages/dashboard/feature-pages.tsx` — remove Firestore wording.
- `apps/web/src/pages/public/plant-detail-page.tsx` — keep auth-state behavior.
- `apps/web/src/vite-env.d.ts` — remove Firebase vars.
- `apps/web/.env.example` — remove Firebase vars.
- `apps/web/package.json` — remove dependency.

#### 5.2 API

1. Replace `requireUser()` with `requireSession()` and internal `users.id`.
2. Move `/api/me` to `/api/auth/session` or make it a session-backed compatibility alias. Do not keep a second auth mechanism.
3. Remove the `firebaseAdminConfigured` field from `/api/health`.
4. Remove Firebase and emulator fields from `apps/api/src/lib/env.ts`; add session/email/rate-limit settings.
5. Delete `apps/api/src/lib/firebase-admin.ts`.
6. Delete `apps/api/src/lib/firestore.ts` after confirming no callers.
7. Rewrite or delete `apps/api/src/lib/auth.ts` so only session validation remains.
8. Remove `Authorization` from CORS allowed headers in `apps/api/src/proxy.ts`; keep cookie/CSRF/origin handling.
9. Remove `serverExternalPackages: ['firebase-admin']` from `apps/api/next.config.ts`.
10. Replace `apps/api/scripts/seed-catalog.ts` with the Neon seed; keep the static source until parity.
11. Remove Firebase variables from `apps/api/.env.example`.
12. Remove `firebase-admin` from `apps/api/package.json`.
13. Extend `apps/api/src/lib/env.test.ts` for the new auth/security configuration.

Affected files:

- `apps/api/src/lib/firebase-admin.ts` — delete.
- `apps/api/src/lib/auth.ts` — rewrite.
- `apps/api/src/lib/firestore.ts` — delete.
- `apps/api/src/lib/env.ts` — remove Firebase.
- `apps/api/src/proxy.ts` — cookie/CSRF/CORS.
- `apps/api/next.config.ts` — remove external package.
- `apps/api/src/app/api/me/route.ts` — replace/alias.
- `apps/api/src/app/api/health/route.ts` — remove Firebase flag.
- `apps/api/scripts/seed-catalog.ts` — Neon seed.
- `apps/api/.env.example` — replace placeholders.
- `apps/api/package.json` — remove dependency.

#### 5.3 Root scripts, configuration, and build

1. Remove the root `emulators` script.
2. Point `seed:catalog` at the Neon seed.
3. Delete `firebase.json`.
4. Delete `.firebaserc`.
5. Delete `firebase/firestore.rules` and `firebase/firestore.indexes.json` after the final backup/approval.
6. Remove `firebase-tools` from root `devDependencies`.
7. Remove the `@firebase/util` `allowBuilds` entry from `pnpm-workspace.yaml` only after both Firebase packages are gone.
8. Remove Firebase-specific `.gitignore` entries while preserving generic secret/service-account protection.
9. Regenerate `pnpm-lock.yaml` with the approved package manager and confirm Firebase no longer resolves.
10. Remove unused Firebase debug/emulator artifacts.

Affected files:

- Root `package.json` — `emulators`, `seed:catalog`, `firebase-tools`.
- `firebase.json` — delete.
- `.firebaserc` — delete.
- `firebase/firestore.rules` — delete after backup.
- `firebase/firestore.indexes.json` — delete after backup.
- `pnpm-workspace.yaml` — remove allowBuild.
- `pnpm-lock.yaml` — regenerate.
- `.gitignore` — remove Firebase-specific patterns; keep secret protection.

#### 5.4 Secrets and credentials

1. Confirm no application process reads Firebase env values.
2. Remove Firebase variables from deployment settings/secret stores.
3. Revoke/delete the Firebase service-account key used by the API.
4. Disable or delete unused Firebase API keys/app registrations after the rollback window.
5. Rotate the Neon, email-provider, and rate-limit secrets if exposure is suspected.
6. Never print secret values in the exit record.

#### 5.5 Documentation and tests

- Update `README.md` to the Vite + Next API + Neon + first-party auth stack.
- Update `docs/stack-mapping.md` and `docs/implementation-status.md`.
- Update product/security/testing docs that assume Supabase Auth/RLS or Firebase.
- Keep this migration record as historical documentation, but remove active instructions that say to configure Firebase.
- Update tests that assert Firebase configuration or `/api/me` identity.
- Add a test/build assertion that no Firebase package is imported.

#### 5.6 Firebase data deletion

Do this only after all prior phases and explicit approval:

1. Freeze Firebase Auth and Firestore writes.
2. Take a final export/backup and store it under the retention policy.
3. Verify the backup can be restored in an isolated project, if feasible.
4. Delete Firebase Auth users.
5. Delete Firestore collections.
6. Delete the Firebase project or disable billing/resources per provider policy.
7. Record the deletion date, approver, backup location reference (not credentials), and retention end.
8. Drop the temporary legacy UID mapping table after reconciliation and rollback close.

This step is irreversible without the backup. If retention/legal requirements are unclear, stop.

## 5. Final repository acceptance

Run from the repository root after removal:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm db:check
```

Search checks (use ripgrep or the IDE's global search; ripgrep may not be installed on every workstation):

```powershell
rg -n -i "firebase|firestore|firebase-admin|firebase-tools|FIREBASE_|VITE_FIREBASE_|GOOGLE_APPLICATION_CREDENTIALS|FIRESTORE_EMULATOR|FIREBASE_AUTH_EMULATOR" apps packages package.json pnpm-workspace.yaml pnpm-lock.yaml .gitignore
```

Confirm the removed configuration paths are absent:

```powershell
@('firebase.json', '.firebaserc', 'firebase') | ForEach-Object {
  "$_ exists: $(Test-Path -LiteralPath $_)"
}
```

Acceptance:

- No `firebase`/`firebase-admin` in package manifests or lockfile.
- No Firebase imports under `apps/` or `packages/`.
- No Firebase env declarations or examples.
- No Firebase config/rules/index files.
- No `emulators` script.
- No Firebase service-account reference in source/config/docs instructions.
- No Firebase network calls in browser/API runtime.
- `/api/health` exposes no Firebase configuration flag.
- The API works with all Firebase env vars absent.
- Auth tests pass with cookies/CSRF and no bearer token.
- Public catalog and private ownership tests pass.
- `pnpm install --frozen-lockfile` succeeds without Firebase.
- Browser bundle inspection finds no Firebase SDK or API key.
- Logs contain no passwords, session tokens, reset tokens, or database URLs.

Historical references in the migration record are allowed; active setup instructions are not.

## 6. Rollback plan

### 6.1 Rollback triggers

Define thresholds before cutover:

- login success rate falls below the agreed baseline;
- reset/verification completion is materially broken;
- users cannot establish sessions;
- cross-user access or data loss is detected;
- email delivery is unavailable for longer than the agreed window;
- database errors or latency make auth unreliable;
- a security defect requires the previous auth boundary.

### 6.2 Rollback before code removal

1. Redeploy the previous Firebase-backed web/API build.
2. Restore the previous deployment configuration/secret references.
3. Confirm Firebase Auth sign-in and token verification.
4. Keep Neon data; export/reconcile any Neon-only users or writes.
5. Revoke new sessions if the new API remains reachable.
6. Record the incident and do not delete Firebase data.

### 6.3 Rollback after code removal but before data deletion

1. Revert the removal commit(s) or redeploy the last Firebase-capable build.
2. Reinstall the locked dependencies from that revision.
3. Restore Firebase environment/secret configuration without printing it.
4. Re-enable Firebase Auth providers/API keys if disabled.
5. Reconcile Neon-only writes.
6. Keep the removal changes available for a corrected attempt.

This requires the prior commit, lockfile, and deployment artifact to remain available.

### 6.4 Rollback after Firebase data deletion

Only backup restoration is possible. This is a high-impact, product-owner-approved action. Do not delete data and rollback support in the same window.

## 7. User communication

### Before cutover

- Explain that GrowSpace is moving to first-party accounts.
- State that existing users will need to sign in again because sessions cannot transfer.
- Explain how to set/reset a password.
- Provide support contact and expected maintenance window.
- Do not include passwords or one-time tokens in bulk announcements.

### At cutover

- Show clear login copy: “Returning users: set or reset your password.”
- Preserve friendly error states without disclosing whether an email exists.
- Provide resend-verification guidance.
- Explain that old Firebase sessions have ended.

### After cutover

- Monitor support for lockouts and deliverability.
- Send a reminder only through an approved campaign with rate limits.
- Do not claim data was migrated if the inventory showed no data.
- Do not claim passwords were preserved when the default is forced reset.

## 8. Roles and approvals

| Role | Responsibility |
| --- | --- |
| Product owner | Approves policy, maintenance window, data deletion, user comms |
| Engineering lead | Approves schema/auth design and cutover readiness |
| Migration operator | Runs exports/imports; controls sensitive files |
| Security reviewer | Reviews cookies, CSRF, hashing, enumeration, secrets |
| Operations/deployer | Deploys builds, configures proxy/cookies/secrets, monitors |
| Support lead | Handles lockouts/reset/verification issues |

No single person should both approve and execute irreversible Firebase data deletion without a second reviewer.

## 9. Risk register

| Risk | Impact | Control |
| --- | --- | --- |
| Removing Firebase too early | Total auth outage | Replacement gates + rollback build |
| Password hashes not portable | User lockout | Forced reset default; optional tested legacy path |
| Duplicate Firebase emails | Ambiguous identity | Pre-import normalization/quarantine |
| Missing Firestore data | Data loss | Read-only inventory + dry run + reconciliation |
| UID→UUID mapping error | Cross-user exposure | Unique mapping, composite FKs, two-account tests |
| Email provider outage | No verification/reset | Monitor, resend, pause cutover, provider failover plan |
| Cookie/CORS misconfiguration | Sessions/CSRF fail | Same-origin deployment, `__Host-`, staging tests |
| Firebase credentials linger | Unauthorized access | Revoke service account; remove env; rotate |
| Old Firebase SDK in bundle | Hidden runtime dependency | Bundle inspection + search gate |
| Lockfile still resolves Firebase | Supply-chain/runtime risk | Regenerate and inspect |
| Rollback loses Neon-only writes | Data loss | Export/reconcile before rollback |
| Firebase data deleted prematurely | Irreversible loss | Separate approval + final backup |
| Docs still instruct Firebase setup | Misconfiguration | Documentation sweep |
| Soak too short | Late defects under load | 7–14 day minimum or agreed equivalent |

## 10. Decision record to complete before execution

1. Authoritative Firebase project and owner.
2. Auth user count/provider mix and Firestore counts.
3. Forced reset versus legacy password verification.
4. Email provider and sending domain.
5. Email-verification policy and registration auto-login behavior.
6. Session lifetimes and rotation.
7. RLS versus API-only initial boundary.
8. Maintenance window, soak length, rollback window.
9. Data retention and deletion approver.
10. Bulk user communication/campaign policy.
11. Account deletion/password-change scope.
12. Final plant-FK behavior for PostgreSQL version.

## 11. Exit checklist

### Replacement

- [ ] Neon schema and auth tables exist and are verified.
- [ ] Argon2id hashing and session auth pass tests.
- [ ] CSRF, Origin, cookie flags, and rate limits pass tests.
- [ ] Email verification/reset work end-to-end.
- [ ] Ownership is scoped by `users.id` and tested with two accounts.
- [ ] Catalog parity is verified.

### Cutover

- [ ] Firebase Auth metadata and Firestore inventory are reconciled.
- [ ] User mapping is complete/quarantined.
- [ ] Production cutover smoke tests pass.
- [ ] No Firebase bearer token is accepted.
- [ ] Returning users can set/reset passwords.
- [ ] Rollback build and Firebase data are available.

### Removal

- [ ] Web Firebase imports/files/config removed.
- [ ] API Firebase imports/config/auth removed.
- [ ] `/api/me` and `/api/health` no longer expose Firebase.
- [ ] Root scripts/config/rules/indexes removed.
- [ ] Packages/lockfile/allowBuild removed.
- [ ] Firebase secrets/keys revoked.
- [ ] README/status/security docs updated.
- [ ] Search/build/test/typecheck/db-check gates pass.
- [ ] Soak and product-owner approval complete.

### Data deletion

- [ ] Final export/backup exists and is tested.
- [ ] Retention/legal approval recorded.
- [ ] Firebase Auth users deleted.
- [ ] Firestore data deleted.
- [ ] Firebase project disabled/deleted.
- [ ] Temporary legacy mapping dropped.
- [ ] Deletion date/approver recorded without secrets.

## 12. References

- Firebase CLI auth export: https://firebase.google.com/docs/cli/auth
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
