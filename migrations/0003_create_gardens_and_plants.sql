-- Migration: 0003_create_gardens_and_plants
-- Description: Creates user garden spaces and tracked plants with composite ownership integrity
-- Target: PostgreSQL 15+ (Neon)
-- Dependencies: 0001_create_auth_tables (users), 0002_create_catalog_tables (plant_catalog)

-- ============================================================================
-- 1. GARDENS
-- User-owned physical or indoor garden spaces.
-- Direct parent entity for plants, sensor readings, and care tasks.
-- ============================================================================
CREATE TABLE IF NOT EXISTS gardens (
    id UUID DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT NULL,
    location_label TEXT NULL,
    growing_method TEXT NULL,
    image_url TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT gardens_pkey PRIMARY KEY (id),
    CONSTRAINT gardens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT gardens_id_user_id_key UNIQUE (id, user_id),
    CONSTRAINT gardens_name_length_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT gardens_description_length_check CHECK (description IS NULL OR char_length(description) <= 500),
    CONSTRAINT gardens_location_label_length_check CHECK (location_label IS NULL OR char_length(location_label) <= 120),
    CONSTRAINT gardens_growing_method_check CHECK (growing_method IS NULL OR growing_method IN ('soil', 'hydroponic', 'container', 'raised_bed', 'other')),
    CONSTRAINT gardens_image_url_check CHECK (image_url IS NULL OR (char_length(image_url) <= 2048 AND image_url LIKE 'https://%'))
);

COMMENT ON TABLE gardens IS 'User-owned garden spaces; acts as ownership parent for plants, readings, and tasks';
COMMENT ON COLUMN gardens.id IS 'Unique garden identifier (UUID v4)';
COMMENT ON COLUMN gardens.user_id IS 'Owner user UUID; cascaded on user deletion';
COMMENT ON COLUMN gardens.name IS 'User-provided garden title (1-80 characters)';
COMMENT ON COLUMN gardens.location_label IS 'General location description (e.g. Balcony, Kitchen, Backyard)';
COMMENT ON COLUMN gardens.growing_method IS 'Growing technique (soil, hydroponic, container, raised_bed, other)';

-- Composite unique key (id, user_id) allows child records to enforce owner consistency via composite foreign keys
CREATE INDEX IF NOT EXISTS gardens_user_id_created_at_idx ON gardens(user_id, created_at DESC);

-- ============================================================================
-- 2. PLANTS
-- Individual plants tracked within a user garden.
-- Either links to a plant_catalog entry or uses a custom user-defined name.
-- ============================================================================
CREATE TABLE IF NOT EXISTS plants (
    id UUID DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    garden_id UUID NOT NULL,
    catalog_id TEXT NULL,
    custom_name TEXT NULL,
    planting_date DATE NULL,
    growth_stage TEXT NOT NULL DEFAULT 'seedling',
    status TEXT NOT NULL DEFAULT 'active',
    expected_harvest_date DATE NULL,
    actual_harvest_date DATE NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT plants_pkey PRIMARY KEY (id),
    CONSTRAINT plants_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT plants_garden_owner_fkey FOREIGN KEY (garden_id, user_id) REFERENCES gardens(id, user_id) ON DELETE CASCADE,
    CONSTRAINT plants_catalog_id_fkey FOREIGN KEY (catalog_id) REFERENCES plant_catalog(id) ON DELETE RESTRICT,
    CONSTRAINT plants_id_garden_id_user_id_key UNIQUE (id, garden_id, user_id),
    CONSTRAINT plants_id_user_id_key UNIQUE (id, user_id),
    CONSTRAINT plants_identification_check CHECK (catalog_id IS NOT NULL OR custom_name IS NOT NULL),
    CONSTRAINT plants_custom_name_length_check CHECK (custom_name IS NULL OR char_length(btrim(custom_name)) BETWEEN 1 AND 80),
    CONSTRAINT plants_growth_stage_check CHECK (growth_stage IN ('seedling', 'vegetative', 'flowering', 'fruiting', 'harvested')),
    CONSTRAINT plants_status_check CHECK (status IN ('active', 'archived', 'harvested')),
    CONSTRAINT plants_notes_length_check CHECK (notes IS NULL OR char_length(notes) <= 1000)
);

COMMENT ON TABLE plants IS 'Tracked plants owned by a user within a specific owned garden';
COMMENT ON COLUMN plants.id IS 'Unique plant identifier (UUID v4)';
COMMENT ON COLUMN plants.garden_id IS 'Parent garden identifier; must belong to the same user';
COMMENT ON COLUMN plants.catalog_id IS 'Optional reference to global plant_catalog; deletion restricted if referenced';
COMMENT ON COLUMN plants.custom_name IS 'User-provided custom plant name if not using catalog entry or custom variety';
COMMENT ON COLUMN plants.growth_stage IS 'Current lifecycle stage (seedling, vegetative, flowering, fruiting, harvested)';
COMMENT ON COLUMN plants.status IS 'Operational status (active, archived, harvested)';

-- Composite unique keys enable composite foreign keys from sensor_readings, care_tasks, and plant_logs
CREATE INDEX IF NOT EXISTS plants_user_id_created_at_idx ON plants(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS plants_garden_user_created_at_idx ON plants(garden_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS plants_catalog_id_idx ON plants(catalog_id);
