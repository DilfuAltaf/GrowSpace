# GrowSpace — Project Documentation

**Tagline:** Grow Smarter. Grow Naturally.  
**Product category:** Smart & Urban Farming / AgriTech  
**Document set:** 11 project documents  
**Status:** Planning and specification — implementation has not started.

## 1. Product summary
GrowSpace is a responsive web platform that helps people manage small gardens, track plants, review environmental readings, understand trends, and follow care tasks. The first version is designed for home growers, students, schools, and urban gardeners.

## 2. Core product principle
**Turn farming data into understandable, actionable decisions — with or without IoT hardware.**

The MVP uses clearly labeled simulated readings and manual data entry. It must never present simulated values as readings from a real connected sensor.

## 3. Documentation index
1. `README.md` — project overview and navigation.
2. `product-brief.md` — vision, users, value proposition, and success measures.
3. `requirements.md` — functional and non-functional requirements.
4. `design.md` — visual design system and UI specifications.
5. `user-flows.md` — primary user journeys and interaction flows.
6. `information-architecture.md` — routes, navigation, page responsibilities, and responsive behavior.
7. `database-schema.md` — entities, relationships, fields, and data rules.
8. `technical-architecture.md` — stack, application structure, and integration boundaries.
9. `security-privacy.md` — authentication, authorization, data safety, and privacy rules.
10. `testing-qa.md` — test strategy and acceptance checks.
11. `tasks.md` — phased implementation backlog and definition of done.

## 4. Recommended stack
- Frontend: Next.js App Router + TypeScript.
- Styling: Tailwind CSS.
- UI primitives: shadcn/ui where useful, with Lucide icons.
- Charts: Recharts.
- Backend and database: Supabase PostgreSQL.
- Authentication: Supabase Auth.
- Hosting: Vercel for the web application; Supabase for database and auth.

Do not add a separate NestJS backend, IoT device integration, AI assistant, or marketplace to the MVP unless the competition requirements explicitly demand it.

## 5. MVP scope
- Public landing page and plant library.
- Sign up, sign in, and sign out.
- Authenticated dashboard.
- Garden CRUD and plant CRUD.
- Monitoring readings via manual input and seeded simulation.
- Historical charts with source labels and timestamps.
- Basic rule-based recommendations based on configured plant-care references.
- Care task CRUD and completion history.
- Responsive UI, empty/loading/error states, and secure user data isolation.

## 6. Product integrity rules
- Simulated data must carry a visible `Simulated` label and explanatory copy.
- Manual entries must carry a `Manual entry` label and creation timestamp.
- Only confirmed device integrations may use a `Sensor` label.
- Estimated harvest dates must be labeled as estimates.
- Do not claim measurable water savings or improved yields without validated data.
- Recommendations should explain their reason and should not use one universal threshold for all plants and growing methods.

## 7. Implementation guidance
Work phase by phase. Do not build every page at once. Before each phase, review its task list and acceptance criteria. After implementation, run type checks, lint, tests, and a manual smoke test before proceeding.

## 8. Out of scope for MVP
- Real IoT hardware and live sensor connectivity.
- AI plant disease diagnosis.
- AI chatbot.
- Social network/community features.
- Marketplace.
- Native mobile app.
- Payment processing.

## 9. Current status
All documents describe the planned product. They are not evidence that features have already been implemented.
