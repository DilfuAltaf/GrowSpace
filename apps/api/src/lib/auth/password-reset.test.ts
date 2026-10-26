import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { PGlite } from '@electric-sql/pglite';
import {
  buildPasswordResetUrl,
  hashToken,
  MockAuthMailer,
  setAuthDbOverride,
  setAuthMailerOverride,
  type Queryable,
} from '@/lib/auth/index';
import { POST as registerHandler } from '@/app/api/auth/register/route';
import { POST as loginHandler } from '@/app/api/auth/login/route';
import { POST as forgotPasswordHandler } from '@/app/api/auth/forgot-password/route';
import { POST as resetPasswordHandler } from '@/app/api/auth/reset-password/route';
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
// PART 1: UNIT TESTS (URL SANITIZATION, FRAGMENT TOKENS & MAILER MOCK)
// ============================================================================

describe('Password Reset: Unit Security Rules', () => {
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

  it('constructs trusted password reset URLs using canonical APP_ORIGIN and fragment tokens', () => {
    process.env.APP_ORIGIN = 'https://growspace.app';
    const rawToken = 'TestResetToken1234567890abcdefghijklmnopqrstuvwxyz';
    const url = buildPasswordResetUrl(rawToken);

    assert.equal(
      url,
      `https://growspace.app/auth/reset-password#token=${encodeURIComponent(rawToken)}`,
    );
    assert.ok(url.includes('#token='), 'Token must be in fragment to protect against Referer and log leakage');
  });

  it('mock mailer records sent reset emails and simulates failures reliably', async () => {
    const mockMailer = new MockAuthMailer();
    assert.equal(mockMailer.sentEmails.length, 0);

    await mockMailer.sendPasswordReset('user@test.org', 'https://app/reset#token=abc');
    assert.equal(mockMailer.sentEmails.length, 1);
    assert.equal(mockMailer.sentEmails[0].to, 'user@test.org');
    assert.equal(mockMailer.sentEmails[0].type, 'password_reset');
    assert.equal(mockMailer.sentEmails[0].link, 'https://app/reset#token=abc');

    mockMailer.setShouldFail(true, new Error('Simulated upstream failure'));
    await assert.rejects(
      async () => mockMailer.sendPasswordReset('fail@test.org', 'https://app/reset#token=xyz'),
      /Simulated upstream failure/,
    );
  });
});

// ============================================================================
// PART 2: REAL POSTGRESQL INTEGRATION SUITE (PGLITE)
// ============================================================================

describe('Password Reset: Real PostgreSQL Integration Suite (PGlite)', () => {
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
    if (db) {
      await db.close();
    }
  });

  it('1. Existing and nonexistent email addresses receive indistinguishable public responses (202 Accepted)', async () => {
    // 1A. Register an existing user
    const existingEmail = 'alice.member@growspace.org';
    const regRes = await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email: existingEmail, password: 'OldPassword123!' }),
      }),
    );
    assert.equal(regRes.status, 202);

    // 1B. Forgot-password request for existing user
    const resExisting = await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email: existingEmail }),
      }),
    );

    // 1C. Forgot-password request for nonexistent user
    const resNonexistent = await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ghost.nobody@growspace.org' }),
      }),
    );

    assert.equal(resExisting.status, 202);
    assert.equal(resNonexistent.status, 202);

    const bodyExisting = await resExisting.json();
    const bodyNonexistent = await resNonexistent.json();

    assert.deepEqual(bodyExisting, bodyNonexistent);
    assert.equal(
      bodyExisting.message,
      'If an account matching that email exists, a password reset link has been sent.',
    );
  });

  it('2. Reset email delivery succeeds through mock provider and stores only token hash (never plaintext)', async () => {
    const email = 'bob.gardener@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'InitialPassword123!' }),
      }),
    );

    // Forgot password request
    const forgotRes = await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );
    assert.equal(forgotRes.status, 202);

    // Mailer should have received 1 verification email (from register) and 1 reset email (from forgot-password)
    assert.equal(mockMailer.sentEmails.length, 2);
    const resetEmail = mockMailer.sentEmails[1];
    assert.equal(resetEmail.to, email);
    assert.equal(resetEmail.type, 'password_reset');
    assert.ok(resetEmail.link.includes('/auth/reset-password#token='));

    const rawToken = resetEmail.link.split('#token=')[1];
    assert.ok(rawToken && rawToken.length >= 32);

    // Verify DB stores only the SHA-256 hash, NEVER plaintext token
    const tokenQuery = await db.query<{ token_hash: Uint8Array; purpose: string }>(
      `SELECT token_hash, purpose FROM auth_tokens WHERE purpose = 'password_reset';`,
    );
    assert.equal(tokenQuery.rows.length, 1);
    assert.equal(tokenQuery.rows[0].purpose, 'password_reset');

    const expectedHash = hashToken(rawToken);
    assert.deepEqual(Buffer.from(tokenQuery.rows[0].token_hash), expectedHash);

    // Verify plaintext token does NOT exist anywhere in database
    const textSearch = await db.query(
      `SELECT * FROM auth_tokens WHERE token_hash::text LIKE '%' || $1 || '%';`,
      [rawToken],
    );
    assert.equal(textSearch.rows.length, 0);
  });

  it('3. Email provider failure during forgot-password does not leak account existence (returns 202)', async () => {
    const email = 'provider.fail@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'ValidPassword123!' }),
      }),
    );

    // Configure mailer to fail
    mockMailer.setShouldFail(true, new Error('Simulated Resend API 500 Network Outage'));

    const forgotRes = await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );

    // Status MUST remain 202 to avoid leaking account existence to attackers
    assert.equal(forgotRes.status, 202);
    const body = await forgotRes.json();
    assert.equal(
      body.message,
      'If an account matching that email exists, a password reset link has been sent.',
    );
  });

  it('3B. Existing reset token remains valid and usable when subsequent email delivery fails', async () => {
    const email = 'resilient.token@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'InitialPass123!' }),
      }),
    );

    // 1. First reset request succeeds
    const forgotRes1 = await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );
    assert.equal(forgotRes1.status, 202);
    const token1 = mockMailer.sentEmails[1].link.split('#token=')[1];

    // 2. Second reset request encounters provider failure
    mockMailer.setShouldFail(true, new Error('Temporary mail provider timeout'));
    const forgotRes2 = await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );
    assert.equal(forgotRes2.status, 202);

    // 3. Verify token1 was NOT invalidated by the failed attempt and can still reset the password
    const resetRes = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: token1, password: 'BrandNewResilientPass123!' }),
      }),
    );
    assert.equal(resetRes.status, 200);

    // 4. Verify login with the newly set password succeeds
    const loginRes = await loginHandler(
      new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'BrandNewResilientPass123!' }),
      }),
    );
    assert.equal(loginRes.status, 200);

    // 5. Verify the undelivered token was deleted and only the consumed token1 remains
    const remainingTokens = await db.query<{ id: string; consumed_at: string | null }>(
      `SELECT id, consumed_at FROM auth_tokens WHERE purpose = 'password_reset';`,
    );
    assert.equal(remainingTokens.rows.length, 1);
    assert.ok(remainingTokens.rows[0].consumed_at, 'Token1 is now consumed');
  });

  it('4. A valid reset token updates the password successfully and marks email verified', async () => {
    const email = 'reset.success@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'OldSecretPassword123!' }),
      }),
    );

    // Request reset
    await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );

    const resetEmail = mockMailer.sentEmails[1];
    const rawToken = resetEmail.link.split('#token=')[1];

    // Submit reset with new password
    const resetRes = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'NewBrandPassword456!' }),
      }),
    );

    assert.equal(resetRes.status, 200);
    const body = await resetRes.json();
    assert.equal(
      body.message,
      'Password has been reset successfully. Please sign in with your new password.',
    );

    // Check DB: token is consumed, password_hash updated, and email_verified_at populated
    const tokenRecord = await db.query<{ consumed_at: string }>(
      `SELECT consumed_at FROM auth_tokens WHERE purpose = 'password_reset';`,
    );
    assert.ok(tokenRecord.rows[0].consumed_at, 'Token must be marked consumed');

    const userRecord = await db.query<{ password_hash: string; email_verified_at: string }>(
      `SELECT password_hash, email_verified_at FROM users WHERE email = $1;`,
      [email],
    );
    assert.ok(userRecord.rows[0].password_hash.startsWith('$argon2id$'));
    assert.ok(userRecord.rows[0].email_verified_at, 'Password reset must confirm email verification');
  });

  it('5. The old password no longer authenticates after a successful reset, and new password authenticates', async () => {
    const email = 'password.switch@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'OriginalPassword123!' }),
      }),
    );

    // Verify initial login works
    const loginInitial = await loginHandler(
      new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'OriginalPassword123!' }),
      }),
    );
    assert.equal(loginInitial.status, 200);

    // Trigger reset
    await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );
    const rawToken = mockMailer.sentEmails[1].link.split('#token=')[1];

    // Reset password
    await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'CompletelyNewPassword789!' }),
      }),
    );

    // Attempt login with OLD password -> MUST FAIL
    const loginOld = await loginHandler(
      new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'OriginalPassword123!' }),
      }),
    );
    assert.equal(loginOld.status, 401);

    // Attempt login with NEW password -> MUST SUCCEED
    const loginNew = await loginHandler(
      new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'CompletelyNewPassword789!' }),
      }),
    );
    assert.equal(loginNew.status, 200);
  });

  it('6. All relevant existing first-party sessions are revoked upon successful password reset', async () => {
    const email = 'session.revocation@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'ActiveSessionPass123!' }),
      }),
    );

    // Create 2 active sessions (e.g. phone and laptop)
    const login1 = await loginHandler(
      new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'ActiveSessionPass123!' }),
      }),
    );
    const cookieHeader1 = login1.headers.get('set-cookie')!;
    const sessionCookie1 = cookieHeader1.split(';')[0]; // gs_session=...

    const login2 = await loginHandler(
      new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'ActiveSessionPass123!' }),
      }),
    );
    const cookieHeader2 = login2.headers.get('set-cookie')!;
    const sessionCookie2 = cookieHeader2.split(';')[0];

    // Verify session 1 works
    const check1Before = await sessionHandler(
      new NextRequest('http://localhost:3001/api/auth/session', {
        headers: { cookie: sessionCookie1 },
      }),
    );
    assert.equal(check1Before.status, 200);

    // Request & perform password reset
    await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );
    const rawToken = mockMailer.sentEmails[1].link.split('#token=')[1];

    const resetRes = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', cookie: sessionCookie1 },
        body: JSON.stringify({ token: rawToken, password: 'NewSecurePassword999!' }),
      }),
    );
    assert.equal(resetRes.status, 200);

    // Verify both existing sessions are now REVOKED and rejected with 401
    const check1After = await sessionHandler(
      new NextRequest('http://localhost:3001/api/auth/session', {
        headers: { cookie: sessionCookie1 },
      }),
    );
    assert.equal(check1After.status, 401);

    const check2After = await sessionHandler(
      new NextRequest('http://localhost:3001/api/auth/session', {
        headers: { cookie: sessionCookie2 },
      }),
    );
    assert.equal(check2After.status, 401);

    // Verify sessions table in DB has revoked_at set on all rows for this user
    const dbSessions = await db.query<{ revoked_at: string | null }>(
      `SELECT s.revoked_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1;`,
      [email],
    );
    assert.equal(dbSessions.rows.length, 2);
    assert.ok(dbSessions.rows[0].revoked_at !== null);
    assert.ok(dbSessions.rows[1].revoked_at !== null);
  });

  it('7. Invalid, expired, wrong-purpose, and already-consumed tokens are rejected with 400 invalid_token', async () => {
    // 7A. Completely invalid token
    const invalidRes = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'completely-bogus-token-random-value-xyz', password: 'ValidNewPassword123!' }),
      }),
    );
    assert.equal(invalidRes.status, 400);
    const invalidBody = await invalidRes.json();
    assert.equal(invalidBody.error.code, 'invalid_token');

    // 7B. Setup user with verification and reset tokens
    const email = 'token.testing@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'InitPassword123!' }),
      }),
    );
    const verificationRawToken = mockMailer.sentEmails[0].link.split('#token=')[1];

    // Try resetting password with a verification token (wrong purpose)
    const wrongPurposeRes = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: verificationRawToken, password: 'ValidNewPassword123!' }),
      }),
    );
    assert.equal(wrongPurposeRes.status, 400);
    const wrongPurposeBody = await wrongPurposeRes.json();
    assert.equal(wrongPurposeBody.error.code, 'invalid_token');

    // 7C. Expired token
    await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );
    const resetRawToken = mockMailer.sentEmails[1].link.split('#token=')[1];

    // Backdate expires_at and created_at in DB
    await db.query(
      `UPDATE auth_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE token_hash = $1;`,
      [hashToken(resetRawToken)],
    );

    const expiredRes = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: resetRawToken, password: 'ValidNewPassword123!' }),
      }),
    );
    assert.equal(expiredRes.status, 400);
    const expiredBody = await expiredRes.json();
    assert.equal(expiredBody.error.code, 'invalid_token');

    // 7D. Security Audit Check: Confirm failed reset attempts DO NOT alter the user's password or revoke sessions
    // Initial login should still work with the original password
    const loginStillWorks = await loginHandler(
      new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'InitPassword123!' }),
      }),
    );
    assert.equal(loginStillWorks.status, 200, 'Original password must remain functional after failed reset attempts');
    const sessionCookie = loginStillWorks.headers.get('set-cookie')!.split(';')[0];

    // Session must remain active
    const sessionRes = await sessionHandler(
      new NextRequest('http://localhost:3001/api/auth/session', {
        headers: { cookie: sessionCookie },
      }),
    );
    assert.equal(sessionRes.status, 200, 'User session must remain valid after failed reset attempts');
  });

  it('8. A reset token cannot be consumed successfully twice (single-use guarantee)', async () => {
    const email = 'single.use@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'InitialPassword123!' }),
      }),
    );

    await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );
    const rawToken = mockMailer.sentEmails[1].link.split('#token=')[1];

    // First reset -> 200 OK
    const firstRes = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'UpdatedPass12345!' }),
      }),
    );
    assert.equal(firstRes.status, 200);

    // Second reset with SAME token -> 400 invalid_token
    const secondRes = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'AnotherPass67890!' }),
      }),
    );
    assert.equal(secondRes.status, 400);
    const secondBody = await secondRes.json();
    assert.equal(secondBody.error.code, 'invalid_token');
  });

  it('9. Concurrent reset attempts cannot both succeed (concurrency safety)', async () => {
    const email = 'concurrent.reset@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'FirstPassword123!' }),
      }),
    );

    await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );
    const rawToken = mockMailer.sentEmails[1].link.split('#token=')[1];

    // Fire 2 concurrent requests at the exact same millisecond with different client IPs to avoid IP rate limit
    const [resA, resB] = await Promise.all([
      resetPasswordHandler(
        new NextRequest('http://localhost:3001/api/auth/reset-password', {
          method: 'POST',
          headers: {
            origin: 'http://localhost:5173',
            'content-type': 'application/json',
            'x-forwarded-for': '198.51.100.1',
          },
          body: JSON.stringify({ token: rawToken, password: 'ConcurrentPassA123!' }),
        }),
      ),
      resetPasswordHandler(
        new NextRequest('http://localhost:3001/api/auth/reset-password', {
          method: 'POST',
          headers: {
            origin: 'http://localhost:5173',
            'content-type': 'application/json',
            'x-forwarded-for': '198.51.100.2',
          },
          body: JSON.stringify({ token: rawToken, password: 'ConcurrentPassB456!' }),
        }),
      ),
    ]);

    const statuses = [resA.status, resB.status];
    assert.ok(statuses.includes(200), 'Exactly one reset attempt must succeed');
    assert.ok(statuses.includes(400), 'Concurrent reset attempt must be rejected');

    // Concurrency Security Verification: Ensure the winner's password is the ONLY valid password
    const winningPass = resA.status === 200 ? 'ConcurrentPassA123!' : 'ConcurrentPassB456!';
    const losingPass = resA.status === 200 ? 'ConcurrentPassB456!' : 'ConcurrentPassA123!';

    const winningLogin = await loginHandler(
      new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: winningPass }),
      }),
    );
    assert.equal(winningLogin.status, 200, 'Winning concurrent password must authenticate');

    const losingLogin = await loginHandler(
      new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: losingPass }),
      }),
    );
    assert.equal(losingLogin.status, 401, 'Losing concurrent password must NOT authenticate');
  });

  it('10. Rate limits apply to forgot-password and are not bypassed by provider errors', async () => {
    const email = 'rate.limited.user@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'TargetPassword123!' }),
      }),
    );

    // Simulate persistent mail provider failure to prove provider errors do NOT bypass rate limiting
    mockMailer.setShouldFail(true, new Error('Simulated upstream outage'));

    // Account limit is 3 attempts per 15 min. Let's make 3 requests:
    for (let i = 0; i < 3; i++) {
      const res = await forgotPasswordHandler(
        new NextRequest('http://localhost:3001/api/auth/forgot-password', {
          method: 'POST',
          headers: {
            origin: 'http://localhost:5173',
            'content-type': 'application/json',
            'x-forwarded-for': `203.0.113.${i + 1}`, // different IPs so account limit is tested
          },
          body: JSON.stringify({ email }),
        }),
      );
      assert.equal(res.status, 202);
    }

    // 4th request -> 429 Rate limited on account even while provider is failing!
    const throttledRes = await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.99',
        },
        body: JSON.stringify({ email }),
      }),
    );
    assert.equal(throttledRes.status, 429);
    assert.ok(throttledRes.headers.get('Retry-After'));
    const throttledBody = await throttledRes.json();
    assert.equal(throttledBody.error.code, 'rate_limited');
  });

  it('11. Plaintext passwords and reset tokens are never persisted in the database', async () => {
    const email = 'crypt.inspector@growspace.org';
    const originalPassword = 'InitialPlaintextPassword123!';
    const resetPassword = 'NewPlaintextPassword456!';

    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: originalPassword }),
      }),
    );

    await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );

    const rawToken = mockMailer.sentEmails[1].link.split('#token=')[1];

    await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: resetPassword }),
      }),
    );

    // Scan database tables for raw plaintext passwords and tokens
    const userRow = await db.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE email = $1;`,
      [email],
    );
    assert.notEqual(userRow.rows[0].password_hash, originalPassword);
    assert.notEqual(userRow.rows[0].password_hash, resetPassword);
    assert.ok(userRow.rows[0].password_hash.startsWith('$argon2id$'));

    // Scan auth_tokens table
    const tokenRow = await db.query<{ token_hash: Uint8Array }>(
      `SELECT token_hash FROM auth_tokens WHERE purpose = 'password_reset';`,
    );
    assert.notEqual(Buffer.from(tokenRow.rows[0].token_hash).toString('utf8'), rawToken);
    assert.equal(tokenRow.rows[0].token_hash.length, 32);
  });
});
