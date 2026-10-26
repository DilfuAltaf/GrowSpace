# Technical Architecture — GrowSpace

## 1. Architecture overview
Use a simple web-first architecture:
- Next.js App Router for routing and rendering.
- TypeScript for typed application code.
- Tailwind CSS and reusable UI components.
- Supabase Auth for authentication.
- Supabase PostgreSQL for persistence and RLS.
- Recharts for time-series charts.
- Vercel for frontend deployment.

The MVP does not require a separate NestJS service. Keep business logic and data access organized so a trusted server-side layer can be introduced later if requirements grow.

## 2. High-level flow
1. User opens a public or protected route.
2. Auth state is resolved using supported Supabase SSR/client patterns.
3. Protected route checks session.
4. Data request is made with the user's authenticated context.
5. PostgreSQL RLS enforces ownership.
6. UI renders loading, success, empty, or error state.
7. Mutations update persisted data and refresh affected views.

Do not treat hiding a UI element as an authorization control.

## 3. Suggested project structure
```text
growspace/
  public/
    images/
    icons/
  src/
    app/
      (public)/
        page.tsx
        about/page.tsx
        plants/page.tsx
        plants/[slug]/page.tsx
      (auth)/
        login/page.tsx
        register/page.tsx
      (dashboard)/
        dashboard/page.tsx
        dashboard/gardens/page.tsx
        dashboard/gardens/[gardenId]/page.tsx
        dashboard/plants/page.tsx
        dashboard/plants/[plantId]/page.tsx
        dashboard/monitoring/page.tsx
        dashboard/analytics/page.tsx
        dashboard/tasks/page.tsx
        dashboard/settings/page.tsx
      layout.tsx
      globals.css
    components/
      layout/
      dashboard/
      gardens/
      plants/
      monitoring/
      tasks/
      ui/
    lib/
      supabase/
      validations/
      recommendations/
      formatters/
      constants/
    types/
    hooks/
  supabase/
    migrations/
    seed.sql
  tests/
  .env.example
  README.md
```

Adapt route grouping to the chosen Next.js version; do not create duplicate conflicting routes.

## 4. Environment variables
Use a `.env.example` with placeholder values:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` or the current publishable-key name used by the Supabase project.

Never commit actual credentials. Never prefix a service-role secret with `NEXT_PUBLIC_`. If privileged operations become necessary, keep them server-only and use least privilege.

## 5. Supabase client patterns
Follow the current recommended Supabase SSR setup for the selected Next.js version:
- Browser client for client-side interactions where appropriate.
- Server client that reads the user's request/session context for server components and server actions.
- Middleware/proxy session refresh only if required by the chosen setup.

Avoid using a privileged service-role client for normal user CRUD. RLS should enforce access using the user's session.

## 6. Data and state management
- Use server rendering for initial page data where it simplifies auth and loading.
- Use client components for interactive filters, forms, chart controls, and task toggles.
- Keep server-owned data authoritative; avoid duplicating the entire database into global client state.
- Revalidate or refresh affected views after mutations.
- Use typed database models and centralized validation.
- Use explicit date/time formatting in the user's locale.

## 7. Charts
Recharts is suitable for initial time-series charts. Each chart needs:
- A selected garden and measurement.
- A date range.
- Valid timestamps and numeric values.
- Units and accessible labels.
- Empty and error states.
- Source label or a clear source breakdown.

Do not interpolate missing readings into fake zero values. If data sources are mixed, visually distinguish them and explain the distinction.

## 8. Recommendation engine
Start with deterministic, rule-based recommendations, not an LLM.
Each rule should define:
- Applicable plant or plant group.
- Growing method where relevant.
- Measurement and units.
- Reference range and source/notes.
- Trigger condition.
- User-facing explanation.
- Suggested action or inspection.
- Confidence/limitations wording.

If reference data is unavailable or readings are too old, return a neutral “Check conditions” recommendation instead of an invented diagnosis. Keep rules in a separate module or table so they can be reviewed.

## 9. Simulation strategy
- Seed a deterministic dataset for demos.
- Store source as `simulated`.
- Use stable timestamps and values.
- Make the simulation mode explicit in the UI.
- Do not randomly mutate readings on every render.
- Keep simulated records separate from verified device readings.
- Allow a clear switch to manual entry where appropriate.

## 10. Error handling
- Validate user input both in UI and at the trusted boundary/database.
- Return safe, actionable error messages.
- Log technical detail only in trusted server logs.
- Never expose secret values, SQL internals, or stack traces to end users.
- Handle network failure and expired sessions.

## 11. Performance
- Optimize and size images.
- Use responsive image delivery.
- Avoid unnecessary heavy animation libraries and 3D assets.
- Limit or paginate long histories.
- Load chart code only where needed if bundle size requires it.
- Avoid unnecessary re-fetching and repeated queries.
- Measure before adding caching that might leak user-specific data.

## 12. Deployment
1. Create Supabase project.
2. Apply reviewed migrations.
3. Configure Auth redirect URLs.
4. Add environment variables to local development and Vercel.
5. Deploy preview.
6. Test auth, RLS, CRUD, and mobile behavior against preview.
7. Deploy production only after acceptance checks pass.

## 13. Future extension points
- IoT device gateway and authenticated ingestion.
- Sensor device registry.
- Notifications.
- AI assistant or image diagnosis after validating safety and accuracy.
- Multi-language UI.
- Exportable garden reports.

These are future options, not part of the MVP commitment.
