import {
  computeNextOccurrence,
  type CareSchedule,
  type CareScheduleInput,
  type CareScheduleUpdate,
} from '@growspace/shared';
import { executeQuery, type Queryable } from '../auth/db-client';
import { isValidUuid } from '../gardens/garden-repository';
import {
  createTask,
  type CareTaskWithDetails,
} from './task-repository';

export interface ScheduleRecord {
  id: string;
  user_id: string;
  garden_id: string;
  plant_id: string | null;
  title: string;
  task_type: string;
  description: string | null;
  priority: string;
  interval_value: number;
  interval_unit: string;
  is_active: boolean;
  next_due_at: Date | string;
  last_generated_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  garden_name?: string | null;
  plant_custom_name?: string | null;
  plant_catalog_id?: string | null;
}

/**
 * Normalizes a database row to a canonical CareSchedule domain entity.
 */
export function toSchedule(record: ScheduleRecord): CareSchedule {
  const plantName = record.plant_custom_name || record.plant_catalog_id || null;

  return {
    id: record.id,
    userId: record.user_id,
    gardenId: record.garden_id,
    plantId: record.plant_id ?? null,
    title: record.title,
    taskType: record.task_type as CareSchedule['taskType'],
    description: record.description ?? null,
    priority: record.priority as CareSchedule['priority'],
    intervalValue: Number(record.interval_value),
    intervalUnit: record.interval_unit as CareSchedule['intervalUnit'],
    isActive: Boolean(record.is_active),
    nextDueAt:
      record.next_due_at instanceof Date
        ? record.next_due_at.toISOString()
        : new Date(record.next_due_at).toISOString(),
    lastGeneratedAt: record.last_generated_at
      ? record.last_generated_at instanceof Date
        ? record.last_generated_at.toISOString()
        : new Date(record.last_generated_at).toISOString()
      : null,
    gardenName: record.garden_name ?? null,
    plantName,
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
 * Creates a new recurring care schedule and generates its initial bounded care task.
 */
export async function createCareSchedule(
  client: Queryable,
  userId: string,
  input: CareScheduleInput,
): Promise<{ schedule: CareSchedule; initialTask: CareTaskWithDetails }> {
  const title = input.title.trim();
  const taskType = input.taskType ?? 'watering';
  const description = input.description?.trim() || null;
  const priority = input.priority ?? 'normal';
  const intervalValue = Math.min(Math.max(Math.floor(input.intervalValue), 1), 365);
  const intervalUnit = input.intervalUnit ?? 'days';
  const plantId = input.plantId?.trim() || null;

  // Determine initial occurrence: if startDate is provided, use it; otherwise start today/now
  const initialDueAt = input.startDate
    ? new Date(input.startDate)
    : new Date();

  const scheduleRes = await executeQuery<ScheduleRecord>(
    client,
    `INSERT INTO care_schedules (
       user_id, garden_id, plant_id, title, task_type, description, priority,
       interval_value, interval_unit, is_active, next_due_at, last_generated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, now())
     RETURNING id, user_id, garden_id, plant_id, title, task_type, description, priority,
               interval_value, interval_unit, is_active, next_due_at, last_generated_at,
               created_at, updated_at;`,
    [
      userId,
      input.gardenId,
      plantId,
      title,
      taskType,
      description,
      priority,
      intervalValue,
      intervalUnit,
      initialDueAt.toISOString(),
    ],
  );

  const scheduleRow = scheduleRes.rows[0];
  const schedule = toSchedule(scheduleRow);

  // Generate bounded initial task linked to this schedule
  const initialTask = await createTask(client, userId, {
    gardenId: input.gardenId,
    plantId,
    title,
    taskType,
    description,
    priority,
    dueAt: initialDueAt.toISOString(),
    scheduleId: schedule.id,
  });

  return { schedule, initialTask };
}

export interface ScheduleFilterOptions {
  gardenId?: string;
  plantId?: string;
  isActive?: boolean;
}

/**
 * Lists care schedules belonging to a user with optional filters.
 */
export async function findCareSchedulesByUserId(
  client: Queryable,
  userId: string,
  filters?: ScheduleFilterOptions,
): Promise<CareSchedule[]> {
  const params: unknown[] = [userId];
  const conditions: string[] = ['s.user_id = $1'];

  if (filters?.gardenId && isValidUuid(filters.gardenId)) {
    params.push(filters.gardenId);
    conditions.push(`s.garden_id = $${params.length}`);
  }

  if (filters?.plantId && isValidUuid(filters.plantId)) {
    params.push(filters.plantId);
    conditions.push(`s.plant_id = $${params.length}`);
  }

  if (filters?.isActive !== undefined) {
    params.push(filters.isActive);
    conditions.push(`s.is_active = $${params.length}`);
  }

  const sql = `
    SELECT s.id, s.user_id, s.garden_id, s.plant_id, s.title, s.task_type,
           s.description, s.priority, s.interval_value, s.interval_unit,
           s.is_active, s.next_due_at, s.last_generated_at, s.created_at, s.updated_at,
           g.name AS garden_name,
           p.custom_name AS plant_custom_name,
           p.catalog_id AS plant_catalog_id
    FROM care_schedules s
    JOIN gardens g ON g.id = s.garden_id
    LEFT JOIN plants p ON p.id = s.plant_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY s.is_active DESC, s.next_due_at ASC, s.created_at DESC;
  `;

  const res = await executeQuery<ScheduleRecord>(client, sql, params);
  return res.rows.map(toSchedule);
}

/**
 * Retrieves a single care schedule by ID.
 */
export async function findCareScheduleById(
  client: Queryable,
  id: string,
): Promise<CareSchedule | null> {
  if (!isValidUuid(id)) return null;

  const res = await executeQuery<ScheduleRecord>(
    client,
    `SELECT s.id, s.user_id, s.garden_id, s.plant_id, s.title, s.task_type,
            s.description, s.priority, s.interval_value, s.interval_unit,
            s.is_active, s.next_due_at, s.last_generated_at, s.created_at, s.updated_at,
            g.name AS garden_name,
            p.custom_name AS plant_custom_name,
            p.catalog_id AS plant_catalog_id
     FROM care_schedules s
     JOIN gardens g ON g.id = s.garden_id
     LEFT JOIN plants p ON p.id = s.plant_id
     WHERE s.id = $1;`,
    [id],
  );

  if (res.rows.length === 0) return null;
  return toSchedule(res.rows[0]);
}

/**
 * Updates a care schedule owned by the user.
 */
export async function updateCareSchedule(
  client: Queryable,
  id: string,
  userId: string,
  input: CareScheduleUpdate,
): Promise<CareSchedule | null> {
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

  if (input.priority !== undefined) {
    setClauses.push(`priority = $${params.length + 1}`);
    params.push(input.priority);
  }

  if (input.intervalValue !== undefined) {
    setClauses.push(`interval_value = $${params.length + 1}`);
    params.push(Math.min(Math.max(Math.floor(input.intervalValue), 1), 365));
  }

  if (input.intervalUnit !== undefined) {
    setClauses.push(`interval_unit = $${params.length + 1}`);
    params.push(input.intervalUnit);
  }

  if (input.isActive !== undefined) {
    setClauses.push(`is_active = $${params.length + 1}`);
    params.push(Boolean(input.isActive));
  }

  if (input.nextDueAt !== undefined) {
    setClauses.push(`next_due_at = $${params.length + 1}`);
    params.push(input.nextDueAt ? new Date(input.nextDueAt).toISOString() : new Date().toISOString());
  }

  if (setClauses.length === 0) {
    return findCareScheduleById(client, id);
  }

  setClauses.push(`updated_at = now()`);

  const sql = `
    UPDATE care_schedules
    SET ${setClauses.join(', ')}
    WHERE id = $1 AND user_id = $2
    RETURNING id;
  `;

  const res = await executeQuery(client, sql, params);
  if (res.rows.length === 0) return null;
  return findCareScheduleById(client, id);
}

/**
 * Deletes a care schedule. Historical care tasks have schedule_id set to NULL
 * to safely preserve completion logs.
 */
export async function deleteCareSchedule(
  client: Queryable,
  id: string,
  userId: string,
): Promise<boolean> {
  if (!isValidUuid(id)) return false;

  await executeQuery(
    client,
    `UPDATE care_tasks SET schedule_id = NULL WHERE schedule_id = $1 AND user_id = $2;`,
    [id, userId],
  );

  const res = await executeQuery(
    client,
    `DELETE FROM care_schedules WHERE id = $1 AND user_id = $2;`,
    [id, userId],
  );

  return (res.rowCount ?? 0) > 0;
}

/**
 * Handles the completion of a recurring care task.
 * Implements:
 * 1. Late completion spacing: schedules the next occurrence relative to completion time
 *    (completed_at + interval) to prevent immediate repetition or plant over-servicing.
 * 2. Strict deduplication: checks whether a pending task already exists for this schedule before generating.
 * 3. Bounded generation: generates exactly one next occurrence.
 */
export async function handleRecurringTaskCompleted(
  client: Queryable,
  task: CareTaskWithDetails,
  completedAt = new Date(),
): Promise<CareTaskWithDetails | null> {
  if (!task.scheduleId) return null;

  const schedule = await findCareScheduleById(client, task.scheduleId);
  if (!schedule || !schedule.isActive) {
    return null;
  }

  // Deduplication check: does an active pending task already exist for this schedule?
  const existingPending = await executeQuery<{ id: string }>(
    client,
    `SELECT id FROM care_tasks WHERE schedule_id = $1 AND status = 'pending' LIMIT 1;`,
    [schedule.id],
  );

  if (existingPending.rows.length > 0) {
    return null;
  }

  // Biological plant care principle: if completed late, the crop received water/nutrients today.
  // Next care date should be calculated from completion timestamp.
  const nextOccurrenceDate = computeNextOccurrence(
    completedAt,
    schedule.intervalValue,
    schedule.intervalUnit,
  );

  // Update schedule next_due_at and last_generated_at
  await executeQuery(
    client,
    `UPDATE care_schedules
     SET next_due_at = $1,
         last_generated_at = now(),
         updated_at = now()
     WHERE id = $2;`,
    [nextOccurrenceDate.toISOString(), schedule.id],
  );

  // Create the next bounded task
  const nextTask = await createTask(client, schedule.userId, {
    gardenId: schedule.gardenId,
    plantId: schedule.plantId,
    title: schedule.title,
    taskType: schedule.taskType,
    description: schedule.description,
    priority: schedule.priority,
    dueAt: nextOccurrenceDate.toISOString(),
    scheduleId: schedule.id,
  });

  return nextTask;
}
