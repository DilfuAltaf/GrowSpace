# Database Schema — GrowSpace

## 1. Design goals
- PostgreSQL through Supabase.
- Every private record is owned by a user, directly or through a parent record.
- Row Level Security (RLS) is mandatory for user-owned tables.
- Use foreign keys and explicit delete behavior.
- Store timestamps in `timestamptz`.
- Keep source-of-data metadata for monitoring readings.
- Never place service-role credentials in client code.

Names below are proposed logical schema names; adjust after checking the current Supabase project.

## 2. Entities
### `profiles`
- `id uuid primary key references auth.users(id) on delete cascade`
- `display_name text`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Profile data should be minimal. Do not duplicate auth secrets or store sensitive data without a clear need.

### `gardens`
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `name text not null`
- `description text null`
- `location_label text null` — user-entered general label, not required precise coordinates
- `growing_method text null` — e.g. soil, hydroponic, container
- `image_url text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexes: `(user_id, created_at desc)`.

### `plant_catalog`
Reference content managed by the project, not user-owned.
- `id uuid primary key default gen_random_uuid()`
- `slug text unique not null`
- `common_name text not null`
- `scientific_name text null`
- `category text not null`
- `difficulty text null`
- `image_url text null`
- `light_guidance text null`
- `watering_guidance text null`
- `growing_method_notes text null`
- `harvest_days_min integer null`
- `harvest_days_max integer null`
- `reference_notes text null`
- `is_published boolean not null default false`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Public read access should expose published entries only. Write access is restricted to trusted maintainers.

### `plants`
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `garden_id uuid not null references gardens(id) on delete cascade`
- `catalog_id uuid null references plant_catalog(id) on delete set null`
- `custom_name text null`
- `planting_date date null`
- `growth_stage text not null default 'seedling'`
- `status text not null default 'active'`
- `expected_harvest_date date null`
- `actual_harvest_date date null`
- `notes text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints: `user_id` must match the owning garden's `user_id`; enforce through a secure trigger/policy design or avoid redundant `user_id` if ownership can be checked reliably through the garden. Validate enums or use lookup/check constraints.

### `sensor_readings`
The table name is retained for convenience, but it stores simulated and manual records too.
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `garden_id uuid not null references gardens(id) on delete cascade`
- `plant_id uuid null references plants(id) on delete set null`
- `measurement_type text not null` — `air_temperature`, `air_humidity`, `medium_moisture`
- `value numeric not null`
- `unit text not null`
- `source text not null` — `simulated`, `manual`, `sensor`
- `recorded_at timestamptz not null`
- `note text null`
- `created_at timestamptz not null default now()`

Indexes: `(garden_id, recorded_at desc)`, `(user_id, recorded_at desc)`.
Constraints: numeric value finite and plausible for the measurement; unit matches measurement type. Only use `source='sensor'` after verified sensor integration. The UI must not allow users to falsely mark arbitrary input as verified sensor data.

### `care_tasks`
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `garden_id uuid not null references gardens(id) on delete cascade`
- `plant_id uuid null references plants(id) on delete set null`
- `title text not null`
- `task_type text not null` — e.g. watering, fertilizing, inspect, harvest, other
- `description text null`
- `due_at timestamptz null`
- `status text not null default 'pending'` — `pending`, `completed`, `cancelled`
- `completed_at timestamptz null`
- `priority text not null default 'normal'` — `low`, `normal`, `high`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### `plant_logs`
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `plant_id uuid not null references plants(id) on delete cascade`
- `log_type text not null` — `growth`, `care`, `harvest`, `note`
- `title text null`
- `content text not null`
- `logged_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`

## 3. Relationships
- One auth user has many gardens.
- One garden has many plants.
- One garden has many readings.
- One plant can have many readings and logs.
- One garden has many care tasks.
- One plant can have many care tasks.
- Plant catalog entries can be referenced by many user plants.

## 4. Ownership and consistency
A user must not be able to attach a plant, reading, task, or log to a garden/plant owned by another user. Do not rely only on client-side filtering. Enforce through RLS plus foreign-key/trigger strategy where cross-table ownership must match.

When both `user_id` and a parent reference are stored, enforce that their owners match. Alternatively, omit redundant `user_id` and derive ownership through parent records, if that makes policies simpler and safer.

## 5. RLS policy requirements
Enable RLS on every private table:
- `profiles`: user can select/update only own profile.
- `gardens`: user can CRUD own gardens.
- `plants`: user can CRUD own plants and only within an owned garden.
- `sensor_readings`: user can CRUD own readings and only within an owned garden/plant.
- `care_tasks`: user can CRUD own tasks and only within an owned garden/plant.
- `plant_logs`: user can CRUD own logs and only for an owned plant.
- `plant_catalog`: public read only for published rows; write access restricted to trusted maintainers.

Test both allowed and denied access using two separate accounts. A policy that checks only a client-supplied `user_id` without validating parent ownership is insufficient.

## 6. Deletion behavior
- Deleting a user cascades their private records as configured.
- Deleting a garden should have an explicit documented cascade/restrict decision for plants, readings, and tasks.
- Deleting a plant should preserve historical readings only if the product explicitly supports orphaned readings; otherwise cascade or null the reference intentionally.
- Confirm destructive actions in the UI.

## 7. Seed data
Use deterministic demo data for a named demo garden. Mark every generated reading as `simulated`. Seed only non-sensitive examples. Avoid changing seeded values randomly on every render.

## 8. Migration and validation
- Keep schema changes in versioned SQL migration files.
- Add constraints and indexes deliberately.
- Verify all policies using authenticated test accounts.
- Do not run destructive schema changes against a production database without a backup and explicit review.
