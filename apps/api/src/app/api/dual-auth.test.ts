import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { PGlite } from '@electric-sql/pglite';
import {
  assertOwnership,
  requireUser,
  requireVerifiedUser,
  resolveAuthUser,
  type AuthenticatedUser,
} from '@/lib/auth';
import {
  createSession,
  createUser,
  generateRandomToken,
  hashToken,
  markEmailVerified,
  setAuthDbOverride,
  type Queryable,
} from '@/lib/auth/index';
import { setDatabaseProbeOverride } from '@/lib/health';
import { GET as meHandler } from './me/route';
import { GET as healthHandler } from './health/route';
import { GET as catalogHandler } from './catalog/route';
import { GET as catalogSlugHandler } from './catalog/[slug]/route';

// Ensure test rate-limit secret is defined
process.env.RATE_LIMIT_SECRET = 'growspace-test-rate-limit-secret-32-chars-long!';

function getMigrationSql(): string {
  const candidates = [
    resolve(process.cwd(), 'migrations/0001_create_auth_tables.sql'),
    resolve(process.cwd(), '../../migrations/0001_create_auth_tables.sql'),
    resolve(import.meta.dirname, '../../../../../../migrations/0001_create_auth_tables.sql'),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return readFileSync(c, 'utf8');
  }
  throw new Error('Could not locate migrations/0001_create_auth_tables.sql');
}

async function createIsolatedAuthDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.waitReady;
  const sql = getMigrationSql();
  await db.exec(sql);
  return db;
}

// ============================================================================
// PART 1: MISSING CREDENTIALS & FIREBASE BEARER TOKEN REJECTION
// ============================================================================

describe('Phase 4.9C: Missing Credentials & Firebase Bearer Token Rejection', () => {
  it('1. Missing Credentials: rejects request with 401 unauthenticated when neither header nor cookie is present', async () => {
    const req = new NextRequest('http://localhost:3001/api/me');

    await assert.rejects(
      async () => requireUser(req),
      (err: unknown) => {
        assert.ok(typeof err === 'object' && err !== null);
        const appErr = err as { status: number; code: string; message: string };
        assert.equal(appErr.status, 401);
        assert.equal(appErr.code, 'unauthenticated');
        assert.equal(appErr.message, 'Sign in to continue.');
        return true;
      },
    );

    // Endpoint GET /api/me response matches error envelope
    const res = await meHandler(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'unauthenticated');
    assert.equal(body.error.message, 'Sign in to continue.');
  });

  it('2. Bearer Token Rejection: rejects Authorization: Bearer token with 401 unauthenticated retirement notice', async () => {
    const req = new NextRequest('http://localhost:3001/api/me', {
      headers: { authorization: 'Bearer any-firebase-or-legacy-token' },
    });

    await assert.rejects(
      async () => requireUser(req),
      (err: unknown) => {
        assert.ok(typeof err === 'object' && err !== null);
        const appErr = err as { status: number; code: string; message: string };
        assert.equal(appErr.status, 401);
        assert.equal(appErr.code, 'unauthenticated');
        assert.equal(
          appErr.message,
          'Bearer token authentication has been retired. Please sign in with your credentials.',
        );
        return true;
      },
    );

    const res = await meHandler(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'unauthenticated');
    assert.equal(
      body.error.message,
      'Bearer token authentication has been retired. Please sign in with your credentials.',
    );
  });

  it('3. Malformed Authorization Header: rejects non-Bearer schemes and empty bearer tokens with 401 unauthenticated', async () => {
    const reqBasic = new NextRequest('http://localhost:3001/api/me', {
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    await assert.rejects(
      async () => requireUser(reqBasic),
      (err: unknown) => (err as { status: number; message: string }).status === 401,
    );

    const reqEmptyBearer = new NextRequest('http://localhost:3001/api/me', {
      headers: { authorization: 'Bearer ' },
    });
    await assert.rejects(
      async () => requireUser(reqEmptyBearer),
      (err: unknown) => (err as { status: number; message: string }).status === 401,
    );
  });

  it('4. Dual Credentials with Bearer: request with BOTH session cookie AND Bearer header is REJECTED', async () => {
    const req = new NextRequest('http://localhost:3001/api/me', {
      headers: {
        authorization: 'Bearer legacy-token',
        cookie: 'gs_session=some-valid-or-invalid-session',
      },
    });

    await assert.rejects(
      async () => requireUser(req),
      (err: unknown) => {
        const appErr = err as { status: number; code: string; message: string };
        assert.equal(appErr.status, 401);
        assert.equal(appErr.code, 'unauthenticated');
        assert.equal(
          appErr.message,
          'Bearer token authentication has been retired. Please sign in with your credentials.',
        );
        return true;
      },
    );
  });
});

// ============================================================================
// PART 2: FIRST-PARTY SESSION COOKIE AUTHENTICATION (REAL PGLITE INTEGRATION)
// ============================================================================

describe('Phase 4.9C: First-Party Session Authentication (Real PostgreSQL PGlite)', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createIsolatedAuthDb();
    setAuthDbOverride(db as unknown as Queryable);
  });

  afterEach(async () => {
    setAuthDbOverride(null);
    await db.close();
  });

  it('5. Valid Session: resolves authenticated user with canonical UUID and authProvider=first_party', async () => {
    const user = await createUser(db, {
      email: 'session.user@growspace.test',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$dummy$hash',
      displayName: 'FirstParty User',
      temperatureUnit: 'celsius',
    });
    await markEmailVerified(db, user.id);

    const rawSessionToken = generateRandomToken(32);
    const rawCsrfToken = generateRandomToken(32);
    const session = await createSession(db, {
      userId: user.id,
      tokenHash: hashToken(rawSessionToken),
      csrfTokenHash: hashToken(rawCsrfToken),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const req = new NextRequest('http://localhost:3001/api/me', {
      headers: {
        cookie: `gs_session=${rawSessionToken}`,
      },
    });

    const resolved = await requireUser(req);
    assert.equal(resolved.uid, user.id);
    assert.equal(resolved.id, user.id);
    assert.equal(resolved.email, 'session.user@growspace.test');
    assert.equal(resolved.name, 'FirstParty User');
    assert.equal(resolved.displayName, 'FirstParty User');
    assert.equal(resolved.emailVerified, true);
    assert.equal(resolved.authProvider, 'first_party');
    assert.equal(resolved.temperatureUnit, 'celsius');
    assert.equal(resolved.sessionId, session.id);
  });

  it('6. Production __Host- Cookie: resolves authenticated user via __Host-gs_session cookie name', async () => {
    const user = await createUser(db, {
      email: 'prod.user@growspace.test',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$dummy$hash',
      displayName: 'Prod User',
    });

    const rawSessionToken = generateRandomToken(32);
    await createSession(db, {
      userId: user.id,
      tokenHash: hashToken(rawSessionToken),
      csrfTokenHash: hashToken(generateRandomToken(32)),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const req = new NextRequest('http://localhost:3001/api/me', {
      headers: {
        cookie: `__Host-gs_session=${rawSessionToken}`,
      },
    });

    const resolved = await requireUser(req);
    assert.equal(resolved.id, user.id);
    assert.equal(resolved.email, 'prod.user@growspace.test');
    assert.equal(resolved.authProvider, 'first_party');
  });

  it('7. Invalid Session: rejects with 401 unauthenticated when cookie contains unknown or forged token', async () => {
    const req = new NextRequest('http://localhost:3001/api/me', {
      headers: {
        cookie: 'gs_session=completely-forged-session-token-32-chars-long',
      },
    });

    await assert.rejects(
      async () => requireUser(req),
      (err: unknown) => {
        const appErr = err as { status: number; code: string };
        assert.equal(appErr.status, 401);
        assert.equal(appErr.code, 'unauthenticated');
        return true;
      },
    );
  });

  it('8. Expired Session: rejects with 401 session_expired when expires_at has passed', async () => {
    const user = await createUser(db, {
      email: 'expired@growspace.test',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$dummy$hash',
    });

    const rawSessionToken = generateRandomToken(32);
    const session = await createSession(db, {
      userId: user.id,
      tokenHash: hashToken(rawSessionToken),
      csrfTokenHash: hashToken(generateRandomToken(32)),
      expiresAt: new Date(Date.now() + 86400000),
    });

    // Backdate session timestamps into past
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 3600000);
    await db.query(
      `UPDATE sessions SET created_at = $1, last_used_at = $1, expires_at = $2 WHERE id = $3;`,
      [twoDaysAgo, oneHourAgo, session.id],
    );

    const req = new NextRequest('http://localhost:3001/api/me', {
      headers: {
        cookie: `gs_session=${rawSessionToken}`,
      },
    });

    await assert.rejects(
      async () => requireUser(req),
      (err: unknown) => {
        const appErr = err as { status: number; code: string };
        assert.equal(appErr.status, 401);
        assert.equal(appErr.code, 'session_expired');
        return true;
      },
    );
  });

  it('9. Revoked Session: rejects with 401 session_revoked when revoked_at is set', async () => {
    const user = await createUser(db, {
      email: 'revoked@growspace.test',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$dummy$hash',
    });

    const rawSessionToken = generateRandomToken(32);
    const session = await createSession(db, {
      userId: user.id,
      tokenHash: hashToken(rawSessionToken),
      csrfTokenHash: hashToken(generateRandomToken(32)),
      expiresAt: new Date(Date.now() + 86400000),
    });

    // Mark session revoked
    await db.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1;`, [session.id]);

    const req = new NextRequest('http://localhost:3001/api/me', {
      headers: {
        cookie: `gs_session=${rawSessionToken}`,
      },
    });

    await assert.rejects(
      async () => requireUser(req),
      (err: unknown) => {
        const appErr = err as { status: number; code: string };
        assert.equal(appErr.status, 401);
        assert.equal(appErr.code, 'session_revoked');
        return true;
      },
    );
  });

  it('10. Idle-Expired Session: rejects with 401 session_idle_timeout when last_used_at exceeds 24h idle window', async () => {
    const user = await createUser(db, {
      email: 'idle@growspace.test',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$dummy$hash',
    });

    const rawSessionToken = generateRandomToken(32);
    const session = await createSession(db, {
      userId: user.id,
      tokenHash: hashToken(rawSessionToken),
      csrfTokenHash: hashToken(generateRandomToken(32)),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });

    // Set created_at to 26 hours ago and last_used_at to 25 hours ago
    const twentySixHoursAgo = new Date(Date.now() - 26 * 3600000);
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 3600000);
    await db.query(`UPDATE sessions SET created_at = $1, last_used_at = $2 WHERE id = $3;`, [
      twentySixHoursAgo,
      twentyFiveHoursAgo,
      session.id,
    ]);

    const req = new NextRequest('http://localhost:3001/api/me', {
      headers: {
        cookie: `gs_session=${rawSessionToken}`,
      },
    });

    await assert.rejects(
      async () => requireUser(req),
      (err: unknown) => {
        const appErr = err as { status: number; code: string };
        assert.equal(appErr.status, 401);
        assert.equal(appErr.code, 'session_idle_timeout');
        return true;
      },
    );
  });

  it('11. Touch Session: updates last_used_at timestamp on access when touchSession is enabled', async () => {
    const user = await createUser(db, {
      email: 'touch@growspace.test',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$dummy$hash',
    });

    const rawSessionToken = generateRandomToken(32);
    const session = await createSession(db, {
      userId: user.id,
      tokenHash: hashToken(rawSessionToken),
      csrfTokenHash: hashToken(generateRandomToken(32)),
      expiresAt: new Date(Date.now() + 86400000),
    });

    // Set created_at to 20 minutes ago and last_used_at to 10 minutes ago
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60000);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60000);
    await db.query(`UPDATE sessions SET created_at = $1, last_used_at = $2 WHERE id = $3;`, [
      twentyMinutesAgo,
      tenMinutesAgo,
      session.id,
    ]);

    const req = new NextRequest('http://localhost:3001/api/me', {
      headers: {
        cookie: `gs_session=${rawSessionToken}`,
      },
    });

    await requireUser(req, { touchSession: true });

    const result = await db.query<{ last_used_at: Date }>(
      `SELECT last_used_at FROM sessions WHERE id = $1;`,
      [session.id],
    );
    const updatedTime = new Date(result.rows[0].last_used_at).getTime();
    assert.ok(updatedTime > tenMinutesAgo.getTime());
  });

  it('12. Email Verification Policy: requireVerifiedUser rejects unverified first-party user with 403 email_unverified', async () => {
    const user = await createUser(db, {
      email: 'unverified.fp@growspace.test',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$dummy$hash',
    });

    const rawSessionToken = generateRandomToken(32);
    await createSession(db, {
      userId: user.id,
      tokenHash: hashToken(rawSessionToken),
      csrfTokenHash: hashToken(generateRandomToken(32)),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const req = new NextRequest('http://localhost:3001/api/me', {
      headers: {
        cookie: `gs_session=${rawSessionToken}`,
      },
    });

    await assert.rejects(
      async () => requireVerifiedUser(req),
      (err: unknown) => {
        const appErr = err as { status: number; code: string };
        assert.equal(appErr.status, 403);
        assert.equal(appErr.code, 'email_unverified');
        return true;
      },
    );
  });

  it('13. Email Verification Policy: requireVerifiedUser succeeds for verified first-party user', async () => {
    const user = await createUser(db, {
      email: 'verified.fp@growspace.test',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$dummy$hash',
    });
    await markEmailVerified(db, user.id);

    const rawSessionToken = generateRandomToken(32);
    await createSession(db, {
      userId: user.id,
      tokenHash: hashToken(rawSessionToken),
      csrfTokenHash: hashToken(generateRandomToken(32)),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const req = new NextRequest('http://localhost:3001/api/me', {
      headers: {
        cookie: `gs_session=${rawSessionToken}`,
      },
    });

    const resolved = await requireVerifiedUser(req);
    assert.equal(resolved.id, user.id);
    assert.equal(resolved.emailVerified, true);
  });

  it('14. Database Unavailable / Error: fails closed with 401 unauthenticated when database query throws', async () => {
    const failingDb = {
      query: async () => {
        throw new Error('Connection refused to database pool');
      },
    } as unknown as Queryable;
    setAuthDbOverride(failingDb);

    const req = new NextRequest('http://localhost:3001/api/me', {
      headers: {
        cookie: 'gs_session=some-session-token',
      },
    });

    await assert.rejects(
      async () => requireUser(req),
      (err: unknown) => {
        const appErr = err as { status: number; code: string };
        assert.equal(appErr.status, 401);
        assert.equal(appErr.code, 'unauthenticated');
        return true;
      },
    );
  });
});

// ============================================================================
// PART 3: CSRF AND ORIGIN ENFORCEMENT ON MUTATING REQUESTS
// ============================================================================

describe('Phase 4.9C: CSRF and Origin Enforcement on Mutating Requests', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createIsolatedAuthDb();
    setAuthDbOverride(db as unknown as Queryable);
  });

  afterEach(async () => {
    setAuthDbOverride(null);
    await db.close();
  });

  it('15. Disallowed Origin: rejects mutating request with disallowed Origin with 403 forbidden_origin', async () => {
    const user = await createUser(db, {
      email: 'csrf.user@growspace.test',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$dummy$hash',
    });
    const rawSessionToken = generateRandomToken(32);
    const rawCsrfToken = generateRandomToken(32);
    await createSession(db, {
      userId: user.id,
      tokenHash: hashToken(rawSessionToken),
      csrfTokenHash: hashToken(rawCsrfToken),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const req = new NextRequest('http://localhost:3001/api/me', {
      method: 'POST',
      headers: {
        origin: 'http://malicious-attacker.evil',
        cookie: `gs_session=${rawSessionToken}`,
        'x-csrf-token': rawCsrfToken,
      },
    });

    await assert.rejects(
      async () => requireUser(req),
      (err: unknown) => {
        const appErr = err as { status: number; code: string };
        assert.equal(appErr.status, 403);
        assert.equal(appErr.code, 'forbidden_origin');
        return true;
      },
    );
  });

  it('16. Missing/Mismatched CSRF: rejects mutating request when X-CSRF-Token is missing or mismatched', async () => {
    const user = await createUser(db, {
      email: 'csrf.mismatch@growspace.test',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$dummy$hash',
    });
    const rawSessionToken = generateRandomToken(32);
    const validCsrfToken = generateRandomToken(32);
    await createSession(db, {
      userId: user.id,
      tokenHash: hashToken(rawSessionToken),
      csrfTokenHash: hashToken(validCsrfToken),
      expiresAt: new Date(Date.now() + 86400000),
    });

    // A: Missing CSRF Token
    const reqMissing = new NextRequest('http://localhost:3001/api/me', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${rawSessionToken}`,
      },
    });
    await assert.rejects(
      async () => requireUser(reqMissing),
      (err: unknown) => {
        const appErr = err as { status: number; code: string };
        assert.equal(appErr.status, 403);
        assert.equal(appErr.code, 'csrf_detected');
        return true;
      },
    );

    // B: Mismatched CSRF Token
    const reqWrong = new NextRequest('http://localhost:3001/api/me', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${rawSessionToken}`,
        'x-csrf-token': 'wrong-or-forged-csrf-token',
      },
    });
    await assert.rejects(
      async () => requireUser(reqWrong),
      (err: unknown) => {
        const appErr = err as { status: number; code: string };
        assert.equal(appErr.status, 403);
        assert.equal(appErr.code, 'csrf_detected');
        return true;
      },
    );
  });

  it('17. Valid CSRF and Origin: succeeds for mutating request with matching origin and CSRF token', async () => {
    const user = await createUser(db, {
      email: 'csrf.valid@growspace.test',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$dummy$hash',
    });
    const rawSessionToken = generateRandomToken(32);
    const validCsrfToken = generateRandomToken(32);
    await createSession(db, {
      userId: user.id,
      tokenHash: hashToken(rawSessionToken),
      csrfTokenHash: hashToken(validCsrfToken),
      expiresAt: new Date(Date.now() + 86400000),
    });

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const req = new NextRequest('http://localhost:3001/api/me', {
        method,
        headers: {
          origin: 'http://localhost:5173',
          cookie: `gs_session=${rawSessionToken}; gs_csrf=${validCsrfToken}`,
          'x-csrf-token': validCsrfToken,
        },
      });

      const resolved = await requireUser(req);
      assert.equal(resolved.id, user.id);
    }
  });

  it('18. Safe Methods Exempt: GET requests do not require CSRF token', async () => {
    const user = await createUser(db, {
      email: 'get.exempt@growspace.test',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$dummy$hash',
    });
    const rawSessionToken = generateRandomToken(32);
    await createSession(db, {
      userId: user.id,
      tokenHash: hashToken(rawSessionToken),
      csrfTokenHash: hashToken(generateRandomToken(32)),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const req = new NextRequest('http://localhost:3001/api/me', {
      method: 'GET',
      headers: {
        cookie: `gs_session=${rawSessionToken}`,
      },
    });

    const resolved = await requireUser(req);
    assert.equal(resolved.id, user.id);
  });
});

// ============================================================================
// PART 4: AUTHORIZATION AND RESOURCE OWNERSHIP CHECKS
// ============================================================================

describe('Phase 4.9C: Authorization and Resource Ownership Checks', () => {
  it('19. assertOwnership: passes when resourceUserId matches user.id (Neon UUID)', () => {
    const user: AuthenticatedUser = {
      uid: 'e499d14a-5b12-4217-9dae-289b52a9e320',
      id: 'e499d14a-5b12-4217-9dae-289b52a9e320',
      email: 'owner@growspace.test',
      name: 'Canonical Owner',
      displayName: 'Canonical Owner',
      emailVerified: true,
      authProvider: 'first_party',
    };

    assert.doesNotThrow(() => assertOwnership('e499d14a-5b12-4217-9dae-289b52a9e320', user));
  });

  it('20. assertOwnership: rejects with 403 forbidden when resourceUserId does not match user.id', () => {
    const user: AuthenticatedUser = {
      uid: 'e499d14a-5b12-4217-9dae-289b52a9e320',
      id: 'e499d14a-5b12-4217-9dae-289b52a9e320',
      email: 'owner@growspace.test',
      name: 'Canonical Owner',
      displayName: 'Canonical Owner',
      emailVerified: true,
      authProvider: 'first_party',
    };

    assert.throws(
      () => assertOwnership('different-user-uuid', user),
      (err: unknown) => {
        const appErr = err as { status: number; code: string; message: string };
        assert.equal(appErr.status, 403);
        assert.equal(appErr.code, 'forbidden');
        assert.equal(appErr.message, 'You do not have access to this record.');
        return true;
      },
    );
  });

  it('21. assertOwnership: does not treat legacy Firebase UIDs as matching Neon UUIDs', () => {
    const user: AuthenticatedUser = {
      uid: 'e499d14a-5b12-4217-9dae-289b52a9e320',
      id: 'e499d14a-5b12-4217-9dae-289b52a9e320',
      email: 'owner@growspace.test',
      name: 'Owner',
      displayName: 'Owner',
      emailVerified: true,
      authProvider: 'first_party',
    };

    assert.throws(
      () => assertOwnership('fb-legacy-uid-string', user),
      (err: unknown) => {
        const appErr = err as { status: number; code: string };
        assert.equal(appErr.status, 403);
        assert.equal(appErr.code, 'forbidden');
        return true;
      },
    );
  });
});

// ============================================================================
// PART 5: PUBLIC ENDPOINT INTEGRITY
// ============================================================================

describe('Phase 4.9C: Public Endpoint Integrity', () => {
  it('22. /api/health: remains fully public and returns service status with databaseConfigured', async () => {
    setDatabaseProbeOverride(async () => 'ok');
    try {
      const res = await healthHandler();
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'ok');
      assert.equal(body.service, 'growspace-api');
      assert.ok(body.timestamp);
      assert.equal(typeof body.databaseConfigured, 'boolean');
      assert.equal(body.database, 'ok');
    } finally {
      setDatabaseProbeOverride(null);
    }
  });

  it('23. /api/catalog: remains fully public without authentication', async () => {
    const req = new NextRequest('http://localhost:3001/api/catalog');
    const res = catalogHandler(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.ok(body.length > 0);
  });

  it('24. /api/catalog/[slug]: remains public reference lookups without authentication', async () => {
    const req = new NextRequest('http://localhost:3001/api/catalog/basil');
    const res = await catalogSlugHandler(req, {
      params: Promise.resolve({ slug: 'basil' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.slug, 'basil');
  });
});

// ============================================================================
// PART 6: GET /api/me RESPONSE SAFETY & RESOLVER ALIAS
// ============================================================================

describe('Phase 4.9C: GET /api/me Pure First-Party Response Safety', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createIsolatedAuthDb();
    setAuthDbOverride(db as unknown as Queryable);
  });

  afterEach(async () => {
    setAuthDbOverride(null);
    await db.close();
  });

  it('25. GET /api/me with First-Party Session: returns safe payload, Cache-Control: no-store, and zero secret leaks', async () => {
    const user = await createUser(db, {
      email: 'fp.me@growspace.test',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$dummy$hash',
      displayName: 'First Party Me',
      temperatureUnit: 'fahrenheit',
    });
    await markEmailVerified(db, user.id);

    const rawSessionToken = generateRandomToken(32);
    await createSession(db, {
      userId: user.id,
      tokenHash: hashToken(rawSessionToken),
      csrfTokenHash: hashToken(generateRandomToken(32)),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const req = new NextRequest('http://localhost:3001/api/me', {
      headers: {
        cookie: `gs_session=${rawSessionToken}`,
      },
    });

    const res = await meHandler(req);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');

    const body = await res.json();
    assert.equal(body.user.uid, user.id);
    assert.equal(body.user.id, user.id);
    assert.equal(body.user.email, 'fp.me@growspace.test');
    assert.equal(body.user.name, 'First Party Me');
    assert.equal(body.user.displayName, 'First Party Me');
    assert.equal(body.user.temperatureUnit, 'fahrenheit');
    assert.equal(body.user.emailVerified, true);
    assert.equal(body.user.authProvider, 'first_party');

    // STRICT CHECK: Verify no secrets or session hashes leak in JSON body
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('token_hash'));
    assert.ok(!serialized.includes('csrf_token_hash'));
    assert.ok(!serialized.includes('password_hash'));
    assert.ok(!serialized.includes('session'));
  });

  it('26. GET /api/me without credentials: returns 401 unauthenticated', async () => {
    const req = new NextRequest('http://localhost:3001/api/me');
    const res = await meHandler(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'unauthenticated');
  });

  it('27. GET /api/me with Bearer token: returns 401 unauthenticated with retirement message', async () => {
    const req = new NextRequest('http://localhost:3001/api/me', {
      headers: { authorization: 'Bearer any-token' },
    });
    const res = await meHandler(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'unauthenticated');
    assert.equal(
      body.error.message,
      'Bearer token authentication has been retired. Please sign in with your credentials.',
    );
  });

  it('28. resolveAuthUser alias: behaves identically to requireUser', async () => {
    const req = new NextRequest('http://localhost:3001/api/me');
    await assert.rejects(
      async () => resolveAuthUser(req),
      (err: unknown) => (err as { status: number }).status === 401,
    );
  });
});
