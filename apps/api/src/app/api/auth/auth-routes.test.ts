import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { PGlite } from '@electric-sql/pglite';
import {
  clearSessionCookies,
  getCookieConfig,
  hashToken,
  setAuthDbOverride,
  validateRequestOrigin,
  validateSessionCsrfToken,
  type Queryable,
  type SessionRecord,
} from '@/lib/auth/index';
import { requireUser } from '@/lib/auth';
import { POST as registerHandler } from './register/route';
import { POST as loginHandler } from './login/route';
import { POST as logoutHandler } from './logout/route';
import { GET as sessionHandler } from './session/route';
import { GET as csrfHandler } from './csrf/route';

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
// PART 1: MOCKED & UNIT SECURITY TESTS
// ============================================================================

describe('Auth HTTP Routes: Security Primitives & Unit Rules', () => {
  describe('Origin and Header Validation', () => {
    it('accepts requests matching allowed origins in env', () => {
      const req = new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173' },
      });
      const check = validateRequestOrigin(req);
      assert.equal(check.valid, true);
    });

    it('rejects unexpected or malicious origins with forbidden status', () => {
      const req = new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'https://malicious-attacker.com' },
      });
      const check = validateRequestOrigin(req);
      assert.equal(check.valid, false);
      assert.match(check.reason ?? '', /not in the allowed origins/);
    });

    it('falls back to Referer header if Origin header is absent and checks domain', () => {
      const reqAllowed = new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { referer: 'http://localhost:5173/auth/login' },
      });
      assert.equal(validateRequestOrigin(reqAllowed).valid, true);

      const reqDisallowed = new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { referer: 'https://evil.org/page' },
      });
      assert.equal(validateRequestOrigin(reqDisallowed).valid, false);
    });

    it('rejects cookie-authenticated requests when both Origin and Referer are missing', () => {
      const req = new NextRequest('http://localhost:3001/api/auth/logout', {
        method: 'POST',
        headers: { cookie: 'gs_session=some-session-token' },
      });
      const check = validateRequestOrigin(req, { requireOriginIfCookiePresent: true });
      assert.equal(check.valid, false);
      assert.match(check.reason ?? '', /must provide a valid Origin/);
    });
  });

  describe('Cookie Security Attributes in Dev vs Production', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    });

    it('enforces __Host- prefix, Secure, HttpOnly, SameSite=Lax, Path=/, and no Domain in production', () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      const config = getCookieConfig();

      assert.equal(config.sessionCookieName, '__Host-gs_session');
      assert.equal(config.csrfCookieName, '__Host-gs_csrf');
      assert.equal(config.secure, true);
      assert.equal(config.sameSite, 'lax');
      assert.equal(config.path, '/');
      assert.equal(config.maxAge, 604800); // 7 days
    });

    it('uses dev cookie names and non-secure cookies over HTTP in development', () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
      const config = getCookieConfig();

      assert.equal(config.sessionCookieName, 'gs_session');
      assert.equal(config.csrfCookieName, 'gs_csrf');
      assert.equal(config.secure, false);
      assert.equal(config.sameSite, 'lax');
      assert.equal(config.path, '/');
    });

    it('clearSessionCookies resets cookies with maxAge=0 for both dev and prod names', () => {
      const res = new (class MockResponse {
        cookiesMap = new Map<string, { name: string; maxAge: number; value: string }>();
        cookies = {
          set: (opts: { name: string; maxAge: number; value: string }) => {
            this.cookiesMap.set(opts.name, opts);
          },
        };
      })();

      clearSessionCookies(res as unknown as Parameters<typeof clearSessionCookies>[0]);
      assert.ok(res.cookiesMap.has('__Host-gs_session'));
      assert.ok(res.cookiesMap.has('gs_session'));
      assert.equal(res.cookiesMap.get('gs_session')?.maxAge, 0);
      assert.equal(res.cookiesMap.get('gs_session')?.value, '');
    });
  });

  describe('Session-Bound CSRF Token Validation', () => {
    const rawCsrfToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE'; // 43 chars
    const csrfHash = hashToken(rawCsrfToken);

    const mockSession: SessionRecord = {
      id: 'sess-1234',
      user_id: 'user-1234',
      token_hash: Buffer.alloc(32),
      csrf_token_hash: csrfHash,
      created_at: new Date(),
      last_used_at: new Date(),
      expires_at: new Date(Date.now() + 86400000),
      revoked_at: null,
    };

    it('passes when X-CSRF-Token header, cookie, and database hash all match', () => {
      const req = new NextRequest('http://localhost:3001/api/auth/logout', {
        method: 'POST',
        headers: {
          'x-csrf-token': rawCsrfToken,
          cookie: `gs_csrf=${rawCsrfToken}`,
        },
      });

      const check = validateSessionCsrfToken(req, mockSession);
      assert.equal(check.valid, true);
    });

    it('fails when X-CSRF-Token header is missing', () => {
      const req = new NextRequest('http://localhost:3001/api/auth/logout', {
        method: 'POST',
        headers: {
          cookie: `gs_csrf=${rawCsrfToken}`,
        },
      });

      const check = validateSessionCsrfToken(req, mockSession);
      assert.equal(check.valid, false);
      assert.match(check.reason ?? '', /Missing X-CSRF-Token/);
    });

    it('fails when CSRF cookie is missing', () => {
      const req = new NextRequest('http://localhost:3001/api/auth/logout', {
        method: 'POST',
        headers: {
          'x-csrf-token': rawCsrfToken,
        },
      });

      const check = validateSessionCsrfToken(req, mockSession);
      assert.equal(check.valid, false);
      assert.match(check.reason ?? '', /Missing CSRF cookie/);
    });

    it('fails when header and cookie tokens mismatch', () => {
      const diffToken = 'ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-ZyXwV';
      const req = new NextRequest('http://localhost:3001/api/auth/logout', {
        method: 'POST',
        headers: {
          'x-csrf-token': rawCsrfToken,
          cookie: `gs_csrf=${diffToken}`,
        },
      });

      const check = validateSessionCsrfToken(req, mockSession);
      assert.equal(check.valid, false);
      assert.match(check.reason ?? '', /do not match/);
    });

    it('fails when token does not match the database session hash', () => {
      const validSyntaxToken = 'ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-ZyXwV';
      const req = new NextRequest('http://localhost:3001/api/auth/logout', {
        method: 'POST',
        headers: {
          'x-csrf-token': validSyntaxToken,
          cookie: `gs_csrf=${validSyntaxToken}`,
        },
      });

      const check = validateSessionCsrfToken(req, mockSession);
      assert.equal(check.valid, false);
      assert.match(check.reason ?? '', /not valid for this active session/);
    });

    it('fails on malformed token length or non-base64url characters', () => {
      const req = new NextRequest('http://localhost:3001/api/auth/logout', {
        method: 'POST',
        headers: {
          'x-csrf-token': 'too-short',
          cookie: 'gs_csrf=too-short',
        },
      });

      const check = validateSessionCsrfToken(req, mockSession);
      assert.equal(check.valid, false);
      assert.match(check.reason ?? '', /Malformed/);
    });
  });

  describe('Generic Error Responses on Database Crashes', () => {
    it('returns generic 500 without disclosing internal database errors or SQL', async () => {
      // Mock DB that throws an unexpected connection failure
      const brokenDb: Queryable = {
        query: async () => {
          throw new Error('FATAL: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed');
        },
      };

      setAuthDbOverride(brokenDb);
      try {
        const req = new NextRequest('http://localhost:3001/api/auth/login', {
          method: 'POST',
          headers: {
            origin: 'http://localhost:5173',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'ValidPassword123!',
          }),
        });

        const res = await loginHandler(req);
        assert.equal(res.status, 500);

        const body = await res.json();
        assert.equal(body.error.code, 'internal_error');
        assert.equal(body.error.message, 'Something went wrong. Please try again.');
        assert.ok(!JSON.stringify(body).includes('socket'));
        assert.ok(!JSON.stringify(body).includes('PGSQL'));
      } finally {
        setAuthDbOverride(null);
      }
    });
  });

  describe('Missing RATE_LIMIT_SECRET Behavior', () => {
    it('fails safely with generic internal error when RATE_LIMIT_SECRET is not configured', async () => {
      const savedSecret = process.env.RATE_LIMIT_SECRET;
      delete process.env.RATE_LIMIT_SECRET;

      try {
        const req = new NextRequest('http://localhost:3001/api/auth/register', {
          method: 'POST',
          headers: {
            origin: 'http://localhost:5173',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email: 'unconfigured@growspace.test',
            password: 'ValidPassword123!',
          }),
        });

        const res = await registerHandler(req);
        assert.equal(res.status, 500);
        const body = await res.json();
        assert.equal(body.error.code, 'internal_error');
        assert.equal(body.error.message, 'Something went wrong. Please try again.');
      } finally {
        process.env.RATE_LIMIT_SECRET = savedSecret;
      }
    });
  });

  describe('Authentication Helper Verification', () => {
    it('verifies that requireUser helper rejects unauthenticated requests with 401 unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3001/api/me');
      // When no authorization header or cookie is supplied, requireUser must throw 401 unauthenticated
      await assert.rejects(
        async () => requireUser(req),
        (err: unknown) =>
          typeof err === 'object' &&
          err !== null &&
          'status' in err &&
          'code' in err &&
          (err as { status: number; code: string }).status === 401 &&
          (err as { status: number; code: string }).code === 'unauthenticated',
      );
    });
  });
});

// ============================================================================
// PART 2: REAL DISPOSABLE POSTGRESQL (PGLITE) INTEGRATION TESTS
// ============================================================================

describe('Auth HTTP Routes: Real PostgreSQL Integration Suite (PGlite)', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createIsolatedAuthDb();
    setAuthDbOverride(db as unknown as Queryable);
  });

  afterEach(async () => {
    setAuthDbOverride(null);
    await db.close();
  });

  it('1. Register successfully returns 202 Accepted and does NOT create a session cookie', async () => {
    const req = new NextRequest('http://localhost:3001/api/auth/register', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'Gardener.Alice@GrowSpace.org',
        password: 'SuperSecurePassword123!',
        displayName: 'Alice Gardener',
      }),
    });

    const res = await registerHandler(req);
    assert.equal(res.status, 202);

    const body = await res.json();
    assert.equal(body.message, 'If this email can be registered, a verification link has been sent.');
    assert.equal(body.user, undefined, 'Register must not return user record');
    assert.equal(body.sessionToken, undefined, 'Register must not return session token');

    // Verify no Set-Cookie header for session
    const setCookie = res.headers.get('set-cookie');
    assert.ok(!setCookie || !setCookie.includes('gs_session'), 'Register must not set session cookie');

    // Verify row inserted in PGlite with normalized email and Argon2id hash
    const rows = await db.query<{ email: string; password_hash: string }>(
      'SELECT email, password_hash FROM users WHERE email = $1;',
      ['gardener.alice@growspace.org'],
    );
    assert.equal(rows.rows.length, 1);
    assert.ok(rows.rows[0].password_hash.startsWith('$argon2id$'));
  });

  it('2. Duplicate-email registration returns INDISTINGUISHABLE 202 response and body', async () => {
    const payload = {
      email: 'duplicate.target@growspace.org',
      password: 'OriginalPassword123!',
      displayName: 'Original User',
    };

    // First registration
    const req1 = new NextRequest('http://localhost:3001/api/auth/register', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const res1 = await registerHandler(req1);
    const body1 = await res1.json();

    // Second registration with same email
    const req2 = new NextRequest('http://localhost:3001/api/auth/register', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'DUPLICATE.TARGET@growspace.org', // Case variation
        password: 'DifferentPassword123!',
        displayName: 'Impostor',
      }),
    });
    const res2 = await registerHandler(req2);
    const body2 = await res2.json();

    assert.equal(res1.status, 202);
    assert.equal(res2.status, 202);
    assert.deepEqual(body1, body2, 'Responses must be byte-for-byte identical to prevent enumeration');
  });

  it('3. Register rejects malformed JSON or invalid schema with 400/422', async () => {
    // Malformed JSON
    const malformedReq = new NextRequest('http://localhost:3001/api/auth/register', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: '{ not valid json',
    });
    const malformedRes = await registerHandler(malformedReq);
    assert.equal(malformedRes.status, 400);

    // Password shorter than 12 characters
    const weakPassReq = new NextRequest('http://localhost:3001/api/auth/register', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'valid@growspace.org', password: 'short' }),
    });
    const weakPassRes = await registerHandler(weakPassReq);
    assert.equal(weakPassRes.status, 422);
    const body = await weakPassRes.json();
    assert.equal(body.error.code, 'validation_error');
  });

  it('4. Login creates session, sets HttpOnly cookie, and returns SessionUser without secrets', async () => {
    const email = 'gardener.bob@growspace.org';
    const password = 'StrongPassword123!';

    // Register user
    const regReq = new NextRequest('http://localhost:3001/api/auth/register', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, displayName: 'Bob Gardener' }),
    });
    await registerHandler(regReq);

    // Login
    const loginReq = new NextRequest('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const loginRes = await loginHandler(loginReq);
    assert.equal(loginRes.status, 200);

    const loginBody = await loginRes.json();
    assert.equal(loginBody.user.email, email);
    assert.equal(loginBody.user.displayName, 'Bob Gardener');
    assert.equal(loginBody.user.temperatureUnit, 'celsius');
    assert.equal(typeof loginBody.csrfToken, 'string');
    assert.equal(loginBody.csrfToken.length, 43);

    // ABSOLUTELY NO SECRETS IN JSON PAYLOAD
    assert.equal(loginBody.sessionToken, undefined, 'Must not return raw session token');
    assert.equal(loginBody.user.password_hash, undefined, 'Must not return password hash');
    assert.equal(loginBody.token_hash, undefined, 'Must not return token hash');

    // Cookie checks
    const sessionCookie = loginRes.cookies.get('gs_session');
    assert.ok(sessionCookie, 'Must set gs_session cookie');
    assert.equal(sessionCookie.httpOnly, true, 'Session cookie must be HttpOnly');
    assert.equal(sessionCookie.sameSite, 'lax');
    assert.equal(sessionCookie.path, '/');

    const csrfCookie = loginRes.cookies.get('gs_csrf');
    assert.ok(csrfCookie, 'Must set gs_csrf cookie');
    assert.equal(csrfCookie.httpOnly, false, 'CSRF cookie must be readable by SPA JS');
    assert.equal(csrfCookie.value, loginBody.csrfToken);
  });

  it('5. Login fails with generic invalid_credentials for both non-existent user and wrong password', async () => {
    // Non-existent email
    const req1 = new NextRequest('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ghost@growspace.org', password: 'SomePassword123!' }),
    });
    const res1 = await loginHandler(req1);
    assert.equal(res1.status, 401);
    const body1 = await res1.json();
    assert.equal(body1.error.code, 'invalid_credentials');
    assert.equal(body1.error.message, 'Invalid email or password.');

    // Existing user, wrong password
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'real@growspace.org', password: 'RealPassword123!' }),
      }),
    );

    const req2 = new NextRequest('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'real@growspace.org', password: 'WrongPassword123!' }),
    });
    const res2 = await loginHandler(req2);
    assert.equal(res2.status, 401);
    const body2 = await res2.json();
    assert.deepEqual(body1, body2, 'Error codes and messages must be identical');
  });

  it('6. GET /api/auth/session returns 200 with user when valid cookie is presented', async () => {
    const email = 'session.test@growspace.org';
    const password = 'PasswordForSession123!';

    // Register & Login to get cookie
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );

    const loginRes = await loginHandler(
      new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );

    const sessionCookieVal = loginRes.cookies.get('gs_session')!.value;
    const csrfCookieVal = loginRes.cookies.get('gs_csrf')!.value;

    // Lookup session
    const sessReq = new NextRequest('http://localhost:3001/api/auth/session', {
      method: 'GET',
      headers: {
        cookie: `gs_session=${sessionCookieVal}; gs_csrf=${csrfCookieVal}`,
      },
    });

    const sessRes = await sessionHandler(sessReq);
    assert.equal(sessRes.status, 200);

    const body = await sessRes.json();
    assert.equal(body.user.email, email);
    assert.equal(body.csrfToken, csrfCookieVal);
  });

  it('7. GET /api/auth/session returns 401 on missing, expired, or revoked sessions', async () => {
    // A. Missing cookie
    const noCookieReq = new NextRequest('http://localhost:3001/api/auth/session', { method: 'GET' });
    const noCookieRes = await sessionHandler(noCookieReq);
    assert.equal(noCookieRes.status, 401);

    // B. Invalid/fabricated cookie
    const fakeCookieReq = new NextRequest('http://localhost:3001/api/auth/session', {
      method: 'GET',
      headers: { cookie: 'gs_session=non-existent-fabricated-token-value-here' },
    });
    const fakeCookieRes = await sessionHandler(fakeCookieReq);
    assert.equal(fakeCookieRes.status, 401);
  });

  it('8. POST /api/auth/logout revokes session in DB, enforces CSRF, and clears cookies', async () => {
    const email = 'logout.test@growspace.org';
    const password = 'LogoutPassword123!';

    // 1. Register & Login
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );

    const loginRes = await loginHandler(
      new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );

    const sessionCookieVal = loginRes.cookies.get('gs_session')!.value;
    const csrfCookieVal = loginRes.cookies.get('gs_csrf')!.value;

    // 2. Attempt logout without CSRF token -> Rejected with 403
    const badLogoutReq = new NextRequest('http://localhost:3001/api/auth/logout', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${sessionCookieVal}`,
      },
    });
    const badLogoutRes = await logoutHandler(badLogoutReq);
    assert.equal(badLogoutRes.status, 403);

    // 3. Proper logout with valid X-CSRF-Token header and cookie
    const goodLogoutReq = new NextRequest('http://localhost:3001/api/auth/logout', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        'x-csrf-token': csrfCookieVal,
        cookie: `gs_session=${sessionCookieVal}; gs_csrf=${csrfCookieVal}`,
      },
    });
    const goodLogoutRes = await logoutHandler(goodLogoutReq);
    assert.equal(goodLogoutRes.status, 204);

    // Verify session cookie was cleared
    const clearedSession = goodLogoutRes.cookies.get('gs_session');
    assert.ok(clearedSession);
    assert.equal(clearedSession.maxAge, 0);

    // 4. Session lookup after logout must fail with 401
    const postLogoutSessReq = new NextRequest('http://localhost:3001/api/auth/session', {
      method: 'GET',
      headers: {
        cookie: `gs_session=${sessionCookieVal}`,
      },
    });
    const postLogoutSessRes = await sessionHandler(postLogoutSessReq);
    assert.equal(postLogoutSessRes.status, 401);
  });

  it('9. Rate limiting on registration triggers 429 after 5 attempts from same IP', async () => {
    const ip = '198.51.100.42';

    for (let i = 1; i <= 5; i++) {
      const req = new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({
          email: `rate.user.${i}@growspace.org`,
          password: 'Password123456!',
        }),
      });

      // Enable TRUST_PROXY to test IP extraction
      process.env.TRUST_PROXY = 'true';
      const res = await registerHandler(req);
      assert.equal(res.status, 202);
    }

    // 6th attempt must be blocked by rate limiter
    const blockedReq = new NextRequest('http://localhost:3001/api/auth/register', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        'content-type': 'application/json',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify({
        email: 'rate.user.6@growspace.org',
        password: 'Password123456!',
      }),
    });

    const blockedRes = await registerHandler(blockedReq);
    assert.equal(blockedRes.status, 429);
    assert.ok(blockedRes.headers.get('retry-after'));
    const body = await blockedRes.json();
    assert.equal(body.error.code, 'rate_limited');
  });

  it('10. GET /api/auth/csrf generates and returns a valid CSRF token', async () => {
    const req = new NextRequest('http://localhost:3001/api/auth/csrf', { method: 'GET' });
    const res = await csrfHandler(req);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.ok(body.csrfToken);
    assert.equal(body.csrfToken.length, 43);

    const csrfCookie = res.cookies.get('gs_csrf');
    assert.ok(csrfCookie);
    assert.equal(csrfCookie.value, body.csrfToken);
  });
});
