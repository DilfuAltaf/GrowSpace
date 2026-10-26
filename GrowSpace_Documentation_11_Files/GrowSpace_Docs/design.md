# Design System & UI Specification — GrowSpace

**Version:** 1.0  
**Direction:** Nature Friendly  
**Status:** Specification only; not implemented.

## 1. Design intent
GrowSpace should feel calm, natural, clear, and trustworthy. Use real plant photography, white/off-white surfaces, sage green accents, and readable data visualization. The interface should feel like a polished AgriTech product, not a decorative gardening blog.

### Principles
1. Nature first, without excessive botanical decoration.
2. Data readability over visual effects.
3. Every important alert should explain condition, reason, and next step.
4. Accessible to beginners.
5. Honest representation of simulated, manual, and verified sensor data.

## 2. Color tokens
### Brand
- `brand-sage`: `#587C63` — primary actions and brand accents.
- `brand-forest`: `#294D38` — headings, high-emphasis text, active navigation.
- `brand-soft-sage`: `#E5EDE3` — soft surfaces and selected states.
- `surface-page`: `#F7F8F3` — page background.
- `surface-card`: `#FFFFFF` — cards and modal surfaces.

### Neutral
- `text-primary`: `#243329`
- `text-secondary`: `#68756A`
- `border-default`: `#E2E7DF`
- `border-strong`: `#D5DDD3`

### Semantic
- `success`: `#28784B`
- `success-surface`: `#E1F1E5`
- `warning`: `#A86616`
- `warning-surface`: `#F8EBD8`
- `critical`: `#B54743`
- `critical-surface`: `#F8E2E0`
- `info`: `#4778B8`
- `info-surface`: `#E5EAF1`

Do not use pale sage for small text on white. Maintain WCAG AA contrast where applicable. Status must include text/icon, not color alone.

## 3. Typography
Primary typeface: **Plus Jakarta Sans**. Provide a sensible sans-serif fallback.

- Display: 48–56 px desktop, 34–40 px mobile, weight 600–700, line-height 1.15–1.25.
- H1: 32 px desktop, 28 px mobile, weight 600.
- H2: 24 px desktop, 22 px mobile, weight 600.
- H3: 18 px, weight 600.
- Body: 16 px desktop, 15–16 px mobile, line-height 1.5.
- Small: 14 px.
- Caption: 12 px, medium weight.
- Dashboard values should use tabular numerals where possible.

## 4. Spacing scale
Use 4 px base increments:
- `space-1`: 4 px
- `space-2`: 8 px
- `space-3`: 12 px
- `space-4`: 16 px
- `space-5`: 20 px
- `space-6`: 24 px
- `space-8`: 32 px
- `space-12`: 48 px
- `space-16`: 64 px
- `space-20`: 80 px

## 5. Layout and shape
- Desktop sidebar: approximately 248 px.
- Topbar: approximately 72 px.
- Main content max width: approximately 1440 px.
- Desktop horizontal content padding: 32 px.
- Tablet padding: 24 px.
- Mobile padding: 16–20 px.
- Standard card radius: 16 px.
- Button/input radius: 10–12 px.
- Badge radius: pill.
- Border: 1 px solid `#E2E7DF`.
- Shadow: subtle only, e.g. `0 4px 20px rgba(36, 51, 41, 0.04)`.

## 6. Photography
- Landing hero: 16:9 or wide crop.
- Plant/garden cards: 4:3.
- Prefer natural light and uncluttered backgrounds.
- Use consistent crop, rounded corners, optimized image sizes, responsive sources, and fallback states.
- Verify image licensing.
- Informative images require useful alt text; decorative images use empty alt text.

## 7. Component inventory
- `AppSidebar`
- `MobileNavigation`
- `Topbar`
- `PageHeader`
- `PrimaryButton`, `SecondaryButton`, `DestructiveButton`
- `MetricCard`
- `GardenCard`
- `PlantCard`
- `RecommendationCard`
- `CareTaskItem`
- `DataSourceBadge`
- `ChartCard`
- `FormField`
- `EmptyState`
- `LoadingSkeleton`
- `ErrorState`
- `ConfirmDialog`
- `Toast`
- `FilterBar`
- `DateRangePicker` if a date-range interaction is implemented

Every relevant component should support hover, focus, disabled, loading, error, and selected states.

## 8. Buttons and forms
- Button height target: 44–48 px.
- Use one clear primary action per major area.
- Labels remain visible; do not rely on placeholder text alone.
- Validation messages appear near the relevant field.
- Destructive actions require confirmation.
- Unsaved form changes should not disappear silently.

## 9. Dashboard desktop
Order:
1. Topbar: page title, date/context, notifications if implemented, profile.
2. Welcome header and `Add Plant` CTA.
3. Four metric cards: active plants, soil/media moisture, air temperature, tasks today.
4. Monitoring trend chart with time range.
5. Recommendations, limited to the most relevant items.
6. Garden cards.
7. Today's tasks.

Do not imply a metric is current unless the source and timestamp justify it.

## 10. Dashboard mobile
- Single-column flow with priority information first.
- Two-column metrics only when each card remains readable.
- Compact bottom navigation with four primary items; secondary routes remain accessible.
- Use bottom sheet or full-screen form for long mobile forms.
- No page-level horizontal overflow at 320 px.
- Touch targets should be approximately 44 x 44 px or larger.

## 11. Page specifications
### `/`
Navbar, hero, product value, problem/solution, dashboard preview, three-step workflow, feature highlights, CTA, footer.

### `/plants`
Search, category filters, plant cards, plant detail, care references, `Add to My Garden` for authenticated users.

### `/about`
Product mission, intended audience, explanation of simulation/manual data, contact/project information if available.

### `/login` and `/register`
Simple forms, validation, auth errors, password visibility control if implemented, recovery link, and return path.

### `/dashboard`
Welcome header, metric cards, monitoring chart, recommendations, gardens, tasks.

### `/dashboard/gardens`
Garden grid/list, create/edit form, garden detail, delete confirmation, empty state.

### `/dashboard/plants`
Plant list, filters, add/edit form, growth stage, planting date, detail view and logs.

### `/dashboard/monitoring`
Garden selector, source selector, reading cards, historical chart, date filter, manual input form, source label, last-reading timestamp, stale/no-data/error states.

### `/dashboard/analytics`
Historical trends, plant growth records, user-entered water-use records, harvest records, date filters. Clearly label estimates versus actuals.

### `/dashboard/tasks`
Today/upcoming/completed filters, task list, due dates, priorities, create/edit/complete actions.

### `/dashboard/settings`
Profile, supported display preferences, logout, and implemented account actions only.

## 12. Monitoring-specific visual rules
- `Simulated`: visible label plus explanation.
- `Manual entry`: visible label and entry timestamp.
- `Sensor`: only after verified device integration.
- `Stale`: show last update time.
- `No data`: explain how to add a reading.
- `Out of range`: show context-aware alert and suggested check.
- Use measurement-specific units and do not mix air humidity with soil/media moisture.

## 13. Chart rules
- Include title, time range, axis labels, and units.
- Use tooltips with date/time and value.
- Empty data produces an empty state, not invented zeros.
- Avoid relying on color alone to distinguish series.
- Include a concise text summary for accessibility.
- Keep animation short and respect reduced-motion preferences.

## 14. Motion
- Button transitions: approximately 150–200 ms.
- Card hover movement: no more than 2–3 px.
- Light entrance transitions only where useful.
- Avoid heavy 3D, constant motion, or large autoplay video backgrounds.
- Respect `prefers-reduced-motion`.

## 15. Accessibility
- Semantic headings and landmarks.
- Keyboard-accessible navigation and controls.
- Visible focus states.
- WCAG AA contrast targets: 4.5:1 for normal text.
- Inputs have permanent labels.
- Charts have text summaries.
- Status uses text/icon as well as color.
- Do not trap keyboard focus except in correctly implemented modal dialogs.

## 16. Responsive breakpoints
Use the project's Tailwind breakpoints as the implementation baseline:
- Small screens: below `sm`.
- Tablet/small laptop: `md` and `lg`.
- Desktop: `xl` and above.

Validate at 320 px, 375 px, 768 px, 1024 px, and 1440 px.
