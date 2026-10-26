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
import { generateCareReminders } from '@/lib/notifications/notification-repository';
import { GET as tasksListHandler, POST as tasksCreateHandler } from './route';
import {
  DELETE as taskDeleteHandler,
  GET as taskDetailHandler,
  PATCH as taskUpdateHandler,
} from './[id]/route';
import {
  GET as schedulesListHandler,
  POST as schedulesCreateHandler,
} from './schedules/route';
import {
  DELETE as scheduleDeleteHandler,
  GET as scheduleDetailHandler,
  PATCH as scheduleUpdateHandler,
} from './schedules/[id]/route';

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
  await db.exec(loadSql('0007_create_care_schedules.sql'));

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

describe('Phase 5.10: Smart Care Planner & Recurring Schedules Suite', () => {
  let db: PGlite;
  let userA: TestUserSession;
  let userB: TestUserSession;
  let gardenAId: string;
  let gardenBId: string;
  let plantAId: string;

  beforeEach(async () => {
    db = await createIsolatedTestDb();
    setAuthDbOverride(db as unknown as Queryable);
    userA = await setupTestUser(db, 'planner.a@growspace.test', 'User A');
    userB = await setupTestUser(db, 'planner.b@growspace.test', 'User B');

    const gardenA = await createGarden(db, userA.userId, {
      name: 'User A Hydro Greenhouse',
      growingMethod: 'hydroponic',
    });
    gardenAId = gardenA.id;

    const gardenB = await createGarden(db, userB.userId, {
      name: 'User B Raised Bed',
      growingMethod: 'raised_bed',
    });
    gardenBId = gardenB.id;

    const plantA = await createPlant(db, userA.userId, {
      gardenId: gardenAId,
      catalogId: 'catalog-tomato',
      customName: 'Cherry Tomato Vine',
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

  it('1. Creates a recurring care schedule and generates its initial bounded task', async () => {
    const req = makeRequest('POST', 'http://localhost:3001/api/tasks/schedules', userA, {
      gardenId: gardenAId,
      plantId: plantAId,
      title: 'Water tomato roots',
      taskType: 'watering',
      priority: 'high',
      intervalValue: 3,
      intervalUnit: 'days',
      startDate: '2026-10-25T09:00:00.000Z',
      description: 'Check reservoir EC and deliver 1.5L water.',
    });

    const res = await schedulesCreateHandler(req);
    assert.equal(res.status, 201);

    const body = (await res.json()) as {
      schedule: { id: string; title: string; intervalValue: number; intervalUnit: string; isActive: boolean };
      initialTask: { id: string; title: string; scheduleId: string; dueAt: string; status: string };
    };

    assert.ok(body.schedule.id);
    assert.equal(body.schedule.title, 'Water tomato roots');
    assert.equal(body.schedule.intervalValue, 3);
    assert.equal(body.schedule.intervalUnit, 'days');
    assert.equal(body.schedule.isActive, true);

    assert.ok(body.initialTask.id);
    assert.equal(body.initialTask.scheduleId, body.schedule.id);
    assert.equal(body.initialTask.status, 'pending');
    assert.equal(body.initialTask.dueAt, '2026-10-25T09:00:00.000Z');
  });

  it('2. Lists care schedules and filters by isActive and gardenId', async () => {
    // Create an active schedule
    await schedulesCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks/schedules', userA, {
        gardenId: gardenAId,
        title: 'Weekly nutrient balance',
        taskType: 'fertilizing',
        intervalValue: 7,
        intervalUnit: 'days',
      }),
    );

    // List all user A schedules
    const listReq = makeRequest('GET', `http://localhost:3001/api/tasks/schedules?gardenId=${gardenAId}`, userA);
    const listRes = await schedulesListHandler(listReq);
    assert.equal(listRes.status, 200);

    const listBody = (await listRes.json()) as { schedules: Array<{ id: string; title: string; isActive: boolean }> };
    assert.equal(listBody.schedules.length, 1);
    assert.equal(listBody.schedules[0]?.title, 'Weekly nutrient balance');
    assert.equal(listBody.schedules[0]?.isActive, true);
  });

  it('3. Updates and disables a schedule without deleting existing tasks', async () => {
    const createRes = await schedulesCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks/schedules', userA, {
        gardenId: gardenAId,
        title: 'Prune suckers',
        taskType: 'pruning',
        intervalValue: 14,
        intervalUnit: 'days',
      }),
    );
    const created = (await createRes.json()) as { schedule: { id: string }; initialTask: { id: string } };

    // Update schedule to inactive
    const updateReq = makeRequest('PATCH', `http://localhost:3001/api/tasks/schedules/${created.schedule.id}`, userA, {
      isActive: false,
      intervalValue: 21,
    });
    const updateRes = await scheduleUpdateHandler(updateReq, { params: Promise.resolve({ id: created.schedule.id }) });
    assert.equal(updateRes.status, 200);

    const updateBody = (await updateRes.json()) as { schedule: { isActive: boolean; intervalValue: number } };
    assert.equal(updateBody.schedule.isActive, false);
    assert.equal(updateBody.schedule.intervalValue, 21);

    // Verify existing initial task is untouched and remains pending
    const taskReq = makeRequest('GET', `http://localhost:3001/api/tasks/${created.initialTask.id}`, userA);
    const taskRes = await taskDetailHandler(taskReq, { params: Promise.resolve({ id: created.initialTask.id }) });
    assert.equal(taskRes.status, 200);
    const taskBody = (await taskRes.json()) as { task: { status: string } };
    assert.equal(taskBody.task.status, 'pending');
  });

  it('4. Deleting a schedule safely sets task schedule_id to null and preserves history', async () => {
    const createRes = await schedulesCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks/schedules', userA, {
        gardenId: gardenAId,
        title: 'Inspect leaf undersides',
        taskType: 'inspect',
        intervalValue: 5,
        intervalUnit: 'days',
      }),
    );
    const created = (await createRes.json()) as { schedule: { id: string }; initialTask: { id: string } };

    // Mark task completed
    await taskUpdateHandler(
      makeRequest('PATCH', `http://localhost:3001/api/tasks/${created.initialTask.id}`, userA, {
        status: 'completed',
      }),
      { params: Promise.resolve({ id: created.initialTask.id }) },
    );

    // Delete the schedule
    const delRes = await scheduleDeleteHandler(
      makeRequest('DELETE', `http://localhost:3001/api/tasks/schedules/${created.schedule.id}`, userA),
      { params: Promise.resolve({ id: created.schedule.id }) },
    );
    assert.equal(delRes.status, 204);

    // Historical completed task must still exist
    const taskRes = await taskDetailHandler(
      makeRequest('GET', `http://localhost:3001/api/tasks/${created.initialTask.id}`, userA),
      { params: Promise.resolve({ id: created.initialTask.id }) },
    );
    assert.equal(taskRes.status, 200);
    const taskBody = (await taskRes.json()) as { task: { id: string; status: string; scheduleId: string | null } };
    assert.equal(taskBody.task.status, 'completed');
    assert.equal(taskBody.task.scheduleId, null);
  });

  it('5. Late task completion spaces the next occurrence from the completion date', async () => {
    // Schedule due in the past: 2026-10-20 (5 days interval)
    const createRes = await schedulesCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks/schedules', userA, {
        gardenId: gardenAId,
        title: 'Water deep roots',
        taskType: 'watering',
        intervalValue: 5,
        intervalUnit: 'days',
        startDate: '2026-10-20T09:00:00.000Z',
      }),
    );
    const created = (await createRes.json()) as { schedule: { id: string }; initialTask: { id: string } };

    // User completes the task today (late)
    const patchRes = await taskUpdateHandler(
      makeRequest('PATCH', `http://localhost:3001/api/tasks/${created.initialTask.id}`, userA, {
        status: 'completed',
      }),
      { params: Promise.resolve({ id: created.initialTask.id }) },
    );
    assert.equal(patchRes.status, 200);

    // Verify schedule was advanced from now() rather than the old Oct 20 due date
    const scheduleRes = await scheduleDetailHandler(
      makeRequest('GET', `http://localhost:3001/api/tasks/schedules/${created.schedule.id}`, userA),
      { params: Promise.resolve({ id: created.schedule.id }) },
    );
    const schedBody = (await scheduleRes.json()) as { schedule: { nextDueAt: string } };

    const nextDue = new Date(schedBody.schedule.nextDueAt);
    const now = new Date();
    // Next due should be approximately now + 5 days (definitely after now)
    assert.ok(nextDue.getTime() > now.getTime() + 4 * 86400000);

    // Verify a new pending task was automatically generated
    const tasksRes = await tasksListHandler(
      makeRequest('GET', `http://localhost:3001/api/tasks?gardenId=${gardenAId}&status=pending`, userA),
    );
    const tasksBody = (await tasksRes.json()) as { tasks: Array<{ scheduleId: string; status: string }> };
    const matchingPending = tasksBody.tasks.filter((t) => t.scheduleId === created.schedule.id);
    assert.equal(matchingPending.length, 1);
  });

  it('6. Reopening a completed task resets completed_at to null', async () => {
    const taskRes = await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        title: 'Harvest mature basil',
        taskType: 'harvest',
      }),
    );
    const task = (await taskRes.json()) as { task: { id: string } };

    // Complete task
    await taskUpdateHandler(
      makeRequest('PATCH', `http://localhost:3001/api/tasks/${task.task.id}`, userA, { status: 'completed' }),
      { params: Promise.resolve({ id: task.task.id }) },
    );

    // Reopen task
    const reopenRes = await taskUpdateHandler(
      makeRequest('PATCH', `http://localhost:3001/api/tasks/${task.task.id}`, userA, { status: 'pending' }),
      { params: Promise.resolve({ id: task.task.id }) },
    );
    assert.equal(reopenRes.status, 200);

    const reopened = (await reopenRes.json()) as { task: { status: string; completedAt: string | null } };
    assert.equal(reopened.task.status, 'pending');
    assert.equal(reopened.task.completedAt, null);
  });

  it('7. Supports calendar date range query and title search', async () => {
    await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        title: 'Prune yellow leaves',
        taskType: 'pruning',
        dueAt: '2026-10-26T10:00:00.000Z',
      }),
    );

    await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        title: 'Fertilize seedlings',
        taskType: 'fertilizing',
        dueAt: '2026-11-15T10:00:00.000Z',
      }),
    );

    // Search query
    const searchRes = await tasksListHandler(
      makeRequest('GET', 'http://localhost:3001/api/tasks?search=Prune', userA),
    );
    const searchBody = (await searchRes.json()) as { tasks: Array<{ title: string }> };
    assert.equal(searchBody.tasks.length, 1);
    assert.equal(searchBody.tasks[0]?.title, 'Prune yellow leaves');

    // Date range within October
    const rangeRes = await tasksListHandler(
      makeRequest(
        'GET',
        'http://localhost:3001/api/tasks?from=2026-10-01T00:00:00.000Z&to=2026-10-31T23:59:59.999Z',
        userA,
      ),
    );
    const rangeBody = (await rangeRes.json()) as { tasks: Array<{ title: string }> };
    assert.equal(rangeBody.tasks.length, 1);
    assert.equal(rangeBody.tasks[0]?.title, 'Prune yellow leaves');

    // Reject inverted date range
    const invalidRangeRes = await tasksListHandler(
      makeRequest('GET', 'http://localhost:3001/api/tasks?from=2026-11-01&to=2026-10-01', userA),
    );
    assert.equal(invalidRangeRes.status, 400);
  });

  it('8. Enforces cross-user ownership isolation on schedules and tasks', async () => {
    // User A creates schedule
    const createRes = await schedulesCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks/schedules', userA, {
        gardenId: gardenAId,
        title: 'User A Secret Routine',
        intervalValue: 2,
        intervalUnit: 'days',
      }),
    );
    const sched = (await createRes.json()) as { schedule: { id: string } };

    // User B attempts to read User A schedule -> 403 Forbidden
    const bGetRes = await scheduleDetailHandler(
      makeRequest('GET', `http://localhost:3001/api/tasks/schedules/${sched.schedule.id}`, userB),
      { params: Promise.resolve({ id: sched.schedule.id }) },
    );
    assert.equal(bGetRes.status, 403);

    // User B attempts to delete User A schedule -> 403 Forbidden
    const bDelRes = await scheduleDeleteHandler(
      makeRequest('DELETE', `http://localhost:3001/api/tasks/schedules/${sched.schedule.id}`, userB),
      { params: Promise.resolve({ id: sched.schedule.id }) },
    );
    assert.equal(bDelRes.status, 403);

    // User B attempts to create schedule in User A garden -> 403 Forbidden
    const bCreateRes = await schedulesCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks/schedules', userB, {
        gardenId: gardenAId,
        title: 'Unauthorized schedule',
        intervalValue: 1,
        intervalUnit: 'days',
      }),
    );
    assert.equal(bCreateRes.status, 403);

    // User B attempts to delete User A task -> 403 Forbidden
    const aTask = await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        title: 'User A Private Task',
      }),
    );
    const { task: createdTask } = (await aTask.json()) as { task: { id: string } };
    const bTaskDelRes = await taskDeleteHandler(
      makeRequest('DELETE', `http://localhost:3001/api/tasks/${createdTask.id}`, userB),
      { params: Promise.resolve({ id: createdTask.id }) },
    );
    assert.equal(bTaskDelRes.status, 403);

    // User A attempts to create task in User B garden -> 403 Forbidden
    const aCreateInBRes = await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenBId,
        title: 'Unauthorized cross garden task',
      }),
    );
    assert.equal(aCreateInBRes.status, 403);
  });

  it('9. Idempotent notification reminders handle repeated triggers without duplicates', async () => {
    // Create an overdue task and a due today task
    const pastDate = new Date(Date.now() - 86400000 * 2).toISOString();
    const todayDate = new Date().toISOString();

    await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        title: 'Overdue emergency watering',
        taskType: 'watering',
        dueAt: pastDate,
      }),
    );

    await tasksCreateHandler(
      makeRequest('POST', 'http://localhost:3001/api/tasks', userA, {
        gardenId: gardenAId,
        title: 'Today scheduled inspection',
        taskType: 'inspect',
        dueAt: todayDate,
      }),
    );

    // First reminder trigger
    const firstRun = await generateCareReminders(db, userA.userId);
    assert.ok(firstRun.generatedCount >= 2);

    // Repeated reminder trigger on same day -> 0 new notifications
    const secondRun = await generateCareReminders(db, userA.userId);
    assert.equal(secondRun.generatedCount, 0);

    // User with 0 tasks handles generation cleanly
    const emptyRun = await generateCareReminders(db, userB.userId);
    assert.equal(emptyRun.generatedCount, 0);
  });
});
