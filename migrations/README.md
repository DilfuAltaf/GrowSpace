# GrowSpace Database Migrations

This directory contains versioned PostgreSQL migration files for GrowSpace, targeting **Neon PostgreSQL** (PostgreSQL 15+).

These migrations implement the approved relational schema for GrowSpace's first-party authentication and garden tracking system.

---

## Confirmed Product Decision

**Fresh Start Architecture**: GrowSpace has no existing Firebase user accounts or user data that need migration. The application starts fresh with new user registrations.
- Every user registers with an email address and password.
- No legacy Firebase UID mapping tables (`legacy_firebase_user_map`) are included.
- No bulk password-reset migration campaigns or nullable password states are used.
- `users.password_hash` is strictly `NOT NULL` and enforces Argon2id formatting.

---

## Migration Manifest

| Migration File | Description | Entities Created | Dependencies |
| :--- | :--- | :--- | :--- |
| `0001_create_auth_tables.sql` | First-party authentication, sessions, security tokens, and rate limits | `users`, `sessions`, `auth_tokens`, `auth_rate_limits` | None (base layer) |
| `0002_create_catalog_tables.sql` | Global botanical reference library and target metric ranges | `plant_catalog`, `plant_catalog_reference_ranges` | None (reference data) |
| `0003_create_gardens_and_plants.sql` | User garden spaces and tracked plants with composite owner keys | `gardens`, `plants` | `users`, `plant_catalog` |
| `0004_create_sensor_readings_care_tasks_plant_logs.sql` | Sensor telemetry, care schedule, and plant journals | `sensor_readings`, `care_tasks`, `plant_logs` | `users`, `gardens`, `plants` |
| `0005_create_notifications.sql` | In-app care reminders, alerts, and read state tracking | `notifications` | `users` |
| `0006_create_plant_research.sql` | AI plant research profiles, citation metadata, and evidence confidence | `plant_research_records` | `users`, `plants` |
| `0007_create_care_schedules.sql` | Recurring care intervals and bounded schedule tracking | `care_schedules`, enhances `care_tasks` | `users`, `gardens`, `plants`, `care_tasks` |
| `0008_create_assistant_conversations.sql` | AI Farming Assistant conversation threads and message dialogue turns | `assistant_conversations`, `assistant_messages` | `users`, `gardens`, `plants` |

---

## Entity Dependency Graph

```text
users (0001)
 ├── sessions (0001)
 ├── auth_tokens (0001)
 ├── notifications (0005)
 ├── plant_research_records (0006)
 ├── assistant_conversations (0008)
 │    └── assistant_messages (0008)
 └── gardens (0003)
      └── plants (0003) ◄── plant_catalog (0002) ── plant_catalog_reference_ranges (0002)
           ├── plant_logs (0004)
           ├── sensor_readings [optional plant context] (0004)
           ├── care_tasks [optional plant context] (0004)
           ├── care_schedules [optional plant context] (0007)
           └── plant_research_records [optional plant link] (0006)

auth_rate_limits (0001) [independent operational table]
```

---

## Key Design & Safety Invariants

### 1. Deterministic Execution Order
Migrations must be executed strictly in ascending numerical sequence (`0001` -> ... -> `0008`). Every foreign key points to a primary key or unique constraint established in the same or an earlier migration file.

### 2. Idempotency & Schema Equivalence Strategy
- Every table is declared with `CREATE TABLE IF NOT EXISTS` containing all column definitions, primary keys, foreign keys, and check constraints inline.
- Every index is declared with `CREATE INDEX IF NOT EXISTS`.
- Running the migrations on an empty database or branch creates all database objects cleanly.
- Re-running the migrations against a previously migrated schema is safe against duplicate-object errors.
- **Important**: `IF NOT EXISTS` provides syntactic idempotency (preventing crash on re-run), but **does not guarantee semantic schema equivalence** on drifted or partially altered tables. Production deployments must use the migration history table (`_schema_migrations`) with cryptographic checksum verification and automated catalog validation queries.

### 3. Password and Token Security
- `users.password_hash`: Constrained by `NOT NULL` and `CHECK (password_hash LIKE '$argon2id$%')`. Plaintext passwords or non-Argon2id hashes cannot be inserted.
- `sessions.token_hash` & `sessions.csrf_token_hash`: Constrained to binary 32-byte SHA-256 digests (`CHECK (octet_length(...) = 32)`). Raw tokens exist only in client HttpOnly cookies.
- `auth_tokens.token_hash`: Constrained to binary 32-byte SHA-256 digests (`CHECK (octet_length(token_hash) = 32)`). Raw tokens appear only in email links.
- `auth_rate_limits.key_hash`: Constrained to binary 32-byte HMAC-SHA-256 digests (`CHECK (octet_length(key_hash) = 32)`). Raw IP addresses and emails are never persisted.

### 4. Auth Token Replacement & Concurrency Locking Protocol
- **Issue**: In PostgreSQL, a partial index cannot use time-dependent functions (e.g. `WHERE expires_at > now()`) because `now()` is `STABLE`, not `IMMUTABLE`. Furthermore, if a partial index on `(user_id, purpose) WHERE consumed_at IS NULL` were marked `UNIQUE`, any token that expired without being consumed would permanently block issuing a replacement token for that user and purpose.
- **Resolution**:
  - The partial index `auth_tokens_user_purpose_active_idx` is defined as a standard (non-unique) index on `(user_id, purpose) WHERE consumed_at IS NULL`.
  - Cryptographic uniqueness is enforced globally on `token_hash` via `auth_tokens_token_hash_key UNIQUE (token_hash)`.
  - **Required Concurrency Locking**: To prevent race conditions where concurrent issuance requests for the same user create duplicate unconsumed active tokens, application code **must acquire an exclusive row-level lock on the parent user entity** inside the transaction:
    ```sql
    BEGIN;
    -- 1. Explicitly serialize token issuance per user
    SELECT id FROM users WHERE id = $1 FOR UPDATE;

    -- 2. Atomically invalidate any active token for this user and purpose
    UPDATE auth_tokens
    SET consumed_at = now()
    WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL;

    -- 3. Insert the newly generated token digest
    INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
    VALUES ($1, $2, $3, $4);
    COMMIT;
    ```
  - *Edge case*: If the user does not exist (`SELECT ... FOR UPDATE` returns 0 rows), the application must immediately `ROLLBACK` and return a generic timing-safe response without inserting into `auth_tokens`.
  - Background cleanup jobs periodically purge expired records (`DELETE FROM auth_tokens WHERE expires_at < now() - INTERVAL '7 days'`).

### 5. Composite Foreign Keys & Column-List Deletion Actions
- `sensor_readings` and `care_tasks` reference both their parent garden and optional plant:
  - Garden reference: `FOREIGN KEY (garden_id, user_id) REFERENCES gardens(id, user_id) ON DELETE CASCADE`
  - Plant reference: `FOREIGN KEY (plant_id, garden_id, user_id) REFERENCES plants(id, garden_id, user_id) ON DELETE SET NULL (plant_id)`
- **PostgreSQL 15+ Semantics**:
  - In PostgreSQL 15+ (Neon is verified running PostgreSQL 18.6), the SQL-standard `ON DELETE SET NULL (plant_id)` action targets *only* the `plant_id` column when the referenced plant is deleted.
  - `garden_id` and `user_id` remain intact, preserving historical garden telemetry and garden tasks when a plant is retired or deleted.
  - Because `gardens(id, user_id)` and `plants(id, garden_id, user_id)` share composite keys, users cannot attach readings or tasks to another user's garden or plant.

### 6. Speculative Telemetry Source Annotation
- `sensor_readings.source` supports three values: `manual`, `simulated`, and `sensor`.
- In the current application implementation:
  - `manual`: Primary user write path for logging environmental readings.
  - `simulated`: Used for deterministic sample demo data.
  - `sensor`: **RESERVED / SPECULATIVE**. No hardware IoT devices or device ingestion endpoints exist in the current application. The column constraint accommodates future device integration without requiring a schema change, but application-level route handlers restrict user writes to `manual`.

### 7. Explicit Foreign Key Cascades
- Deleting a `user` cascades and cleans up `sessions`, `auth_tokens`, `gardens`, `plants`, `sensor_readings`, `care_tasks`, and `plant_logs`.
- Deleting a `garden` cascades and removes all contained `plants`, `sensor_readings`, and `care_tasks`.
- Deleting a `plant` cascades and removes attached `plant_logs`, while nullifying `plant_id` on associated `sensor_readings` and `care_tasks`.
- Deleting a `plant_catalog` entry is blocked (`ON DELETE RESTRICT`) if referenced by any plant.

---

## Production Execution & Cutover Guidelines

For the current production cutover of migrations `0007` and `0008`, including preflight queries, snapshot/recovery, postflight verification, and smoke tests, use:
- [docs/database/cutover-0007-0008.md](../docs/database/cutover-0007-0008.md)

For the historical Phase 4 cutover and migration runner architecture, see:
- [docs/database/production-cutover.md](../docs/database/production-cutover.md)

### Quick Reference: Migration Execution Order
1. `0001_create_auth_tables.sql` (Base identity, sessions, tokens, rate limits)
2. `0002_create_catalog_tables.sql` (Reference plant catalog and ranges)
3. `0003_create_gardens_and_plants.sql` (User gardens and plants)
4. `0004_create_sensor_readings_care_tasks_plant_logs.sql` (Telemetry, tasks, logs)
5. `0005_create_notifications.sql` (In-app notifications)
6. `0006_create_plant_research.sql` (AI plant research records)
7. `0007_create_care_schedules.sql` (Recurring care schedules, task linkage)
8. `0008_create_assistant_conversations.sql` (Assistant threads and messages)

