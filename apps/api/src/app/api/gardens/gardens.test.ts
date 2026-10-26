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
import { GET as gardensListHandler, POST as gardensCreateHandler } from './route';
import {
  DELETE as gardenDeleteHandler,
  GET as gardenDetailHandler,
  PATCH as gardenUpdateHandler,
} from './[id]/route';

// Ensure test rate-limit secret is configured
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

describe('Phase 5.0: Garden Management CRUD End-to-End Suite', () => {
  let db: PGlite;
  let userA: TestUserSession;
  let userB: TestUserSession;

  beforeEach(async () => {
    db = await createIsolatedTestDb();
    setAuthDbOverride(db as unknown as Queryable);
    userA = await setupTestUser(db, 'user.a@growspace.test', 'User A');
    userB = await setupTestUser(db, 'user.b@growspace.test', 'User B');
  });

  afterEach(async () => {
    setAuthDbOverride(null);
    await db.close();
  });

  // ==========================================================================
  // PART 1: UNAUTHENTICATED & MALFORMED REQUESTS
  // ==========================================================================

  it('1. Unauthenticated requests are rejected with 401 across all endpoints', async () => {
    const listReq = new NextRequest('http://localhost:3001/api/gardens');
    const listRes = await gardensListHandler(listReq);
    assert.equal(listRes.status, 401);

    const postReq = new NextRequest('http://localhost:3001/api/gardens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Balcony' }),
    });
    const postRes = await gardensCreateHandler(postReq);
    assert.equal(postRes.status, 401);

    const validId = '00000000-0000-0000-0000-000000000001';
    const getReq = new NextRequest(`http://localhost:3001/api/gardens/${validId}`);
    const getRes = await gardenDetailHandler(getReq, {
      params: Promise.resolve({ id: validId }),
    });
    assert.equal(getRes.status, 401);

    const patchReq = new NextRequest(`http://localhost:3001/api/gardens/${validId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    });
    const patchRes = await gardenUpdateHandler(patchReq, {
      params: Promise.resolve({ id: validId }),
    });
    assert.equal(patchRes.status, 401);

    const delReq = new NextRequest(`http://localhost:3001/api/gardens/${validId}`, {
      method: 'DELETE',
    });
    const delRes = await gardenDeleteHandler(delReq, {
      params: Promise.resolve({ id: validId }),
    });
    assert.equal(delRes.status, 401);
  });

  it('2. Bearer tokens are rejected with 401 retirement notice', async () => {
    const req = new NextRequest('http://localhost:3001/api/gardens', {
      headers: { authorization: 'Bearer some-legacy-token' },
    });
    const res = await gardensListHandler(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'unauthenticated');
    assert.match(body.error.message, /Bearer token authentication has been retired/i);
  });

  it('3. Mutating requests reject missing or invalid CSRF tokens', async () => {
    const reqMissingCsrf = new NextRequest('http://localhost:3001/api/gardens', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Herb Garden' }),
    });
    const res = await gardensCreateHandler(reqMissingCsrf);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'csrf_detected');
  });

  it('4. Rejects malformed UUID identifiers with 400 invalid_parameter', async () => {
    const malformedId = 'not-a-valid-uuid';

    const getReq = new NextRequest(`http://localhost:3001/api/gardens/${malformedId}`, {
      headers: { cookie: `gs_session=${userA.sessionToken}` },
    });
    const getRes = await gardenDetailHandler(getReq, {
      params: Promise.resolve({ id: malformedId }),
    });
    assert.equal(getRes.status, 400);
    const getBody = await getRes.json();
    assert.equal(getBody.error.code, 'invalid_parameter');

    const patchReq = new NextRequest(`http://localhost:3001/api/gardens/${malformedId}`, {
      method: 'PATCH',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Updated' }),
    });
    const patchRes = await gardenUpdateHandler(patchReq, {
      params: Promise.resolve({ id: malformedId }),
    });
    assert.equal(patchRes.status, 400);

    const delReq = new NextRequest(`http://localhost:3001/api/gardens/${malformedId}`, {
      method: 'DELETE',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
      },
    });
    const delRes = await gardenDeleteHandler(delReq, {
      params: Promise.resolve({ id: malformedId }),
    });
    assert.equal(delRes.status, 400);
  });

  // ==========================================================================
  // PART 2: VALIDATION & PAYLOAD RULES
  // ==========================================================================

  it('5. Rejects creation with empty name or invalid growing method with 422 validation_error', async () => {
    // Missing / empty name
    const reqEmptyName = new NextRequest('http://localhost:3001/api/gardens', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: '   ', growingMethod: 'soil' }),
    });
    const resEmptyName = await gardensCreateHandler(reqEmptyName);
    assert.equal(resEmptyName.status, 422);
    const bodyEmpty = await resEmptyName.json();
    assert.equal(bodyEmpty.error.code, 'validation_error');
    assert.ok(bodyEmpty.error.fieldErrors.name);

    // Invalid growing method
    const reqInvalidMethod = new NextRequest('http://localhost:3001/api/gardens', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Garden 1', growingMethod: 'unsupported_method' }),
    });
    const resInvalidMethod = await gardensCreateHandler(reqInvalidMethod);
    assert.equal(resInvalidMethod.status, 422);
    const bodyMethod = await resInvalidMethod.json();
    assert.equal(bodyMethod.error.code, 'validation_error');
  });

  // ==========================================================================
  // PART 3: SUCCESSFUL GARDEN LIFECYCLE (CREATE, LIST, GET, PATCH, DELETE)
  // ==========================================================================

  it('6. Full CRUD lifecycle: creates, lists, retrieves, updates, and deletes an empty garden', async () => {
    // A. Create Garden
    const createReq = new NextRequest('http://localhost:3001/api/gardens', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Sunny Patio',
        description: 'South-facing outdoor containers',
        locationLabel: 'Patio Deck',
        growingMethod: 'container',
      }),
    });

    const createRes = await gardensCreateHandler(createReq);
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    const garden = createBody.garden;

    assert.ok(garden.id);
    assert.equal(garden.userId, userA.userId);
    assert.equal(garden.name, 'Sunny Patio');
    assert.equal(garden.description, 'South-facing outdoor containers');
    assert.equal(garden.locationLabel, 'Patio Deck');
    assert.equal(garden.growingMethod, 'container');
    assert.ok(garden.createdAt);
    assert.ok(garden.updatedAt);

    // B. List Gardens
    const listReq = new NextRequest('http://localhost:3001/api/gardens', {
      headers: { cookie: `gs_session=${userA.sessionToken}` },
    });
    const listRes = await gardensListHandler(listReq);
    assert.equal(listRes.status, 200);
    assert.equal(listRes.headers.get('Cache-Control'), 'no-store');
    const listBody = await listRes.json();
    assert.equal(listBody.gardens.length, 1);
    assert.equal(listBody.gardens[0].id, garden.id);
    assert.equal(listBody.gardens[0].plantCount, 0);

    // C. Get Garden By ID
    const getReq = new NextRequest(`http://localhost:3001/api/gardens/${garden.id}`, {
      headers: { cookie: `gs_session=${userA.sessionToken}` },
    });
    const getRes = await gardenDetailHandler(getReq, {
      params: Promise.resolve({ id: garden.id }),
    });
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.garden.id, garden.id);
    assert.equal(getBody.garden.name, 'Sunny Patio');

    // D. Update Garden (PATCH)
    const patchReq = new NextRequest(`http://localhost:3001/api/gardens/${garden.id}`, {
      method: 'PATCH',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Sunny Patio Renovated',
        growingMethod: 'raised_bed',
      }),
    });
    const patchRes = await gardenUpdateHandler(patchReq, {
      params: Promise.resolve({ id: garden.id }),
    });
    assert.equal(patchRes.status, 200);
    const patchBody = await patchRes.json();
    assert.equal(patchBody.garden.name, 'Sunny Patio Renovated');
    assert.equal(patchBody.garden.growingMethod, 'raised_bed');
    assert.equal(patchBody.garden.description, 'South-facing outdoor containers'); // Preserved

    // E. Delete Empty Garden
    const delReq = new NextRequest(`http://localhost:3001/api/gardens/${garden.id}`, {
      method: 'DELETE',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
      },
    });
    const delRes = await gardenDeleteHandler(delReq, {
      params: Promise.resolve({ id: garden.id }),
    });
    assert.equal(delRes.status, 204);

    // Verify gone from list
    const verifyList = await gardensListHandler(listReq);
    const verifyBody = await verifyList.json();
    assert.equal(verifyBody.gardens.length, 0);

    // Verify 404 on subsequent get
    const verifyGet = await gardenDetailHandler(getReq, {
      params: Promise.resolve({ id: garden.id }),
    });
    assert.equal(verifyGet.status, 404);
  });

  // ==========================================================================
  // PART 4: CROSS-USER DATA ISOLATION & FORBIDDEN ACCESS
  // ==========================================================================

  it('7. Cross-user isolation: User B cannot view, modify, or delete User A gardens', async () => {
    // User A creates a garden
    const createReq = new NextRequest('http://localhost:3001/api/gardens', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: "User A's Secret Greenhouse" }),
    });
    const createRes = await gardensCreateHandler(createReq);
    const gardenA = (await createRes.json()).garden;

    // User B lists gardens -> must NOT see User A's garden
    const listB = new NextRequest('http://localhost:3001/api/gardens', {
      headers: { cookie: `gs_session=${userB.sessionToken}` },
    });
    const listResB = await gardensListHandler(listB);
    const listBodyB = await listResB.json();
    assert.equal(listBodyB.gardens.length, 0);

    // User B attempts GET User A's garden -> 403 Forbidden
    const getB = new NextRequest(`http://localhost:3001/api/gardens/${gardenA.id}`, {
      headers: { cookie: `gs_session=${userB.sessionToken}` },
    });
    const getResB = await gardenDetailHandler(getB, {
      params: Promise.resolve({ id: gardenA.id }),
    });
    assert.equal(getResB.status, 403);
    const getBodyB = await getResB.json();
    assert.equal(getBodyB.error.code, 'forbidden');

    // User B attempts PATCH User A's garden -> 403 Forbidden
    const patchB = new NextRequest(`http://localhost:3001/api/gardens/${gardenA.id}`, {
      method: 'PATCH',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userB.sessionToken}; gs_csrf=${userB.csrfToken}`,
        'x-csrf-token': userB.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Hacked by User B' }),
    });
    const patchResB = await gardenUpdateHandler(patchB, {
      params: Promise.resolve({ id: gardenA.id }),
    });
    assert.equal(patchResB.status, 403);

    // User B attempts DELETE User A's garden -> 403 Forbidden
    const delB = new NextRequest(`http://localhost:3001/api/gardens/${gardenA.id}`, {
      method: 'DELETE',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userB.sessionToken}; gs_csrf=${userB.csrfToken}`,
        'x-csrf-token': userB.csrfToken,
      },
    });
    const delResB = await gardenDeleteHandler(delB, {
      params: Promise.resolve({ id: gardenA.id }),
    });
    assert.equal(delResB.status, 403);
  });

  // ==========================================================================
  // PART 5: SAFE DELETION POLICY WITH PLANTS
  // ==========================================================================

  it('8. Safe deletion policy: rejects non-empty garden deletion with 409 unless cascade=true is specified', async () => {
    // 1. Create garden for User A
    const createReq = new NextRequest('http://localhost:3001/api/gardens', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Tomato Patch' }),
    });
    const createRes = await gardensCreateHandler(createReq);
    const garden = (await createRes.json()).garden;

    // 2. Insert a child plant directly into PostgreSQL for this garden
    await db.query(
      `INSERT INTO plants (user_id, garden_id, custom_name, growth_stage, status)
       VALUES ($1, $2, 'Roma Tomato #1', 'vegetative', 'active');`,
      [userA.userId, garden.id],
    );

    // Verify plantCount is now 1 in GET
    const getReq = new NextRequest(`http://localhost:3001/api/gardens/${garden.id}`, {
      headers: { cookie: `gs_session=${userA.sessionToken}` },
    });
    const getRes = await gardenDetailHandler(getReq, {
      params: Promise.resolve({ id: garden.id }),
    });
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.garden.plantCount, 1);

    // 3. Attempt DELETE without cascade -> must reject with 409 Conflict
    const delReqWithoutCascade = new NextRequest(`http://localhost:3001/api/gardens/${garden.id}`, {
      method: 'DELETE',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
      },
    });
    const delResFail = await gardenDeleteHandler(delReqWithoutCascade, {
      params: Promise.resolve({ id: garden.id }),
    });
    assert.equal(delResFail.status, 409);
    const failBody = await delResFail.json();
    assert.equal(failBody.error.code, 'garden_not_empty');
    assert.match(failBody.error.message, /contains 1 plant/i);

    // Verify garden and plant still exist
    const plantCheck = await db.query(`SELECT count(*)::int AS count FROM plants WHERE garden_id = $1`, [garden.id]);
    assert.equal((plantCheck.rows[0] as { count: number }).count, 1);

    // 4. Attempt DELETE WITH cascade=true -> succeeds with 204 No Content
    const delReqWithCascade = new NextRequest(`http://localhost:3001/api/gardens/${garden.id}?cascade=true`, {
      method: 'DELETE',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${userA.sessionToken}; gs_csrf=${userA.csrfToken}`,
        'x-csrf-token': userA.csrfToken,
      },
    });
    const delResSuccess = await gardenDeleteHandler(delReqWithCascade, {
      params: Promise.resolve({ id: garden.id }),
    });
    assert.equal(delResSuccess.status, 204);

    // Verify garden is gone and child plant was cascade-deleted by PostgreSQL
    const gardenCheck = await db.query(`SELECT count(*)::int AS count FROM gardens WHERE id = $1`, [garden.id]);
    assert.equal((gardenCheck.rows[0] as { count: number }).count, 0);

    const plantCascadeCheck = await db.query(`SELECT count(*)::int AS count FROM plants WHERE garden_id = $1`, [garden.id]);
    assert.equal((plantCascadeCheck.rows[0] as { count: number }).count, 0);
  });
});
