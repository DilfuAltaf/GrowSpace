import type {
  Notification,
  NotificationInput,
  NotificationType,
} from '@growspace/shared';
import { formatDate, getTaskDueClassification } from '@growspace/shared';
import { executeQuery, type Queryable } from '../auth/db-client';
import { isValidUuid } from '../gardens/garden-repository';
import { findPlantsByUserId } from '../plants/plant-repository';
import { findReadings } from '../readings/reading-repository';
import { findTasksByUserId } from '../tasks/task-repository';
import { evaluateRecommendations } from '@growspace/shared';

export interface NotificationRecord {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  read_at: Date | string | null;
  dedup_key: string | null;
  created_at: Date | string;
}

export interface NotificationFilterOptions {
  unreadOnly?: boolean;
  type?: NotificationType;
  limit?: number;
  offset?: number;
}

/**
 * Normalizes a database row to a canonical Notification domain entity.
 */
export function toNotification(record: NotificationRecord): Notification {
  return {
    id: record.id,
    userId: record.user_id,
    type: record.type as NotificationType,
    title: record.title,
    message: record.message,
    link: record.link ?? null,
    isRead: record.is_read,
    readAt: record.read_at
      ? record.read_at instanceof Date
        ? record.read_at.toISOString()
        : new Date(record.read_at).toISOString()
      : null,
    dedupKey: record.dedup_key ?? null,
    createdAt:
      record.created_at instanceof Date
        ? record.created_at.toISOString()
        : new Date(record.created_at).toISOString(),
  };
}

/**
 * Inserts a notification with idempotent deduplication per user.
 * Returns null if a record with the same dedup_key already exists for this user.
 */
export async function createNotification(
  client: Queryable,
  userId: string,
  input: NotificationInput,
): Promise<Notification | null> {
  const type = input.type;
  const title = input.title.trim();
  const message = input.message.trim();
  const link = input.link ? input.link.trim() : null;
  const dedupKey = input.dedupKey ? input.dedupKey.trim() : null;

  const res = await executeQuery<NotificationRecord>(
    client,
    `INSERT INTO notifications (user_id, type, title, message, link, dedup_key, is_read, read_at)
     VALUES ($1, $2, $3, $4, $5, $6, false, NULL)
     ON CONFLICT (user_id, dedup_key) WHERE dedup_key IS NOT NULL
     DO NOTHING
     RETURNING id, user_id, type, title, message, link, is_read, read_at, dedup_key, created_at;`,
    [userId, type, title, message, link, dedupKey],
  );

  if (res.rows.length === 0) {
    return null;
  }

  return toNotification(res.rows[0]);
}

/**
 * Lists notifications belonging to the specified user with optional filtering and pagination.
 */
export async function findNotifications(
  client: Queryable,
  userId: string,
  filters: NotificationFilterOptions = {},
): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
  const conditions: string[] = ['user_id = $1'];
  const params: unknown[] = [userId];

  if (filters.unreadOnly) {
    conditions.push('is_read = false');
  }

  if (filters.type) {
    params.push(filters.type);
    conditions.push(`type = $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  // Filtered total count
  const countRes = await executeQuery<{ count: string | number }>(
    client,
    `SELECT COUNT(*)::int AS count FROM notifications WHERE ${whereClause};`,
    params,
  );
  const total = Number(countRes.rows[0]?.count ?? 0);

  // Global unread count for user
  const unreadRes = await executeQuery<{ count: string | number }>(
    client,
    `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false;`,
    [userId],
  );
  const unreadCount = Number(unreadRes.rows[0]?.count ?? 0);

  const limit = Math.min(Math.max(Number(filters.limit ?? 20), 1), 100);
  const offset = Math.max(Number(filters.offset ?? 0), 0);

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;
  params.push(offset);
  const offsetPlaceholder = `$${params.length}`;

  const query = `
    SELECT id, user_id, type, title, message, link, is_read, read_at, dedup_key, created_at
    FROM notifications
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder};
  `;

  const res = await executeQuery<NotificationRecord>(client, query, params);
  const notifications = res.rows.map(toNotification);

  return { notifications, total, unreadCount };
}

/**
 * Retrieves a single notification by ID.
 */
export async function findNotificationById(
  client: Queryable,
  id: string,
): Promise<Notification | null> {
  if (!isValidUuid(id)) return null;

  const res = await executeQuery<NotificationRecord>(
    client,
    `SELECT id, user_id, type, title, message, link, is_read, read_at, dedup_key, created_at
     FROM notifications
     WHERE id = $1;`,
    [id],
  );

  if (res.rows.length === 0) return null;
  return toNotification(res.rows[0]);
}

/**
 * Updates a notification's read state with constraint consistency.
 */
export async function updateNotificationReadState(
  client: Queryable,
  id: string,
  userId: string,
  isRead: boolean,
): Promise<Notification | null> {
  if (!isValidUuid(id)) return null;

  const res = await executeQuery<NotificationRecord>(
    client,
    `UPDATE notifications
     SET is_read = $3,
         read_at = CASE WHEN $3 = true THEN now() ELSE NULL END
     WHERE id = $1 AND user_id = $2
     RETURNING id, user_id, type, title, message, link, is_read, read_at, dedup_key, created_at;`,
    [id, userId, isRead],
  );

  if (res.rows.length === 0) return null;
  return toNotification(res.rows[0]);
}

/**
 * Marks all unread notifications for a user as read.
 */
export async function markAllNotificationsAsRead(
  client: Queryable,
  userId: string,
): Promise<number> {
  const res = await executeQuery(
    client,
    `UPDATE notifications
     SET is_read = true,
         read_at = now()
     WHERE user_id = $1 AND is_read = false;`,
    [userId],
  );

  return res.rowCount ?? 0;
}

/**
 * Evaluates active tasks and care intelligence recommendations to generate
 * actionable notifications idempotently (at most once per calendar day per trigger).
 */
export async function generateCareReminders(
  client: Queryable,
  userId: string,
  now = new Date(),
): Promise<{ generatedCount: number; unreadCount: number }> {
  const todayUtc = now.toISOString().split('T')[0];
  let generatedCount = 0;

  // 1. Overdue and Due Today Tasks
  const tasks = await findTasksByUserId(client, userId, { status: 'pending' });

  for (const task of tasks) {
    const classification = getTaskDueClassification(task.dueAt, now);

    if (classification === 'overdue') {
      const dedupKey = `task-overdue-${task.id}-${todayUtc}`;
      const created = await createNotification(client, userId, {
        type: 'care_task',
        title: `Overdue Task: ${task.title}`,
        message: `Your task "${task.title}" was due on ${formatDate(task.dueAt)}. Please inspect your crop and complete this action.`,
        link: `/dashboard/tasks/${task.id}`,
        dedupKey,
      });
      if (created) generatedCount++;
    } else if (classification === 'today') {
      const dedupKey = `task-today-${task.id}-${todayUtc}`;
      const plantContext = task.plantName ? ` for ${task.plantName}` : '';
      const created = await createNotification(client, userId, {
        type: 'care_task',
        title: `Task Due Today: ${task.title}`,
        message: `Your task "${task.title}"${plantContext} is scheduled for today. Complete it during your garden routine.`,
        link: `/dashboard/tasks/${task.id}`,
        dedupKey,
      });
      if (created) generatedCount++;
    } else if (classification === 'upcoming' && task.dueAt) {
      const dueTime = new Date(task.dueAt).getTime();
      const diffHours = (dueTime - now.getTime()) / (1000 * 60 * 60);
      // Relevant upcoming tasks due within 48 hours
      if (diffHours > 0 && diffHours <= 48) {
        const dedupKey = `task-upcoming-${task.id}-${todayUtc}`;
        const plantContext = task.plantName ? ` for ${task.plantName}` : '';
        const created = await createNotification(client, userId, {
          type: 'care_task',
          title: `Upcoming Task: ${task.title}`,
          message: `Your task "${task.title}"${plantContext} is due on ${formatDate(task.dueAt)}. Prepare your care routine.`,
          link: `/dashboard/tasks/${task.id}`,
          dedupKey,
        });
        if (created) generatedCount++;
      }
    }
  }

  // 2. High-priority Environmental Alerts and Lifecycle Windows
  const plants = await findPlantsByUserId(client, userId);
  const readingsRes = await findReadings(client, userId, { limit: 100 });

  if (plants.length > 0) {
    const plantContexts = plants.map((p) => {
      const plantReadings = readingsRes.readings.filter(
        (r) => r.plantId === p.id || (!r.plantId && r.gardenId === p.gardenId),
      );
      const plantTasks = tasks.filter((t) => t.plantId === p.id);
      return {
        plant: p,
        catalog: p.catalog ?? null,
        readings: plantReadings,
        tasks: plantTasks,
      };
    });

    const recommendations = evaluateRecommendations({ plants: plantContexts, now });

    for (const rec of recommendations) {
      if (rec.severity === 'critical' || rec.severity === 'warning') {
        const notifType: NotificationType =
          rec.category === 'lifecycle'
            ? 'lifecycle'
            : rec.category === 'environmental'
              ? 'environmental'
              : 'care_task';

        const dedupKey = `rec-${notifType}-${rec.plantId || 'global'}-${rec.measurementType || rec.id}-${todayUtc}`;
        const created = await createNotification(client, userId, {
          type: notifType,
          title: rec.title,
          message: `${rec.condition} ${rec.suggestedAction}`,
          link: rec.actionLink || '/dashboard/monitoring',
          dedupKey,
        });
        if (created) generatedCount++;
      }
    }
  }

  // Get updated unread count
  const unreadRes = await executeQuery<{ count: string | number }>(
    client,
    `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false;`,
    [userId],
  );
  const unreadCount = Number(unreadRes.rows[0]?.count ?? 0);

  return { generatedCount, unreadCount };
}
