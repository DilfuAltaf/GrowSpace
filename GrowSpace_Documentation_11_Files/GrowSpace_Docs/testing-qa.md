# Testing & QA Plan — GrowSpace

## 1. Test objectives
Verify that core user journeys work, data persists, user records are isolated, data source labels remain accurate, and the UI works on mobile and desktop.

## 2. Test levels
### Unit tests
Test pure functions and validation:
- Unit conversion and formatting.
- Measurement validation.
- Recommendation rule selection.
- Date calculations and harvest estimate labels.
- Filtering and aggregation helpers.

### Component tests
Test:
- Metric cards with missing/stale values.
- Source badges.
- Form validation and error rendering.
- Empty states.
- Task completion control.
- Chart empty state and accessible summary.

### Integration tests
Test:
- Authenticated CRUD against a test database.
- Garden/plant relationships.
- Manual reading persistence.
- Chart query filters.
- Task status persistence.
- RLS policies with separate test accounts.

### End-to-end tests
Test primary journeys in a browser:
- Register/sign in.
- Create garden.
- Add plant.
- Add manual reading.
- Review chart.
- Create and complete task.
- Sign out and verify protected route behavior.

## 3. Functional test cases
### Authentication
- Valid registration follows configured confirmation behavior.
- Valid sign-in opens dashboard.
- Invalid credentials show a safe error.
- Sign-out ends access to private routes.
- Expired session is handled without exposing stale private data.

### Garden and plant CRUD
- Create/edit/delete garden.
- Add plant to an owned garden.
- Required fields are validated.
- A plant cannot be attached to another user's garden.
- Deletion behavior matches the documented cascade/restrict policy.

### Monitoring
- Manual reading is persisted with source `manual`.
- Simulated readings visibly say `Simulated`.
- Sensor label is not available without verified integration.
- Filters use the selected garden and date range.
- Invalid value, unit, or timestamp is rejected.
- Stale readings are labeled as stale.
- No readings show a helpful empty state.
- Missing values are not rendered as zero.

### Recommendations
- Rule triggers are deterministic and tested.
- Recommendation includes the reason and suggested check.
- Different plant/method context can change applicable guidance.
- Old or insufficient data does not create a confident diagnosis.
- Simulated data remains disclosed in recommendation context.

### Care tasks
- Create/edit/delete task.
- Complete task and reload; completed status persists.
- Filters return correct results.
- Task references an owned garden/plant only.

### Analytics
- Chart labels include measurement and unit.
- Date-range filter changes the query/result.
- Empty datasets do not show fabricated trends.
- Estimated harvest and actual harvest are distinguished.

## 4. Authorization test cases
Use User A and User B:
1. User A tries to read User B's garden by ID.
2. User A tries to update/delete User B's garden.
3. User A tries to attach a plant to User B's garden.
4. User A tries to insert a reading for User B's garden.
5. User A tries to create a task for User B's plant.
6. Anonymous user attempts protected data access.
Expected result: denied at the database/policy boundary, not merely hidden by UI.

## 5. Responsive test matrix
Test at:
- 320 px: smallest mobile.
- 375 px: common mobile.
- 768 px: tablet.
- 1024 px: small desktop/tablet landscape.
- 1440 px: desktop.

Check navigation, forms, charts, dialogs, card wrapping, text clipping, and horizontal overflow.

## 6. Accessibility checks
- Keyboard navigation works.
- Focus indicator is visible.
- Input labels are programmatically associated.
- Color contrast meets WCAG AA targets for normal text.
- Status is not conveyed by color alone.
- Modal focus behavior is correct.
- Reduced motion is respected.
- Charts have accessible text summaries.

## 7. Browser and runtime checks
Test current stable Chrome and at least one additional browser if time allows. Check console errors, failed network requests, auth redirects, and environment configuration.

## 8. Pre-demo smoke checklist
- [ ] Production/preview environment variables configured.
- [ ] Database migrations applied.
- [ ] RLS verified with two accounts.
- [ ] Demo data is deterministic and clearly simulated.
- [ ] Landing and dashboard load without console errors.
- [ ] Garden and plant CRUD work.
- [ ] Manual readings persist.
- [ ] Charts show correct units and timestamps.
- [ ] Recommendations explain their reason.
- [ ] Tasks persist after reload.
- [ ] Mobile layout tested.
- [ ] No secrets in repository or browser bundle.
- [ ] Demo account contains no personal or sensitive data.

## 9. Definition of release readiness
Release only when all critical flows pass, no known critical authorization issue remains, simulated data is clearly labeled, and no blocking responsive defect remains. Record any accepted non-critical limitations before the competition demo.
