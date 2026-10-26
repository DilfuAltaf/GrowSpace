# Stack Adaptation — GrowSpace

> [!NOTE]
> **HISTORICAL ARCHITECTURE ARCHIVE:** This document records the initial prototype stack adaptation that utilized Firebase. Under Phase 4.9, Firebase has been completely retired from GrowSpace. Active production architecture uses GrowSpace First-Party Authentication and Neon PostgreSQL. See [`docs/auth/phase-4.9a-firebase-retirement-plan.md`](auth/phase-4.9a-firebase-retirement-plan.md) and [`README.md`](../README.md) for current specifications.

## 1. Decision

The product documentation recommends a single Next.js App Router application with Supabase Auth and PostgreSQL. This repository was requested to use:

- **Frontend:** React + Vite
- **Backend:** Next.js
- **Platform:** Firebase

The adaptation preserves the product requirements, data rules, source-integrity rules, and acceptance criteria. It changes the implementation mechanics, not the intended behavior.

## 2. Architecture

```text
Browser
  └─ React + Vite (apps/web)
       ├─ Firebase Auth client (email/password)
       └─ fetch /api/* with Firebase ID token
             └─ Next.js route handlers (apps/api)
                  ├─ verifyIdToken()
                  ├─ ownership checks (user → garden → plant)
                  ├─ Zod validation from @growspace/shared
                  └─ Firebase Admin SDK
                       └─ Cloud Firestore
Firestore security rules protect direct client access as defence in depth.
```

The Admin SDK bypasses Firestore security rules. Therefore, **every API route must verify the ID token and re-check ownership at the trusted boundary**. Firestore rules are not a substitute for server-side checks when the server uses Admin credentials.

## 3. Data model mapping

| Specification (Postgres) | Implementation (Firestore) | Notes |
| --- | --- | --- |
| `auth.users(id)` | Firebase Authentication user (`uid`) | Managed by Firebase Auth |
| `profiles` | `profiles/{uid}` | Minimal display data and preferences |
| `gardens` | `gardens/{gardenId}` | `userId` field |
| `plant_catalog` | `plantCatalog/{entryId}` | Maintained by trusted seed/admin |
| `plants` | `plants/{plantId}` | `userId`, `gardenId`, optional `catalogId` |
| `sensor_readings` | `readings/{readingId}` | Stores manual, simulated, and future sensor records |
| `care_tasks` | `careTasks/{taskId}` | `userId`, `gardenId`, optional `plantId` |
| `plant_logs` | `plantLogs/{logId}` | `userId`, `plantId` |

Field names use `camelCase` in Firestore and TypeScript. Timestamps are stored as Firestore `Timestamp` values and serialized to ISO strings by the API. Date-only fields remain `YYYY-MM-DD` strings.

### Ownership and integrity

- All private documents carry `userId`.
- Creation and update rules confirm that `userId` matches the authenticated user.
- Child records also confirm that their garden/plant belongs to the same user with `get()` checks.
- Readings created by clients must use `source == "manual"`. Simulated records are seeded by a trusted process. `sensor` is reserved for a future verified integration.
- Numeric plausibility and measurement-specific units are validated in both shared Zod schemas and Firestore rules.
- Team-maintained catalog entries are public-read only when `isPublished == true`; client writes are denied.

## 4. Authentication and route protection

- Firebase Auth provides registration, sign-in, password reset, sign-out, and session state.
- The web app's `ProtectedRoute` handles navigation and UX only.
- The API's `requireUser` verifies the bearer ID token with revocation checks.
- The API must return `401` for missing/expired tokens and `403` when a record belongs to another user.
- Redirect targets are restricted to same-origin relative paths to avoid open redirects.

## 5. Deletion behavior

Firestore does not cascade deletes. The product documents require an explicit decision and confirmed destructive actions. The planned behavior is:

- Deleting a garden deletes its plants, readings, and care tasks in a trusted batch/recursive operation.
- Plant logs belonging to deleted plants are deleted.
- The confirmation dialog must state this behavior before the operation.
- The operation should fail safely if a partial batch cannot be completed.

This decision should be implemented server-side in the garden deletion phase and covered with integration tests.

## 6. What did not change

- User roles and permissions.
- The MVP scope and out-of-scope list.
- Source labels (`simulated`, `manual`, `sensor`) and their honesty requirements.
- Design tokens, page responsibilities, route map, responsive expectations, and accessibility targets.
- Validation requirements, recommendation explainability, and empty-state rules.
- The requirement to isolate users’ private records and test access with two accounts.

## 7. Consequences and risks

| Risk | Mitigation |
| --- | --- |
| Admin SDK bypasses rules | Re-check ownership in every route; test with two accounts |
| Firestore has no relational constraints | Validate parent ownership on write; use deterministic IDs for the catalog; use transactions/batches for multi-document changes |
| Composite query index errors | Maintain `firebase/firestore.indexes.json` and deploy it with the rules |
| Rules drift from server checks | Keep shared schemas as the source of validation rules; add emulator tests with two users |
| Emulator requires Java | Documented prerequisite; rules can also be reviewed/tested in a Firebase project |
| Two deployables instead of one | Vite and Next.js are deployment-independent; configure CORS with an explicit origin allowlist |

## 8. Deviation from the task list

`tasks.md` names Supabase, SQL migrations, RLS, and a single Next.js app. In this implementation, read those steps as:

- Supabase project → Firebase project
- SQL migrations → Firestore rules/indexes + seed scripts
- RLS policies → Firestore rules **plus** API ownership checks
- Supabase SSR/browser clients → Firebase Auth client + Firebase Admin server SDK
- One Next.js app → Vite web app + Next.js API service
- Vercel deployment → static Vite host + Next.js host (or a Next.js server serving the built web app)

All product-facing acceptance criteria remain unchanged.
