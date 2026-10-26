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
import { setGroqExplainOverride } from '@/lib/analytics/analytics-groq';
import { GET as analyticsGetHandler } from './route';
import { POST as analyticsExplainHandler } from './explain/route';

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

describe('Phase 5.9: Smart Insights & Historical Analytics API Suite', () => {
  let db: PGlite;
  let userA: TestUserSession;
  let userB: TestUserSession;
  let gardenAId: string;
  let plantAId: string;
  let gardenBId: string;

  beforeEach(async () => {
    db = await createIsolatedTestDb();
    setAuthDbOverride(db as unknown as Queryable);
    userA = await setupTestUser(db, 'user.a@growspace.test', 'User A');
    userB = await setupTestUser(db, 'user.b@growspace.test', 'User B');

    const gardenA = await createGarden(db, userA.userId, {
      name: 'User A Hydro Garden',
      growingMethod: 'hydroponic',
    });
    gardenAId = gardenA.id;

    const plantA = await createPlant(db, userA.userId, {
      gardenId: gardenAId,
      catalogId: 'catalog-tomato',
      customName: 'San Marzano Tomato',
      growthStage: 'vegetative',
      status: 'active',
    });
    plantAId = plantA.id;

    const gardenB = await createGarden(db, userB.userId, {
      name: 'User B Soil Garden',
      growingMethod: 'soil',
    });
    gardenBId = gardenB.id;
  });

  afterEach(async () => {
    setAuthDbOverride(null);
    setGroqExplainOverride(null);
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

  it('1. Requires authentication to access GET /api/analytics', async () => {
    const req = makeRequest('GET', '/api/analytics');
    const res = await analyticsGetHandler(req);
    assert.equal(res.status, 401);
  });

  it('2. Denies access when requesting data for another user garden or plant', async () => {
    // User A attempts to query User B's garden
    const req = makeRequest('GET', `/api/analytics?gardenId=${gardenBId}`, userA);
    const res = await analyticsGetHandler(req);
    assert.equal(res.status, 403);
  });

  it('3. Returns clean empty state and zero counts when user has no readings', async () => {
    const req = makeRequest('GET', '/api/analytics?timeRange=7d', userA);
    const res = await analyticsGetHandler(req);
    assert.equal(res.status, 200);

    const data = (await res.json()).data;
    assert.equal(data.totalReadings, 0);
    assert.equal(data.stats.air_temperature.count, 0);
    assert.equal(data.stats.air_temperature.min, null);
    assert.equal(data.stats.air_temperature.avg, null);
    assert.equal(data.previousPeriod.hasComparableData, false);
    assert.match(data.deterministicSummary, /No environmental readings/);
  });

  it('4. Computes historical stats, min/max/avg, and period delta when prior readings exist', async () => {
    const now = new Date();
    // Insert reading in current period (3 days ago)
    const currentReadingDate = new Date(now.getTime() - 3 * 24 * 3600 * 1000).toISOString();
    await db.query(
      `INSERT INTO sensor_readings (user_id, garden_id, plant_id, measurement_type, value, unit, source, recorded_at)
       VALUES
         ($1, $2, $3, 'air_temperature', 26.0, '°C', 'manual', $4),
         ($1, $2, $3, 'air_temperature', 22.0, '°C', 'simulated', $4),
         ($1, $2, $3, 'air_humidity', 60.0, '%', 'manual', $4);`,
      [userA.userId, gardenAId, plantAId, currentReadingDate],
    );

    // Insert reading in prior period (10 days ago, which is in the prior 7d window)
    const priorReadingDate = new Date(now.getTime() - 10 * 24 * 3600 * 1000).toISOString();
    await db.query(
      `INSERT INTO sensor_readings (user_id, garden_id, plant_id, measurement_type, value, unit, source, recorded_at)
       VALUES
         ($1, $2, $3, 'air_temperature', 20.0, '°C', 'manual', $4);`,
      [userA.userId, gardenAId, plantAId, priorReadingDate],
    );

    const req = makeRequest('GET', '/api/analytics?timeRange=7d', userA);
    const res = await analyticsGetHandler(req);
    assert.equal(res.status, 200);

    const data = (await res.json()).data;
    assert.equal(data.totalReadings, 3);

    const tempStats = data.stats.air_temperature;
    assert.equal(tempStats.count, 2);
    assert.equal(tempStats.min, 22);
    assert.equal(tempStats.max, 26);
    assert.equal(tempStats.avg, 24);
    assert.equal(tempStats.sourceBreakdown.manual, 1);
    assert.equal(tempStats.sourceBreakdown.simulated, 1);

    // Prior period had 1 temp reading of 20°C, so delta is 24 - 20 = +4
    assert.equal(data.previousPeriod.hasComparableData, true);
    assert.equal(tempStats.previousAvg, 20);
    assert.equal(tempStats.deltaAvg, 4);
    assert.match(data.deterministicSummary, /\+4\.0°C vs prior period/);
  });

  it('5. Evaluates plant condition insights accurately for authenticated user plants', async () => {
    const now = new Date();
    // Tomato reference ranges: temp: 18-29°C, humidity: 50-70%, moisture: 55-75%
    // Record fresh readings: temperature 24°C (optimal), humidity 35% (low), moisture missing
    const readingTime = new Date(now.getTime() - 2 * 3600 * 1000).toISOString(); // 2 hours ago
    await db.query(
      `INSERT INTO sensor_readings (user_id, garden_id, plant_id, measurement_type, value, unit, source, recorded_at)
       VALUES
         ($1, $2, $3, 'air_temperature', 24.0, '°C', 'manual', $4),
         ($1, $2, $3, 'air_humidity', 35.0, '%', 'manual', $4);`,
      [userA.userId, gardenAId, plantAId, readingTime],
    );

    const req = makeRequest('GET', `/api/analytics?plantId=${plantAId}`, userA);
    const res = await analyticsGetHandler(req);
    assert.equal(res.status, 200);

    const data = (await res.json()).data;
    const insights = data.plantInsights;
    assert.equal(insights.length, 3);

    const tempInsight = insights.find((i: { measurementType: string }) => i.measurementType === 'air_temperature');
    assert.equal(tempInsight.state, 'optimal');
    assert.equal(tempInsight.observedValue, 24);

    const humInsight = insights.find((i: { measurementType: string }) => i.measurementType === 'air_humidity');
    assert.equal(humInsight.state, 'low');
    assert.equal(humInsight.observedValue, 35);
    assert.equal(humInsight.severity, 'warning');

    const moistInsight = insights.find((i: { measurementType: string }) => i.measurementType === 'medium_moisture');
    assert.equal(moistInsight.state, 'insufficient_data');
    assert.equal(moistInsight.observedValue, null);
  });

  it('6. POST /api/analytics/explain returns deterministic summary when Groq is not configured', async () => {
    delete process.env.GROQ_API_KEY;

    const req = makeRequest('POST', '/api/analytics/explain', userA, { timeRange: '7d' });
    const res = await analyticsExplainHandler(req);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.ok(body.data.explanation);
    assert.equal(body.data.explanation, body.data.summary.deterministicSummary);
  });

  it('7. POST /api/analytics/explain calls AI synthesizer when override is registered', async () => {
    let overrideCalled = false;
    setGroqExplainOverride(async (summary) => {
      overrideCalled = true;
      return `AI analysis: ${summary.totalReadings} readings evaluated across ${summary.period.timeRange}.`;
    });

    const req = makeRequest('POST', '/api/analytics/explain', userA, { timeRange: '7d' });
    const res = await analyticsExplainHandler(req);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(overrideCalled, true);
    assert.match(body.data.explanation, /AI analysis:/);
  });
});
