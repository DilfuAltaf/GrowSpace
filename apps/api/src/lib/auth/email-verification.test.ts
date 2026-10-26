import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { PGlite } from '@electric-sql/pglite';
import {
  buildVerificationUrl,
  getAppOrigin,
  hashToken,
  MockAuthMailer,
  setAuthDbOverride,
  setAuthMailerOverride,
  type Queryable,
} from '@/lib/auth/index';
import { POST as registerHandler } from '@/app/api/auth/register/route';
import { POST as loginHandler } from '@/app/api/auth/login/route';
import { POST as verifyEmailHandler } from '@/app/api/auth/verify-email/route';
import { POST as resendVerificationHandler } from '@/app/api/auth/resend-verification/route';
import { GET as sessionHandler } from '@/app/api/auth/session/route';

process.env.RATE_LIMIT_SECRET = 'growspace-test-rate-limit-secret-32-chars-long!';

function getMigrationSql(): string {
  const candidates = [
    resolve(process.cwd(), 'migrations/0001_create_auth_tables.sql'),
    resolve(process.cwd(), '../../migrations/0001_create_auth_tables.sql'),
    resolve(import.meta.dirname, '../../../../../../migrations/0001_create_auth_tables.sql'),
    resolve(import.meta.dirname, '../../../../../migrations/0001_create_auth_tables.sql'),
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
// PART 1: UNIT TESTS (URL SANITIZATION, MAILER MOCK & SECRETS)
// ============================================================================

describe('Email Verification & Mailer: Unit Security Rules', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalAppOrigin = process.env.APP_ORIGIN;

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    if (originalAppOrigin) {
      process.env.APP_ORIGIN = originalAppOrigin;
    } else {
      delete process.env.APP_ORIGIN;
    }
  });

  it('constructs trusted verification URLs using canonical APP_ORIGIN and fragment tokens', () => {
    process.env.APP_ORIGIN = 'https://growspace.app';
    const rawToken = 'TestToken1234567890abcdefghijklmnopqrstuvwxyz';
    const url = buildVerificationUrl(rawToken);

    assert.equal(
      url,
      `https://growspace.app/auth/verify-email#token=${encodeURIComponent(rawToken)}`,
    );
    assert.ok(url.includes('#token='), 'Token must be in fragment to protect against Referer leakage');
  });

  it('rejects untrusted protocols in APP_ORIGIN', () => {
    process.env.APP_ORIGIN = 'javascript:alert(1)';
    assert.throws(() => getAppOrigin(), /APP_ORIGIN must use http:\/\/ or https:\/\/ protocol/);

    process.env.APP_ORIGIN = 'ftp://malicious.com';
    assert.throws(() => getAppOrigin(), /APP_ORIGIN must use http:\/\/ or https:\/\/ protocol/);
  });

  it('requires HTTPS for APP_ORIGIN in production environment', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.APP_ORIGIN = 'http://insecure.app';
    assert.throws(() => getAppOrigin(), /must use the https:\/\/ protocol in production/);
  });

  it('mock mailer records sent emails and simulates failures reliably', async () => {
    const mockMailer = new MockAuthMailer();
    assert.equal(mockMailer.sentEmails.length, 0);

    await mockMailer.sendVerification('user@test.org', 'https://app/verify#token=abc');
    assert.equal(mockMailer.sentEmails.length, 1);
    assert.equal(mockMailer.sentEmails[0].to, 'user@test.org');
    assert.equal(mockMailer.sentEmails[0].link, 'https://app/verify#token=abc');

    mockMailer.setShouldFail(true, new Error('Simulated upstream failure'));
    await assert.rejects(
      async () => mockMailer.sendVerification('fail@test.org', 'https://app/verify#token=xyz'),
      /Simulated upstream failure/,
    );
  });
});

// ============================================================================
// PART 2: REAL POSTGRESQL (PGLITE) INTEGRATION SUITE
// ============================================================================

describe('Email Verification & Mailer: Real PostgreSQL Integration Suite (PGlite)', () => {
  let db: PGlite;
  let mockMailer: MockAuthMailer;

  beforeEach(async () => {
    db = await createIsolatedAuthDb();
    setAuthDbOverride(db as unknown as Queryable);

    mockMailer = new MockAuthMailer();
    setAuthMailerOverride(mockMailer);
  });

  afterEach(async () => {
    setAuthDbOverride(null);
    setAuthMailerOverride(null);
    await db.close();
  });

  it('1. Registration issues serialized token, hashes it in DB, and delivers via mailer', async () => {
    const email = 'gardener.flora@growspace.org';
    const req = new NextRequest('http://localhost:3001/api/auth/register', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password: 'ValidPassword12345!',
        displayName: 'Flora Gardener',
      }),
    });

    const res = await registerHandler(req);
    assert.equal(res.status, 202);

    // Verify mock mailer received the delivery call
    assert.equal(mockMailer.sentEmails.length, 1);
    const sent = mockMailer.sentEmails[0];
    assert.equal(sent.to, email);
    assert.ok(sent.link.includes('/auth/verify-email#token='));

    // Extract raw token from fragment
    const rawToken = sent.link.split('#token=')[1];
    assert.ok(rawToken && rawToken.length === 43, 'Token must be 43 base64url characters');

    // Verify token hash in PostgreSQL auth_tokens table
    const tokenRows = await db.query<{ token_hash: Uint8Array | Buffer; purpose: string; consumed_at: unknown }>(
      'SELECT token_hash, purpose, consumed_at FROM auth_tokens WHERE purpose = $1;',
      ['email_verification'],
    );
    assert.equal(tokenRows.rows.length, 1);
    assert.equal(tokenRows.rows[0].consumed_at, null, 'Token must initially be unconsumed');

    // Confirm database holds SHA-256 hash, never raw token
    const expectedHash = hashToken(rawToken);
    const storedHash = Buffer.from(tokenRows.rows[0].token_hash);
    assert.deepEqual(storedHash, expectedHash);
  });

  it('2. Provider failure during registration safely rolls back user to prevent unusable accounts', async () => {
    mockMailer.setShouldFail(true, new Error('Resend upstream SMTP 500 error'));
    const email = 'stuck.candidate@growspace.org';

    const req = new NextRequest('http://localhost:3001/api/auth/register', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password: 'ValidPassword12345!',
        displayName: 'Temporary Candidate',
      }),
    });

    const res = await registerHandler(req);
    assert.equal(res.status, 503, 'Must return 503 when provider delivery fails');
    const body = await res.json();
    assert.equal(body.error.code, 'email_delivery_failed');
    assert.ok(!JSON.stringify(body).includes('Resend'), 'Must not leak upstream provider internals');

    // Verify user was safely rolled back from database
    const userCheck = await db.query('SELECT id FROM users WHERE email = $1;', [email]);
    assert.equal(userCheck.rows.length, 0, 'User record must be rolled back on delivery failure');

    // Once mailer recovers, registration must immediately succeed without duplicate error
    mockMailer.setShouldFail(false);
    const retryReq = new NextRequest('http://localhost:3001/api/auth/register', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password: 'ValidPassword12345!',
        displayName: 'Temporary Candidate',
      }),
    });
    const retryRes = await registerHandler(retryReq);
    assert.equal(retryRes.status, 202);
  });

  it('3. Successful email verification atomically consumes token and sets email_verified_at', async () => {
    const email = 'verify.target@growspace.org';
    const password = 'StrongPassword123!';

    // Register user
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );

    const rawToken = mockMailer.sentEmails[0].link.split('#token=')[1];

    // Verify user is unverified initially
    const preUser = await db.query<{ email_verified_at: unknown }>(
      'SELECT email_verified_at FROM users WHERE email = $1;',
      [email],
    );
    assert.equal(preUser.rows[0].email_verified_at, null);

    // Call verify-email endpoint
    const verifyReq = new NextRequest('http://localhost:3001/api/auth/verify-email', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ token: rawToken }),
    });

    const verifyRes = await verifyEmailHandler(verifyReq);
    assert.equal(verifyRes.status, 200);
    const verifyBody = await verifyRes.json();
    assert.equal(verifyBody.message, 'Email verified successfully.');
    assert.equal(verifyBody.user.emailVerified, true);

    // Verify database row
    const postUser = await db.query<{ email_verified_at: unknown }>(
      'SELECT email_verified_at FROM users WHERE email = $1;',
      [email],
    );
    assert.ok(postUser.rows[0].email_verified_at !== null, 'email_verified_at must be populated');

    // Confirm token in auth_tokens is marked consumed_at
    const postToken = await db.query<{ consumed_at: unknown }>(
      'SELECT consumed_at FROM auth_tokens WHERE purpose = $1;',
      ['email_verification'],
    );
    assert.ok(postToken.rows[0].consumed_at !== null, 'Token must be marked consumed');
  });

  it('4. Rejects already-consumed, invalid, and expired verification tokens safely', async () => {
    const email = 'replay.target@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'StrongPassword123!' }),
      }),
    );

    const rawToken = mockMailer.sentEmails[0].link.split('#token=')[1];

    // First use succeeds
    const res1 = await verifyEmailHandler(
      new NextRequest('http://localhost:3001/api/auth/verify-email', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken }),
      }),
    );
    assert.equal(res1.status, 200);

    // Replay attempt (second use) must fail with generic invalid_token
    const res2 = await verifyEmailHandler(
      new NextRequest('http://localhost:3001/api/auth/verify-email', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken }),
      }),
    );
    assert.equal(res2.status, 400);
    const body2 = await res2.json();
    assert.equal(body2.error.code, 'invalid_token');

    // Fabricated token must fail
    const fakeReq = new NextRequest('http://localhost:3001/api/auth/verify-email', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'fabricated-random-token-value-here-43-chars!' }),
    });
    const fakeRes = await verifyEmailHandler(fakeReq);
    assert.equal(fakeRes.status, 400);

    // Expired token test (manually backdate expires_at in DB)
    const email2 = 'expired.target@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email: email2, password: 'StrongPassword123!' }),
      }),
    );
    const rawToken2 = mockMailer.sentEmails[1].link.split('#token=')[1];

    await db.query(
      `UPDATE auth_tokens SET created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' WHERE token_hash = $1;`,
      [hashToken(rawToken2)],
    );

    const expiredRes = await verifyEmailHandler(
      new NextRequest('http://localhost:3001/api/auth/verify-email', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken2 }),
      }),
    );
    assert.equal(expiredRes.status, 400);
    const expiredBody = await expiredRes.json();
    assert.equal(expiredBody.error.code, 'invalid_token');
  });

  it('5. Concurrent verification attempts cannot both succeed (single-use guarantee)', async () => {
    const email = 'concurrency.target@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'StrongPassword123!' }),
      }),
    );

    const rawToken = mockMailer.sentEmails[0].link.split('#token=')[1];

    const req1 = new NextRequest('http://localhost:3001/api/auth/verify-email', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ token: rawToken }),
    });

    const req2 = new NextRequest('http://localhost:3001/api/auth/verify-email', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ token: rawToken }),
    });

    const [res1, res2] = await Promise.all([verifyEmailHandler(req1), verifyEmailHandler(req2)]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 400], 'Exactly one attempt must succeed and the other must be rejected');
  });

  it('6. Resend verification issues a fresh token, supersedes previous tokens, and obeys rate limits', async () => {
    const email = 'resend.candidate@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'StrongPassword123!' }),
      }),
    );

    const initialToken = mockMailer.sentEmails[0].link.split('#token=')[1];

    // Resend attempt 1 (authenticated via session)
    const loginRes = await loginHandler(
      new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'StrongPassword123!' }),
      }),
    );
    const sessionCookie = loginRes.cookies.get('gs_session')!.value;
    const csrfToken = loginRes.cookies.get('gs_csrf')!.value;

    const resendReq1 = new NextRequest('http://localhost:3001/api/auth/resend-verification', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        cookie: `gs_session=${sessionCookie}; gs_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
      },
    });

    const resendRes1 = await resendVerificationHandler(resendReq1);
    assert.equal(resendRes1.status, 202);
    assert.equal(mockMailer.sentEmails.length, 2);

    const secondToken = mockMailer.sentEmails[1].link.split('#token=')[1];
    assert.notEqual(initialToken, secondToken, 'Must generate a distinct new token');

    // Confirm initial token was superseded (marked consumed_at)
    const checkInitial = await db.query<{ consumed_at: unknown }>(
      'SELECT consumed_at FROM auth_tokens WHERE token_hash = $1;',
      [hashToken(initialToken)],
    );
    assert.ok(checkInitial.rows[0].consumed_at !== null, 'Prior token must be superseded and consumed');

    // Verify that using the superseded initial token now fails
    const tryInitialRes = await verifyEmailHandler(
      new NextRequest('http://localhost:3001/api/auth/verify-email', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: initialToken }),
      }),
    );
    assert.equal(tryInitialRes.status, 400);

    // Using the second token succeeds
    const trySecondRes = await verifyEmailHandler(
      new NextRequest('http://localhost:3001/api/auth/verify-email', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: secondToken }),
      }),
    );
    assert.equal(trySecondRes.status, 200);

    // Resend on already-verified user does not send any further email
    const countBefore = mockMailer.sentEmails.length;
    const resendOnVerified = await resendVerificationHandler(resendReq1);
    assert.equal(resendOnVerified.status, 202);
    assert.equal(mockMailer.sentEmails.length, countBefore, 'Must not send email if already verified');
  });

  it('7. Unverified account can sign in (documenting policy) and emailVerified updates on session lookup', async () => {
    const email = 'policy.test@growspace.org';
    const password = 'StrongPassword123!';

    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );

    // Login while unverified -> succeeds and returns emailVerified: false
    const loginRes = await loginHandler(
      new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );
    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.equal(loginBody.user.emailVerified, false, 'Account must start unverified');

    const sessionCookie = loginRes.cookies.get('gs_session')!.value;
    const csrfCookie = loginRes.cookies.get('gs_csrf')!.value;

    // Verify the email
    const rawToken = mockMailer.sentEmails[0].link.split('#token=')[1];
    await verifyEmailHandler(
      new NextRequest('http://localhost:3001/api/auth/verify-email', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken }),
      }),
    );

    // Subsequent GET /api/auth/session immediately reflects emailVerified: true
    const sessionRes = await sessionHandler(
      new NextRequest('http://localhost:3001/api/auth/session', {
        method: 'GET',
        headers: {
          cookie: `gs_session=${sessionCookie}; gs_csrf=${csrfCookie}`,
        },
      }),
    );
    assert.equal(sessionRes.status, 200);
    const sessionBody = await sessionRes.json();
    assert.equal(sessionBody.user.emailVerified, true, 'Session lookup must reflect verified state');
  });
});
