-- Migration: 0007_create_care_schedules
-- Description: Creates care_schedules table for recurring plant care intervals and links tasks to schedules
-- Target: PostgreSQL 15+ (Neon / PGlite)
-- Dependencies: 0001_create_auth_tables (users), 0003_create_gardens_and_plants (gardens, plants), 0004_create_sensor_readings_care_tasks_plant_logs (care_tasks)

-- ============================================================================
-- 1. CARE_SCHEDULES
-- Configurable recurring rules for watering, fertilizing, pruning, and garden tasks
-- ============================================================================
CREATE TABLE IF NOT EXISTS care_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    garden_id UUID NOT NULL,
    plant_id UUID NULL,
    title TEXT NOT NULL,
    task_type TEXT NOT NULL DEFAULT 'watering',
    description TEXT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    interval_value INTEGER NOT NULL,
    interval_unit TEXT NOT NULL DEFAULT 'days',
    is_active BOOLEAN NOT NULL DEFAULT true,
    next_due_at TIMESTAMPTZ NOT NULL,
    last_generated_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT care_schedules_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT care_schedules_garden_owner_fkey FOREIGN KEY (garden_id, user_id) REFERENCES gardens(id, user_id) ON DELETE CASCADE,
    CONSTRAINT care_schedules_plant_owner_fkey FOREIGN KEY (plant_id, garden_id, user_id) REFERENCES plants(id, garden_id, user_id) ON DELETE SET NULL (plant_id),
    CONSTRAINT care_schedules_title_length_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
    CONSTRAINT care_schedules_description_length_check CHECK (description IS NULL OR char_length(description) <= 1000),
    CONSTRAINT care_schedules_interval_value_check CHECK (interval_value BETWEEN 1 AND 365),
    CONSTRAINT care_schedules_interval_unit_check CHECK (interval_unit IN ('days', 'weeks', 'months')),
    CONSTRAINT care_schedules_task_type_check CHECK (task_type IN ('watering', 'fertilizing', 'pruning', 'inspect', 'harvest', 'other')),
    CONSTRAINT care_schedules_priority_check CHECK (priority IN ('low', 'normal', 'high'))
);

COMMENT ON TABLE care_schedules IS 'Recurring plant care schedules specifying recurrence intervals and next occurrence';
COMMENT ON COLUMN care_schedules.id IS 'Unique care schedule identifier (UUID v4)';
COMMENT ON COLUMN care_schedules.garden_id IS 'Parent garden identifier; must match user_id';
COMMENT ON COLUMN care_schedules.plant_id IS 'Optional plant target; nullified via ON DELETE SET NULL (plant_id) if plant is removed';
COMMENT ON COLUMN care_schedules.interval_value IS 'Recurrence quantity (1 to 365)';
COMMENT ON COLUMN care_schedules.interval_unit IS 'Recurrence time unit (days, weeks, months)';
COMMENT ON COLUMN care_schedules.is_active IS 'Whether the recurring rule actively generates upcoming tasks';
COMMENT ON COLUMN care_schedules.next_due_at IS 'Next scheduled occurrence timestamp for generation';

-- Indexes for active schedule evaluation and garden filtering
CREATE INDEX IF NOT EXISTS care_schedules_user_active_idx ON care_schedules(user_id, is_active, next_due_at);
CREATE INDEX IF NOT EXISTS care_schedules_garden_idx ON care_schedules(garden_id);
CREATE INDEX IF NOT EXISTS care_schedules_plant_idx ON care_schedules(plant_id) WHERE plant_id IS NOT NULL;

-- ============================================================================
-- 2. ENHANCE CARE_TASKS
-- Add optional schedule linkage and allow 'pruning' in task_type
-- ============================================================================
ALTER TABLE care_tasks ADD COLUMN IF NOT EXISTS schedule_id UUID NULL;

ALTER TABLE care_tasks DROP CONSTRAINT IF EXISTS care_tasks_schedule_id_fkey;
ALTER TABLE care_tasks ADD CONSTRAINT care_tasks_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES care_schedules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS care_tasks_schedule_id_idx ON care_tasks(schedule_id) WHERE schedule_id IS NOT NULL;

-- Update task_type check constraint to include pruning
ALTER TABLE care_tasks DROP CONSTRAINT IF EXISTS care_tasks_task_type_check;
ALTER TABLE care_tasks ADD CONSTRAINT care_tasks_task_type_check CHECK (task_type IN ('watering', 'fertilizing', 'pruning', 'inspect', 'harvest', 'other'));
