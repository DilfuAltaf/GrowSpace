import type {
  PlantResearchProfile,
  PlantResearchRecord,
  ResearchConfidence,
  ResearchSource,
} from '@growspace/shared';
import { executeQuery, type Queryable } from '../auth/db-client';

export interface ResearchDbRow {
  id: string;
  user_id: string;
  plant_id: string | null;
  plant_name: string;
  scientific_name: string | null;
  category: string;
  difficulty: string | null;
  growing_medium: string | null;
  light_guidance: string | null;
  watering_guidance: string | null;
  fertilizer_guidance: string | null;
  temperature_min: string | number | null;
  temperature_max: string | number | null;
  humidity_min: string | number | null;
  humidity_max: string | number | null;
  moisture_min: string | number | null;
  moisture_max: string | number | null;
  harvest_days_min: number | null;
  harvest_days_max: number | null;
  cultivation_notes: string | null;
  safety_notes: string | null;
  confidence: string;
  sources: ResearchSource[] | string;
  status: string;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function parseNumeric(val: string | number | null | undefined): number | null {
  if (val == null) return null;
  const num = typeof val === 'number' ? val : parseFloat(val);
  return Number.isFinite(num) ? num : null;
}

function parseSources(val: unknown): ResearchSource[] {
  if (!val) return [];
  if (Array.isArray(val)) return val as ResearchSource[];
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function toResearchRecord(row: ResearchDbRow): PlantResearchRecord {
  return {
    id: row.id,
    userId: row.user_id,
    plantId: row.plant_id ?? null,
    plantName: row.plant_name,
    scientificName: row.scientific_name ?? null,
    category: row.category,
    difficulty: (row.difficulty as PlantResearchRecord['difficulty']) ?? null,
    growingMedium: row.growing_medium ?? null,
    lightGuidance: row.light_guidance ?? null,
    wateringGuidance: row.watering_guidance ?? null,
    fertilizerGuidance: row.fertilizer_guidance ?? null,
    temperatureMin: parseNumeric(row.temperature_min),
    temperatureMax: parseNumeric(row.temperature_max),
    humidityMin: parseNumeric(row.humidity_min),
    humidityMax: parseNumeric(row.humidity_max),
    moistureMin: parseNumeric(row.moisture_min),
    moistureMax: parseNumeric(row.moisture_max),
    harvestDaysMin: row.harvest_days_min ?? null,
    harvestDaysMax: row.harvest_days_max ?? null,
    cultivationNotes: row.cultivation_notes ?? null,
    safetyNotes: row.safety_notes ?? null,
    confidence: (row.confidence as ResearchConfidence) || 'moderate',
    sources: parseSources(row.sources),
    status: (row.status as PlantResearchRecord['status']) || 'completed',
    errorMessage: row.error_message ?? null,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString(),
  };
}

/**
 * Inserts a new research record for an authenticated user.
 */
export async function createResearchRecord(
  client: Queryable,
  userId: string,
  profile: PlantResearchProfile,
  status: 'draft' | 'completed' | 'failed' = 'completed',
  plantId: string | null = null,
  errorMessage: string | null = null,
): Promise<PlantResearchRecord> {
  const res = await executeQuery<ResearchDbRow>(
    client,
    `INSERT INTO plant_research_records (
       user_id, plant_id, plant_name, scientific_name, category, difficulty,
       growing_medium, light_guidance, watering_guidance, fertilizer_guidance,
       temperature_min, temperature_max, humidity_min, humidity_max,
       moisture_min, moisture_max, harvest_days_min, harvest_days_max,
       cultivation_notes, safety_notes, confidence, sources, status, error_message
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
     RETURNING *;`,
    [
      userId,
      plantId,
      profile.plantName.trim(),
      profile.scientificName?.trim() || null,
      profile.category.trim() || 'Other',
      profile.difficulty || null,
      profile.growingMedium?.trim() || null,
      profile.lightGuidance?.trim() || null,
      profile.wateringGuidance?.trim() || null,
      profile.fertilizerGuidance?.trim() || null,
      profile.temperatureMin ?? null,
      profile.temperatureMax ?? null,
      profile.humidityMin ?? null,
      profile.humidityMax ?? null,
      profile.moistureMin ?? null,
      profile.moistureMax ?? null,
      profile.harvestDaysMin ?? null,
      profile.harvestDaysMax ?? null,
      profile.cultivationNotes?.trim() || null,
      profile.safetyNotes?.trim() || null,
      profile.confidence || 'moderate',
      JSON.stringify(profile.sources || []),
      status,
      errorMessage || null,
    ],
  );

  return toResearchRecord(res.rows[0]);
}

/**
 * Finds a specific research record by ID with user ownership check.
 */
export async function findResearchRecordById(
  client: Queryable,
  id: string,
  userId: string,
): Promise<PlantResearchRecord | null> {
  const res = await executeQuery<ResearchDbRow>(
    client,
    `SELECT * FROM plant_research_records WHERE id = $1 AND user_id = $2;`,
    [id, userId],
  );

  if (res.rows.length === 0) return null;
  return toResearchRecord(res.rows[0]);
}

/**
 * Finds the latest research profile associated with a plant.
 */
export async function findLatestResearchByPlantId(
  client: Queryable,
  plantId: string,
  userId: string,
): Promise<PlantResearchRecord | null> {
  const res = await executeQuery<ResearchDbRow>(
    client,
    `SELECT * FROM plant_research_records
     WHERE plant_id = $1 AND user_id = $2
     ORDER BY updated_at DESC
     LIMIT 1;`,
    [plantId, userId],
  );

  if (res.rows.length === 0) return null;
  return toResearchRecord(res.rows[0]);
}

/**
 * Links a research record to a newly created plant, updating fields if user reviewed them.
 */
export async function linkResearchRecordToPlant(
  client: Queryable,
  id: string,
  plantId: string,
  userId: string,
  reviewedProfile?: Partial<PlantResearchProfile>,
): Promise<PlantResearchRecord | null> {
  // Verify ownership
  const existing = await findResearchRecordById(client, id, userId);
  if (!existing) return null;

  const updatedProfile: PlantResearchProfile = {
    ...existing,
    ...(reviewedProfile || {}),
  };

  const res = await executeQuery<ResearchDbRow>(
    client,
    `UPDATE plant_research_records
     SET plant_id = $1,
         scientific_name = $2,
         category = $3,
         difficulty = $4,
         growing_medium = $5,
         light_guidance = $6,
         watering_guidance = $7,
         fertilizer_guidance = $8,
         temperature_min = $9,
         temperature_max = $10,
         humidity_min = $11,
         humidity_max = $12,
         moisture_min = $13,
         moisture_max = $14,
         harvest_days_min = $15,
         harvest_days_max = $16,
         cultivation_notes = $17,
         safety_notes = $18,
         updated_at = now()
     WHERE id = $19 AND user_id = $20
     RETURNING *;`,
    [
      plantId,
      updatedProfile.scientificName?.trim() || null,
      updatedProfile.category.trim() || 'Other',
      updatedProfile.difficulty || null,
      updatedProfile.growingMedium?.trim() || null,
      updatedProfile.lightGuidance?.trim() || null,
      updatedProfile.wateringGuidance?.trim() || null,
      updatedProfile.fertilizerGuidance?.trim() || null,
      updatedProfile.temperatureMin ?? null,
      updatedProfile.temperatureMax ?? null,
      updatedProfile.humidityMin ?? null,
      updatedProfile.humidityMax ?? null,
      updatedProfile.moistureMin ?? null,
      updatedProfile.moistureMax ?? null,
      updatedProfile.harvestDaysMin ?? null,
      updatedProfile.harvestDaysMax ?? null,
      updatedProfile.cultivationNotes?.trim() || null,
      updatedProfile.safetyNotes?.trim() || null,
      id,
      userId,
    ],
  );

  if (res.rows.length === 0) return null;
  return toResearchRecord(res.rows[0]);
}
