import type { CareTask, TaskInput, TaskUpdate } from '@growspace/shared';
import { executeQuery, type Queryable } from '../auth/db-client';
import { isValidUuid } from '../gardens/garden-repository';

export interface TaskRecord {
  id: string;
  user_id: string;
  garden_id: string;
  plant_id: string | null;
  schedule_id?: string | null;
  title: string;
  task_type: string;
  description: string | null;
  due_at: Date | string | null;
  status: string;
  completed_at: Date | string | null;
  priority: string;
  created_at: Date | string;
  updated_at: Date | string;
  garden_name?: string | null;
  plant_custom_name?: string | null;
  plant_catalog_id?: string | null;
  schedule_title?: string | null;
}

export type CareTaskWithDetails = CareTask & {
  gardenName?: string | null;
  plantName?: string | null;
  scheduleTitle?: string | null;
};

/**
 * Normalizes a database row to a canonical CareTask domain entity.
 */
export function toTask(record: TaskRecord): CareTaskWithDetails {
  const plantName = record.plant_custom_name || record.plant_catalog_id || null;

  return {
    id: record.id,
    userId: record.user_id,
    gardenId: record.garden_id,
    plantId: record.plant_id ?? null,
    scheduleId: record.schedule_id ?? null,
    title: record.title,
    taskType: record.task_type as CareTask['taskType'],
    description: record.description ?? null,
    dueAt: record.due_at
      ? record.due_at instanceof Date
        ? record.due_at.toISOString()
        : new Date(record.due_at).toISOString()
      : null,
    status: record.status as CareTask['status'],
    completedAt: record.completed_at
      ? record.completed_at instanceof Date
        ? record.completed_at.toISOString()
        : new Date(record.completed_at).toISOString()
      : null,
    priority: record.priority as CareTask['priority'],
    gardenName: record.garden_name ?? null,
    plantName,
    scheduleTitle: record.schedule_title ?? null,
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
export async function verifyGardenOwnershipForTask(
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
 * Verifies that an optional plant exists, belongs to the user, and is in the specified garden.
 */
export async function verifyPlantBelongsToGarden(
  client: Queryable,
  plantId: string,
  gardenId: string,
  userId: string,
): Promise<{ exists: boolean; owned: boolean; inGarden: boolean }> {
  const res = await executeQuery<{ id: string; user_id: string; garden_id: string }>(
    client,
    `SELECT id, user_id, garden_id FROM plants WHERE id = $1;`,
    [plantId],
  );

  if (res.rows.length === 0) {
    return { exists: false, owned: false, inGarden: false };
  }

  const row = res.rows[0];
  const isOwner = row.user_id === userId;
  const inGarden = row.garden_id === gardenId;
  return { exists: true, owned: isOwner, inGarden };
}

/**
 * Inserts a new care task into PostgreSQL.
 */
export async function createTask(
  client: Queryable,
  userId: string,
  input: TaskInput,
): Promise<CareTaskWithDetails> {
  const title = input.title.trim();
  const taskType = input.taskType ?? 'other';
  const description = input.description?.trim() || null;
  const dueAt = input.dueAt ? new Date(input.dueAt).toISOString() : null;
  const priority = input.priority ?? 'normal';
  const plantId = input.plantId?.trim() || null;
  const scheduleId = input.scheduleId?.trim() || null;

  try {
    const res = await executeQuery<TaskRecord>(
      client,
      `INSERT INTO care_tasks (
         user_id, garden_id, plant_id, schedule_id, title, task_type, description, due_at,
         status, completed_at, priority
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NULL, $9)
       RETURNING id, user_id, garden_id, plant_id, schedule_id, title, task_type, description,
                 due_at, status, completed_at, priority, created_at, updated_at;`,
      [userId, input.gardenId, plantId, scheduleId, title, taskType, description, dueAt, priority],
    );

    const row = res.rows[0];
    return toTask(row);
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '42703') {
      // 42703: undefined_column (fallback when schedule_id column is not yet migrated)
      const res = await executeQuery<TaskRecord>(
        client,
        `INSERT INTO care_tasks (
           user_id, garden_id, plant_id, title, task_type, description, due_at,
           status, completed_at, priority
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NULL, $8)
         RETURNING id, user_id, garden_id, plant_id, title, task_type, description,
                   due_at, status, completed_at, priority, created_at, updated_at;`,
        [userId, input.gardenId, plantId, title, taskType, description, dueAt, priority],
      );
      const row = res.rows[0];
      return toTask(row);
    }
    throw err;
  }
}

export interface TaskFilterOptions {
  gardenId?: string;
  plantId?: string;
  status?: string;
  due?: 'overdue' | 'today' | 'upcoming';
  priority?: 'low' | 'normal' | 'high';
  search?: string;
  from?: string;
  to?: string;
}

/**
 * Lists care tasks belonging to a user, with optional filters.
 */
export async function findTasksByUserId(
  client: Queryable,
  userId: string,
  filters?: TaskFilterOptions,
): Promise<CareTaskWithDetails[]> {
  const params: unknown[] = [userId];
  const conditions: string[] = ['t.user_id = $1'];

  if (filters?.gardenId && isValidUuid(filters.gardenId)) {
    params.push(filters.gardenId);
    conditions.push(`t.garden_id = $${params.length}`);
  }

  if (filters?.plantId && isValidUuid(filters.plantId)) {
    params.push(filters.plantId);
    conditions.push(`t.plant_id = $${params.length}`);
  }

  if (filters?.status && ['pending', 'completed', 'cancelled'].includes(filters.status)) {
    params.push(filters.status);
    conditions.push(`t.status = $${params.length}`);
  }

  if (filters?.priority && ['low', 'normal', 'high'].includes(filters.priority)) {
    params.push(filters.priority);
    conditions.push(`t.priority = $${params.length}`);
  }

  if (filters?.search && filters.search.trim().length > 0) {
    params.push(`%${filters.search.trim()}%`);
    conditions.push(
      `(t.title ILIKE $${params.length} OR (t.description IS NOT NULL AND t.description ILIKE $${params.length}))`,
    );
  }

  if (filters?.from) {
    const fromDate = new Date(filters.from);
    if (!Number.isNaN(fromDate.getTime())) {
      params.push(fromDate.toISOString());
      conditions.push(`t.due_at >= $${params.length}`);
    }
  }

  if (filters?.to) {
    const toDate = new Date(filters.to);
    if (!Number.isNaN(toDate.getTime())) {
      params.push(toDate.toISOString());
      conditions.push(`t.due_at <= $${params.length}`);
    }
  }

  if (filters?.due) {
    if (filters.due === 'overdue') {
      if (!filters.status) {
        conditions.push(`t.status = 'pending'`);
      }
      conditions.push(
        `t.due_at IS NOT NULL AND (t.due_at AT TIME ZONE 'UTC')::date < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`,
      );
    } else if (filters.due === 'today') {
      conditions.push(
        `t.due_at IS NOT NULL AND (t.due_at AT TIME ZONE 'UTC')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`,
      );
    } else if (filters.due === 'upcoming') {
      conditions.push(
        `t.due_at IS NOT NULL AND (t.due_at AT TIME ZONE 'UTC')::date > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`,
      );
    }
  }

  const sql = `
    SELECT t.id, t.user_id, t.garden_id, t.plant_id, t.schedule_id, t.title, t.task_type,
           t.description, t.due_at, t.status, t.completed_at, t.priority,
           t.created_at, t.updated_at,
           g.name AS garden_name,
           p.custom_name AS plant_custom_name,
           p.catalog_id AS plant_catalog_id,
           s.title AS schedule_title
    FROM care_tasks t
    JOIN gardens g ON g.id = t.garden_id
    LEFT JOIN plants p ON p.id = t.plant_id
    LEFT JOIN care_schedules s ON s.id = t.schedule_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE t.status WHEN 'pending' THEN 0 WHEN 'completed' THEN 1 WHEN 'cancelled' THEN 2 ELSE 3 END ASC,
      CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 ELSE 3 END ASC,
      t.due_at ASC NULLS LAST,
      t.created_at DESC;
  `;

  try {
    const res = await executeQuery<TaskRecord>(client, sql, params);
    return res.rows.map(toTask);
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '42P01' || pgErr?.code === '42703') {
      const fallbackSql = `
        SELECT t.id, t.user_id, t.garden_id, t.plant_id, t.title, t.task_type,
               t.description, t.due_at, t.status, t.completed_at, t.priority,
               t.created_at, t.updated_at,
               g.name AS garden_name,
               p.custom_name AS plant_custom_name,
               p.catalog_id AS plant_catalog_id,
               NULL AS schedule_id,
               NULL AS schedule_title
        FROM care_tasks t
        JOIN gardens g ON g.id = t.garden_id
        LEFT JOIN plants p ON p.id = t.plant_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY
          CASE t.status WHEN 'pending' THEN 0 WHEN 'completed' THEN 1 WHEN 'cancelled' THEN 2 ELSE 3 END ASC,
          CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 ELSE 3 END ASC,
          t.due_at ASC NULLS LAST,
          t.created_at DESC;
      `;
      const res = await executeQuery<TaskRecord>(client, fallbackSql, params);
      return res.rows.map(toTask);
    }
    throw err;
  }
}

/**
 * Retrieves a single care task by ID.
 */
export async function findTaskById(
  client: Queryable,
  id: string,
): Promise<CareTaskWithDetails | null> {
  try {
    const res = await executeQuery<TaskRecord>(
      client,
      `SELECT t.id, t.user_id, t.garden_id, t.plant_id, t.schedule_id, t.title, t.task_type,
              t.description, t.due_at, t.status, t.completed_at, t.priority,
              t.created_at, t.updated_at,
              g.name AS garden_name,
              p.custom_name AS plant_custom_name,
              p.catalog_id AS plant_catalog_id,
              s.title AS schedule_title
       FROM care_tasks t
       JOIN gardens g ON g.id = t.garden_id
       LEFT JOIN plants p ON p.id = t.plant_id
       LEFT JOIN care_schedules s ON s.id = t.schedule_id
       WHERE t.id = $1;`,
      [id],
    );

    if (res.rows.length === 0) return null;
    return toTask(res.rows[0]);
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '42P01' || pgErr?.code === '42703') {
      const res = await executeQuery<TaskRecord>(
        client,
        `SELECT t.id, t.user_id, t.garden_id, t.plant_id, t.title, t.task_type,
                t.description, t.due_at, t.status, t.completed_at, t.priority,
                t.created_at, t.updated_at,
                g.name AS garden_name,
                p.custom_name AS plant_custom_name,
                p.catalog_id AS plant_catalog_id,
                NULL AS schedule_id,
                NULL AS schedule_title
         FROM care_tasks t
         JOIN gardens g ON g.id = t.garden_id
         LEFT JOIN plants p ON p.id = t.plant_id
         WHERE t.id = $1;`,
        [id],
      );

      if (res.rows.length === 0) return null;
      return toTask(res.rows[0]);
    }
    throw err;
  }
}

/**
 * Updates a care task belonging to the specified user.
 * Preserves compliance with care_tasks_completed_at_consistency_check:
 * (status = 'completed') = (completed_at IS NOT NULL)
 */
export async function updateTask(
  client: Queryable,
  id: string,
  userId: string,
  input: TaskUpdate,
): Promise<CareTaskWithDetails | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [id, userId];

  if (input.title !== undefined) {
    setClauses.push(`title = $${params.length + 1}`);
    params.push(input.title.trim());
  }

  if (input.taskType !== undefined) {
    setClauses.push(`task_type = $${params.length + 1}`);
    params.push(input.taskType);
  }

  if (input.description !== undefined) {
    setClauses.push(`description = $${params.length + 1}`);
    params.push(input.description ? input.description.trim() : null);
  }

  if (input.dueAt !== undefined) {
    setClauses.push(`due_at = $${params.length + 1}`);
    params.push(input.dueAt ? new Date(input.dueAt).toISOString() : null);
  }

  if (input.plantId !== undefined) {
    setClauses.push(`plant_id = $${params.length + 1}`);
    params.push(input.plantId ? input.plantId.trim() : null);
  }

  if (input.priority !== undefined) {
    setClauses.push(`priority = $${params.length + 1}`);
    params.push(input.priority);
  }

  if (input.scheduleId !== undefined) {
    setClauses.push(`schedule_id = $${params.length + 1}`);
    params.push(input.scheduleId ? input.scheduleId.trim() : null);
  }

  if (input.status !== undefined) {
    setClauses.push(`status = $${params.length + 1}`);
    params.push(input.status);

    if (input.status === 'completed') {
      setClauses.push(`completed_at = now()`);
    } else {
      setClauses.push(`completed_at = NULL`);
    }
  }

  if (setClauses.length === 0) {
    return findTaskById(client, id);
  }

  setClauses.push(`updated_at = now()`);

  const sql = `
    UPDATE care_tasks
    SET ${setClauses.join(', ')}
    WHERE id = $1 AND user_id = $2
    RETURNING id, user_id, garden_id, plant_id, title, task_type, description,
              due_at, status, completed_at, priority, created_at, updated_at;
  `;

  const res = await executeQuery<TaskRecord>(client, sql, params);
  if (res.rows.length === 0) return null;
  return findTaskById(client, id);
}

/**
 * Deletes a care task belonging to the specified user.
 */
export async function deleteTask(
  client: Queryable,
  id: string,
  userId: string,
): Promise<boolean> {
  const res = await executeQuery(
    client,
    `DELETE FROM care_tasks WHERE id = $1 AND user_id = $2;`,
    [id, userId],
  );

  return (res.rowCount ?? 0) > 0;
}
