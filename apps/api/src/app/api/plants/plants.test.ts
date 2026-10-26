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
import { GET as plantsListHandler, POST as plantsCreateHandler } from './route';
import {
  DELETE as plantDeleteHandler,
  GET as plantDetailHandler,
  PATCH as plantUpdateHandler,
} from './[id]/route';
import { DELETE as gardenDeleteHandler } from '../gardens/[id]/route';

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

describe('Phase 5.1: Plant Management & Add to My Garden Suite', () => {
  let db: PGlite;
  let userA: TestUserSession;
  let userB: TestUserSession;
  let gardenAId: string;
  let gardenBId: string;

  beforeEach(async () => {
    db = await createIsolatedTestDb();
    setAuthDbOverride(db as unknown as Queryable);
    userA = await setupTestUser(db, 'user.a@growspace.test', 'User A');
    userB = await setupTestUser(db, 'user.b@growspace.test', 'User B');

    // Create garden for User A
    const gA = await createGarden(db as unknown as Queryable, userA.userId, {
      name: 'User A Herb Garden',
      growingMethod: 'container',
    });
    gardenAId = gA.id;

    // Create garden for User B
    const gB = await createGarden(db as unknown as Queryable, userB.userId, {
      name: 'User B Hydro Tower',
      growingMethod: 'hydroponic',
    });
    gardenBId = gB.id;
  });

  afterEach(async () => {
    setAuthDbOverride(null);
    await db.close();
  });

  // ==========================================================================
  // PART 1: UNAUTHENTICATED & MALFORMED REQUESTS
  // ==========================================================================

  it('1. Rejects unauthenticated requests with 401 across all endpoints', async () => {
    const listReq = new NextRequest('http://localhost:3001/api/plants');
    const listRes = await plantsListHandler(listReq);
    assert.equal(listRes.status, 401);

    const postReq = new NextRequest('http://localhost:3001/api/plants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gardenId: gardenAId, customName: 'Rosemary' }),
    });
    const postRes = await plantsCreateHandler(postReq);
    assert.equal(postRes.status, 401);

    const validId = '00000000-0000-0000-0000-000000000001';
    const getReq = new NextRequest(`http://localhost:3001/api/plants/${validId}`);
    const getRes = await plantDetailHandler(getReq, {
      params: Promise.resolve({ id: validId }),
    });
    assert.equal(getRes.status, 401);

    const patchReq = new NextRequest(`http://localhost:3001/api/plants/${validId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customName: 'Updated' }),
    });
    const patchRes = await plantUpdateHandler(patchReq, {
      params: Promise.resolve({ id: validId }),
    });
    assert.equal(patchRes.status, 401);

    const delReq = new NextRequest(`http://localhost:3001/api/plants/${validId}`, {
      method: 'DELETE',
    });
    const delRes = await plantDeleteHandler(delReq, {
      params: Promise.resolve({ id: validId }),
    });
    assert.equal(delRes.status, 401);
  });

  it('2. Mutating requests reject missing or invalid CSRF tokens', async () => {
    const req = new NextRequest('http://localhost:3001/api/plants', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ gardenId: gardenAId, customName: 'Basil' }),
    });
    const res = await plantsCreateHandler(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'csrf_detected');
  });

  // ==========================================================================
  // PART 2: VALIDATION & CROSS-USER GARDEN ACCESS CONTROL
  // ==========================================================================

  it('3. Prevents User A from adding a plant to User B garden (Cross-User Access Denial)', async () => {
    const req = new NextRequest('http://localhost:3001/api/plants', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        gardenId: gardenBId, // Belongs to User B!
        catalogId: 'catalog-tomato',
      }),
    });

    const res = await plantsCreateHandler(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'forbidden');
  });

  it('4. Rejects addition if neither catalogId nor customName is provided', async () => {
    const req = new NextRequest('http://localhost:3001/api/plants', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        gardenId: gardenAId,
      }),
    });

    const res = await plantsCreateHandler(req);
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.error.code, 'validation_error');
  });

  // ==========================================================================
  // PART 3: SUCCESSFUL ADD TO MY GARDEN & FULL CRUD LIFECYCLE
  // ==========================================================================

  it('5. Successfully adds catalog plant to owned garden (Add to My Garden flow)', async () => {
    const req = new NextRequest('http://localhost:3001/api/plants', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        gardenId: gardenAId,
        catalogId: 'catalog-tomato',
        customName: 'San Marzano #1',
        plantingDate: '2026-10-23',
        growthStage: 'seedling',
        notes: 'Planted from heirloom seeds',
      }),
    });

    const res = await plantsCreateHandler(req);
    assert.equal(res.status, 201);
    const body = await res.json();
    const plant = body.plant;

    assert.ok(plant.id);
    assert.equal(plant.userId, userA.userId);
    assert.equal(plant.gardenId, gardenAId);
    assert.equal(plant.catalogId, 'catalog-tomato');
    assert.equal(plant.customName, 'San Marzano #1');
    assert.equal(plant.plantingDate, '2026-10-23');
    assert.equal(plant.growthStage, 'seedling');
    assert.equal(plant.status, 'active');
    assert.equal(plant.notes, 'Planted from heirloom seeds');
    assert.ok(plant.createdAt);
  });

  it('6. Supports adding plant using catalog slug shorthand (e.g. "tomato")', async () => {
    const req = new NextRequest('http://localhost:3001/api/plants', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        gardenId: gardenAId,
        catalogId: 'basil', // Slug shorthand
      }),
    });

    const res = await plantsCreateHandler(req);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.plant.catalogId, 'catalog-basil');
  });

  it('7. Lists plants belonging to user with optional gardenId filtering', async () => {
    // Add 2 plants to Garden A
    await plantsCreateHandler(
      new NextRequest('http://localhost:3001/api/plants', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
          'x-csrf-token': userA.csrfToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ gardenId: gardenAId, customName: 'Rosemary' }),
      }),
    );

    await plantsCreateHandler(
      new NextRequest('http://localhost:3001/api/plants', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
          'x-csrf-token': userA.csrfToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ gardenId: gardenAId, catalogId: 'catalog-tomato' }),
      }),
    );

    // List all User A plants
    const listAllReq = new NextRequest('http://localhost:3001/api/plants', {
      headers: { cookie: `gs_session=${userA.sessionToken}` },
    });
    const listAllRes = await plantsListHandler(listAllReq);
    assert.equal(listAllRes.status, 200);
    const listAllBody = await listAllRes.json();
    assert.equal(listAllBody.plants.length, 2);

    // List with gardenId filter
    const listFilteredReq = new NextRequest(`http://localhost:3001/api/plants?gardenId=${gardenAId}`, {
      headers: { cookie: `gs_session=${userA.sessionToken}` },
    });
    const listFilteredRes = await plantsListHandler(listFilteredReq);
    assert.equal(listFilteredRes.status, 200);
    const listFilteredBody = await listFilteredRes.json();
    assert.equal(listFilteredBody.plants.length, 2);

    // User B lists plants -> must be 0
    const listBReq = new NextRequest('http://localhost:3001/api/plants', {
      headers: { cookie: `gs_session=${userB.sessionToken}` },
    });
    const listBRes = await plantsListHandler(listBReq);
    assert.equal(listBRes.status, 200);
    const listBBody = await listBRes.json();
    assert.equal(listBBody.plants.length, 0);
  });

  it('8. Retrieves, updates, and deletes an owned plant', async () => {
    // 1. Create plant
    const createRes = await plantsCreateHandler(
      new NextRequest('http://localhost:3001/api/plants', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
          'x-csrf-token': userA.csrfToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          gardenId: gardenAId,
          customName: 'Bell Pepper',
          growthStage: 'seedling',
        }),
      }),
    );
    const plant = (await createRes.json()).plant;

    // 2. Retrieve plant (GET)
    const getReq = new NextRequest(`http://localhost:3001/api/plants/${plant.id}`, {
      headers: { cookie: `gs_session=${userA.sessionToken}` },
    });
    const getRes = await plantDetailHandler(getReq, {
      params: Promise.resolve({ id: plant.id }),
    });
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.plant.id, plant.id);
    assert.equal(getBody.plant.customName, 'Bell Pepper');

    // 3. Update plant (PATCH) - update growth stage and notes
    const patchReq = new NextRequest(`http://localhost:3001/api/plants/${plant.id}`, {
      method: 'PATCH',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        growthStage: 'flowering',
        notes: 'First blossoms observed today',
      }),
    });
    const patchRes = await plantUpdateHandler(patchReq, {
      params: Promise.resolve({ id: plant.id }),
    });
    assert.equal(patchRes.status, 200);
    const patchBody = await patchRes.json();
    assert.equal(patchBody.plant.growthStage, 'flowering');
    assert.equal(patchBody.plant.notes, 'First blossoms observed today');

    // 4. Delete plant (DELETE)
    const delReq = new NextRequest(`http://localhost:3001/api/plants/${plant.id}`, {
      method: 'DELETE',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
      },
    });
    const delRes = await plantDeleteHandler(delReq, {
      params: Promise.resolve({ id: plant.id }),
    });
    assert.equal(delRes.status, 204);

    // Verify plant is gone
    const verifyGet = await plantDetailHandler(getReq, {
      params: Promise.resolve({ id: plant.id }),
    });
    assert.equal(verifyGet.status, 404);
  });

  // ==========================================================================
  // PART 4: CROSS-USER PLANT ISOLATION
  // ==========================================================================

  it('9. User B cannot read, update, or delete User A plants (403 Forbidden)', async () => {
    // User A creates plant
    const createRes = await plantsCreateHandler(
      new NextRequest('http://localhost:3001/api/plants', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
          'x-csrf-token': userA.csrfToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ gardenId: gardenAId, customName: "User A's Plant" }),
      }),
    );
    const plantA = (await createRes.json()).plant;

    // User B attempts GET -> 403
    const getB = new NextRequest(`http://localhost:3001/api/plants/${plantA.id}`, {
      headers: { cookie: `gs_session=${userB.sessionToken}` },
    });
    const getResB = await plantDetailHandler(getB, {
      params: Promise.resolve({ id: plantA.id }),
    });
    assert.equal(getResB.status, 403);

    // User B attempts PATCH -> 403
    const patchB = new NextRequest(`http://localhost:3001/api/plants/${plantA.id}`, {
      method: 'PATCH',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userB.sessionToken}; gs_csrf=${userB.csrfToken}`,
        'x-csrf-token': userB.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ customName: 'Hacked plant' }),
    });
    const patchResB = await plantUpdateHandler(patchB, {
      params: Promise.resolve({ id: plantA.id }),
    });
    assert.equal(patchResB.status, 403);

    // User B attempts DELETE -> 403
    const delB = new NextRequest(`http://localhost:3001/api/plants/${plantA.id}`, {
      method: 'DELETE',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userB.sessionToken}; gs_csrf=${userB.csrfToken}`,
        'x-csrf-token': userB.csrfToken,
      },
    });
    const delResB = await plantDeleteHandler(delB, {
      params: Promise.resolve({ id: plantA.id }),
    });
    assert.equal(delResB.status, 403);
  });

  // ==========================================================================
  // PART 5: INPUT VALIDATION, CATALOG REFERENCE INTEGRITY & FK CONSTRAINTS
  // ==========================================================================

  it('10. Rejects invalid catalog references that do not exist with 422', async () => {
    const req = new NextRequest('http://localhost:3001/api/plants', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        gardenId: gardenAId,
        catalogId: 'catalog-fictional-space-plant-999',
      }),
    });

    const res = await plantsCreateHandler(req);
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.error.code, 'validation_error');
    assert.match(body.error.message, /does not exist/i);
  });

  it('11. Rejects malformed IDs, bad JSON, and invalid inputs', async () => {
    // Malformed gardenId (non-UUID)
    const malformedGardenReq = new NextRequest('http://localhost:3001/api/plants', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        gardenId: 'not-a-valid-uuid',
        customName: 'Rosemary',
      }),
    });
    const malformedGardenRes = await plantsCreateHandler(malformedGardenReq);
    assert.equal(malformedGardenRes.status, 400);

    // Malformed plant ID on GET /api/plants/:id
    const badIdGet = new NextRequest('http://localhost:3001/api/plants/not-a-uuid', {
      headers: { cookie: `gs_session=${userA.sessionToken}` },
    });
    const badIdRes = await plantDetailHandler(badIdGet, {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });
    assert.equal(badIdRes.status, 400);

    // Invalid JSON body on POST
    const badJsonReq = new NextRequest('http://localhost:3001/api/plants', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: '{ invalid json ]',
    });
    const badJsonRes = await plantsCreateHandler(badJsonReq);
    assert.equal(badJsonRes.status, 400);
  });

  it('12. Prevents moving plant to another user garden via PATCH (Cross-User)', async () => {
    // User A creates a plant in User A's garden
    const createRes = await plantsCreateHandler(
      new NextRequest('http://localhost:3001/api/plants', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
          'x-csrf-token': userA.csrfToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ gardenId: gardenAId, customName: 'Sage' }),
      }),
    );
    const plant = (await createRes.json()).plant;

    // User A attempts to PATCH and move the plant to User B's garden
    const patchReq = new NextRequest(`http://localhost:3001/api/plants/${plant.id}`, {
      method: 'PATCH',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ gardenId: gardenBId }),
    });
    const patchRes = await plantUpdateHandler(patchReq, {
      params: Promise.resolve({ id: plant.id }),
    });
    assert.equal(patchRes.status, 403);
    const body = await patchRes.json();
    assert.equal(body.error.code, 'forbidden');
  });

  it('13. Supports multiple owned gardens and garden-filtered queries', async () => {
    // User A creates a second garden
    const secondGarden = await createGarden(db as unknown as Queryable, userA.userId, {
      name: 'User A Hydroponic Tent',
      growingMethod: 'hydroponic',
    });

    // Add 1 plant to Garden 1
    await plantsCreateHandler(
      new NextRequest('http://localhost:3001/api/plants', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
          'x-csrf-token': userA.csrfToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ gardenId: gardenAId, customName: 'Herb In Soil' }),
      }),
    );

    // Add 1 plant to Second Garden
    await plantsCreateHandler(
      new NextRequest('http://localhost:3001/api/plants', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
          'x-csrf-token': userA.csrfToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ gardenId: secondGarden.id, catalogId: 'catalog-tomato' }),
      }),
    );

    // Query User A total plants
    const allPlantsRes = await plantsListHandler(
      new NextRequest('http://localhost:3001/api/plants', {
        headers: { cookie: `gs_session=${userA.sessionToken}` },
      }),
    );
    assert.equal((await allPlantsRes.json()).plants.length, 2);

    // Query filtered to Second Garden only
    const filteredRes = await plantsListHandler(
      new NextRequest(`http://localhost:3001/api/plants?gardenId=${secondGarden.id}`, {
        headers: { cookie: `gs_session=${userA.sessionToken}` },
      }),
    );
    const filteredPlants = (await filteredRes.json()).plants;
    assert.equal(filteredPlants.length, 1);
    assert.equal(filteredPlants[0]?.gardenId, secondGarden.id);
  });

  it('14. Safe deletion policy: Deleting garden with plants without ?cascade=true returns 409 garden_not_empty', async () => {
    // Add plant to Garden A
    await plantsCreateHandler(
      new NextRequest('http://localhost:3001/api/plants', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
          'x-csrf-token': userA.csrfToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ gardenId: gardenAId, customName: 'Rosemary' }),
      }),
    );

    // Attempt to delete garden without cascade
    const delReq = new NextRequest(`http://localhost:3001/api/gardens/${gardenAId}`, {
      method: 'DELETE',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
      },
    });
    const delRes = await gardenDeleteHandler(delReq, {
      params: Promise.resolve({ id: gardenAId }),
    });
    assert.equal(delRes.status, 409);
    const body = await delRes.json();
    assert.equal(body.error.code, 'garden_not_empty');
  });

  it('15. Foreign key cascade: Deleting garden with ?cascade=true cascades and removes all child plants', async () => {
    // Add plant to Garden A
    const plantRes = await plantsCreateHandler(
      new NextRequest('http://localhost:3001/api/plants', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
          'x-csrf-token': userA.csrfToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ gardenId: gardenAId, customName: 'Rosemary' }),
      }),
    );
    const plantId = (await plantRes.json()).plant.id;

    // Delete garden with cascade=true
    const delReq = new NextRequest(`http://localhost:3001/api/gardens/${gardenAId}?cascade=true`, {
      method: 'DELETE',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
      },
    });
    const delRes = await gardenDeleteHandler(delReq, {
      params: Promise.resolve({ id: gardenAId }),
    });
    assert.equal(delRes.status, 204);

    // Verify plant was cascaded
    const checkPlant = await plantDetailHandler(
      new NextRequest(`http://localhost:3001/api/plants/${plantId}`, {
        headers: { cookie: `gs_session=${userA.sessionToken}` },
      }),
      { params: Promise.resolve({ id: plantId }) },
    );
    assert.equal(checkPlant.status, 404);
  });
});
