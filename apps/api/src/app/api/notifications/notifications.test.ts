import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { PGlite } from '@electric-sql/pglite';
import {
  createSession,
  createUser,
  generateRandomToken,
  hashToken,
  setAuthDbOverride,
  type Queryable,
} from '@/lib/auth/index';
import { createGarden } from '@/lib/gardens/garden-repository';
import { createPlant } from '@/lib/plants/plant-repository';
import { createSensorReading } from '@/lib/readings/reading-repository';
import { createTask } from '@/lib/tasks/task-repository';
import {
  createNotification,
  findNotifications,
} from '@/lib/notifications/notification-repository';
import { GET as notificationsListHandler, POST as notificationsCreateHandler } from './route';
import {
  GET as notificationDetailHandler,
  PATCH as notificationUpdateHandler,
} from './[id]/route';
import { POST as markAllReadHandler } from './mark-all-read/route';
import { POST as generateRemindersHandler } from './generate/route';

process.env.RATE_LIMIT_SECRET = 'growspace-test-rate-limit-secret-32-chars-long!';

function loadSql(filename: string): string {
  const candidates = [
    resolve(process.cwd(), `migrations/${filename}`),
    resolve(process.cwd(), `../../migrations/${filename}`),
    resolve(import.meta.dirname, `../../../../../../migrations/${filename}`),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return readFileSync(c, 'utf8');
  }
  throw new Error(`Could not locate migrations/${filename}`);
}

async function createIsolatedTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(loadSql('0001_create_auth_tables.sql'));
  await db.exec(loadSql('0002_create_catalog_tables.sql'));
  await db.exec(loadSql('0003_create_gardens_and_plants.sql'));
  await db.exec(loadSql('0004_create_sensor_readings_care_tasks_plant_logs.sql'));
  await db.exec(loadSql('0005_create_notifications.sql'));

  // Seed sample catalog plant
  await db.query(`
    INSERT INTO plant_catalog (id, slug, common_name, category, is_published)
    VALUES
      ('catalog-tomato', 'tomato', 'Tomato', 'Vegetables', true),
      ('catalog-basil', 'basil', 'Basil', 'Herbs', true)
    ON CONFLICT (id) DO NOTHING;
  `);

  return db;
}

interface TestUserSession {
  userId: string;
  sessionToken: string;
  csrfToken: string;
}

async function setupTestUser(
  db: PGlite,
  email = 'gardener@growspace.test',
  displayName = 'Green Thumb',
): Promise<TestUserSession> {
  const user = await createUser(db, {
    email,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$dummy$hash',
    displayName,
  });

  const sessionToken = generateRandomToken(32);
  const csrfToken = generateRandomToken(32);

  await createSession(db, {
    userId: user.id,
    tokenHash: hashToken(sessionToken),
    csrfTokenHash: hashToken(csrfToken),
    expiresAt: new Date(Date.now() + 86400000),
  });

  return { userId: user.id, sessionToken, csrfToken };
}

function makeRequest(
  method: string,
  url: string,
  user?: TestUserSession | null,
  body?: unknown,
  csrfOverride?: string,
): NextRequest {
  const headers = new Headers();
  if (user) {
    headers.set('origin', 'http://localhost:5173');
    headers.set('cookie', `gs_session=${user.sessionToken}; gs_csrf=${user.csrfToken}`);
    headers.set('x-csrf-token', csrfOverride ?? user.csrfToken);
  }
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('Phase 5.5: In-App Notifications & Reminders API Suite', () => {
  let db: PGlite;
  let userA: TestUserSession;
  let userB: TestUserSession;
  let gardenAId: string;
  let plantAId: string;

  beforeEach(async () => {
    db = await createIsolatedTestDb();
    setAuthDbOverride(db as unknown as Queryable);
    userA = await setupTestUser(db, 'user.a@growspace.test', 'User A');
    userB = await setupTestUser(db, 'user.b@growspace.test', 'User B');

    const gardenA = await createGarden(db, userA.userId, {
      name: 'Balcony Sanctuary',
      growingMethod: 'container',
    });
    gardenAId = gardenA.id;

    const plantA = await createPlant(db, userA.userId, {
      gardenId: gardenAId,
      catalogId: 'catalog-tomato',
      customName: 'Cherry Tomato',
      growthStage: 'vegetative',
      status: 'active',
      plantingDate: '2026-02-01',
    });
    plantAId = plantA.id;
  });

  afterEach(async () => {
    setAuthDbOverride(null);
    await db.close();
  });

  it('1. Rejects unauthenticated requests with 401 unauthenticated', async () => {
    const listReq = makeRequest('GET', 'http://localhost:3001/api/notifications', null);
    const listRes = await notificationsListHandler(listReq);
    assert.equal(listRes.status, 401);

    const markReq = makeRequest(
      'POST',
      'http://localhost:3001/api/notifications/mark-all-read',
      null,
    );
    const markRes = await markAllReadHandler(markReq);
    assert.equal(markRes.status, 401);

    const genReq = makeRequest(
      'POST',
      'http://localhost:3001/api/notifications/generate',
      null,
    );
    const genRes = await generateRemindersHandler(genReq);
    assert.equal(genRes.status, 401);
  });

  it('2. Lists notifications with unreadOnly and type filtering, pagination, and unread counts', async () => {
    // Create 3 notifications for User A
    await createNotification(db, userA.userId, {
      type: 'care_task',
      title: 'Watering Reminder',
      message: 'Time to water your tomato.',
      link: '/dashboard/tasks',
      dedupKey: 'task-1',
    });

    await createNotification(db, userA.userId, {
      type: 'environmental',
      title: 'Low Moisture Alert',
      message: 'Moisture is below 15%.',
      link: '/dashboard/monitoring',
      dedupKey: 'env-1',
    });

    const notif3 = await createNotification(db, userA.userId, {
      type: 'system',
      title: 'Welcome',
      message: 'Welcome to GrowSpace Notifications!',
      dedupKey: 'sys-1',
    });

    // Mark notif3 as read in DB
    await db.query(
      `UPDATE notifications SET is_read = true, read_at = now() WHERE id = $1;`,
      [notif3!.id],
    );

    // Fetch all notifications (total = 3, unreadCount = 2)
    const allRes = await notificationsListHandler(
      makeRequest('GET', 'http://localhost:3001/api/notifications', userA),
    );
    assert.equal(allRes.status, 200);
    const allBody = (await allRes.json()) as {
      notifications: Array<{ id: string; title: string; isRead: boolean }>;
      total: number;
      unreadCount: number;
    };
    assert.equal(allBody.total, 3);
    assert.equal(allBody.unreadCount, 2);
    assert.equal(allBody.notifications.length, 3);

    // Fetch with unreadOnly=true (total = 2, unreadCount = 2)
    const unreadRes = await notificationsListHandler(
      makeRequest('GET', 'http://localhost:3001/api/notifications?unreadOnly=true', userA),
    );
    assert.equal(unreadRes.status, 200);
    const unreadBody = (await unreadRes.json()) as {
      notifications: Array<{ id: string; title: string; isRead: boolean }>;
      total: number;
      unreadCount: number;
    };
    assert.equal(unreadBody.total, 2);
    assert.equal(unreadBody.notifications.length, 2);
    assert.ok(unreadBody.notifications.every((n) => !n.isRead));

    // Fetch with type=environmental
    const envRes = await notificationsListHandler(
      makeRequest('GET', 'http://localhost:3001/api/notifications?type=environmental', userA),
    );
    assert.equal(envRes.status, 200);
    const envBody = (await envRes.json()) as {
      notifications: Array<{ type: string }>;
      total: number;
    };
    assert.equal(envBody.total, 1);
    assert.equal(envBody.notifications[0].type, 'environmental');

    // Fetch with limit=1, offset=1
    const pageRes = await notificationsListHandler(
      makeRequest('GET', 'http://localhost:3001/api/notifications?limit=1&offset=1', userA),
    );
    assert.equal(pageRes.status, 200);
    const pageBody = (await pageRes.json()) as {
      notifications: Array<unknown>;
      total: number;
      limit: number;
      offset: number;
    };
    assert.equal(pageBody.notifications.length, 1);
    assert.equal(pageBody.total, 3);
    assert.equal(pageBody.limit, 1);
    assert.equal(pageBody.offset, 1);
  });

  it('3. Updates single notification read state (read and unread) with timestamp consistency', async () => {
    const notif = await createNotification(db, userA.userId, {
      type: 'care_task',
      title: 'Inspect leaves',
      message: 'Check for pests.',
    });
    assert.ok(notif);
    assert.equal(notif.isRead, false);
    assert.equal(notif.readAt, null);

    // Mark as read
    const readRes = await notificationUpdateHandler(
      makeRequest('PATCH', `http://localhost:3001/api/notifications/${notif.id}`, userA, {
        isRead: true,
      }),
      { params: Promise.resolve({ id: notif.id }) },
    );
    assert.equal(readRes.status, 200);
    const readBody = (await readRes.json()) as {
      notification: { isRead: boolean; readAt: string | null };
    };
    assert.equal(readBody.notification.isRead, true);
    assert.ok(readBody.notification.readAt !== null);

    // Mark as unread
    const unreadRes = await notificationUpdateHandler(
      makeRequest('PATCH', `http://localhost:3001/api/notifications/${notif.id}`, userA, {
        isRead: false,
      }),
      { params: Promise.resolve({ id: notif.id }) },
    );
    assert.equal(unreadRes.status, 200);
    const unreadBody = (await unreadRes.json()) as {
      notification: { isRead: boolean; readAt: string | null };
    };
    assert.equal(unreadBody.notification.isRead, false);
    assert.equal(unreadBody.notification.readAt, null);
  });

  it('4. Prevents cross-user read or update of notifications (strict user isolation)', async () => {
    const notifA = await createNotification(db, userA.userId, {
      type: 'lifecycle',
      title: 'User A Secret Harvest',
      message: 'Harvest today.',
    });
    assert.ok(notifA);

    // User B tries to read User A's notification -> 403 Forbidden
    const getRes = await notificationDetailHandler(
      makeRequest('GET', `http://localhost:3001/api/notifications/${notifA.id}`, userB),
      { params: Promise.resolve({ id: notifA.id }) },
    );
    assert.ok(getRes.status === 403 || getRes.status === 404);

    // User B tries to mark User A's notification as read -> 403 Forbidden
    const patchRes = await notificationUpdateHandler(
      makeRequest('PATCH', `http://localhost:3001/api/notifications/${notifA.id}`, userB, {
        isRead: true,
      }),
      { params: Promise.resolve({ id: notifA.id }) },
    );
    assert.ok(patchRes.status === 403 || patchRes.status === 404);

    // User A's notification remains unread
    const check = await findNotifications(db, userA.userId);
    assert.equal(check.notifications[0].isRead, false);
  });

  it('5. Marks all unread notifications as read for caller only', async () => {
    // User A has 2 unread
    await createNotification(db, userA.userId, {
      type: 'care_task',
      title: 'Task A1',
      message: 'Do task 1',
    });
    await createNotification(db, userA.userId, {
      type: 'care_task',
      title: 'Task A2',
      message: 'Do task 2',
    });

    // User B has 1 unread
    await createNotification(db, userB.userId, {
      type: 'care_task',
      title: 'Task B1',
      message: 'Do task B',
    });

    // User A calls mark-all-read
    const res = await markAllReadHandler(
      makeRequest('POST', 'http://localhost:3001/api/notifications/mark-all-read', userA),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { updatedCount: number };
    assert.equal(body.updatedCount, 2);

    // User A now has 0 unread
    const userACheck = await findNotifications(db, userA.userId);
    assert.equal(userACheck.unreadCount, 0);

    // User B still has 1 unread (unaffected)
    const userBCheck = await findNotifications(db, userB.userId);
    assert.equal(userBCheck.unreadCount, 1);
  });

  it('6. Generates care reminders idempotently without duplicate notifications', async () => {
    const twoDaysAgo = new Date(Date.now() - 86400000 * 2).toISOString();

    // Create overdue task
    await createTask(db, userA.userId, {
      gardenId: gardenAId,
      plantId: plantAId,
      title: 'Overdue Pruning',
      taskType: 'other',
      priority: 'high',
      dueAt: twoDaysAgo,
    });

    // Record low soil moisture reading
    await createSensorReading(db, userA.userId, {
      gardenId: gardenAId,
      plantId: plantAId,
      measurementType: 'medium_moisture',
      value: 10,
      unit: '%',
      source: 'manual',
      recordedAt: new Date().toISOString(),
    });

    // First generation run: creates notifications
    const genRes1 = await generateRemindersHandler(
      makeRequest('POST', 'http://localhost:3001/api/notifications/generate', userA),
    );
    assert.equal(genRes1.status, 200);
    const body1 = (await genRes1.json()) as { generatedCount: number; unreadCount: number };
    assert.ok(body1.generatedCount >= 2);
    const initialUnread = body1.unreadCount;

    // Second generation run immediately after: must generate 0 new items due to dedup_key
    const genRes2 = await generateRemindersHandler(
      makeRequest('POST', 'http://localhost:3001/api/notifications/generate', userA),
    );
    assert.equal(genRes2.status, 200);
    const body2 = (await genRes2.json()) as { generatedCount: number; unreadCount: number };
    assert.equal(body2.generatedCount, 0);
    assert.equal(body2.unreadCount, initialUnread);
  });

  it('7. Enforces link safety and rejects external, protocol-relative, or javascript links', async () => {
    // Malicious link attempts
    const externalRes = await notificationsCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/notifications', userA, {
        type: 'care_task',
        title: 'Phishing Alert',
        message: 'Click here.',
        link: 'https://evil.com/login',
      }),
    );
    assert.equal(externalRes.status, 422);

    const protoRelativeRes = await notificationsCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/notifications', userA, {
        type: 'care_task',
        title: 'Protocol Relative Alert',
        message: 'Click here.',
        link: '//evil.com/login',
      }),
    );
    assert.equal(protoRelativeRes.status, 422);

    const jsRes = await notificationsCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/notifications', userA, {
        type: 'care_task',
        title: 'XSS Alert',
        message: 'Click here.',
        link: 'javascript:alert(document.cookie)',
      }),
    );
    assert.equal(jsRes.status, 422);

    // Valid relative internal link succeeds
    const validRes = await notificationsCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/notifications', userA, {
        type: 'care_task',
        title: 'Legitimate Alert',
        message: 'Click here.',
        link: '/dashboard/tasks',
      }),
    );
    assert.equal(validRes.status, 201);
  });

  it('8. Enforces CSRF token validation on mutating notification endpoints', async () => {
    // Missing or invalid CSRF token on POST mark-all-read
    const req = makeRequest(
      'POST',
      'http://localhost:3001/api/notifications/mark-all-read',
      userA,
      undefined,
      'invalid-csrf-token',
    );
    const res = await markAllReadHandler(req);
    assert.equal(res.status, 403);
  });
});
