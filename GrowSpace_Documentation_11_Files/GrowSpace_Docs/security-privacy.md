# Security & Privacy — GrowSpace

## 1. Security goals
Protect user accounts and private garden records, prevent cross-user access, avoid exposing credentials, and represent monitoring data honestly.

## 2. Authentication
- Use Supabase Auth rather than custom password storage.
- Support sign in, sign out, registration, and recovery flows that are configured.
- Protect authenticated routes and handle expired sessions.
- Validate redirects to prevent open redirects.
- Do not log passwords, tokens, or full session objects.
- Do not treat a client-side route guard as sufficient authorization.

## 3. Authorization and RLS
- Enable RLS on every table containing user-owned data.
- Write explicit select/insert/update/delete policies.
- Derive user identity from the authenticated database context, not a user ID submitted by the browser.
- Validate ownership through parent relationships, including garden → plant → reading/log/task.
- Prevent users from attaching records to another user's garden or plant.
- Test with at least two separate accounts and attempt cross-user reads and writes.
- Keep public plant catalog rows read-only to visitors and restrict catalog writes.

## 4. Secrets and environment
- Commit `.env.example`, not `.env`.
- Never put service-role secrets in browser variables.
- Use only publishable/anonymous credentials in browser contexts, protected by RLS.
- If a privileged key is ever required, keep it server-only, limit its use, and review the threat model.
- Rotate credentials if they are accidentally committed or shared.
- Avoid printing environment values in logs.

## 5. Input validation
- Validate all form fields at the UI and trusted boundary.
- Restrict text lengths.
- Validate numeric readings by measurement type and unit.
- Reject NaN, Infinity, invalid dates, and unsupported units.
- Sanitize or safely render user-entered text; do not inject it as raw HTML.
- Use parameterized database operations through supported clients.

## 6. Data source integrity
- `simulated` means generated demo data.
- `manual` means entered by a user.
- `sensor` is reserved for a verified device integration.
- The client must not be able to label a manual entry as a trusted sensor reading.
- Show recorded timestamps and stale-data warnings.
- Recommendations should account for source and age of data.

## 7. Privacy principles
- Collect only profile and garden information needed for the product.
- Make location optional; avoid collecting precise coordinates unless clearly needed and consented to.
- Do not ask for sensitive personal information.
- Do not expose one user's garden names, notes, readings, or activity to another user.
- Define how account deletion affects related records.
- Use production analytics only if needed and disclose relevant collection.

## 8. File and image uploads
If image upload is implemented:
- Restrict file types and file size.
- Verify actual content type rather than trusting the extension alone.
- Use user-scoped storage paths and storage policies.
- Avoid public access for private user uploads unless intentionally designed.
- Provide delete/update behavior and handle orphaned files.
- Do not include upload support in MVP unless needed.

## 9. Errors and logging
- Show users generic, useful messages.
- Keep stack traces and database internals out of client responses.
- Do not log auth tokens, passwords, or sensitive personal details.
- Use request IDs or safe metadata when debugging.
- Avoid storing unnecessary raw request payloads.

## 10. Minimum security test suite
- User A cannot read User B's gardens.
- User A cannot update or delete User B's plants.
- User A cannot insert a reading linked to User B's garden.
- User A cannot create a task for User B's plant.
- Anonymous visitors cannot access protected data.
- Logout prevents access to private pages and data.
- Public plant catalog exposes only published records.
- Browser bundle and source maps do not contain privileged secrets.
- Invalid units and impossible values are rejected.
- Simulated readings cannot be represented as verified sensor data.

## 11. Incident response basics
If credentials are exposed:
1. Revoke or rotate the affected credential.
2. Review logs and affected resources.
3. Remove the secret from current code and repository history where appropriate.
4. Re-deploy and re-test.
5. Document the incident and prevention action.

## 12. Important limitation
This document is a development baseline, not a formal security audit or certification. Security controls must be tested in the actual Supabase project and deployment environment.
