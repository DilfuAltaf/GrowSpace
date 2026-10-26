# User Flows — GrowSpace

## 1. Flow: visitor to first garden
1. Visitor opens landing page.
2. Visitor selects `Start Growing`.
3. If not authenticated, registration page opens.
4. User completes registration and verifies email if the auth configuration requires it.
5. User signs in and reaches onboarding or dashboard.
6. User selects `Create Garden`.
7. User enters garden name and optional details.
8. System validates and saves the garden.
9. User sees the garden detail/overview and an `Add Plant` action.

**Error paths:** invalid form, duplicate/invalid auth credentials, network error, session expiry. Preserve form inputs where safe and provide useful feedback.

## 2. Flow: add a plant
1. User opens a garden or My Plants.
2. User selects `Add Plant`.
3. User chooses a plant from the library or enters a supported custom plant name.
4. User chooses the owned garden.
5. User enters planting date, growth stage, and optional notes.
6. System validates garden ownership and required fields.
7. Plant is saved and appears in the garden and plant list.
8. User can open plant detail or create a care task.

## 3. Flow: manual monitoring entry
1. User opens Monitoring.
2. User chooses an owned garden.
3. User chooses `Manual entry`.
4. User selects measurement type, enters value/unit, timestamp, and optional note.
5. UI displays measurement-specific helper text and valid range guidance.
6. System validates numeric value, timestamp, unit, and garden ownership.
7. Reading is saved with source `manual`.
8. The chart and reading history update.
9. The entry remains labeled `Manual entry`.

**Failure path:** validation errors are inline; failed saves show an error and do not claim success.

## 4. Flow: view simulated monitoring
1. User selects a garden.
2. User chooses simulation mode or opens a seeded demo garden.
3. UI displays a persistent `Simulated` badge and explanatory copy.
4. User selects a date range.
5. Chart displays only the selected dataset and its timestamps.
6. Recommendations explicitly account for simulated source.
7. UI never describes these values as live sensor readings.

Simulation should be deterministic or seeded for a reliable competition demo. Do not generate misleading random changes every render.

## 5. Flow: act on a recommendation
1. Dashboard displays a recommendation with condition and reason.
2. User opens recommendation details.
3. UI shows relevant plant/garden, reading source/time, explanation, and suggested check.
4. User opens the related plant or creates a care task.
5. User records the action if performed.
6. Recommendation status/history updates only if that behavior is implemented and persisted.

If the evidence is insufficient, show a “Check conditions” suggestion instead of a definitive diagnosis.

## 6. Flow: complete care task
1. User opens Tasks or a dashboard task list.
2. User filters by Today, Upcoming, or Completed.
3. User opens a task or marks it complete.
4. System confirms the update and persists completion status/time.
5. Task appears in Completed.
6. On reload, the status remains unchanged.

## 7. Flow: edit or delete a garden
1. User opens garden detail.
2. User selects Edit or Delete.
3. Edit form loads current values.
4. Save validates and persists changes.
5. Delete displays a confirmation dialog explaining whether related records will be deleted or blocked.
6. Server/database policy enforces the chosen cascade/restrict behavior.
7. User sees success feedback only after the operation succeeds.

## 8. Flow: sign out
1. User opens profile/menu.
2. User selects Sign out.
3. Supabase session is ended.
4. User is redirected to a public page.
5. Protected routes no longer display private data.

## 9. Navigation map
Public:
- Landing → Plant Library → Plant Detail
- Landing → Login/Register
- About → Landing
Authenticated:
- Dashboard → Gardens → Garden Detail → Plant Detail
- Dashboard → Monitoring → Reading Detail or Manual Entry
- Dashboard → Analytics
- Dashboard → Tasks → Task Detail/Edit
- Dashboard → Settings → Sign out

## 10. Mobile interaction requirements
- Main navigation remains reachable without opening multiple nested menus.
- Long forms can use full-screen sheets.
- Confirm dialogs fit narrow screens.
- Chart tooltips can be activated by tap.
- Primary actions are not hidden below long decorative sections.
