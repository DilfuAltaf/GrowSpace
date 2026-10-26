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
import { GET as plantLogsListHandler, POST as plantLogsCreateHandler } from './[id]/logs/route';
import { DELETE as plantLogDeleteHandler } from './[id]/logs/[logId]/route';

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

describe('Phase 5.2: Plant Growth Logs API Suite', () => {
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
      name: 'User A Garden',
      growingMethod: 'soil',
    });
    gardenAId = gardenA.id;

    const plantA = await createPlant(db, userA.userId, {
      gardenId: gardenAId,
      catalogId: 'catalog-tomato',
      customName: 'User A Tomato',
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

  it('1. POST /api/plants/:id/logs successfully creates a growth log with valid payload', async () => {
    const req = makeRequest('POST', `http://localhost:3001/api/plants/${plantAId}/logs`, userA, {
      logType: 'growth',
      title: 'First true leaves observed',
      content: 'Plant is developing strong first set of true leaves. Healthy green color.',
      loggedAt: '2026-10-23T10:00:00.000Z',
    });

    const res = await plantLogsCreateHandler(req, {
      params: Promise.resolve({ id: plantAId }),
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as { log: { id: string; title: string; content: string; logType: string } };
    assert.ok(body.log.id);
    assert.equal(body.log.title, 'First true leaves observed');
    assert.equal(body.log.logType, 'growth');
    assert.equal(body.log.content, 'Plant is developing strong first set of true leaves. Healthy green color.');
  });

  it('2. GET /api/plants/:id/logs returns logs in descending chronological order', async () => {
    // Create two logs
    await plantLogsCreateHandler(
      makeRequest('POST', `http://localhost:3001/api/plants/${plantAId}/logs`, userA, {
        logType: 'note',
        title: 'Earlier observation',
        content: 'Seedling sprouted',
        loggedAt: '2026-10-20T08:00:00.000Z',
      }),
      { params: Promise.resolve({ id: plantAId }) },
    );

    await plantLogsCreateHandler(
      makeRequest('POST', `http://localhost:3001/api/plants/${plantAId}/logs`, userA, {
        logType: 'growth',
        title: 'Later observation',
        content: 'Flowering cluster formed',
        loggedAt: '2026-10-23T12:00:00.000Z',
      }),
      { params: Promise.resolve({ id: plantAId }) },
    );

    const getReq = makeRequest('GET', `http://localhost:3001/api/plants/${plantAId}/logs`, userA);
    const getRes = await plantLogsListHandler(getReq, {
      params: Promise.resolve({ id: plantAId }),
    });

    assert.equal(getRes.status, 200);
    const getBody = (await getRes.json()) as { logs: { title: string; loggedAt: string }[] };
    assert.equal(getBody.logs.length, 2);
    // Newest first
    assert.equal(getBody.logs[0]?.title, 'Later observation');
    assert.equal(getBody.logs[1]?.title, 'Earlier observation');
  });

  it('3. DELETE /api/plants/:id/logs/:logId deletes the log and removes it from list', async () => {
    const createRes = await plantLogsCreateHandler(
      makeRequest('POST', `http://localhost:3001/api/plants/${plantAId}/logs`, userA, {
        logType: 'note',
        content: 'Temporary observation to delete',
      }),
      { params: Promise.resolve({ id: plantAId }) },
    );

    const created = (await createRes.json()) as { log: { id: string } };
    const logId = created.log.id;

    const delReq = makeRequest(
      'DELETE',
      `http://localhost:3001/api/plants/${plantAId}/logs/${logId}`,
      userA,
    );
    const delRes = await plantLogDeleteHandler(delReq, {
      params: Promise.resolve({ id: plantAId, logId }),
    });

    assert.equal(delRes.status, 204);

    // Verify it is no longer returned
    const listRes = await plantLogsListHandler(
      makeRequest('GET', `http://localhost:3001/api/plants/${plantAId}/logs`, userA),
      { params: Promise.resolve({ id: plantAId }) },
    );
    const listBody = (await listRes.json()) as { logs: { id: string }[] };
    assert.equal(listBody.logs.some((l) => l.id === logId), false);
  });

  it('4. Rejects unauthenticated requests with 401 unauthenticated', async () => {
    const req = makeRequest('GET', `http://localhost:3001/api/plants/${plantAId}/logs`, null);
    const res = await plantLogsListHandler(req, {
      params: Promise.resolve({ id: plantAId }),
    });

    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'unauthenticated');
  });

  it('5. Prevents cross-user log creation (User B cannot add logs to User A plant)', async () => {
    const req = makeRequest('POST', `http://localhost:3001/api/plants/${plantAId}/logs`, userB, {
      logType: 'growth',
      content: 'Unauthorized observation attempt',
    });

    const res = await plantLogsCreateHandler(req, {
      params: Promise.resolve({ id: plantAId }),
    });

    assert.ok(res.status === 403 || res.status === 404);
  });

  it('6. Prevents cross-user log listing (User B cannot list User A plant logs)', async () => {
    const req = makeRequest('GET', `http://localhost:3001/api/plants/${plantAId}/logs`, userB);
    const res = await plantLogsListHandler(req, {
      params: Promise.resolve({ id: plantAId }),
    });

    assert.ok(res.status === 403 || res.status === 404);
  });

  it('7. Prevents cross-user log deletion (User B cannot delete User A plant log)', async () => {
    const createRes = await plantLogsCreateHandler(
      makeRequest('POST', `http://localhost:3001/api/plants/${plantAId}/logs`, userA, {
        logType: 'note',
        content: 'User A private note',
      }),
      { params: Promise.resolve({ id: plantAId }) },
    );

    const created = (await createRes.json()) as { log: { id: string } };
    const logId = created.log.id;

    const delReq = makeRequest(
      'DELETE',
      `http://localhost:3001/api/plants/${plantAId}/logs/${logId}`,
      userB,
    );
    const delRes = await plantLogDeleteHandler(delReq, {
      params: Promise.resolve({ id: plantAId, logId }),
    });

    assert.ok(delRes.status === 403 || delRes.status === 404);
  });

  it('8. Validates request body and rejects empty content with 422', async () => {
    const req = makeRequest('POST', `http://localhost:3001/api/plants/${plantAId}/logs`, userA, {
      logType: 'growth',
      content: '   ', // whitespace only
    });

    const res = await plantLogsCreateHandler(req, {
      params: Promise.resolve({ id: plantAId }),
    });

    assert.equal(res.status, 422);
  });

  it('9. Rejects invalid date format with 422', async () => {
    const req = makeRequest('POST', `http://localhost:3001/api/plants/${plantAId}/logs`, userA, {
      logType: 'growth',
      content: 'Valid content',
      loggedAt: 'not-a-valid-date',
    });

    const res = await plantLogsCreateHandler(req, {
      params: Promise.resolve({ id: plantAId }),
    });

    assert.equal(res.status, 422);
  });
});
