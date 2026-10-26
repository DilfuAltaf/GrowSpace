-- Migration: 0004_create_sensor_readings_care_tasks_plant_logs
-- Description: Creates telemetry, care schedule, and plant journal tables with composite foreign keys
-- Target: PostgreSQL 15+ (Neon)
-- Dependencies: 0001_create_auth_tables (users), 0003_create_gardens_and_plants (gardens, plants)

-- ============================================================================
-- 1. SENSOR_READINGS
-- Environmental metric observations (temperature, humidity, moisture).
-- Supports simulated and manual readings. Hardware sensor is reserved/speculative.
-- ============================================================================
CREATE TABLE IF NOT EXISTS sensor_readings (
    id UUID DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    garden_id UUID NOT NULL,
    plant_id UUID NULL,
    measurement_type TEXT NOT NULL,
    value NUMERIC(6,2) NOT NULL,
    unit TEXT NOT NULL,
    source TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT sensor_readings_pkey PRIMARY KEY (id),
    CONSTRAINT sensor_readings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT sensor_readings_garden_owner_fkey FOREIGN KEY (garden_id, user_id) REFERENCES gardens(id, user_id) ON DELETE CASCADE,
    CONSTRAINT sensor_readings_plant_owner_fkey FOREIGN KEY (plant_id, garden_id, user_id) REFERENCES plants(id, garden_id, user_id) ON DELETE SET NULL (plant_id),
    CONSTRAINT sensor_readings_source_check CHECK (source IN ('simulated', 'manual', 'sensor')),
    CONSTRAINT sensor_readings_note_length_check CHECK (note IS NULL OR char_length(note) <= 500),
    CONSTRAINT sensor_readings_measurement_check CHECK (
        (measurement_type = 'air_temperature' AND unit = '°C' AND value BETWEEN -20.00 AND 70.00) OR
        (measurement_type = 'air_humidity' AND unit = '%' AND value BETWEEN 0.00 AND 100.00) OR
        (measurement_type = 'medium_moisture' AND unit = '%' AND value BETWEEN 0.00 AND 100.00)
    )
);

COMMENT ON TABLE sensor_readings IS 'Recorded environmental measurements with provenance tracking and range plausibility checks';
COMMENT ON COLUMN sensor_readings.id IS 'Unique sensor reading identifier (UUID v4)';
COMMENT ON COLUMN sensor_readings.garden_id IS 'Parent garden identifier; must match user_id';
COMMENT ON COLUMN sensor_readings.plant_id IS 'Optional plant context; nullified via ON DELETE SET NULL (plant_id) if plant is removed';
COMMENT ON COLUMN sensor_readings.source IS 'Provenance classification: manual (user web entry), simulated (demo seed dataset), sensor (RESERVED / SPECULATIVE: no hardware device integration currently exists in runtime)';
COMMENT ON COLUMN sensor_readings.recorded_at IS 'User-visible instant when the measurement occurred (defaults to now())';

-- Indexes for time-series charts, dashboard cards, and historical logs
CREATE INDEX IF NOT EXISTS sensor_readings_garden_recorded_at_idx ON sensor_readings(garden_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS sensor_readings_garden_measurement_idx ON sensor_readings(garden_id, measurement_type, recorded_at DESC);
CREATE INDEX IF NOT EXISTS sensor_readings_user_recorded_at_idx ON sensor_readings(user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS sensor_readings_plant_recorded_at_idx ON sensor_readings(plant_id, recorded_at DESC) WHERE plant_id IS NOT NULL;

-- ============================================================================
-- 2. CARE_TASKS
-- Actionable gardening tasks with schedules, priorities, and completion state.
-- ============================================================================
CREATE TABLE IF NOT EXISTS care_tasks (
    id UUID DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    garden_id UUID NOT NULL,
    plant_id UUID NULL,
    title TEXT NOT NULL,
    task_type TEXT NOT NULL DEFAULT 'other',
    description TEXT NULL,
    due_at TIMESTAMPTZ NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    completed_at TIMESTAMPTZ NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT care_tasks_pkey PRIMARY KEY (id),
    CONSTRAINT care_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT care_tasks_garden_owner_fkey FOREIGN KEY (garden_id, user_id) REFERENCES gardens(id, user_id) ON DELETE CASCADE,
    CONSTRAINT care_tasks_plant_owner_fkey FOREIGN KEY (plant_id, garden_id, user_id) REFERENCES plants(id, garden_id, user_id) ON DELETE SET NULL (plant_id),
    CONSTRAINT care_tasks_title_length_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
    CONSTRAINT care_tasks_task_type_check CHECK (task_type IN ('watering', 'fertilizing', 'inspect', 'harvest', 'other')),
    CONSTRAINT care_tasks_description_length_check CHECK (description IS NULL OR char_length(description) <= 1000),
    CONSTRAINT care_tasks_status_check CHECK (status IN ('pending', 'completed', 'cancelled')),
    CONSTRAINT care_tasks_priority_check CHECK (priority IN ('low', 'normal', 'high')),
    CONSTRAINT care_tasks_completed_at_consistency_check CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

COMMENT ON TABLE care_tasks IS 'Scheduled and completed garden tasks; retains garden context if optional plant is deleted';
COMMENT ON COLUMN care_tasks.id IS 'Unique care task identifier (UUID v4)';
COMMENT ON COLUMN care_tasks.garden_id IS 'Parent garden identifier; must match user_id';
COMMENT ON COLUMN care_tasks.plant_id IS 'Optional plant context; nullified via ON DELETE SET NULL (plant_id) if plant is removed';
COMMENT ON COLUMN care_tasks.task_type IS 'Action type (watering, fertilizing, inspect, harvest, other)';
COMMENT ON COLUMN care_tasks.status IS 'Task status (pending, completed, cancelled)';
COMMENT ON COLUMN care_tasks.completed_at IS 'Timestamp of task completion; strictly non-null iff status = completed';
COMMENT ON COLUMN care_tasks.priority IS 'Priority level (low, normal, high)';

-- Indexes for daily agenda, garden task views, and due date reminders
CREATE INDEX IF NOT EXISTS care_tasks_user_status_due_idx ON care_tasks(user_id, status, due_at);
CREATE INDEX IF NOT EXISTS care_tasks_garden_status_due_idx ON care_tasks(garden_id, status, due_at);
CREATE INDEX IF NOT EXISTS care_tasks_user_due_at_idx ON care_tasks(user_id, due_at);
CREATE INDEX IF NOT EXISTS care_tasks_plant_due_at_idx ON care_tasks(plant_id, due_at) WHERE plant_id IS NOT NULL;

-- ============================================================================
-- 3. PLANT_LOGS
-- Journal entries and observation notes attached directly to a plant.
-- ============================================================================
CREATE TABLE IF NOT EXISTS plant_logs (
    id UUID DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    plant_id UUID NOT NULL,
    log_type TEXT NOT NULL DEFAULT 'note',
    title TEXT NULL,
    content TEXT NOT NULL,
    logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT plant_logs_pkey PRIMARY KEY (id),
    CONSTRAINT plant_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT plant_logs_plant_owner_fkey FOREIGN KEY (plant_id, user_id) REFERENCES plants(id, user_id) ON DELETE CASCADE,
    CONSTRAINT plant_logs_log_type_check CHECK (log_type IN ('growth', 'care', 'harvest', 'note')),
    CONSTRAINT plant_logs_title_length_check CHECK (title IS NULL OR char_length(title) <= 120),
    CONSTRAINT plant_logs_content_length_check CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000)
);

COMMENT ON TABLE plant_logs IS 'Chronological journal observations and milestone notes for a plant';
COMMENT ON COLUMN plant_logs.id IS 'Unique plant log identifier (UUID v4)';
COMMENT ON COLUMN plant_logs.plant_id IS 'Target plant identifier; cascaded on plant deletion';
COMMENT ON COLUMN plant_logs.log_type IS 'Category of journal entry (growth, care, harvest, note)';
COMMENT ON COLUMN plant_logs.content IS 'Journal body text (1-2000 characters)';
COMMENT ON COLUMN plant_logs.logged_at IS 'User-specified timestamp of observation (defaults to now())';

-- Indexes for plant timeline and user recent activity
CREATE INDEX IF NOT EXISTS plant_logs_plant_logged_at_idx ON plant_logs(plant_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS plant_logs_user_logged_at_idx ON plant_logs(user_id, logged_at DESC);
