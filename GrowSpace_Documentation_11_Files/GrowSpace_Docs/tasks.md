# Implementation Tasks — GrowSpace

## Working rules
- Work in small, reviewable phases.
- Do not implement later phases before current acceptance criteria pass.
- Do not claim completion without running the relevant checks.
- Keep scope limited to the MVP.
- Use deterministic simulated data and label it.
- Review security and RLS before connecting real user data.

## Phase 0 — Project preparation
### Tasks
- [ ] Confirm competition requirements, submission deadline, and demo expectations.
- [ ] Create Next.js App Router project with TypeScript.
- [ ] Configure Tailwind CSS and lint/type-check scripts.
- [ ] Add Lucide icons and shadcn/ui components only as needed.
- [ ] Create `.env.example` with placeholder Supabase values.
- [ ] Set up Git repository and initial commit.
- [ ] Add this documentation set to the project.
### Acceptance criteria
- Project runs locally.
- Lint and type-check commands are documented and run successfully.
- No real credentials are committed.

## Phase 1 — Design foundation
### Tasks
- [ ] Implement color, typography, spacing, radius, and shadow tokens from `design.md`.
- [ ] Build reusable buttons, inputs, badges, cards, dialogs, toasts, and empty states.
- [ ] Build public layout, dashboard layout, sidebar, topbar, and mobile navigation.
- [ ] Add responsive behavior and focus states.
- [ ] Add image fallback and loading skeleton patterns.
### Acceptance criteria
- Component examples match the design specification.
- Navigation works with mouse, touch, and keyboard.
- No page-level horizontal overflow at 320 px.
- Loading, empty, and error patterns are reusable.

## Phase 2 — Public website
### Tasks
- [ ] Build landing page sections.
- [ ] Build Plant Library list, search, and filters.
- [ ] Build plant detail page.
- [ ] Build About page.
- [ ] Optimize and verify image licenses.
### Acceptance criteria
- Public pages render correctly on mobile and desktop.
- CTAs navigate to the intended routes.
- Plant search/filter works.
- Public pages do not require authentication.

## Phase 3 — Supabase and authentication
### Tasks
- [ ] Create Supabase project and configure Auth.
- [ ] Implement supported SSR/browser client patterns for the chosen Next.js version.
- [ ] Create reviewed SQL migrations for profiles and private tables.
- [ ] Enable and test RLS policies.
- [ ] Build registration, login, recovery if configured, and sign-out flows.
- [ ] Protect dashboard routes.
### Acceptance criteria
- Auth flows work in local and preview environments.
- Protected pages require a valid session.
- Two-account RLS tests deny cross-user access.
- No service-role secret is exposed in the browser.

## Phase 4 — Garden management
### Tasks
- [ ] Build garden list and empty state.
- [ ] Build create/edit garden form.
- [ ] Build garden detail page.
- [ ] Implement delete confirmation and documented child-record behavior.
- [ ] Add loading/error/success states.
### Acceptance criteria
- Authenticated user can CRUD their own gardens.
- Data persists after reload.
- User cannot access another user's garden by changing its ID.

## Phase 5 — Plant management
### Tasks
- [ ] Create and seed the plant catalog.
- [ ] Build add/edit plant form.
- [ ] Build plant list and detail.
- [ ] Support planting date, growth stage, status, and notes.
- [ ] Add plant growth log.
### Acceptance criteria
- User can add plants only to owned gardens.
- Plant list/detail data matches the database.
- Invalid input is rejected.
- Estimated harvest date is not presented as a guarantee.

## Phase 6 — Monitoring and deterministic demo data
### Tasks
- [ ] Add measurement types and unit validation.
- [ ] Create deterministic seed readings with source `simulated`.
- [ ] Build manual reading form.
- [ ] Build monitoring cards, chart, filters, and source badges.
- [ ] Implement stale/no-data/error states.
- [ ] Ensure client cannot falsely mark an entry as verified sensor data.
### Acceptance criteria
- Simulated and manual readings are visibly distinguished.
- Manual readings persist with timestamp and unit.
- Charts use actual stored values and selected filters.
- Empty data does not produce fake zeros.
- No live-sensor claim appears in the UI.

## Phase 7 — Analytics and recommendations
### Tasks
- [ ] Implement historical charts and date filters.
- [ ] Implement deterministic, explainable recommendation rules.
- [ ] Add source/timestamp context to recommendations.
- [ ] Add insufficient/stale-data fallback behavior.
- [ ] Add user-entered water-use and harvest summaries only if time permits.
### Acceptance criteria
- Recommendation tests cover each rule.
- Every recommendation explains its trigger and suggested check.
- Unsupported plant conditions do not produce confident diagnosis.
- Estimates and actual records are visually distinct.

## Phase 8 — Care tasks
### Tasks
- [ ] Build task list and filters.
- [ ] Build create/edit task form.
- [ ] Implement complete/reopen behavior if supported.
- [ ] Link tasks to owned gardens/plants.
- [ ] Add due-date and empty states.
### Acceptance criteria
- Task CRUD and completion persist after reload.
- Cross-user task references are denied.
- Task filters return correct results.

## Phase 9 — QA, security, and accessibility
### Tasks
- [ ] Run unit and component tests.
- [ ] Run end-to-end smoke tests.
- [ ] Run two-account RLS tests.
- [ ] Test viewport widths 320, 375, 768, 1024, and 1440 px.
- [ ] Check keyboard navigation, focus, contrast, labels, and reduced motion.
- [ ] Optimize images and check console/network errors.
- [ ] Verify no secrets in Git history/current browser bundle.
### Acceptance criteria
- No critical data access vulnerability remains.
- All critical flows pass.
- No blocking mobile layout defect remains.
- Simulated/manual data labeling is consistent.

## Phase 10 — Deployment and competition demo
### Tasks
- [ ] Apply reviewed migrations to the intended Supabase environment.
- [ ] Configure Vercel environment variables and Auth redirect URLs.
- [ ] Deploy preview and repeat smoke tests.
- [ ] Prepare deterministic demo account and sample garden.
- [ ] Write a short demo script: create garden → add plant → inspect reading → view recommendation → complete task.
- [ ] Document known limitations honestly.
### Acceptance criteria
- Deployed app loads reliably.
- Auth and database operations work in deployment.
- Demo data is clearly marked as simulated.
- Demo can be completed without manual database intervention during presentation.

## Priority rules
- P0: authentication, data isolation, garden/plant CRUD, monitoring source integrity.
- P1: charts, recommendations, care tasks, responsive polish.
- P2: optional analytics refinements and future features.

## Explicitly deferred
Real IoT integration, AI chatbot, image-based diagnosis, community, marketplace, payment, native mobile app, and complex gamification.
