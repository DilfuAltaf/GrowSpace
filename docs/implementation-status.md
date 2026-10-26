# Implementation Status — GrowSpace

Last updated: 2026-10-23

> [!NOTE]
> **Architecture Update (Phase 4.9):** Firebase has been retired from the GrowSpace stack. The application now uses GrowSpace First-Party Authentication (Argon2id, session cookies, CSRF protection) and Neon PostgreSQL. Sections below referencing Firebase or Firestore describe the historical foundation state prior to Phase 4.9. See [`docs/auth/phase-4.9a-firebase-retirement-plan.md`](auth/phase-4.9a-firebase-retirement-plan.md) and [`README.md`](../README.md).

This document separates **working code** from **scaffolded routes**. A route existing does not mean its feature is complete.

## Verification results

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm test` | Pass — 23 tests |
| `pnpm build` | Pass — Vite production build + Next.js production build |
| Auth against a live Firebase project | Not tested (no credentials configured) |
| Firestore rules against emulator/live project | Not tested (no Java / Firebase project in this environment) |
| Two-account authorization tests | Pending implementation of private CRUD routes |
| Responsive browser matrix | Pending manual visual check |

## Phase status

### Phase 0 — Project preparation: complete

- Monorepo created with pnpm workspaces.
- TypeScript, ESLint, Tailwind, Vite, and Next.js configured.
- Environment examples created; no secrets committed.
- Documentation retained and stack mapping added.

### Phase 1 — Design foundation: complete for the implemented components

- Color, typography, spacing, radius, and shadow tokens implemented in Tailwind theme.
- Buttons, fields, cards, badges, data-source badges, empty states, loading skeletons, error states, page headers, and placeholders.
- Public, auth, and dashboard layouts; desktop sidebar, mobile drawer, bottom navigation.
- Responsive and focus styles; reduced-motion support.
- Not yet implemented: confirm dialog, toast system, chart card, date-range picker.

### Phase 2 — Public website: complete (photography pending)

- Landing page with product explanation, preview, workflow, features, honesty section, CTA.
- Plant library with search and category filters.
- Plant detail with care guidance, reference ranges, and clearly labeled harvest estimate.
- About page.
- Public navigation works without authentication.
- Licensed plant photography intentionally deferred.

### Phase 3 — Firebase and authentication: partial

- Firebase web client and Admin SDK initialization.
- Register, login, password reset, logout, session-aware navigation.
- Client route protection and safe return paths.
- API bearer-token verification, CORS allowlist, and `/api/me`.
- Firestore rules written for all planned private collections.
- Pending: profile document creation, email-verification policy decision, rules tests with two accounts, expired-session handling in the API client, account deletion behavior.

### Phase 4 — Garden management: scaffolded

Routes and placeholder screens exist. No persistence yet. Next work: API repository, ownership checks, CRUD forms, delete confirmation and cascade.

### Phase 5 — Plant management: scaffolded

Routes and placeholder screens exist. Catalog source and seed script exist. Next work: catalog-backed picker, plant CRUD, growth logs, harvest labeling.

### Phase 6 — Monitoring and simulation: partial foundation

- Measurement metadata, units, plausible ranges, source labels, and stale checks exist.
- Deterministic recommendation rules and simulation disclaimer copy exist.
- Monitoring screen demonstrates source legend and honest empty state.
- Pending: manual reading API, reading queries, chart implementation, deterministic demo seed, stale-data UI.

### Phase 7 — Analytics and recommendations: partial foundation

- Rule engine supports reference ranges, stale fallback, insufficient-context fallback, and simulated-source disclosure.
- Unit tests cover main rule branches.
- Pending: garden/plant context wiring, chart date filters, source breakdown, analytics summaries.

### Phase 8 — Care tasks: scaffolded

Routes and placeholder screens exist. Pending: task CRUD, completion/reopen persistence, filters, ownership enforcement.

### Phase 9 — QA, security, accessibility: partial

- Shared-domain tests and build/type/lint checks pass.
- API error envelope and validation pattern established.
- Pending: API integration tests, two-account rules tests, E2E smoke tests, viewport matrix, accessibility audit, secret/bundle checks.

### Phase 10 — Deployment and demo: pending

- No Firebase project, hosting configuration, production environment, or demo account has been created.
- Demo seeding is planned to use deterministic `simulated` records only.

## Recommended next steps

1. Configure a Firebase project and verify auth end to end.
2. Add API repositories and routes for gardens and plants with server-side ownership checks.
3. Add profile creation/read/update and settings persistence.
4. Add manual readings, deterministic simulation seed, and the chart.
5. Add tasks and plant logs.
6. Add two-account rules/integration tests and E2E smoke coverage.
7. Complete the responsive/accessibility audit.
8. Prepare deployment and the competition demo script.

## Honesty checklist

- Empty states never show fabricated zeros.
- Simulated values carry a visible `Simulated` badge and explanation.
- Manual entries carry `Manual entry` and a timestamp.
- `Sensor` is not selectable in the UI.
- Estimated harvest is labeled as an estimate.
- Unimplemented controls are disabled or absent, not presented as working.
