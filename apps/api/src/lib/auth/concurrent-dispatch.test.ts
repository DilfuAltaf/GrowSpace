import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { PGlite } from '@electric-sql/pglite';
import {
  MockAuthMailer,
  hashToken,
  insertAuthToken,
  supersedeOtherAuthTokens,
  setAuthDbOverride,
  setAuthMailerOverride,
  type Queryable,
} from '@/lib/auth/index';
import { POST as registerHandler } from '@/app/api/auth/register/route';
import { POST as loginHandler } from '@/app/api/auth/login/route';
import { POST as forgotPasswordHandler } from '@/app/api/auth/forgot-password/route';
import { POST as resetPasswordHandler } from '@/app/api/auth/reset-password/route';
import { POST as resendVerificationHandler } from '@/app/api/auth/resend-verification/route';
import { POST as verifyEmailHandler } from '@/app/api/auth/verify-email/route';

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

describe('Concurrent Token Dispatch & Interleaving Suite (Deterministic Barriers)', () => {
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

  it('1. Two simultaneous forgot-password requests: slower dispatch does not kill newer token', async () => {
    const email = 'concurrent.forgot@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'InitPassword123!' }),
      }),
    );

    // Setup deterministic barrier:
    // Request 1 will pause inside onBeforeSendPasswordReset until released.
    let releaseReq1: () => void;
    const req1PausedPromise = new Promise<void>((resolve) => {
      let firstCall = true;
      mockMailer.onBeforeSendPasswordReset = async () => {
        if (firstCall) {
          firstCall = false;
          await new Promise<void>((r) => {
            releaseReq1 = r;
            resolve(); // notify test that Req 1 is paused
          });
        }
      };
    });

    // Start Request 1 (will pause inside mailer)
    const req1Promise = forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json',
          'x-forwarded-for': '198.51.100.1',
        },
        body: JSON.stringify({ email }),
      }),
    );

    // Wait until Request 1 is paused in mailer
    await req1PausedPromise;

    // Start Request 2 (runs and completes while Request 1 is still in flight)
    const req2Res = await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json',
          'x-forwarded-for': '198.51.100.2',
        },
        body: JSON.stringify({ email }),
      }),
    );
    assert.equal(req2Res.status, 202);

    // Now release Request 1 so it completes its dispatch and superseding logic
    releaseReq1!();
    const req1Res = await req1Promise;
    assert.equal(req1Res.status, 202);

    // Verify 2 emails were sent (from forgot-password; plus 1 from register = 3 total).
    // Note: Request 2 completed sending first while Request 1 was paused,
    // so sentEmails[1] is the newer token from Request 2, and sentEmails[2] is from Request 1.
    assert.equal(mockMailer.sentEmails.length, 3);
    const tokenFromReq2 = mockMailer.sentEmails[1].link.split('#token=')[1];
    const tokenFromReq1 = mockMailer.sentEmails[2].link.split('#token=')[1];

    // Inspect auth_tokens table in DB:
    // Exactly 1 reset token must be active (consumed_at IS NULL), and it must be the newer token from Request 2!
    const activeTokens = await db.query<{ id: string; token_hash: Uint8Array }>(
      `SELECT id, token_hash FROM auth_tokens WHERE purpose = 'password_reset' AND consumed_at IS NULL;`,
    );
    assert.equal(activeTokens.rows.length, 1, 'Concurrent requests must leave exactly 1 active token');

    // Newer token (from Request 2) must be valid and reset the password successfully
    const resetResNew = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: tokenFromReq2, password: 'NewPasswordFromReq2!' }),
      }),
    );
    assert.equal(resetResNew.status, 200, 'Newer token from Request 2 must reset password successfully');

    // Older token (from Request 1) was superseded, so attempting to use it must fail with 400
    const resetResOld = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: tokenFromReq1, password: 'ShouldFailPassword!' }),
      }),
    );
    assert.equal(resetResOld.status, 400, 'Older token from Request 1 was superseded and must be rejected');
  });

  it('2. Two simultaneous resend-verification requests: slower dispatch does not kill newer token', async () => {
    const email = 'concurrent.verify@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'InitPassword123!' }),
      }),
    );

    // Setup barrier for verification dispatch
    let releaseReq1: () => void;
    const req1PausedPromise = new Promise<void>((resolve) => {
      let firstCall = true;
      mockMailer.onBeforeSendVerification = async () => {
        if (firstCall) {
          firstCall = false;
          await new Promise<void>((r) => {
            releaseReq1 = r;
            resolve();
          });
        }
      };
    });

    // Start Request 1
    const req1Promise = resendVerificationHandler(
      new NextRequest('http://localhost:3001/api/auth/resend-verification', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json',
          'x-forwarded-for': '198.51.100.3',
        },
        body: JSON.stringify({ email }),
      }),
    );

    await req1PausedPromise;

    // Start Request 2 while Request 1 is paused
    const req2Res = await resendVerificationHandler(
      new NextRequest('http://localhost:3001/api/auth/resend-verification', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json',
          'x-forwarded-for': '198.51.100.4',
        },
        body: JSON.stringify({ email }),
      }),
    );
    assert.equal(req2Res.status, 202);

    // Release Request 1
    releaseReq1!();
    const req1Res = await req1Promise;
    assert.equal(req1Res.status, 202);

    // Total verification emails: 1 from register + 2 from resends = 3.
    // Request 2 sent its email first (sentEmails[1]) with the newer token.
    // Request 1 sent its email second (sentEmails[2]) with the older token.
    assert.equal(mockMailer.sentEmails.length, 3);
    const verifyTokenFromReq2 = mockMailer.sentEmails[1].link.split('#token=')[1];
    const verifyTokenFromReq1 = mockMailer.sentEmails[2].link.split('#token=')[1];

    // Check DB: exactly 1 active verification token
    const activeTokens = await db.query(
      `SELECT id FROM auth_tokens WHERE purpose = 'email_verification' AND consumed_at IS NULL;`,
    );
    assert.equal(activeTokens.rows.length, 1);

    // Newer token from Request 2 successfully verifies email
    const verifyResNew = await verifyEmailHandler(
      new NextRequest('http://localhost:3001/api/auth/verify-email', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: verifyTokenFromReq2 }),
      }),
    );
    assert.equal(verifyResNew.status, 200);

    // Older token from Request 1 was superseded and fails
    const verifyResOld = await verifyEmailHandler(
      new NextRequest('http://localhost:3001/api/auth/verify-email', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: verifyTokenFromReq1 }),
      }),
    );
    assert.equal(verifyResOld.status, 400);
  });

  it('3. One email dispatch succeeds while another fails concurrently', async () => {
    const email = 'split.dispatch@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'InitPassword123!' }),
      }),
    );

    // First call will succeed, second call will fail
    let callCount = 0;
    mockMailer.onBeforeSendPasswordReset = async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error('Upstream mailer simulated 500 error on call 2');
      }
    };

    const [resA, resB] = await Promise.all([
      forgotPasswordHandler(
        new NextRequest('http://localhost:3001/api/auth/forgot-password', {
          method: 'POST',
          headers: {
            origin: 'http://localhost:5173',
            'content-type': 'application/json',
            'x-forwarded-for': '198.51.100.5',
          },
          body: JSON.stringify({ email }),
        }),
      ),
      forgotPasswordHandler(
        new NextRequest('http://localhost:3001/api/auth/forgot-password', {
          method: 'POST',
          headers: {
            origin: 'http://localhost:5173',
            'content-type': 'application/json',
            'x-forwarded-for': '198.51.100.6',
          },
          body: JSON.stringify({ email }),
        }),
      ),
    ]);

    // Both return 202 to the public (enumeration resistance)
    assert.equal(resA.status, 202);
    assert.equal(resB.status, 202);

    // Database must retain exactly 1 valid active reset token (the one that succeeded)
    const activeTokens = await db.query(
      `SELECT id FROM auth_tokens WHERE purpose = 'password_reset' AND consumed_at IS NULL;`,
    );
    assert.equal(activeTokens.rows.length, 1);

    // The single reset email that succeeded can be consumed
    const sentResetEmail = mockMailer.sentEmails.find((e) => e.type === 'password_reset')!;
    assert.ok(sentResetEmail);
    const token = sentResetEmail.link.split('#token=')[1];

    const resetRes = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token, password: 'SucceededResetPass123!' }),
      }),
    );
    assert.equal(resetRes.status, 200);
  });

  it('4. A failed dispatch must not delete or invalidate another request\'s successfully delivered token', async () => {
    const email = 'protection.target@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'InitPassword123!' }),
      }),
    );

    // Request 1 delivers token 1 successfully
    const res1 = await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );
    assert.equal(res1.status, 202);
    const token1 = mockMailer.sentEmails[1].link.split('#token=')[1];

    // Now Request 2 is triggered, but provider fails
    mockMailer.setShouldFail(true, new Error('Simulated network timeout'));
    const res2 = await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );
    assert.equal(res2.status, 202);

    // Token 1 was NOT deleted and was NOT marked consumed by Request 2's failure
    const token1Record = await db.query<{ consumed_at: string | null }>(
      `SELECT consumed_at FROM auth_tokens WHERE purpose = 'password_reset' AND consumed_at IS NULL;`,
    );
    assert.equal(token1Record.rows.length, 1);
    assert.equal(token1Record.rows[0].consumed_at, null);

    // Token 1 can still be used to reset password
    const resetRes = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: token1, password: 'NewProtectedPass123!' }),
      }),
    );
    assert.equal(resetRes.status, 200);
  });

  it('5. Concurrent requests must not leave an unexpected number of usable tokens for the same purpose', async () => {
    const email = 'token.count@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'InitPassword123!' }),
      }),
    );

    // Fire 3 simultaneous forgot-password requests (within rate limit of 3/15m)
    await Promise.all([
      forgotPasswordHandler(
        new NextRequest('http://localhost:3001/api/auth/forgot-password', {
          method: 'POST',
          headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
          body: JSON.stringify({ email }),
        }),
      ),
      forgotPasswordHandler(
        new NextRequest('http://localhost:3001/api/auth/forgot-password', {
          method: 'POST',
          headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.2' },
          body: JSON.stringify({ email }),
        }),
      ),
      forgotPasswordHandler(
        new NextRequest('http://localhost:3001/api/auth/forgot-password', {
          method: 'POST',
          headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.3' },
          body: JSON.stringify({ email }),
        }),
      ),
    ]);

    // Inspect active tokens in DB
    const active = await db.query(
      `SELECT id FROM auth_tokens WHERE purpose = 'password_reset' AND consumed_at IS NULL;`,
    );
    // MUST leave exactly 1 active token (the latest delivered one)
    assert.equal(active.rows.length, 1, 'Must leave at most 1 active unconsumed token for password_reset');
  });

  it('6. Rate limits remain strictly effective under concurrent bursts without leaking account existence', async () => {
    const email = 'burst.rate@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'InitPassword123!' }),
      }),
    );

    // Send 5 concurrent requests from different IPs (account limit is 3)
    const responses = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        forgotPasswordHandler(
          new NextRequest('http://localhost:3001/api/auth/forgot-password', {
            method: 'POST',
            headers: {
              origin: 'http://localhost:5173',
              'content-type': 'application/json',
              'x-forwarded-for': `172.16.0.${i}`,
            },
            body: JSON.stringify({ email }),
          }),
        ),
      ),
    );

    const statuses = responses.map((r) => r.status);
    const acceptedCount = statuses.filter((s) => s === 202).length;
    const rateLimitedCount = statuses.filter((s) => s === 429).length;

    assert.equal(acceptedCount, 3, 'Exactly 3 requests within limit are accepted');
    assert.equal(rateLimitedCount, 2, 'Burst exceeding limit is throttled with 429');

    // Confirm non-existent email gets identical 202/429 behavior without leaking existence
    const ghostEmail = 'ghost.burst@growspace.org';
    const ghostRes = await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json',
          'x-forwarded-for': '172.16.0.99',
        },
        body: JSON.stringify({ email: ghostEmail }),
      }),
    );
    assert.equal(ghostRes.status, 202);
    const ghostBody = await ghostRes.json();
    assert.equal(ghostBody.message, 'If an account matching that email exists, a password reset link has been sent.');
  });

  it('7. Email link corresponds to the token that remains valid and resets password end-to-end', async () => {
    const email = 'endtoend.valid@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'OldOriginalPass123!' }),
      }),
    );

    await forgotPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );

    // Extract link and token from mock mailer
    const lastEmail = mockMailer.getLastEmail()!;
    assert.equal(lastEmail.type, 'password_reset');
    const token = lastEmail.link.split('#token=')[1];
    assert.ok(token);

    // Reset password using the link token
    const resetRes = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token, password: 'NewValidPassword123!' }),
      }),
    );
    assert.equal(resetRes.status, 200);

    // Verify login with new password
    const loginRes = await loginHandler(
      new NextRequest('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'NewValidPassword123!' }),
      }),
    );
    assert.equal(loginRes.status, 200);
  });

  it('8. Older-started transaction lock contention: clock_timestamp guarantees correct monotonic token ordering', async () => {
    const email = 'lock.contention.reset@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'InitialPass123!' }),
      }),
    );

    const userRes = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1;', [email]);
    const userId = userRes.rows[0].id;

    // Simulate Transaction 1 (started earlier at T0)
    await db.exec('BEGIN;');
    await db.query('SELECT now() as t_start;');
    // Tx1 is delayed while waiting for locks / external dependencies
    await new Promise((r) => setTimeout(r, 60));

    // Meanwhile, Transaction 2 begins, generates Token B, inserts it and finalizes:
    const rawTokenB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const issueB = await insertAuthToken(db, {
      userId,
      purpose: 'password_reset',
      tokenHash: hashToken(rawTokenB),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    assert.ok(issueB.success && issueB.tokenId);
    const tokenBId = issueB.tokenId;
    await supersedeOtherAuthTokens(db, userId, 'password_reset', tokenBId);

    // Confirm Token B is active
    const activeBefore = await db.query<{ id: string }>(
      `SELECT id FROM auth_tokens WHERE user_id = $1 AND purpose = 'password_reset' AND consumed_at IS NULL;`,
      [userId],
    );
    assert.equal(activeBefore.rows.length, 1);
    assert.equal(activeBefore.rows[0].id, tokenBId);

    // Now Tx1 resumes, acquires user row lock, inserts Token A with clock_timestamp(), and commits:
    const rawTokenA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const issueA = await insertAuthToken(db, {
      userId,
      purpose: 'password_reset',
      tokenHash: hashToken(rawTokenA),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    assert.ok(issueA.success && issueA.tokenId);
    const tokenAId = issueA.tokenId;
    await db.exec('COMMIT;');

    // Verify Token A has a strictly later created_at than Token B (because of clock_timestamp())
    const timestamps = await db.query<{ id: string; created_at: string }>(
      `SELECT id, created_at FROM auth_tokens WHERE id IN ($1, $2);`,
      [tokenAId, tokenBId],
    );
    const timeA = new Date(timestamps.rows.find((r) => r.id === tokenAId)!.created_at).getTime();
    const timeB = new Date(timestamps.rows.find((r) => r.id === tokenBId)!.created_at).getTime();
    assert.ok(timeA > timeB, `Token A created_at (${timeA}) must be > Token B created_at (${timeB})`);

    // Tx1 finalizes by superseding older tokens for Token A
    await supersedeOtherAuthTokens(db, userId, 'password_reset', tokenAId);

    // Exactly 1 active token must remain: Token A!
    const activeAfter = await db.query<{ id: string }>(
      `SELECT id FROM auth_tokens WHERE user_id = $1 AND purpose = 'password_reset' AND consumed_at IS NULL;`,
      [userId],
    );
    assert.equal(activeAfter.rows.length, 1, 'Must leave exactly 1 active token');
    assert.equal(activeAfter.rows[0].id, tokenAId, 'The active token must be Token A');

    // Token A resets password with 200 OK
    const resetResA = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawTokenA, password: 'NewPasswordFromTokenA!' }),
      }),
    );
    assert.equal(resetResA.status, 200);

    // Token B was superseded and fails with 400
    const resetResB = await resetPasswordHandler(
      new NextRequest('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawTokenB, password: 'FailingPasswordB!' }),
      }),
    );
    assert.equal(resetResB.status, 400);
  });

  it('9. Email-verification token ordering under older-started transaction contention', async () => {
    const email = 'lock.contention.verify@growspace.org';
    await registerHandler(
      new NextRequest('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'InitialPass123!' }),
      }),
    );

    const userRes = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1;', [email]);
    const userId = userRes.rows[0].id;

    // Tx1 starts earlier at T0
    await db.exec('BEGIN;');
    await new Promise((r) => setTimeout(r, 60));

    // Tx2 inserts Token B
    const rawTokenB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const issueB = await insertAuthToken(db, {
      userId,
      purpose: 'email_verification',
      tokenHash: hashToken(rawTokenB),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    assert.ok(issueB.success && issueB.tokenId);
    const tokenBId = issueB.tokenId;
    await supersedeOtherAuthTokens(db, userId, 'email_verification', tokenBId);

    // Tx1 inserts Token A with clock_timestamp() and commits
    const rawTokenA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const issueA = await insertAuthToken(db, {
      userId,
      purpose: 'email_verification',
      tokenHash: hashToken(rawTokenA),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    assert.ok(issueA.success && issueA.tokenId);
    const tokenAId = issueA.tokenId;
    await db.exec('COMMIT;');

    // Tx1 finalizes superseding
    await supersedeOtherAuthTokens(db, userId, 'email_verification', tokenAId);

    // Exactly 1 verification token is active: Token A
    const activeTokens = await db.query<{ id: string }>(
      `SELECT id FROM auth_tokens WHERE user_id = $1 AND purpose = 'email_verification' AND consumed_at IS NULL;`,
      [userId],
    );
    assert.equal(activeTokens.rows.length, 1);
    assert.equal(activeTokens.rows[0].id, tokenAId);

    // Token A verifies successfully
    const verifyResA = await verifyEmailHandler(
      new NextRequest('http://localhost:3001/api/auth/verify-email', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawTokenA }),
      }),
    );
    assert.equal(verifyResA.status, 200);

    // Token B was superseded and fails
    const verifyResB = await verifyEmailHandler(
      new NextRequest('http://localhost:3001/api/auth/verify-email', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawTokenB }),
      }),
    );
    assert.equal(verifyResB.status, 400);
  });
});
