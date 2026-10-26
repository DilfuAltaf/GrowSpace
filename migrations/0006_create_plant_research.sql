-- Migration: 0006_create_plant_research
-- Description: Creates the plant_research_records table for AI-assisted plant cultivation research
-- Target: PostgreSQL 15+ (Neon)
-- Dependencies: 0001_create_auth_tables (users), 0003_create_gardens_and_plants (plants)

CREATE TABLE IF NOT EXISTS plant_research_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    plant_id UUID NULL,
    plant_name TEXT NOT NULL,
    scientific_name TEXT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    difficulty TEXT NULL,
    growing_medium TEXT NULL,
    light_guidance TEXT NULL,
    watering_guidance TEXT NULL,
    fertilizer_guidance TEXT NULL,
    temperature_min NUMERIC(6,2) NULL,
    temperature_max NUMERIC(6,2) NULL,
    humidity_min NUMERIC(6,2) NULL,
    humidity_max NUMERIC(6,2) NULL,
    moisture_min NUMERIC(6,2) NULL,
    moisture_max NUMERIC(6,2) NULL,
    harvest_days_min INTEGER NULL,
    harvest_days_max INTEGER NULL,
    cultivation_notes TEXT NULL,
    safety_notes TEXT NULL,
    confidence TEXT NOT NULL DEFAULT 'moderate',
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'completed',
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT plant_research_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT plant_research_records_plant_id_fkey FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE SET NULL,
    CONSTRAINT plant_research_records_plant_name_check CHECK (char_length(btrim(plant_name)) BETWEEN 1 AND 120),
    CONSTRAINT plant_research_records_scientific_name_check CHECK (scientific_name IS NULL OR char_length(scientific_name) <= 120),
    CONSTRAINT plant_research_records_category_check CHECK (char_length(btrim(category)) BETWEEN 1 AND 80),
    CONSTRAINT plant_research_records_difficulty_check CHECK (difficulty IS NULL OR difficulty IN ('easy', 'moderate', 'advanced')),
    CONSTRAINT plant_research_records_confidence_check CHECK (confidence IN ('high', 'moderate', 'low', 'insufficient')),
    CONSTRAINT plant_research_records_status_check CHECK (status IN ('draft', 'completed', 'failed')),
    CONSTRAINT plant_research_records_temp_range_check CHECK (temperature_min IS NULL OR temperature_max IS NULL OR temperature_max >= temperature_min),
    CONSTRAINT plant_research_records_humidity_range_check CHECK (humidity_min IS NULL OR humidity_max IS NULL OR humidity_max >= humidity_min),
    CONSTRAINT plant_research_records_moisture_range_check CHECK (moisture_min IS NULL OR moisture_max IS NULL OR moisture_max >= moisture_min),
    CONSTRAINT plant_research_records_harvest_range_check CHECK (harvest_days_min IS NULL OR harvest_days_max IS NULL OR harvest_days_max >= harvest_days_min)
);

-- Index for ordering research requests by user
CREATE INDEX IF NOT EXISTS idx_plant_research_records_user
    ON plant_research_records(user_id, created_at DESC);

-- Index for resolving attached research profile by plant
CREATE INDEX IF NOT EXISTS idx_plant_research_records_plant
    ON plant_research_records(plant_id)
    WHERE plant_id IS NOT NULL;

COMMENT ON TABLE plant_research_records IS 'AI-assisted plant cultivation research profiles with source citations';
COMMENT ON COLUMN plant_research_records.id IS 'Internal unique research record ID (UUID v4)';
COMMENT ON COLUMN plant_research_records.user_id IS 'Owner of the research record; references users(id)';
COMMENT ON COLUMN plant_research_records.plant_id IS 'Optional linked plant when saved as a custom plant; references plants(id)';
COMMENT ON COLUMN plant_research_records.plant_name IS 'Common or submitted name of researched plant (1-120 chars)';
COMMENT ON COLUMN plant_research_records.scientific_name IS 'Verified botanical binomial name';
COMMENT ON COLUMN plant_research_records.category IS 'Botanical classification (e.g. Vegetables, Herbs, Fruits)';
COMMENT ON COLUMN plant_research_records.difficulty IS 'Estimated difficulty (easy, moderate, advanced)';
COMMENT ON COLUMN plant_research_records.growing_medium IS 'Soil or substrate recommendations';
COMMENT ON COLUMN plant_research_records.light_guidance IS 'Sunlight/lighting requirements';
COMMENT ON COLUMN plant_research_records.watering_guidance IS 'Irrigation and moisture advice';
COMMENT ON COLUMN plant_research_records.fertilizer_guidance IS 'Nutrient requirements and feeding schedule';
COMMENT ON COLUMN plant_research_records.temperature_min IS 'Researched minimum safe temperature (°C)';
COMMENT ON COLUMN plant_research_records.temperature_max IS 'Researched maximum safe temperature (°C)';
COMMENT ON COLUMN plant_research_records.humidity_min IS 'Researched minimum relative humidity (%)';
COMMENT ON COLUMN plant_research_records.humidity_max IS 'Researched maximum relative humidity (%)';
COMMENT ON COLUMN plant_research_records.moisture_min IS 'Researched minimum medium moisture (%)';
COMMENT ON COLUMN plant_research_records.moisture_max IS 'Researched maximum medium moisture (%)';
COMMENT ON COLUMN plant_research_records.harvest_days_min IS 'Minimum days to harvest from planting';
COMMENT ON COLUMN plant_research_records.harvest_days_max IS 'Maximum days to harvest from planting';
COMMENT ON COLUMN plant_research_records.cultivation_notes IS 'General cultivation and pruning guidance';
COMMENT ON COLUMN plant_research_records.safety_notes IS 'Toxicity, spines, or handling warnings';
COMMENT ON COLUMN plant_research_records.confidence IS 'Evidence confidence score (high, moderate, low, insufficient)';
COMMENT ON COLUMN plant_research_records.sources IS 'JSON array of cited research sources with URLs and retrieval timestamps';
COMMENT ON COLUMN plant_research_records.status IS 'Status of research job (draft, completed, failed)';
COMMENT ON COLUMN plant_research_records.error_message IS 'Optional failure message if research failed';
