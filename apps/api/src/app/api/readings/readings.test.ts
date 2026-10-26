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
import { GET as readingsListHandler, POST as readingsCreateHandler } from './route';
import { POST as simulateReadingsHandler } from './simulate/route';
import {
  GET as plantReadingsListHandler,
  POST as plantReadingsCreateHandler,
} from '../plants/[id]/readings/route';

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

describe('Phase 5.3: Sensor Readings & Environmental Monitoring API Suite', () => {
  let db: PGlite;
  let userA: TestUserSession;
  let userB: TestUserSession;
  let gardenAId: string;
  let plantAId: string;
  let gardenBId: string;
  let plantBId: string;

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

    const gardenB = await createGarden(db, userB.userId, {
      name: 'User B Garden',
      growingMethod: 'hydroponic',
    });
    gardenBId = gardenB.id;

    const plantB = await createPlant(db, userB.userId, {
      gardenId: gardenBId,
      catalogId: 'catalog-basil',
      customName: 'User B Basil',
      growthStage: 'seedling',
      status: 'active',
    });
    plantBId = plantB.id;
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

  describe('1. Authentication & Tenant Authorization', () => {
    it('rejects unauthenticated requests with 401 unauthenticated', async () => {
      const getReq = makeRequest('GET', '/api/readings');
      const getRes = await readingsListHandler(getReq);
      assert.equal(getRes.status, 401);

      const postReq = makeRequest('POST', '/api/readings', null, {
        plantId: plantAId,
        measurementType: 'air_temperature',
        value: 22.5,
      });
      const postRes = await readingsCreateHandler(postReq);
      assert.equal(postRes.status, 401);
    });

    it('rejects mutating request without valid CSRF token with 403', async () => {
      const headers = new Headers();
      headers.set('origin', 'http://localhost:5173');
      headers.set('cookie', `gs_session=${userA.sessionToken}`);
      headers.set('content-type', 'application/json');
      // Intentionally omitting x-csrf-token

      const req = new NextRequest(new URL('/api/readings', 'http://localhost:3001'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          plantId: plantAId,
          measurementType: 'air_temperature',
          value: 22.5,
        }),
      });

      const res = await readingsCreateHandler(req);
      assert.equal(res.status, 403);
    });

    it('prevents user A from reading readings for user B plant (403 forbidden)', async () => {
      const req = makeRequest('GET', `/api/readings?plantId=${plantBId}`, userA);
      const res = await readingsListHandler(req);
      assert.equal(res.status, 403);
    });

    it('prevents user A from creating a reading for user B plant (403 forbidden)', async () => {
      const req = makeRequest('POST', '/api/readings', userA, {
        plantId: plantBId,
        measurementType: 'air_temperature',
        value: 22.5,
      });
      const res = await readingsCreateHandler(req);
      assert.equal(res.status, 403);
    });

    it('never trusts user-supplied userId in request body', async () => {
      const spoofedUserId = userB.userId;
      const req = makeRequest('POST', '/api/readings', userA, {
        plantId: plantAId,
        userId: spoofedUserId, // Malicious spoof
        measurementType: 'air_temperature',
        value: 22.5,
      });
      const res = await readingsCreateHandler(req);
      assert.equal(res.status, 201);
      const data = (await res.json()) as { reading: { userId: string } };
      // Authoritative session userId must be used
      assert.equal(data.reading.userId, userA.userId);
      assert.notEqual(data.reading.userId, spoofedUserId);
    });
  });

  describe('2. Reading Creation & Schema Range Validation', () => {
    it('creates a valid manual air temperature reading with unit and source manual', async () => {
      const req = makeRequest('POST', '/api/readings', userA, {
        plantId: plantAId,
        measurementType: 'air_temperature',
        value: 24.5,
        note: 'Warm sunny morning on balcony',
      });
      const res = await readingsCreateHandler(req);
      assert.equal(res.status, 201);
      const data = (await res.json()) as {
        reading: {
          id: string;
          plantId: string;
          gardenId: string;
          measurementType: string;
          value: number;
          unit: string;
          source: string;
          note: string;
          plantName: string;
          gardenName: string;
        };
      };
      assert.equal(data.reading.measurementType, 'air_temperature');
      assert.equal(data.reading.value, 24.5);
      assert.equal(data.reading.unit, '°C');
      assert.equal(data.reading.source, 'manual');
      assert.equal(data.reading.note, 'Warm sunny morning on balcony');
      assert.equal(data.reading.plantId, plantAId);
      assert.equal(data.reading.gardenId, gardenAId);
      assert.equal(data.reading.plantName, 'User A Tomato');
      assert.equal(data.reading.gardenName, 'User A Garden');
    });

    it('creates a valid air humidity reading', async () => {
      const req = makeRequest('POST', '/api/readings', userA, {
        plantId: plantAId,
        measurementType: 'air_humidity',
        value: 65,
      });
      const res = await readingsCreateHandler(req);
      assert.equal(res.status, 201);
      const data = (await res.json()) as { reading: { unit: string; value: number } };
      assert.equal(data.reading.unit, '%');
      assert.equal(data.reading.value, 65);
    });

    it('creates a valid medium moisture reading', async () => {
      const req = makeRequest('POST', '/api/readings', userA, {
        plantId: plantAId,
        measurementType: 'medium_moisture',
        value: 72.5,
      });
      const res = await readingsCreateHandler(req);
      assert.equal(res.status, 201);
      const data = (await res.json()) as { reading: { unit: string; value: number } };
      assert.equal(data.reading.unit, '%');
      assert.equal(data.reading.value, 72.5);
    });

    it('rejects air temperature values outside plausible range (-20 to 70 °C)', async () => {
      const tooHot = makeRequest('POST', '/api/readings', userA, {
        plantId: plantAId,
        measurementType: 'air_temperature',
        value: 75.0,
      });
      const hotRes = await readingsCreateHandler(tooHot);
      assert.equal(hotRes.status, 400);

      const tooCold = makeRequest('POST', '/api/readings', userA, {
        plantId: plantAId,
        measurementType: 'air_temperature',
        value: -25.0,
      });
      const coldRes = await readingsCreateHandler(tooCold);
      assert.equal(coldRes.status, 400);
    });

    it('rejects air humidity values outside plausible range (0 to 100 %)', async () => {
      const tooHigh = makeRequest('POST', '/api/readings', userA, {
        plantId: plantAId,
        measurementType: 'air_humidity',
        value: 105.0,
      });
      const resHigh = await readingsCreateHandler(tooHigh);
      assert.equal(resHigh.status, 400);

      const tooLow = makeRequest('POST', '/api/readings', userA, {
        plantId: plantAId,
        measurementType: 'air_humidity',
        value: -5.0,
      });
      const resLow = await readingsCreateHandler(tooLow);
      assert.equal(resLow.status, 400);
    });

    it('rejects medium moisture values outside plausible range (0 to 100 %)', async () => {
      const tooHigh = makeRequest('POST', '/api/readings', userA, {
        plantId: plantAId,
        measurementType: 'medium_moisture',
        value: 120,
      });
      const res = await readingsCreateHandler(tooHigh);
      assert.equal(res.status, 400);
    });

    it('rejects unsupported measurement metrics like light_intensity (schema check)', async () => {
      const unsupported = makeRequest('POST', '/api/readings', userA, {
        plantId: plantAId,
        measurementType: 'light_intensity',
        value: 500,
      });
      const res = await readingsCreateHandler(unsupported);
      assert.equal(res.status, 400);
    });

    it('rejects non-numeric values, NaN, and Infinity', async () => {
      const nanReq = makeRequest('POST', '/api/readings', userA, {
        plantId: plantAId,
        measurementType: 'air_temperature',
        value: 'hot',
      });
      const res = await readingsCreateHandler(nanReq);
      assert.equal(res.status, 400);
    });

    it('rejects incompatible units for measurement type', async () => {
      const badUnit = makeRequest('POST', '/api/readings', userA, {
        plantId: plantAId,
        measurementType: 'air_temperature',
        value: 25,
        unit: '%', // Incompatible unit
      });
      const res = await readingsCreateHandler(badUnit);
      assert.equal(res.status, 400);
    });

    it('rejects hardware sensor provenance since no physical hardware is connected', async () => {
      const sensorReq = makeRequest('POST', '/api/readings', userA, {
        plantId: plantAId,
        measurementType: 'air_temperature',
        value: 23,
        source: 'sensor',
      });
      const res = await readingsCreateHandler(sensorReq);
      assert.equal(res.status, 400);
    });
  });

  describe('3. Filtering, Pagination & Querying', () => {
    beforeEach(async () => {
      // Seed several readings for user A
      const timestamps = [
        '2026-10-20T10:00:00.000Z',
        '2026-10-21T10:00:00.000Z',
        '2026-10-22T10:00:00.000Z',
        '2026-10-23T10:00:00.000Z',
        '2026-10-24T10:00:00.000Z',
      ];

      for (let i = 0; i < timestamps.length; i++) {
        await readingsCreateHandler(
          makeRequest('POST', '/api/readings', userA, {
            plantId: plantAId,
            measurementType: 'air_temperature',
            value: 20 + i,
            recordedAt: timestamps[i],
            note: `Day ${i + 1}`,
          }),
        );
      }

      // Add one humidity reading
      await readingsCreateHandler(
        makeRequest('POST', '/api/readings', userA, {
          plantId: plantAId,
          measurementType: 'air_humidity',
          value: 55,
          recordedAt: '2026-10-24T11:00:00.000Z',
        }),
      );
    });

    it('lists all readings for authenticated user with pagination and total count', async () => {
      const req = makeRequest('GET', '/api/readings?limit=3&offset=0', userA);
      const res = await readingsListHandler(req);
      assert.equal(res.status, 200);
      const data = (await res.json()) as {
        readings: unknown[];
        total: number;
        limit: number;
        offset: number;
      };
      assert.equal(data.readings.length, 3);
      assert.equal(data.total, 6);
      assert.equal(data.limit, 3);
      assert.equal(data.offset, 0);
    });

    it('filters readings by measurementType', async () => {
      const req = makeRequest('GET', '/api/readings?measurementType=air_humidity', userA);
      const res = await readingsListHandler(req);
      assert.equal(res.status, 200);
      const data = (await res.json()) as { readings: Array<{ measurementType: string }> };
      assert.equal(data.readings.length, 1);
      assert.equal(data.readings[0].measurementType, 'air_humidity');
    });

    it('filters readings by date range (from / to)', async () => {
      const req = makeRequest(
        'GET',
        '/api/readings?from=2026-10-21T00:00:00.000Z&to=2026-10-23T23:59:59.000Z&measurementType=air_temperature',
        userA,
      );
      const res = await readingsListHandler(req);
      assert.equal(res.status, 200);
      const data = (await res.json()) as { readings: unknown[] };
      // Days 21, 22, 23 = 3 readings
      assert.equal(data.readings.length, 3);
    });

    it('returns latest readings per measurement type when latest=true', async () => {
      const req = makeRequest('GET', `/api/readings?latest=true&plantId=${plantAId}`, userA);
      const res = await readingsListHandler(req);
      assert.equal(res.status, 200);
      const data = (await res.json()) as {
        latest: {
          air_temperature: { value: number; recordedAt: string } | null;
          air_humidity: { value: number; recordedAt: string } | null;
          medium_moisture: unknown;
        };
      };
      assert.ok(data.latest.air_temperature);
      assert.equal(data.latest.air_temperature.value, 24); // 20 + 4
      assert.ok(data.latest.air_humidity);
      assert.equal(data.latest.air_humidity.value, 55);
      assert.equal(data.latest.medium_moisture, null);
    });

    it('plant-specific nested endpoint GET /api/plants/:id/readings returns readings and latest', async () => {
      const req = makeRequest('GET', `/api/plants/${plantAId}/readings`, userA);
      const res = await plantReadingsListHandler(req, { params: Promise.resolve({ id: plantAId }) });
      assert.equal(res.status, 200);
      const data = (await res.json()) as {
        readings: unknown[];
        latest: { air_temperature: unknown };
        total: number;
      };
      assert.equal(data.total, 6);
      assert.ok(data.latest.air_temperature);
    });

    it('plant-specific nested endpoint POST /api/plants/:id/readings records plant reading', async () => {
      const req = makeRequest('POST', `/api/plants/${plantAId}/readings`, userA, {
        measurementType: 'medium_moisture',
        value: 68.0,
        note: 'Direct root zone probe check',
      });
      const res = await plantReadingsCreateHandler(req, {
        params: Promise.resolve({ id: plantAId }),
      });
      assert.equal(res.status, 201);
      const data = (await res.json()) as {
        reading: { plantId: string; measurementType: string; value: number };
      };
      assert.equal(data.reading.plantId, plantAId);
      assert.equal(data.reading.measurementType, 'medium_moisture');
      assert.equal(data.reading.value, 68.0);
    });
  });

  describe('4. Simulation & Provenance Separation', () => {
    it('generates clearly labeled simulated demo readings via POST /api/readings/simulate', async () => {
      const req = makeRequest('POST', '/api/readings/simulate', userA, {
        plantId: plantAId,
      });
      const res = await simulateReadingsHandler(req);
      assert.equal(res.status, 201);
      const data = (await res.json()) as {
        readings: Array<{ source: string; measurementType: string }>;
        count: number;
        disclaimer: string;
      };
      assert.ok(data.count > 0);
      assert.ok(data.disclaimer.includes('SIMULATED / DATA DEMO'));
      for (const r of data.readings) {
        assert.equal(r.source, 'simulated');
      }
    });

    it('can filter specifically by source=manual and source=simulated', async () => {
      // Create 1 manual reading
      await readingsCreateHandler(
        makeRequest('POST', '/api/readings', userA, {
          plantId: plantAId,
          measurementType: 'air_temperature',
          value: 21.0,
        }),
      );

      // Generate simulated readings
      await simulateReadingsHandler(
        makeRequest('POST', '/api/readings/simulate', userA, {
          plantId: plantAId,
        }),
      );

      // Query manual only
      const manualReq = makeRequest('GET', '/api/readings?source=manual', userA);
      const manualRes = await readingsListHandler(manualReq);
      const manualData = (await manualRes.json()) as {
        readings: Array<{ source: string }>;
        total: number;
      };
      assert.equal(manualData.total, 1);
      assert.equal(manualData.readings[0].source, 'manual');

      // Query simulated only
      const simReq = makeRequest('GET', '/api/readings?source=simulated', userA);
      const simRes = await readingsListHandler(simReq);
      const simData = (await simRes.json()) as {
        readings: Array<{ source: string }>;
        total: number;
      };
      assert.ok(simData.total > 0);
      for (const r of simData.readings) {
        assert.equal(r.source, 'simulated');
      }
    });
  });
});
