import type { GardenInput, GardenUpdate } from '@growspace/shared';
import type { Garden } from '@growspace/shared';
import { executeQuery, type Queryable } from '../auth/db-client';

export interface GardenRecord {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  location_label: string | null;
  growing_method: string | null;
  image_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  plant_count?: number | string | null;
}

export type GardenWithStats = Garden & { plantCount?: number };

/**
 * Normalizes a database row to a canonical Garden domain entity.
 */
export function toGarden(record: GardenRecord): GardenWithStats {
  const garden: GardenWithStats = {
    id: record.id,
    userId: record.user_id,
    name: record.name,
    description: record.description ?? null,
    locationLabel: record.location_label ?? null,
    growingMethod: (record.growing_method as Garden['growingMethod']) ?? null,
    imageUrl: record.image_url ?? null,
    createdAt:
      record.created_at instanceof Date
        ? record.created_at.toISOString()
        : new Date(record.created_at).toISOString(),
    updatedAt:
      record.updated_at instanceof Date
        ? record.updated_at.toISOString()
        : new Date(record.updated_at).toISOString(),
  };

  if (record.plant_count !== undefined && record.plant_count !== null) {
    garden.plantCount = Number(record.plant_count);
  }

  return garden;
}

/**
 * Validates whether a string matches standard PostgreSQL UUID format (8-4-4-4-12 hex).
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidUuid(id: string): boolean {
  if (typeof id !== 'string') return false;
  return UUID_REGEX.test(id.trim());
}

/**
 * Inserts a new user garden into PostgreSQL.
 */
export async function createGarden(
  client: Queryable,
  userId: string,
  input: GardenInput,
): Promise<Garden> {
  const name = input.name.trim();
  const description = input.description?.trim() || null;
  const locationLabel = input.locationLabel?.trim() || null;
  const growingMethod = input.growingMethod ?? null;
  const imageUrl = input.imageUrl ?? null;

  const res = await executeQuery<GardenRecord>(
    client,
    `INSERT INTO gardens (user_id, name, description, location_label, growing_method, image_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, name, description, location_label, growing_method, image_url, created_at, updated_at;`,
    [userId, name, description, locationLabel, growingMethod, imageUrl],
  );

  return toGarden(res.rows[0]);
}

/**
 * Retrieves all gardens owned by the specified user, including child plant counts.
 */
export async function findGardensByUserId(
  client: Queryable,
  userId: string,
): Promise<GardenWithStats[]> {
  const res = await executeQuery<GardenRecord>(
    client,
    `SELECT g.id, g.user_id, g.name, g.description, g.location_label, g.growing_method, g.image_url, g.created_at, g.updated_at,
            COALESCE(COUNT(p.id), 0)::int AS plant_count
     FROM gardens g
     LEFT JOIN plants p ON p.garden_id = g.id AND p.user_id = g.user_id
     WHERE g.user_id = $1
     GROUP BY g.id
     ORDER BY g.created_at DESC;`,
    [userId],
  );

  return res.rows.map((row) => toGarden(row));
}

/**
 * Retrieves a single garden by primary key, including child plant count.
 */
export async function findGardenById(
  client: Queryable,
  id: string,
): Promise<GardenWithStats | null> {
  const res = await executeQuery<GardenRecord>(
    client,
    `SELECT g.id, g.user_id, g.name, g.description, g.location_label, g.growing_method, g.image_url, g.created_at, g.updated_at,
            COALESCE(COUNT(p.id), 0)::int AS plant_count
     FROM gardens g
     LEFT JOIN plants p ON p.garden_id = g.id
     WHERE g.id = $1
     GROUP BY g.id;`,
    [id],
  );

  if (res.rows.length === 0) return null;
  return toGarden(res.rows[0]);
}

/**
 * Updates an owned garden record.
 */
export async function updateGarden(
  client: Queryable,
  id: string,
  userId: string,
  input: GardenUpdate,
): Promise<Garden | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [id, userId];

  if (input.name !== undefined) {
    setClauses.push(`name = $${params.length + 1}`);
    params.push(input.name.trim());
  }

  if (input.description !== undefined) {
    setClauses.push(`description = $${params.length + 1}`);
    params.push(input.description?.trim() || null);
  }

  if (input.locationLabel !== undefined) {
    setClauses.push(`location_label = $${params.length + 1}`);
    params.push(input.locationLabel?.trim() || null);
  }

  if (input.growingMethod !== undefined) {
    setClauses.push(`growing_method = $${params.length + 1}`);
    params.push(input.growingMethod ?? null);
  }

  if (input.imageUrl !== undefined) {
    setClauses.push(`image_url = $${params.length + 1}`);
    params.push(input.imageUrl ?? null);
  }

  if (setClauses.length === 0) {
    return findGardenById(client, id);
  }

  setClauses.push(`updated_at = now()`);

  const sql = `UPDATE gardens
               SET ${setClauses.join(', ')}
               WHERE id = $1 AND user_id = $2
               RETURNING id, user_id, name, description, location_label, growing_method, image_url, created_at, updated_at;`;

  const res = await executeQuery<GardenRecord>(client, sql, params);
  if (res.rows.length === 0) return null;
  return toGarden(res.rows[0]);
}

/**
 * Counts the number of plants belonging to a garden.
 */
export async function countPlantsInGarden(
  client: Queryable,
  gardenId: string,
  userId: string,
): Promise<number> {
  const res = await executeQuery<{ count: string | number }>(
    client,
    `SELECT COUNT(*)::int AS count FROM plants WHERE garden_id = $1 AND user_id = $2;`,
    [gardenId, userId],
  );

  return Number(res.rows[0]?.count ?? 0);
}

/**
 * Deletes a garden belonging to the specified user.
 */
export async function deleteGarden(
  client: Queryable,
  id: string,
  userId: string,
): Promise<boolean> {
  const res = await executeQuery(
    client,
    `DELETE FROM gardens WHERE id = $1 AND user_id = $2;`,
    [id, userId],
  );

  return (res.rowCount ?? 0) > 0;
}
