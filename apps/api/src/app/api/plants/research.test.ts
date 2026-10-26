import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { PGlite } from '@electric-sql/pglite';
import type { PlantResearchProfile } from '@growspace/shared';
import {
  createSession,
  createUser,
  generateRandomToken,
  hashToken,
  setAuthDbOverride,
  type Queryable,
} from '@/lib/auth/index';
import { createGarden } from '@/lib/gardens/garden-repository';
import {
  RealGroqResearchClient,
  setGroqClientOverride,
} from '@/lib/research/groq-client';
import { resetResearchRateLimits } from '@/lib/research/rate-limiter';
import {
  setSearchAdapterOverride,
  type SearchEvidenceItem,
} from '@/lib/research/search-adapter';
import { POST as researchPostHandler } from './research/route';
import { GET as researchGetHandler } from './research/[id]/route';
import { GET as plantsListHandler, POST as plantCreateHandler } from './route';
import {
  GET as plantDetailHandler,
  PATCH as plantPatchHandler,
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
  await db.exec(loadSql('0005_create_notifications.sql'));
  await db.exec(loadSql('0006_create_plant_research.sql'));

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
  const tokenHash = hashToken(sessionToken);
  const csrfTokenHash = hashToken(csrfToken);

  const expiresAt = new Date(Date.now() + 86400000);

  await createSession(db, {
    userId: user.id,
    tokenHash,
    csrfTokenHash,
    expiresAt,
  });

  return {
    userId: user.id,
    sessionToken,
    csrfToken,
  };
}

function makeAuthRequest(
  url: string,
  session?: TestUserSession | null,
  options: {
    method?: string;
    body?: unknown;
    origin?: string;
    csrfToken?: string | null;
  } = {},
): NextRequest {
  const method = options.method ?? 'GET';
  const headers = new Headers();
  headers.set('host', 'localhost:3000');

  if (session) {
    headers.set('cookie', `gs_session=${session.sessionToken}; gs_csrf=${session.csrfToken}`);
    headers.set('origin', options.origin ?? 'http://localhost:5173');

    if (options.csrfToken !== null) {
      headers.set('x-csrf-token', options.csrfToken ?? session.csrfToken);
    }
  } else if (options.origin) {
    headers.set('origin', options.origin);
  }

  let bodyString: string | undefined;
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    bodyString = JSON.stringify(options.body);
  }

  return new NextRequest(url, {
    method,
    headers,
    body: bodyString,
  });
}

describe('AI Plant Research Agent & Custom Plant Flow', () => {
  let db: PGlite;
  let userA: TestUserSession;
  let userB: TestUserSession;
  let gardenAId: string;
  let gardenBId: string;

  beforeEach(async () => {
    db = await createIsolatedTestDb();
    setAuthDbOverride(db as unknown as Queryable);
    resetResearchRateLimits();

    userA = await setupTestUser(db, 'usera@growspace.test', 'User A');
    userB = await setupTestUser(db, 'userb@growspace.test', 'User B');

    const gardenA = await createGarden(db, userA.userId, {
      name: 'Balcony Garden',
      locationLabel: 'Sunny Balcony',
    });
    gardenAId = gardenA.id;

    const gardenB = await createGarden(db, userB.userId, {
      name: 'User B Yard',
      locationLabel: 'Backyard',
    });
    gardenBId = gardenB.id;
  });

  afterEach(async () => {
    setAuthDbOverride(null);
    setSearchAdapterOverride(null);
    setGroqClientOverride(null);
    resetResearchRateLimits();
    delete process.env.GROQ_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    await db.close();
  });

  it('1. Existing catalog match returns early without calling search or Groq LLM', async () => {
    let searchCalled = false;
    let groqCalled = false;

    setSearchAdapterOverride({
      name: 'mock',
      async search() {
        searchCalled = true;
        return [];
      },
    });

    setGroqClientOverride({
      async synthesizePlantProfile() {
        groqCalled = true;
        throw new Error('Should not be called');
      },
    });

    const req = makeAuthRequest('http://localhost:3000/api/plants/research', userA, {
      method: 'POST',
      body: { plantName: 'Tomato' },
    });

    const res = await researchPostHandler(req);
    assert.equal(res.status, 200);

    const body = (await res.json()) as { matchedCatalogEntry?: { commonName: string } };
    assert.equal(body.matchedCatalogEntry?.commonName, 'Tomato');
    assert.equal(searchCalled, false, 'Search must not be invoked for existing catalog plant');
    assert.equal(groqCalled, false, 'Groq LLM must not be invoked for existing catalog plant');
  });

  it('2. Missing Groq or Search credentials returns clear 503 setup_required error', async () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    setSearchAdapterOverride(null);
    setGroqClientOverride(null);

    const req = makeAuthRequest('http://localhost:3000/api/plants/research', userA, {
      method: 'POST',
      body: { plantName: 'Dragon Fruit' },
    });

    const res = await researchPostHandler(req);
    assert.equal(res.status, 503);

    const body = (await res.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'setup_required');
    assert.match(body.error.message, /GROQ_API_KEY/);
  });

  it('3. Complete 11-step integration path: research uncataloged plant, review draft, explicit save, and verify isolated persistence', async () => {
    // Step 1: User A is authenticated (userA session)
    // Step 2 & 3: Submit plant name absent from catalog; catalog-miss confirmed
    const mockEvidence: SearchEvidenceItem[] = [
      {
        title: 'Growing Dragon Fruit (Pitaya) - University Extension',
        url: 'https://extension.example.edu/pitaya',
        publisher: 'State Extension',
        snippet: 'Dragon fruit prefers temperatures between 18 and 35°C, well-draining soil, and 40-70% humidity. Harvest in 180 to 300 days.',
        retrievedAt: '2026-10-24T12:00:00.000Z',
      },
      {
        title: 'Botanical Society - Pitaya Care',
        url: 'https://botanical.example.org/pitaya-guide',
        publisher: 'Botanical Society',
        snippet: 'Pitaya requires bright sunlight and light watering.',
        retrievedAt: '2026-10-24T12:00:00.000Z',
      },
    ];

    let searchExecuted = false;
    let groqExecuted = false;

    // Step 4: Search adapter executes and returns bounded evidence
    setSearchAdapterOverride({
      name: 'mock-search',
      async search(name: string) {
        searchExecuted = true;
        assert.equal(name, 'Dragon Fruit');
        return mockEvidence;
      },
    });

    // Step 5: Groq adapter receives bounded evidence and synthesizes structured profile
    setGroqClientOverride({
      async synthesizePlantProfile(name: string, evidence: SearchEvidenceItem[]) {
        groqExecuted = true;
        assert.equal(name, 'Dragon Fruit');
        assert.equal(evidence.length, 2);

        // Step 6 & 7: Structured profile with source metadata and confidence
        return {
          plantName: name,
          scientificName: 'Selenicereus undatus',
          category: 'Fruits',
          difficulty: 'moderate',
          growingMedium: 'Well-draining cactus and succulent mix',
          lightGuidance: 'Full sun to partial afternoon shade',
          wateringGuidance: 'Water when top 2 inches feel dry',
          fertilizerGuidance: 'Low-nitrogen cactus fertilizer during active growth',
          temperatureMin: 18,
          temperatureMax: 35,
          humidityMin: 40,
          humidityMax: 70,
          moistureMin: 30,
          moistureMax: 50,
          harvestDaysMin: 180,
          harvestDaysMax: 300,
          cultivationNotes: 'Sturdy trellis support required for mature stems.',
          safetyNotes: 'Sharp thorns on mature stems.',
          confidence: 'high',
          sources: [
            {
              title: evidence[0]!.title,
              url: evidence[0]!.url,
              publisher: evidence[0]!.publisher ?? null,
              relevantFinding: 'Cultivation temperatures 18-35°C and well-draining soil.',
              retrievedAt: evidence[0]!.retrievedAt,
            },
            {
              title: evidence[1]!.title,
              url: evidence[1]!.url,
              publisher: evidence[1]!.publisher ?? null,
              relevantFinding: 'Bright sunlight and light watering.',
              retrievedAt: evidence[1]!.retrievedAt,
            },
          ],
        };
      },
    });

    process.env.GROQ_API_KEY = 'gsk_integration_test_key';

    // Execute research POST
    const researchReq = makeAuthRequest('http://localhost:3000/api/plants/research', userA, {
      method: 'POST',
      body: { plantName: 'Dragon Fruit' },
    });

    const researchRes = await researchPostHandler(researchReq);
    assert.equal(researchRes.status, 200);
    assert.equal(searchExecuted, true, 'Search adapter must be executed on catalog miss');
    assert.equal(groqExecuted, true, 'Groq adapter must be executed with retrieved evidence');

    // Step 8: Draft returned for review with source metadata and confidence
    const researchBody = (await researchRes.json()) as {
      researchRecord: {
        id: string;
        plantName: string;
        scientificName: string;
        confidence: string;
        temperatureMin: number;
        temperatureMax: number;
        sources: Array<{ title: string; url: string; publisher: string }>;
      };
    };

    assert.ok(researchBody.researchRecord.id, 'Draft research record must have an ID');
    assert.equal(researchBody.researchRecord.confidence, 'high');
    assert.equal(researchBody.researchRecord.sources.length, 2);
    assert.equal(researchBody.researchRecord.sources[0]?.url, 'https://extension.example.edu/pitaya');

    // Step 9: Confirm that research ALONE does NOT automatically save a plant into `plants` table
    const plantCountBefore = await db.query<{ count: string }>(
      `SELECT count(*) FROM plants WHERE user_id = $1;`,
      [userA.userId],
    );
    assert.equal(Number(plantCountBefore.rows[0]?.count), 0, 'Research must NOT create plant record automatically');

    // Step 10: Explicitly save the reviewed profile with user modifications
    const reviewedProfile: Partial<PlantResearchProfile> = {
      scientificName: 'Hylocereus undatus (Reviewed)',
      difficulty: 'easy',
      cultivationNotes: 'Trellis installed. Reviewed and approved by gardener.',
      temperatureMin: 19,
      temperatureMax: 36,
    };

    const saveReq = makeAuthRequest('http://localhost:3000/api/plants', userA, {
      method: 'POST',
      body: {
        gardenId: gardenAId,
        customName: 'Dragon Fruit Pot #1',
        researchRecordId: researchBody.researchRecord.id,
        reviewedProfile,
      },
    });

    const saveRes = await plantCreateHandler(saveReq);
    assert.equal(saveRes.status, 201);

    const saveBody = (await saveRes.json()) as {
      plant: {
        id: string;
        customName: string;
        catalogId: string | null;
        researchProfile?: {
          id: string;
          scientificName: string;
          difficulty: string;
          temperatureMin: number;
          temperatureMax: number;
          cultivationNotes: string;
          sources: Array<{ url: string }>;
        };
      };
    };

    assert.ok(saveBody.plant.id);
    assert.equal(saveBody.plant.customName, 'Dragon Fruit Pot #1');
    assert.equal(saveBody.plant.catalogId, null, 'Custom plant must not reference plant_catalog');
    assert.ok(saveBody.plant.researchProfile, 'Plant must have attached researchProfile');
    assert.equal(saveBody.plant.researchProfile.scientificName, 'Hylocereus undatus (Reviewed)');
    assert.equal(saveBody.plant.researchProfile.difficulty, 'easy');
    assert.equal(saveBody.plant.researchProfile.temperatureMin, 19);
    assert.equal(saveBody.plant.researchProfile.temperatureMax, 36);

    // Step 11: Read the saved plant back and verify ownership and persisted fields
    const getPlantReq = makeAuthRequest(`http://localhost:3000/api/plants/${saveBody.plant.id}`, userA);
    const getPlantRes = await plantDetailHandler(getPlantReq, {
      params: Promise.resolve({ id: saveBody.plant.id }),
    });
    assert.equal(getPlantRes.status, 200);

    const getPlantBody = (await getPlantRes.json()) as {
      plant: {
        id: string;
        userId: string;
        customName: string;
        researchProfile?: {
          plantId: string;
          scientificName: string;
          cultivationNotes: string;
          sources: Array<{ url: string }>;
        };
      };
    };

    assert.equal(getPlantBody.plant.userId, userA.userId);
    assert.equal(getPlantBody.plant.researchProfile?.scientificName, 'Hylocereus undatus (Reviewed)');
    assert.equal(getPlantBody.plant.researchProfile?.sources[0]?.url, 'https://extension.example.edu/pitaya');

    // Invariant: Custom plant is NOT published to the shared catalog
    const catalogCheck = await db.query(
      `SELECT * FROM plant_catalog WHERE lower(common_name) LIKE '%dragon%';`,
    );
    assert.equal(catalogCheck.rows.length, 0, 'Custom plant must never be published to plant_catalog');
  });

  it('4. Security: Unauthenticated requests are rejected with 401 unauthenticated', async () => {
    // POST /api/plants/research without session cookie
    const unauthPost = makeAuthRequest('http://localhost:3000/api/plants/research', null, {
      method: 'POST',
      body: { plantName: 'Dragon Fruit' },
    });
    const postRes = await researchPostHandler(unauthPost);
    assert.equal(postRes.status, 401);
    const postBody = (await postRes.json()) as { error: { code: string } };
    assert.equal(postBody.error.code, 'unauthenticated');

    // GET /api/plants/research/[id] without session cookie
    const unauthGet = makeAuthRequest('http://localhost:3000/api/plants/research/00000000-0000-0000-0000-000000000001', null);
    const getRes = await researchGetHandler(unauthGet, {
      params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000001' }),
    });
    assert.equal(getRes.status, 401);
  });

  it('5. Security: CSRF and Origin violations are rejected with 403', async () => {
    // Disallowed origin
    const badOriginReq = makeAuthRequest('http://localhost:3000/api/plants/research', userA, {
      method: 'POST',
      body: { plantName: 'Dragon Fruit' },
      origin: 'https://evil-attacker.example.com',
    });
    const badOriginRes = await researchPostHandler(badOriginReq);
    assert.equal(badOriginRes.status, 403);
    const originBody = (await badOriginRes.json()) as { error: { code: string } };
    assert.equal(originBody.error.code, 'forbidden_origin');

    // Missing CSRF token
    const noCsrfReq = makeAuthRequest('http://localhost:3000/api/plants/research', userA, {
      method: 'POST',
      body: { plantName: 'Dragon Fruit' },
      csrfToken: null,
    });
    const noCsrfRes = await researchPostHandler(noCsrfReq);
    assert.equal(noCsrfRes.status, 403);
    const csrfBody = (await noCsrfRes.json()) as { error: { code: string } };
    assert.equal(csrfBody.error.code, 'csrf_detected');
  });

  it('6. Security: Input validation rejects empty, whitespace, and excessively long plant names', async () => {
    // Empty / whitespace
    const emptyReq = makeAuthRequest('http://localhost:3000/api/plants/research', userA, {
      method: 'POST',
      body: { plantName: '    ' },
    });
    const emptyRes = await researchPostHandler(emptyReq);
    assert.equal(emptyRes.status, 422);

    // Excessively long plant name (>120 chars)
    const longName = 'A'.repeat(121);
    const longReq = makeAuthRequest('http://localhost:3000/api/plants/research', userA, {
      method: 'POST',
      body: { plantName: longName },
    });
    const longRes = await researchPostHandler(longReq);
    assert.equal(longRes.status, 422);

    // Malformed non-JSON
    const malformedReq = new NextRequest('http://localhost:3000/api/plants/research', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: '{ not valid json',
    });
    const malformedRes = await researchPostHandler(malformedReq);
    assert.equal(malformedRes.status, 400);
  });

  it('7. Security: Endpoint rate limiting blocks rapid repeated research requests', async () => {
    process.env.GROQ_API_KEY = 'gsk_test';
    setSearchAdapterOverride({
      name: 'mock',
      async search() {
        return [];
      },
    });
    setGroqClientOverride({
      async synthesizePlantProfile(name: string) {
        return {
          plantName: name,
          scientificName: null,
          category: 'Other',
          difficulty: null,
          growingMedium: null,
          lightGuidance: null,
          wateringGuidance: null,
          fertilizerGuidance: null,
          temperatureMin: null,
          temperatureMax: null,
          humidityMin: null,
          humidityMax: null,
          moistureMin: null,
          moistureMax: null,
          harvestDaysMin: null,
          harvestDaysMax: null,
          cultivationNotes: null,
          safetyNotes: null,
          confidence: 'insufficient',
          sources: [],
        };
      },
    });

    // Make 10 permitted requests
    for (let i = 0; i < 10; i++) {
      const req = makeAuthRequest('http://localhost:3000/api/plants/research', userA, {
        method: 'POST',
        body: { plantName: `Rare Orchid ${i}` },
      });
      const res = await researchPostHandler(req);
      assert.equal(res.status, 200, `Request ${i + 1} should be permitted`);
    }

    // 11th request must be rate-limited
    const blockedReq = makeAuthRequest('http://localhost:3000/api/plants/research', userA, {
      method: 'POST',
      body: { plantName: 'Rare Orchid 11' },
    });
    const blockedRes = await researchPostHandler(blockedReq);
    assert.equal(blockedRes.status, 429);
    const body = (await blockedRes.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'rate_limit_exceeded');
    assert.match(body.error.message, /Too many plant research requests/);
  });

  it('8. Security: Cross-user isolation prevents accessing or modifying other users research and custom plants', async () => {
    // 1. User A creates research record and custom plant
    process.env.GROQ_API_KEY = 'gsk_test';
    setSearchAdapterOverride({
      name: 'mock',
      async search() {
        return [{ title: 'Ghost Pepper', url: 'https://example.com/pepper', snippet: 'Spicy', retrievedAt: new Date().toISOString() }];
      },
    });
    setGroqClientOverride({
      async synthesizePlantProfile() {
        return {
          plantName: 'Ghost Pepper',
          scientificName: 'Capsicum chinense',
          category: 'Vegetables',
          difficulty: 'advanced',
          growingMedium: 'Rich loamy soil',
          lightGuidance: 'Full sun',
          wateringGuidance: 'Moderate',
          fertilizerGuidance: null,
          temperatureMin: 24,
          temperatureMax: 35,
          humidityMin: 50,
          humidityMax: 80,
          moistureMin: 40,
          moistureMax: 60,
          harvestDaysMin: 120,
          harvestDaysMax: 160,
          cultivationNotes: 'Handle with gloves.',
          safetyNotes: 'Extremely hot.',
          confidence: 'high',
          sources: [{ title: 'Ghost Pepper', url: 'https://example.com/pepper', publisher: null, relevantFinding: null, retrievedAt: new Date().toISOString() }],
        };
      },
    });

    const resA = await researchPostHandler(
      makeAuthRequest('http://localhost:3000/api/plants/research', userA, {
        method: 'POST',
        body: { plantName: 'Ghost Pepper' },
      }),
    );
    const { researchRecord: recordA } = (await resA.json()) as { researchRecord: { id: string } };

    const plantResA = await plantCreateHandler(
      makeAuthRequest('http://localhost:3000/api/plants', userA, {
        method: 'POST',
        body: {
          gardenId: gardenAId,
          customName: 'Ghost Pepper Plant',
          researchRecordId: recordA.id,
        },
      }),
    );
    const { plant: plantA } = (await plantResA.json()) as { plant: { id: string } };

    // 2. User B CANNOT read User A's research record
    const userBResearchReq = makeAuthRequest(`http://localhost:3000/api/plants/research/${recordA.id}`, userB);
    const userBResearchRes = await researchGetHandler(userBResearchReq, {
      params: Promise.resolve({ id: recordA.id }),
    });
    assert.equal(userBResearchRes.status, 404, 'User B must not see User A research record');

    // 3. User B CANNOT read User A's plant
    const userBPlantReq = makeAuthRequest(`http://localhost:3000/api/plants/${plantA.id}`, userB);
    const userBPlantRes = await plantDetailHandler(userBPlantReq, {
      params: Promise.resolve({ id: plantA.id }),
    });
    assert.equal(userBPlantRes.status, 403, 'User B must be forbidden from viewing User A plant');

    // 4. User B CANNOT update User A's plant
    const userBPatchReq = makeAuthRequest(`http://localhost:3000/api/plants/${plantA.id}`, userB, {
      method: 'PATCH',
      body: { customName: 'Hijacked Plant' },
    });
    const userBPatchRes = await plantPatchHandler(userBPatchReq, {
      params: Promise.resolve({ id: plantA.id }),
    });
    assert.equal(userBPatchRes.status, 403, 'User B must be forbidden from updating User A plant');

    // 5. User B CANNOT link User A's research record to User B's new plant
    const userBLinkReq = makeAuthRequest('http://localhost:3000/api/plants', userB, {
      method: 'POST',
      body: {
        gardenId: gardenBId,
        customName: 'Attempted Link',
        researchRecordId: recordA.id,
      },
    });
    const userBLinkRes = await plantCreateHandler(userBLinkReq);
    assert.equal(userBLinkRes.status, 201);
    const userBLinkBody = (await userBLinkRes.json()) as { plant: { researchProfile?: unknown } };
    assert.equal(
      userBLinkBody.plant.researchProfile,
      undefined,
      'Research profile must not link across user boundary',
    );
  });

  it('9. Duplicate plant prevention: rejects duplicate plant names within the same garden', async () => {
    // Add first custom plant
    const firstRes = await plantCreateHandler(
      makeAuthRequest('http://localhost:3000/api/plants', userA, {
        method: 'POST',
        body: {
          gardenId: gardenAId,
          customName: 'Dragon Fruit',
        },
      }),
    );
    assert.equal(firstRes.status, 201);

    // Attempt to add duplicate plant with same name (case-insensitive with whitespace)
    const dupRes = await plantCreateHandler(
      makeAuthRequest('http://localhost:3000/api/plants', userA, {
        method: 'POST',
        body: {
          gardenId: gardenAId,
          customName: '  dragon fruit  ',
        },
      }),
    );
    assert.equal(dupRes.status, 409, 'Duplicate plant should be rejected with 409 conflict');

    const body = (await dupRes.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'duplicate_plant');
    assert.match(body.error.message, /already growing in this garden/);
  });

  it('10. Provider resilience: search provider rate limits and errors are safely caught', async () => {
    process.env.GROQ_API_KEY = 'gsk_test';

    // 429 rate limit
    setSearchAdapterOverride({
      name: 'mock-failing',
      async search() {
        throw new Error('Search provider rate limit reached. Please try again in a few minutes.');
      },
    });

    const rateRes = await researchPostHandler(
      makeAuthRequest('http://localhost:3000/api/plants/research', userA, {
        method: 'POST',
        body: { plantName: 'Rare Herb' },
      }),
    );
    assert.equal(rateRes.status, 429);
    const rateBody = (await rateRes.json()) as { error: { code: string } };
    assert.equal(rateBody.error.code, 'rate_limit_exceeded');

    // 502 upstream error
    setSearchAdapterOverride({
      name: 'mock-error',
      async search() {
        throw new Error('Upstream connection reset');
      },
    });

    const errRes = await researchPostHandler(
      makeAuthRequest('http://localhost:3000/api/plants/research', userA, {
        method: 'POST',
        body: { plantName: 'Rare Herb' },
      }),
    );
    assert.equal(errRes.status, 502);
    const errBody = (await errRes.json()) as { error: { code: string } };
    assert.equal(errBody.error.code, 'provider_error');
  });

  it('11. Groq client normalization: normalizes case, maps medium to moderate, and filters hallucinated sources', async () => {
    const client = new RealGroqResearchClient('gsk_dummy', 'openai/gpt-oss-120b');

    // 1. Evidence with 1 verified source
    const evidence: SearchEvidenceItem[] = [
      {
        title: 'Rosemary Cultivation Guide',
        url: 'https://extension.example.edu/rosemary',
        publisher: 'Extension',
        snippet: 'Grows best in full sun at 20-30°C.',
        retrievedAt: '2026-10-24T12:00:00.000Z',
      },
    ];

    // Mock completion on Groq client internal instance
    (client as unknown as { groq: { chat: { completions: { create: () => Promise<unknown> } } } }).groq = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    plantName: 'Rosemary',
                    scientificName: 'Salvia rosmarinus',
                    category: 'Herbs',
                    difficulty: 'MEDIUM', // uppercase & "medium"
                    temperatureMin: '20', // string number
                    temperatureMax: '30',
                    humidityMin: '40',
                    humidityMax: '60',
                    confidence: 'HIGH', // uppercase
                    sources: [
                      {
                        title: 'Rosemary Guide',
                        url: 'https://extension.example.edu/rosemary',
                        publisher: 'Extension',
                        relevantFinding: '20-30°C',
                        retrievedAt: '2026-10-24T12:00:00.000Z',
                      },
                      {
                        title: 'Fake Hallucinated Source',
                        url: 'https://hallucinated-source.example.com/fake',
                        publisher: 'Fake',
                        relevantFinding: 'Made up',
                        retrievedAt: '2026-10-24T12:00:00.000Z',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        },
      },
    };

    const profile = await client.synthesizePlantProfile('Rosemary', evidence);

    assert.equal(profile.difficulty, 'moderate', 'MEDIUM should normalize to moderate');
    assert.equal(profile.temperatureMin, 20, 'String temperatureMin should coerce to number');
    assert.equal(profile.temperatureMax, 30);
    assert.equal(profile.confidence, 'high', 'HIGH should normalize to high');
    assert.equal(profile.sources.length, 1, 'Hallucinated source URL must be stripped');
    assert.equal(profile.sources[0]?.url, 'https://extension.example.edu/rosemary');
  });

  it('12. Groq empty evidence fallback: returns insufficient confidence without hallucinations', async () => {
    const client = new RealGroqResearchClient('gsk_dummy', 'openai/gpt-oss-120b');
    const profile = await client.synthesizePlantProfile('Unknown Alien Plant', []);

    assert.equal(profile.plantName, 'Unknown Alien Plant');
    assert.equal(profile.confidence, 'insufficient');
    assert.equal(profile.temperatureMin, null);
    assert.equal(profile.temperatureMax, null);
    assert.equal(profile.sources.length, 0);
  });

  it('13. findPlantsByUserId / GET /api/plants: batch-loads and attaches reviewed researchProfile to custom plants without N+1 queries', async () => {
    process.env.GROQ_API_KEY = 'gsk_test';
    setSearchAdapterOverride({
      name: 'mock',
      async search() {
        return [{ title: 'Lemongrass Guide', url: 'https://example.com/lemongrass', snippet: 'Warm weather grass', retrievedAt: new Date().toISOString() }];
      },
    });
    setGroqClientOverride({
      async synthesizePlantProfile() {
        return {
          plantName: 'Lemongrass',
          scientificName: 'Cymbopogon citratus',
          category: 'Herbs',
          difficulty: 'easy',
          growingMedium: 'Sandy loam',
          lightGuidance: 'Full sun',
          wateringGuidance: 'Keep moist',
          fertilizerGuidance: 'Balanced liquid feed monthly',
          temperatureMin: 18,
          temperatureMax: 30,
          humidityMin: 50,
          humidityMax: 70,
          moistureMin: 40,
          moistureMax: 60,
          harvestDaysMin: 75,
          harvestDaysMax: 100,
          cultivationNotes: 'Divide stalks in spring.',
          safetyNotes: null,
          confidence: 'high',
          sources: [{ title: 'Lemongrass Guide', url: 'https://example.com/lemongrass', publisher: 'Herbal Extension', relevantFinding: '18-30°C', retrievedAt: new Date().toISOString() }],
        };
      },
    });

    const researchRes = await researchPostHandler(
      makeAuthRequest('http://localhost:3000/api/plants/research', userA, {
        method: 'POST',
        body: { plantName: 'Lemongrass' },
      }),
    );
    const { researchRecord } = (await researchRes.json()) as { researchRecord: { id: string } };

    await plantCreateHandler(
      makeAuthRequest('http://localhost:3000/api/plants', userA, {
        method: 'POST',
        body: {
          gardenId: gardenAId,
          customName: 'My Thai Lemongrass',
          researchRecordId: researchRecord.id,
        },
      }),
    );

    const listReq = makeAuthRequest('http://localhost:3000/api/plants', userA);
    const listRes = await plantsListHandler(listReq);
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as {
      plants: {
        customName: string;
        researchProfile?: {
          temperatureMin: number;
          temperatureMax: number;
          confidence: string;
        };
      }[];
    };

    const lemongrass = listBody.plants.find((p) => p.customName === 'My Thai Lemongrass');
    assert.ok(lemongrass, 'Created plant should be returned in user plants list');
    assert.ok(lemongrass.researchProfile, 'Research profile must be attached in plants list');
    assert.equal(lemongrass.researchProfile.temperatureMin, 18);
    assert.equal(lemongrass.researchProfile.temperatureMax, 30);
    assert.equal(lemongrass.researchProfile.confidence, 'high');

    // Strict user isolation: User B must not see User A's plant or research profile in their list
    const listBReq = makeAuthRequest('http://localhost:3000/api/plants', userB);
    const listBRes = await plantsListHandler(listBReq);
    assert.equal(listBRes.status, 200);
    const listBBody = (await listBRes.json()) as { plants: { customName: string }[] };
    assert.equal(
      listBBody.plants.some((p) => p.customName === 'My Thai Lemongrass'),
      false,
      'User B must not see User A plants in list',
    );
  });
});
