import type { PlantLog, PlantLogInput } from '@growspace/shared';
import { executeQuery, type Queryable } from '../auth/db-client';

export interface PlantLogRecord {
  id: string;
  user_id: string;
  plant_id: string;
  log_type: string;
  title: string | null;
  content: string;
  logged_at: Date | string;
  created_at: Date | string;
}

/**
 * Normalizes a database row to a canonical PlantLog entity.
 */
export function toPlantLog(record: PlantLogRecord): PlantLog {
  return {
    id: record.id,
    userId: record.user_id,
    plantId: record.plant_id,
    logType: record.log_type as PlantLog['logType'],
    title: record.title ?? null,
    content: record.content,
    loggedAt:
      record.logged_at instanceof Date
        ? record.logged_at.toISOString()
        : new Date(record.logged_at).toISOString(),
    createdAt:
      record.created_at instanceof Date
        ? record.created_at.toISOString()
        : new Date(record.created_at).toISOString(),
  };
}

/**
 * Verifies that a plant exists and is owned by the specified user.
 */
export async function verifyPlantOwnership(
  client: Queryable,
  plantId: string,
  userId: string,
): Promise<{ exists: boolean; owned: boolean; plantName?: string; gardenId?: string }> {
  const res = await executeQuery<{
    id: string;
    user_id: string;
    garden_id: string;
    custom_name: string | null;
    catalog_id: string | null;
  }>(
    client,
    `SELECT id, user_id, garden_id, custom_name, catalog_id FROM plants WHERE id = $1;`,
    [plantId],
  );

  if (res.rows.length === 0) {
    return { exists: false, owned: false };
  }

  const row = res.rows[0];
  const isOwner = row.user_id === userId;
  return {
    exists: true,
    owned: isOwner,
    plantName: row.custom_name || row.catalog_id || undefined,
    gardenId: row.garden_id,
  };
}

/**
 * Inserts a new plant log record into PostgreSQL.
 */
export async function createPlantLog(
  client: Queryable,
  userId: string,
  plantId: string,
  input: PlantLogInput,
): Promise<PlantLog> {
  const logType = input.logType ?? 'note';
  const title = input.title?.trim() || null;
  const content = input.content.trim();
  const loggedAt = input.loggedAt ? new Date(input.loggedAt).toISOString() : new Date().toISOString();

  const res = await executeQuery<PlantLogRecord>(
    client,
    `INSERT INTO plant_logs (user_id, plant_id, log_type, title, content, logged_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, plant_id, log_type, title, content, logged_at, created_at;`,
    [userId, plantId, logType, title, content, loggedAt],
  );

  return toPlantLog(res.rows[0]);
}

/**
 * Lists all logs belonging to a plant owned by the specified user, in chronological order.
 */
export async function findPlantLogsByPlantId(
  client: Queryable,
  userId: string,
  plantId: string,
): Promise<PlantLog[]> {
  const res = await executeQuery<PlantLogRecord>(
    client,
    `SELECT id, user_id, plant_id, log_type, title, content, logged_at, created_at
     FROM plant_logs
     WHERE user_id = $1 AND plant_id = $2
     ORDER BY logged_at DESC, created_at DESC;`,
    [userId, plantId],
  );

  return res.rows.map(toPlantLog);
}

/**
 * Deletes a plant log belonging to the specified user and optional plant.
 */
export async function deletePlantLog(
  client: Queryable,
  userId: string,
  logId: string,
  plantId?: string,
): Promise<boolean> {
  const query = plantId
    ? `DELETE FROM plant_logs WHERE id = $1 AND user_id = $2 AND plant_id = $3;`
    : `DELETE FROM plant_logs WHERE id = $1 AND user_id = $2;`;
  const params = plantId ? [logId, userId, plantId] : [logId, userId];
  const res = await executeQuery(client, query, params);

  return (res.rowCount ?? 0) > 0;
}
