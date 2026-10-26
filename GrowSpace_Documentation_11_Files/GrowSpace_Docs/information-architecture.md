# Information Architecture — GrowSpace

## 1. Sitemap
### Public
- `/` — Landing page
- `/plants` — Plant library
- `/plants/[slug]` — Plant reference detail
- `/about` — About GrowSpace
- `/login` — Sign in
- `/register` — Create account
- `/auth/callback` — Auth callback if required by Supabase configuration

### Authenticated
- `/dashboard` — Overview
- `/dashboard/gardens` — Garden list
- `/dashboard/gardens/new` — Create garden
- `/dashboard/gardens/[gardenId]` — Garden detail
- `/dashboard/gardens/[gardenId]/edit` — Edit garden
- `/dashboard/plants` — Plant list
- `/dashboard/plants/new` — Create plant
- `/dashboard/plants/[plantId]` — Plant detail
- `/dashboard/plants/[plantId]/edit` — Edit plant
- `/dashboard/monitoring` — Readings and charts
- `/dashboard/monitoring/new` — Manual reading form, or modal if preferred
- `/dashboard/analytics` — Trends and summaries
- `/dashboard/tasks` — Care task list
- `/dashboard/tasks/new` — Create task
- `/dashboard/tasks/[taskId]` — Task detail/edit
- `/dashboard/settings` — Profile and preferences

Route aliases may be consolidated into modal forms, but ownership checks must remain server/database enforced.

## 2. Navigation
### Desktop sidebar
- Overview
- Gardens
- My Plants
- Monitoring
- Analytics
- Care Tasks
- Settings

Use a visible active state and consistent icons. Avoid excessive nesting.

### Mobile primary navigation
Suggested four items:
- Home
- Gardens
- Monitor
- Tasks

Provide access to My Plants, Analytics, and Settings through a menu or relevant contextual links.

### Public navigation
- Plant Library
- About
- Log in
- Start Growing

## 3. Page responsibilities
- Landing: explain product and convert visitors to users.
- Plant Library: discover plant references.
- Dashboard: summarize state and priorities.
- Gardens: manage growing spaces.
- Plants: manage plant records and logs.
- Monitoring: view and enter environmental readings.
- Analytics: understand historical trends.
- Tasks: plan and record care.
- Settings: account and supported preferences.

Do not duplicate the same complex feature across multiple pages. The dashboard should summarize; detail pages should provide full controls.

## 4. Layout templates
- `PublicLayout`: public navbar, content, footer.
- `AuthLayout`: focused form, minimal distractions.
- `DashboardLayout`: sidebar/topbar/content on desktop; mobile navigation on narrow screens.
- `DetailLayout`: breadcrumb, title, primary action, main content, secondary metadata.
- `FormLayout`: title, helper copy, grouped fields, submit/cancel actions.

## 5. Route protection
- Public pages can be accessed without a session.
- Dashboard routes require an authenticated session.
- Unauthenticated users are redirected to login with a safe return path.
- After logout, protected routes must not reveal cached private data.
- Authentication redirects must not accept unsafe external destinations.

## 6. Responsive behavior
- At narrow widths, hide desktop sidebar and show mobile navigation/drawer.
- Metric cards can use two columns only when readable.
- Tables convert to cards or allow contained horizontal scrolling where appropriate; never force page-wide overflow.
- Filters wrap or move into a filter sheet on mobile.
- Forms use one column on mobile and may use two columns on wider screens for related fields.

## 7. Empty states
- No gardens: explain the benefit and show `Create Garden`.
- No plants: show `Add Plant` and link to Plant Library.
- No readings: explain manual entry and simulation options.
- No tasks: show `Create Task`.
- No analytics: explain that historical records are needed.
- Search with no results: show query and clear-filter action.

## 8. Naming conventions
Use consistent English route and component names. UI copy may use English initially, but all labels should be centralized so localization can be added later. Avoid mixing route naming styles.
