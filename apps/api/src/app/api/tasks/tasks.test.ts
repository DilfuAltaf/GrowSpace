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
import { GET as tasksListHandler, POST as tasksCreateHandler } from './route';
import {
  DELETE as taskDeleteHandler,
  GET as taskDetailHandler,
  PATCH as taskUpdateHandler,
} from './[id]/route';

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
  await db.exec(loadSql('0007_create_care_schedules.sql'));

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

describe('Phase 5.2: Care Tasks API Suite', () => {
  let db: PGlite;
  let userA: TestUserSession;
  let userB: TestUserSession;
  let gardenAId: string;
  let gardenBId: string;
  let plantAId: string;

  beforeEach(async () => {
    db = await createIsolatedTestDb();
    setAuthDbOverride(db as unknown as Queryable);
    userA = await setupTestUser(db, 'user.a@growspace.test', 'User A');
    userB = await setupTestUser(db, 'user.b@growspace.test', 'User B');

    const gardenA = await createGarden(db, userA.userId, {
      name: 'User A Hydroponics',
      growingMethod: 'hydroponic',
    });
    gardenAId = gardenA.id;

    const gardenB = await createGarden(db, userB.userId, {
      name: 'User B Garden',
      growingMethod: 'soil',
    });
    gardenBId = gardenB.id;

    const plantA = await createPlant(db, userA.userId, {
      gardenId: gardenAId,
      catalogId: 'catalog-basil',
      customName: 'Sweet Basil',
      growthStage: 'vegetative',
      status: 'active',
    });
    plantAId = plantA.id;
  });

  afterEach(async () => {
    setAuthDbOverride(null);
    await db.close();
  });

  function makeRequest(
    method: string,
    url: string,
    session?: TestUserSession | null,
    body?: unknown,
  ): NextRequest {
    const headers = new Headers();
    if (session) {
      headers.set('origin', 'http://localhost:5173');
      headers.set('cookie', `gs_session=${session.sessionToken}; gs_csrf=${session.csrfToken}`);
      headers.set('x-csrf-token', session.csrfToken);
    }
    if (body !== undefined) {
      headers.set('content-type', 'application/json');
    }

    return new NextRequest(new URL(url, 'http://localhost:3001'), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  it('1. POST /api/tasks successfully creates a care task with valid payload', async () => {
    const req = makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
      gardenId: gardenAId,
      plantId: plantAId,
      title: 'Nutrient reservoir flush and refill',
      taskType: 'fertilizing',
      priority: 'high',
      dueAt: '2026-10-24T10:00:00.000Z',
      description: 'Flush EC to baseline and add vegetative nutrients.',
    });

    const res = await tasksCreateHandler(req);
    assert.equal(res.status, 201);

    const body = (await res.json()) as { task: { id: string; title: string; status: string; completedAt: string | null } };
    assert.ok(body.task.id);
    assert.equal(body.task.title, 'Nutrient reservoir flush and refill');
    assert.equal(body.task.status, 'pending');
    assert.equal(body.task.completedAt, null);
  });

  it('2. GET /api/tasks lists tasks and respects gardenId and status filters', async () => {
    // Create 2 tasks
    await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        title: 'Check pH levels',
        taskType: 'inspect',
      }),
    );

    const task2Res = await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        plantId: plantAId,
        title: 'Prune lower leaves',
        taskType: 'other',
      }),
    );
    const task2 = ((await task2Res.json()) as { task: { id: string } }).task;

    // Mark task2 as completed
    await taskUpdateHandler(
      makeRequest('PATCH', `http://localhost:3001/api/tasks/${task2.id}`, userA, {
        status: 'completed',
      }),
      { params: Promise.resolve({ id: task2.id }) },
    );

    // Filter by pending
    const pendingReq = makeRequest('GET', 'http://localhost:3001/api/tasks?status=pending', userA);
    const pendingRes = await tasksListHandler(pendingReq);
    const pendingBody = (await pendingRes.json()) as { tasks: { title: string }[] };
    assert.equal(pendingBody.tasks.length, 1);
    assert.equal(pendingBody.tasks[0]?.title, 'Check pH levels');

    // Filter by completed
    const completedReq = makeRequest('GET', 'http://localhost:3001/api/tasks?status=completed', userA);
    const completedRes = await tasksListHandler(completedReq);
    const completedBody = (await completedRes.json()) as { tasks: { title: string }[] };
    assert.equal(completedBody.tasks.length, 1);
    assert.equal(completedBody.tasks[0]?.title, 'Prune lower leaves');
  });

  it('3. PATCH /api/tasks/:id enforces completed_at consistency check', async () => {
    const createRes = await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        title: 'Water basil',
        taskType: 'watering',
      }),
    );
    const taskId = ((await createRes.json()) as { task: { id: string } }).task.id;

    // Mark completed
    const patchRes1 = await taskUpdateHandler(
      makeRequest('PATCH', `http://localhost:3001/api/tasks/${taskId}`, userA, {
        status: 'completed',
      }),
      { params: Promise.resolve({ id: taskId }) },
    );
    assert.equal(patchRes1.status, 200);
    const body1 = (await patchRes1.json()) as { task: { status: string; completedAt: string | null } };
    assert.equal(body1.task.status, 'completed');
    assert.ok(body1.task.completedAt !== null);

    // Reopen task
    const patchRes2 = await taskUpdateHandler(
      makeRequest('PATCH', `http://localhost:3001/api/tasks/${taskId}`, userA, {
        status: 'pending',
      }),
      { params: Promise.resolve({ id: taskId }) },
    );
    assert.equal(patchRes2.status, 200);
    const body2 = (await patchRes2.json()) as { task: { status: string; completedAt: string | null } };
    assert.equal(body2.task.status, 'pending');
    assert.equal(body2.task.completedAt, null);
  });

  it('4. DELETE /api/tasks/:id deletes the task', async () => {
    const createRes = await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        title: 'Task to delete',
      }),
    );
    const taskId = ((await createRes.json()) as { task: { id: string } }).task.id;

    const delRes = await taskDeleteHandler(
      makeRequest('DELETE', `http://localhost:3001/api/tasks/${taskId}`, userA),
      { params: Promise.resolve({ id: taskId }) },
    );
    assert.equal(delRes.status, 204);

    const getRes = await taskDetailHandler(
      makeRequest('GET', `http://localhost:3001/api/tasks/${taskId}`, userA),
      { params: Promise.resolve({ id: taskId }) },
    );
    assert.equal(getRes.status, 404);
  });

  it('5. Rejects unauthenticated requests with 401 unauthenticated', async () => {
    const req = makeRequest('GET', 'http://localhost:3001/api/tasks', null);
    const res = await tasksListHandler(req);
    assert.equal(res.status, 401);
  });

  it('6. Prevents cross-user task creation into unowned garden', async () => {
    // User B tries to create task in User A's garden
    const req = makeRequest('POST', 'http://localhost:3001/api/tasks', userB, {
      gardenId: gardenAId,
      title: 'Malicious task',
    });

    const res = await tasksCreateHandler(req);
    assert.ok(res.status === 403 || res.status === 404);
  });

  it('7. Prevents attaching another user plant to a task', async () => {
    // User B tries to attach User A's plant to User B's garden task
    const req = makeRequest('POST', 'http://localhost:3001/api/tasks', userB, {
      gardenId: gardenBId,
      plantId: plantAId, // owned by User A
      title: 'Mismatched plant task',
    });

    const res = await tasksCreateHandler(req);
    assert.ok(res.status === 400 || res.status === 403 || res.status === 404);
  });

  it('8. Prevents cross-user read, update, and delete of care tasks', async () => {
    const createRes = await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        title: 'User A private task',
      }),
    );
    const taskId = ((await createRes.json()) as { task: { id: string } }).task.id;

    // Read
    const getRes = await taskDetailHandler(
      makeRequest('GET', `http://localhost:3001/api/tasks/${taskId}`, userB),
      { params: Promise.resolve({ id: taskId }) },
    );
    assert.ok(getRes.status === 403 || getRes.status === 404);

    // Update
    const patchRes = await taskUpdateHandler(
      makeRequest('PATCH', `http://localhost:3001/api/tasks/${taskId}`, userB, {
        title: 'Hacked title',
      }),
      { params: Promise.resolve({ id: taskId }) },
    );
    assert.ok(patchRes.status === 403 || patchRes.status === 404);

    // Delete
    const delRes = await taskDeleteHandler(
      makeRequest('DELETE', `http://localhost:3001/api/tasks/${taskId}`, userB),
      { params: Promise.resolve({ id: taskId }) },
    );
    assert.ok(delRes.status === 403 || delRes.status === 404);
  });

  it('9. Validates task inputs and rejects empty title with 422', async () => {
    const req = makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
      gardenId: gardenAId,
      title: '   ',
    });

    const res = await tasksCreateHandler(req);
    assert.equal(res.status, 422);
  });

  it('10. Filters tasks by due classification (overdue, today, upcoming) and priority', async () => {
    const yesterday = new Date(Date.now() - 86400000 * 2).toISOString();
    const today = new Date().toISOString();
    const nextWeek = new Date(Date.now() + 86400000 * 5).toISOString();

    // Create overdue task
    await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        title: 'Overdue task',
        dueAt: yesterday,
        priority: 'high',
      }),
    );

    // Create due today task
    await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        title: 'Today task',
        dueAt: today,
        priority: 'normal',
      }),
    );

    // Create upcoming task
    await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        title: 'Upcoming task',
        dueAt: nextWeek,
        priority: 'low',
      }),
    );

    // Test ?due=overdue
    const overdueRes = await tasksListHandler(
      makeRequest('GET', 'http://localhost:3001/api/tasks?due=overdue', userA),
    );
    assert.equal(overdueRes.status, 200);
    const overdueData = (await overdueRes.json()) as { tasks: Array<{ title: string }> };
    assert.equal(overdueData.tasks.length, 1);
    assert.equal(overdueData.tasks[0].title, 'Overdue task');

    // Test ?due=today
    const todayRes = await tasksListHandler(
      makeRequest('GET', 'http://localhost:3001/api/tasks?due=today', userA),
    );
    assert.equal(todayRes.status, 200);
    const todayData = (await todayRes.json()) as { tasks: Array<{ title: string }> };
    assert.equal(todayData.tasks.length, 1);
    assert.equal(todayData.tasks[0].title, 'Today task');

    // Test ?due=upcoming
    const upcomingRes = await tasksListHandler(
      makeRequest('GET', 'http://localhost:3001/api/tasks?due=upcoming', userA),
    );
    assert.equal(upcomingRes.status, 200);
    const upcomingData = (await upcomingRes.json()) as { tasks: Array<{ title: string }> };
    assert.equal(upcomingData.tasks.length, 1);
    assert.equal(upcomingData.tasks[0].title, 'Upcoming task');

    // Test ?priority=high
    const highRes = await tasksListHandler(
      makeRequest('GET', 'http://localhost:3001/api/tasks?priority=high', userA),
    );
    assert.equal(highRes.status, 200);
    const highData = (await highRes.json()) as { tasks: Array<{ title: string }> };
    assert.equal(highData.tasks.length, 1);
    assert.equal(highData.tasks[0].title, 'Overdue task');

    // Rejects invalid due or priority query parameter
    const invalidDue = await tasksListHandler(
      makeRequest('GET', 'http://localhost:3001/api/tasks?due=invalid', userA),
    );
    assert.equal(invalidDue.status, 400);

    const invalidPriority = await tasksListHandler(
      makeRequest('GET', 'http://localhost:3001/api/tasks?priority=superhigh', userA),
    );
    assert.equal(invalidPriority.status, 400);
  });

  it('11. Supports task cancellation and status transitions with constraint safety', async () => {
    const createRes = await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        title: 'Task to cancel',
      }),
    );
    const taskId = ((await createRes.json()) as { task: { id: string } }).task.id;

    // Transition pending -> cancelled
    const cancelRes = await taskUpdateHandler(
      makeRequest('PATCH', `http://localhost:3001/api/tasks/${taskId}`, userA, {
        status: 'cancelled',
      }),
      { params: Promise.resolve({ id: taskId }) },
    );
    assert.equal(cancelRes.status, 200);
    const cancelledTask = (await cancelRes.json()) as { task: { status: string; completedAt: string | null } };
    assert.equal(cancelledTask.task.status, 'cancelled');
    assert.equal(cancelledTask.task.completedAt, null);

    // Transition cancelled -> completed
    const completeRes = await taskUpdateHandler(
      makeRequest('PATCH', `http://localhost:3001/api/tasks/${taskId}`, userA, {
        status: 'completed',
      }),
      { params: Promise.resolve({ id: taskId }) },
    );
    assert.equal(completeRes.status, 200);
    const completedTask = (await completeRes.json()) as { task: { status: string; completedAt: string | null } };
    assert.equal(completedTask.task.status, 'completed');
    assert.ok(completedTask.task.completedAt !== null);

    // Transition completed -> pending
    const reopenRes = await taskUpdateHandler(
      makeRequest('PATCH', `http://localhost:3001/api/tasks/${taskId}`, userA, {
        status: 'pending',
      }),
      { params: Promise.resolve({ id: taskId }) },
    );
    assert.equal(reopenRes.status, 200);
    const reopenedTask = (await reopenRes.json()) as { task: { status: string; completedAt: string | null } };
    assert.equal(reopenedTask.task.status, 'pending');
    assert.equal(reopenedTask.task.completedAt, null);
  });
});
