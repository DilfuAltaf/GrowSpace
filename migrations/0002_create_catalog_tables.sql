-- Migration: 0002_create_catalog_tables
-- Description: Creates the reference plant catalog and normalized measurement ranges
-- Target: PostgreSQL 15+ (Neon)
-- Dependencies: None (global reference library maintained by system maintainers)

-- ============================================================================
-- 1. PLANT_CATALOG
-- Global botanical reference library. Not user-owned.
-- Public read access exposes published rows (is_published = true).
-- ============================================================================
CREATE TABLE IF NOT EXISTS plant_catalog (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    common_name TEXT NOT NULL,
    scientific_name TEXT NULL,
    category TEXT NOT NULL,
    difficulty TEXT NULL,
    image_url TEXT NULL,
    light_guidance TEXT NULL,
    watering_guidance TEXT NULL,
    growing_method_notes TEXT NULL,
    harvest_days_min INTEGER NULL,
    harvest_days_max INTEGER NULL,
    reference_notes TEXT NULL,
    is_published BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT plant_catalog_slug_key UNIQUE (slug),
    CONSTRAINT plant_catalog_id_check CHECK (char_length(btrim(id)) BETWEEN 1 AND 128),
    CONSTRAINT plant_catalog_slug_check CHECK (char_length(btrim(slug)) BETWEEN 1 AND 100 AND slug = lower(btrim(slug))),
    CONSTRAINT plant_catalog_common_name_check CHECK (char_length(btrim(common_name)) BETWEEN 1 AND 120),
    CONSTRAINT plant_catalog_category_check CHECK (char_length(btrim(category)) BETWEEN 1 AND 80),
    CONSTRAINT plant_catalog_difficulty_check CHECK (difficulty IS NULL OR difficulty IN ('easy', 'moderate', 'advanced')),
    CONSTRAINT plant_catalog_image_url_check CHECK (image_url IS NULL OR (char_length(image_url) <= 2048 AND image_url LIKE 'https://%')),
    CONSTRAINT plant_catalog_harvest_days_min_check CHECK (harvest_days_min IS NULL OR harvest_days_min >= 0),
    CONSTRAINT plant_catalog_harvest_days_max_check CHECK (harvest_days_max IS NULL OR harvest_days_max >= 0),
    CONSTRAINT plant_catalog_harvest_days_range_check CHECK (harvest_days_min IS NULL OR harvest_days_max IS NULL OR harvest_days_max >= harvest_days_min)
);

COMMENT ON TABLE plant_catalog IS 'Global reference plant catalog library; managed by maintainers, referenced by user plants';
COMMENT ON COLUMN plant_catalog.id IS 'Deterministic stable identifier (catalog-<slug>)';
COMMENT ON COLUMN plant_catalog.slug IS 'Unique URL-safe kebab-case identifier';
COMMENT ON COLUMN plant_catalog.common_name IS 'Primary common plant name (e.g. Tomato, Basil)';
COMMENT ON COLUMN plant_catalog.scientific_name IS 'Botanical binomial or genus name (e.g. Solanum lycopersicum)';
COMMENT ON COLUMN plant_catalog.category IS 'Broad category (e.g. Vegetables, Herbs, Fruits)';
COMMENT ON COLUMN plant_catalog.difficulty IS 'Growing difficulty classification (easy, moderate, advanced)';
COMMENT ON COLUMN plant_catalog.is_published IS 'Visibility flag; only published entries are visible to public consumers';

-- Indexes for public listing, search, and filtering
CREATE INDEX IF NOT EXISTS plant_catalog_published_category_name_idx ON plant_catalog(is_published, category, common_name);

-- ============================================================================
-- 2. PLANT_CATALOG_REFERENCE_RANGES
-- Normalized environmental measurement ranges per catalog plant.
-- Stores target baseline ranges for temperature, humidity, and moisture.
-- ============================================================================
CREATE TABLE IF NOT EXISTS plant_catalog_reference_ranges (
    plant_catalog_id TEXT NOT NULL,
    measurement_type TEXT NOT NULL,
    min_value NUMERIC(6,2) NOT NULL,
    max_value NUMERIC(6,2) NOT NULL,

    -- Constraints
    CONSTRAINT plant_catalog_reference_ranges_pkey PRIMARY KEY (plant_catalog_id, measurement_type),
    CONSTRAINT plant_catalog_reference_ranges_plant_catalog_id_fkey FOREIGN KEY (plant_catalog_id) REFERENCES plant_catalog(id) ON DELETE CASCADE,
    CONSTRAINT plant_catalog_reference_ranges_measurement_type_check CHECK (measurement_type IN ('air_temperature', 'air_humidity', 'medium_moisture')),
    CONSTRAINT plant_catalog_reference_ranges_values_check CHECK (min_value <= max_value)
);

COMMENT ON TABLE plant_catalog_reference_ranges IS 'Target environmental metric ranges for catalog plants (12 entries x 3 metrics = 36 rows)';
COMMENT ON COLUMN plant_catalog_reference_ranges.plant_catalog_id IS 'Foreign key to parent plant_catalog entry';
COMMENT ON COLUMN plant_catalog_reference_ranges.measurement_type IS 'Metric type (air_temperature in °C, air_humidity in %, medium_moisture in %)';
COMMENT ON COLUMN plant_catalog_reference_ranges.min_value IS 'Lower bound of target recommended range';
COMMENT ON COLUMN plant_catalog_reference_ranges.max_value IS 'Upper bound of target recommended range';
