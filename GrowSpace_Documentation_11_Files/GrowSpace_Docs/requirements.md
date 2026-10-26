# Product Requirements — GrowSpace

## 1. Purpose
This document defines what the MVP must do and the quality constraints it must satisfy.

## 2. Roles
- **Visitor:** can view public landing page, About page, and plant library.
- **Authenticated user:** can manage only their own gardens, plants, readings, tasks, and logs.
- **Admin/operator:** not a separate product role in the MVP. Database administration is handled through trusted Supabase tooling, never exposed as a public client capability.

## 3. Functional requirements

### FR-01 Public pages
The system shall display a responsive landing page with product explanation, feature highlights, dashboard preview, and clear calls to action.

### FR-02 Plant library
The system shall list plant reference entries with name, category, image, difficulty, and basic care information. Search and category filters should work. Reference content should be stored in a maintainable source rather than duplicated in UI components.

### FR-03 Authentication
The system shall allow users to register, sign in, sign out, and recover access through supported Supabase Auth flows. Protected pages shall redirect unauthenticated users to sign in.

### FR-04 Garden management
Authenticated users shall create, read, update, and delete their own gardens. A garden may contain multiple plants. Deleting a garden must use confirmation and follow documented child-record behavior.

### FR-05 Plant management
Users shall add plants to their own gardens, edit plant details, view plant details, and record growth notes. Plant records shall include planting date and growth status where applicable.

### FR-06 Monitoring readings
Users shall be able to:
- View readings filtered by garden and measurement type.
- Add a manual reading with measurement, numeric value, unit, timestamp, and optional note.
- View reading source and timestamp.
- See seeded simulation data only when simulation mode is clearly active.
- Distinguish missing or stale data from current data.

### FR-07 Charts and analytics
The system shall display historical readings in charts with readable axes, units, date range, and source label. Empty or insufficient data shall produce an empty state rather than a fabricated chart.

### FR-08 Recommendations
The system shall show rule-based recommendations when sufficient context exists. Each recommendation should include:
- A concise title.
- The observed condition or trigger.
- Why it matters.
- A suggested check or action.
- Relevant plant/growing-method context.
- A disclaimer when the advice is general or data is simulated.

If the data is insufficient, the system shall say so instead of inventing a confident recommendation.

### FR-09 Care tasks
Users shall create, edit, complete, reopen where allowed, and delete care tasks. Tasks shall include title, related plant or garden, due date, status, and optional notes. Completion shall be persisted.

### FR-10 Plant and growth logs
Users shall add dated notes about plant progress, care actions, and harvest records. The interface shall distinguish a planned/estimated harvest from a recorded actual harvest.

### FR-11 Settings
Users shall view and update supported profile and display preferences, including temperature units if both units are implemented. Settings that are not implemented must not appear as working controls.

### FR-12 Feedback states
Every data-driven page shall handle loading, empty, success, and error states. Mutating actions shall provide visible feedback.

## 4. Non-functional requirements
- **Accessibility:** semantic HTML, keyboard access, visible focus, labels for inputs, sufficient contrast, and reduced-motion support.
- **Responsive:** support 320 px mobile width through wide desktop screens without page-level horizontal overflow.
- **Performance:** optimize images; avoid large decorative libraries unless justified; paginate or limit long histories.
- **Reliability:** show recoverable errors and avoid silently discarding unsaved form data.
- **Security:** enforce ownership with Supabase Row Level Security; never expose service-role credentials in browser code.
- **Privacy:** collect only data needed for the product; provide logout and account-data handling consistent with the implementation.
- **Maintainability:** reusable UI components, typed data models, centralized validation, and documented environment variables.
- **Honesty:** simulated, manual, and sensor data must be represented accurately.

## 5. Data validation requirements
- Required fields cannot be blank.
- Numeric readings must be finite numbers and must pass measurement-specific plausibility validation.
- Units must match measurement type.
- Timestamps must be valid and timezone-aware in storage; display in the user's local timezone.
- Garden and plant references must belong to the current user.
- Text fields should have reasonable length limits.
- Invalid or missing chart data must not be converted to fake zero values.

## 6. Acceptance criteria by workflow
### Create garden
Given an authenticated user, when they submit a valid garden form, then the garden is saved and appears in their list. Invalid input shows an inline error. A different user cannot read or edit it.

### Add plant
Given a garden owned by the user, when they add a valid plant, then it appears in the garden and plant list. The garden selector must not expose another user's gardens.

### Add reading
Given an owned garden, when the user records a manual reading, then it is saved with source `manual`, timestamp, unit, and user/garden ownership. The UI labels it as manual entry.

### Simulation
When simulation mode is active, the UI labels the displayed dataset as simulated. The product must not describe those values as live sensor readings.

### Complete task
When the user marks a task complete, the status persists after reload and the completion time is recorded where supported.

## 7. Out of scope
Real-time sensor streaming, device provisioning, AI diagnosis, chatbot, marketplace, community, payments, native apps, and unvalidated claims of yield or water savings.
