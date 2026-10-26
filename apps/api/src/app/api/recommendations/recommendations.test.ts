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
import { GET as recommendationsHandler } from './route';

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

function makeRequest(
  method: string,
  url: string,
  user?: TestUserSession | null,
): NextRequest {
  const headers = new Headers();
  if (user) {
    headers.set('origin', 'http://localhost:5173');
    headers.set('cookie', `gs_session=${user.sessionToken}; gs_csrf=${user.csrfToken}`);
    headers.set('x-csrf-token', user.csrfToken);
  }

  return new NextRequest(url, {
    method,
    headers,
  });
}

describe('Phase 5.4: Care Intelligence & Recommendations API Suite', () => {
  let db: PGlite;
  let userA: TestUserSession;
  let userB: TestUserSession;
  let gardenAId: string;
  let _gardenBId: string;
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

    const gardenB = await createGarden(db, userB.userId, {
      name: 'User B Yard',
      growingMethod: 'soil',
    });
    _gardenBId = gardenB.id;

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

  it('1. Rejects unauthenticated requests with 401', async () => {
    const req = makeRequest('GET', 'http://localhost:3001/api/recommendations', null);
    const res = await recommendationsHandler(req);
    assert.equal(res.status, 401);
  });

  it('2. Prevents cross-user garden access with 403', async () => {
    // User B tries to inspect User A's garden
    const req = makeRequest(
      'GET',
      `http://localhost:3001/api/recommendations?gardenId=${gardenAId}`,
      userB,
    );
    const res = await recommendationsHandler(req);
    assert.equal(res.status, 403);
  });

  it('3. Prevents cross-user plant access with 403', async () => {
    // User B tries to inspect User A's plant
    const req = makeRequest(
      'GET',
      `http://localhost:3001/api/recommendations?plantId=${plantAId}`,
      userB,
    );
    const res = await recommendationsHandler(req);
    assert.equal(res.status, 403);
  });

  it('4. Rejects invalid UUID query parameters with 400', async () => {
    const req = makeRequest(
      'GET',
      'http://localhost:3001/api/recommendations?gardenId=invalid-uuid',
      userA,
    );
    const res = await recommendationsHandler(req);
    assert.equal(res.status, 400);
  });

  it('5. Evaluates explainable recommendations for out-of-range simulated sensor reading', async () => {
    // Record low soil moisture reading for Cherry Tomato (simulated)
    await createSensorReading(db, userA.userId, {
      gardenId: gardenAId,
      plantId: plantAId,
      measurementType: 'medium_moisture',
      value: 12,
      unit: '%',
      source: 'simulated',
      recordedAt: new Date().toISOString(),
    });

    const req = makeRequest('GET', 'http://localhost:3001/api/recommendations', userA);
    const res = await recommendationsHandler(req);
    assert.equal(res.status, 200);

    const body = (await res.json()) as {
      recommendations: Array<{
        category: string;
        severity: string;
        measurementType: string;
        title: string;
        condition: string;
        source: string;
        disclaimer: string;
      }>;
      summary: {
        total: number;
        criticalCount: number;
        environmentalAlertCount: number;
      };
    };

    assert.ok(body.recommendations.length > 0);
    const moistureRec = body.recommendations.find((r) => r.measurementType === 'medium_moisture');
    assert.ok(moistureRec);
    assert.equal(moistureRec.severity, 'warning');
    assert.equal(moistureRec.source, 'simulated');
    assert.ok(moistureRec.disclaimer.includes('simulated demonstration data'));
    assert.ok(moistureRec.condition.includes('simulated reading: 12%'));
    assert.ok(body.summary.environmentalAlertCount >= 1);
  });

  it('6. Evaluates overdue care task and due today task recommendations with priority weighting', async () => {
    const twoDaysAgo = new Date(Date.now() - 86400000 * 2).toISOString();
    const today = new Date().toISOString();

    // High priority overdue task
    await createTask(db, userA.userId, {
      gardenId: gardenAId,
      plantId: plantAId,
      title: 'Emergency Pest Inspection',
      taskType: 'inspect',
      priority: 'high',
      dueAt: twoDaysAgo,
    });

    // Normal priority due today task
    await createTask(db, userA.userId, {
      gardenId: gardenAId,
      plantId: plantAId,
      title: 'Routine Feed',
      taskType: 'fertilizing',
      priority: 'normal',
      dueAt: today,
    });

    const req = makeRequest('GET', 'http://localhost:3001/api/recommendations', userA);
    const res = await recommendationsHandler(req);
    assert.equal(res.status, 200);

    const body = (await res.json()) as {
      recommendations: Array<{
        category: string;
        severity: string;
        title: string;
        actionLink?: string;
      }>;
      summary: {
        overdueTaskCount: number;
        dueTodayTaskCount: number;
        criticalCount: number;
      };
    };

    assert.equal(body.summary.overdueTaskCount, 1);
    assert.equal(body.summary.dueTodayTaskCount, 1);

    const overdueRec = body.recommendations.find((r) =>
      r.title.includes('Emergency Pest Inspection'),
    );
    assert.ok(overdueRec);
    assert.equal(overdueRec.severity, 'critical');
    assert.ok(overdueRec.actionLink?.startsWith('/dashboard/tasks/'));

    const todayRec = body.recommendations.find((r) => r.title.includes('Routine Feed'));
    assert.ok(todayRec);
    assert.equal(todayRec.severity, 'info');
  });

  it('7. Returns empty recommendations list when everything is on track and healthy', async () => {
    // Set plant to young seedling (planted 5 days ago) so harvest window is not yet open
    const fiveDaysAgo = new Date(Date.now() - 86400000 * 5).toISOString().split('T')[0];
    await db.query(`UPDATE plants SET planting_date = $1 WHERE id = $2;`, [fiveDaysAgo, plantAId]);

    // Record healthy in-range readings
    await createSensorReading(db, userA.userId, {
      gardenId: gardenAId,
      plantId: plantAId,
      measurementType: 'medium_moisture',
      value: 60,
      unit: '%',
      source: 'manual',
      recordedAt: new Date().toISOString(),
    });

    await createSensorReading(db, userA.userId, {
      gardenId: gardenAId,
      plantId: plantAId,
      measurementType: 'air_temperature',
      value: 23,
      unit: '°C',
      source: 'manual',
      recordedAt: new Date().toISOString(),
    });

    await createSensorReading(db, userA.userId, {
      gardenId: gardenAId,
      plantId: plantAId,
      measurementType: 'air_humidity',
      value: 55,
      unit: '%',
      source: 'manual',
      recordedAt: new Date().toISOString(),
    });

    const req = makeRequest('GET', 'http://localhost:3001/api/recommendations', userA);
    const res = await recommendationsHandler(req);
    assert.equal(res.status, 200);

    const body = (await res.json()) as {
      recommendations: Array<unknown>;
      summary: {
        total: number;
        criticalCount: number;
        warningCount: number;
        overdueTaskCount: number;
      };
    };

    assert.equal(body.recommendations.length, 0);
    assert.equal(body.summary.total, 0);
    assert.equal(body.summary.criticalCount, 0);
    assert.equal(body.summary.warningCount, 0);
    assert.equal(body.summary.overdueTaskCount, 0);
  });
});
