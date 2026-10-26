import type { Plant, PlantCatalogEntry, PlantInput, PlantUpdate } from '@growspace/shared';
import { findCatalogEntryById } from '@growspace/shared';
import { executeQuery, type Queryable } from '../auth/db-client';
import { isValidUuid } from '../gardens/garden-repository';
import { toResearchRecord, type ResearchDbRow } from '../research/research-repository';

export interface PlantRecord {
  id: string;
  user_id: string;
  garden_id: string;
  catalog_id: string | null;
  custom_name: string | null;
  planting_date: Date | string | null;
  growth_stage: string;
  status: string;
  expected_harvest_date: Date | string | null;
  actual_harvest_date: Date | string | null;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  garden_name?: string | null;
}

export type PlantWithDetails = Plant & {
  gardenName?: string | null;
  catalog?: PlantCatalogEntry | null;
};

function formatDateOnly(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().split('T')[0] ?? null;
  }
  if (typeof val === 'string') {
    return val.split('T')[0] ?? null;
  }
  return null;
}

/**
 * Normalizes a database row to a canonical Plant domain entity.
 */
export function toPlant(record: PlantRecord): PlantWithDetails {
  const catalogEntry = record.catalog_id ? (findCatalogEntryById(record.catalog_id) ?? null) : null;

  return {
    id: record.id,
    userId: record.user_id,
    gardenId: record.garden_id,
    catalogId: record.catalog_id ?? null,
    customName: record.custom_name ?? null,
    plantingDate: formatDateOnly(record.planting_date),
    growthStage: record.growth_stage as Plant['growthStage'],
    status: record.status as Plant['status'],
    expectedHarvestDate: formatDateOnly(record.expected_harvest_date),
    actualHarvestDate: formatDateOnly(record.actual_harvest_date),
    notes: record.notes ?? null,
    gardenName: record.garden_name ?? null,
    catalog: catalogEntry,
    createdAt:
      record.created_at instanceof Date
        ? record.created_at.toISOString()
        : new Date(record.created_at).toISOString(),
    updatedAt:
      record.updated_at instanceof Date
        ? record.updated_at.toISOString()
        : new Date(record.updated_at).toISOString(),
  };
}

/**
 * Verifies that a garden exists and is owned by the specified user.
 */
export async function verifyGardenOwnership(
  client: Queryable,
  gardenId: string,
  userId: string,
): Promise<{ exists: boolean; owned: boolean; gardenName?: string }> {
  const res = await executeQuery<{ id: string; user_id: string; name: string }>(
    client,
    `SELECT id, user_id, name FROM gardens WHERE id = $1;`,
    [gardenId],
  );

  if (res.rows.length === 0) {
    return { exists: false, owned: false };
  }

  const row = res.rows[0];
  const isOwner = row.user_id === userId;
  return { exists: true, owned: isOwner, gardenName: row.name };
}

/**
 * Verifies that a catalog entry exists in plant_catalog.
 */
export async function verifyCatalogIdExists(
  client: Queryable,
  catalogId: string,
): Promise<boolean> {
  const res = await executeQuery<{ id: string }>(
    client,
    `SELECT id FROM plant_catalog WHERE id = $1;`,
    [catalogId],
  );

  return res.rows.length > 0;
}

/**
 * Ensures a catalog entry exists in plant_catalog, syncing from shared botanical catalog if needed.
 */
export async function ensureCatalogEntryExists(
  client: Queryable,
  catalogId: string,
): Promise<boolean> {
  const exists = await verifyCatalogIdExists(client, catalogId);
  if (exists) return true;

  const entry = findCatalogEntryById(catalogId);
  if (!entry) return false;

  await executeQuery(
    client,
    `INSERT INTO plant_catalog (
       id, slug, common_name, scientific_name, category, difficulty,
       image_url, light_guidance, watering_guidance, growing_method_notes,
       harvest_days_min, harvest_days_max, reference_notes, is_published
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (id) DO NOTHING;`,
    [
      entry.id,
      entry.slug,
      entry.commonName,
      entry.scientificName ?? null,
      entry.category,
      entry.difficulty ?? null,
      entry.imageUrl ?? null,
      entry.lightGuidance ?? null,
      entry.wateringGuidance ?? null,
      entry.growingMethodNotes ?? null,
      entry.harvestDaysMin ?? null,
      entry.harvestDaysMax ?? null,
      entry.referenceNotes ?? null,
      entry.isPublished,
    ],
  );

  return true;
}

/**
 * Inserts a new tracked plant into PostgreSQL.
 */
export async function createPlant(
  client: Queryable,
  userId: string,
  input: PlantInput,
): Promise<PlantWithDetails> {
  const catalogId = input.catalogId?.trim() || null;
  const customName = input.customName?.trim() || null;
  const plantingDate = input.plantingDate ? formatDateOnly(input.plantingDate) : null;
  const growthStage = input.growthStage ?? 'seedling';
  const status = input.status ?? 'active';
  const expectedHarvestDate = input.expectedHarvestDate
    ? formatDateOnly(input.expectedHarvestDate)
    : null;
  const actualHarvestDate = input.actualHarvestDate ? formatDateOnly(input.actualHarvestDate) : null;
  const notes = input.notes?.trim() || null;

  const res = await executeQuery<PlantRecord>(
    client,
    `INSERT INTO plants (
       user_id, garden_id, catalog_id, custom_name, planting_date,
       growth_stage, status, expected_harvest_date, actual_harvest_date, notes
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, user_id, garden_id, catalog_id, custom_name, planting_date,
               growth_stage, status, expected_harvest_date, actual_harvest_date,
               notes, created_at, updated_at;`,
    [
      userId,
      input.gardenId,
      catalogId,
      customName,
      plantingDate,
      growthStage,
      status,
      expectedHarvestDate,
      actualHarvestDate,
      notes,
    ],
  );

  const row = res.rows[0];
  return toPlant(row);
}

/**
 * Lists all plants belonging to a user, with optional gardenId filtering.
 */
export async function findPlantsByUserId(
  client: Queryable,
  userId: string,
  gardenId?: string,
): Promise<PlantWithDetails[]> {
  const params: unknown[] = [userId];
  let filterClause = '';

  if (gardenId && isValidUuid(gardenId)) {
    params.push(gardenId);
    filterClause = `AND p.garden_id = $${params.length}`;
  }

  const sql = `
    SELECT p.id, p.user_id, p.garden_id, p.catalog_id, p.custom_name, p.planting_date,
           p.growth_stage, p.status, p.expected_harvest_date, p.actual_harvest_date,
           p.notes, p.created_at, p.updated_at,
           g.name AS garden_name
    FROM plants p
    JOIN gardens g ON g.id = p.garden_id
    WHERE p.user_id = $1 ${filterClause}
    ORDER BY p.created_at DESC;
  `;

  const res = await executeQuery<PlantRecord>(client, sql, params);
  const plants = res.rows.map((row) => toPlant(row));

  const customPlantIds = plants.filter((p) => !p.catalogId).map((p) => p.id);
  if (customPlantIds.length > 0) {
    try {
      const researchRes = await executeQuery<ResearchDbRow>(
        client,
        `SELECT DISTINCT ON (plant_id) *
         FROM plant_research_records
         WHERE plant_id = ANY($1) AND user_id = $2
         ORDER BY plant_id, updated_at DESC;`,
        [customPlantIds, userId],
      );
      const researchByPlantId = new Map<string, ReturnType<typeof toResearchRecord>>();
      for (const row of researchRes.rows) {
        if (row.plant_id) {
          researchByPlantId.set(row.plant_id, toResearchRecord(row));
        }
      }
      for (const plant of plants) {
        if (!plant.catalogId && researchByPlantId.has(plant.id)) {
          plant.researchProfile = researchByPlantId.get(plant.id);
        }
      }
    } catch {
      // Table may not exist in environments that haven't applied migration 0006
    }
  }

  return plants;
}

/**
 * Checks if an active plant with the same custom name already exists in the destination garden.
 */
export async function checkDuplicatePlant(
  client: Queryable,
  gardenId: string,
  customName: string | null,
  catalogId: string | null,
  excludePlantId?: string,
): Promise<boolean> {
  if (customName && customName.trim()) {
    const params: unknown[] = [gardenId, customName.trim().toLowerCase()];
    let excludeSql = '';
    if (excludePlantId) {
      params.push(excludePlantId);
      excludeSql = `AND id != $${params.length}`;
    }
    const res = await executeQuery<{ id: string }>(
      client,
      `SELECT id FROM plants
       WHERE garden_id = $1
         AND status = 'active'
         AND lower(btrim(custom_name)) = $2
         ${excludeSql}
       LIMIT 1;`,
      params,
    );
    return res.rows.length > 0;
  }
  return false;
}

/**
 * Retrieves a single plant by primary key.
 */
export async function findPlantById(
  client: Queryable,
  id: string,
): Promise<PlantWithDetails | null> {
  const res = await executeQuery<PlantRecord>(
    client,
    `SELECT p.id, p.user_id, p.garden_id, p.catalog_id, p.custom_name, p.planting_date,
            p.growth_stage, p.status, p.expected_harvest_date, p.actual_harvest_date,
            p.notes, p.created_at, p.updated_at,
            g.name AS garden_name
     FROM plants p
     JOIN gardens g ON g.id = p.garden_id
     WHERE p.id = $1;`,
    [id],
  );

  if (res.rows.length === 0) return null;
  const plant = toPlant(res.rows[0]);

  // If this is a custom plant without a catalog entry, attach latest research profile if available
  if (!plant.catalogId) {
    try {
      const researchRes = await executeQuery<ResearchDbRow>(
        client,
        `SELECT * FROM plant_research_records
         WHERE plant_id = $1
         ORDER BY updated_at DESC
         LIMIT 1;`,
        [id],
      );
      if (researchRes.rows.length > 0) {
        plant.researchProfile = toResearchRecord(researchRes.rows[0]);
      }
    } catch {
      // Table may not exist in environments that haven't applied migration 0006
    }
  }

  return plant;
}

/**
 * Updates an owned plant.
 */
export async function updatePlant(
  client: Queryable,
  id: string,
  userId: string,
  input: PlantUpdate,
): Promise<PlantWithDetails | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [id, userId];

  if (input.gardenId !== undefined) {
    setClauses.push(`garden_id = $${params.length + 1}`);
    params.push(input.gardenId);
  }

  if (input.catalogId !== undefined) {
    setClauses.push(`catalog_id = $${params.length + 1}`);
    params.push(input.catalogId ? input.catalogId.trim() : null);
  }

  if (input.customName !== undefined) {
    setClauses.push(`custom_name = $${params.length + 1}`);
    params.push(input.customName ? input.customName.trim() : null);
  }

  if (input.plantingDate !== undefined) {
    setClauses.push(`planting_date = $${params.length + 1}`);
    params.push(input.plantingDate ? formatDateOnly(input.plantingDate) : null);
  }

  if (input.growthStage !== undefined) {
    setClauses.push(`growth_stage = $${params.length + 1}`);
    params.push(input.growthStage);
  }

  if (input.status !== undefined) {
    setClauses.push(`status = $${params.length + 1}`);
    params.push(input.status);
  }

  if (input.expectedHarvestDate !== undefined) {
    setClauses.push(`expected_harvest_date = $${params.length + 1}`);
    params.push(input.expectedHarvestDate ? formatDateOnly(input.expectedHarvestDate) : null);
  }

  if (input.actualHarvestDate !== undefined) {
    setClauses.push(`actual_harvest_date = $${params.length + 1}`);
    params.push(input.actualHarvestDate ? formatDateOnly(input.actualHarvestDate) : null);
  }

  if (input.notes !== undefined) {
    setClauses.push(`notes = $${params.length + 1}`);
    params.push(input.notes ? input.notes.trim() : null);
  }

  if (setClauses.length === 0) {
    return findPlantById(client, id);
  }

  setClauses.push(`updated_at = now()`);

  const sql = `
    UPDATE plants
    SET ${setClauses.join(', ')}
    WHERE id = $1 AND user_id = $2
    RETURNING id, user_id, garden_id, catalog_id, custom_name, planting_date,
              growth_stage, status, expected_harvest_date, actual_harvest_date,
              notes, created_at, updated_at;
  `;

  const res = await executeQuery<PlantRecord>(client, sql, params);
  if (res.rows.length === 0) return null;
  return toPlant(res.rows[0]);
}

/**
 * Deletes a plant belonging to the specified user.
 */
export async function deletePlant(
  client: Queryable,
  id: string,
  userId: string,
): Promise<boolean> {
  const res = await executeQuery(
    client,
    `DELETE FROM plants WHERE id = $1 AND user_id = $2;`,
    [id, userId],
  );

  return (res.rowCount ?? 0) > 0;
}
