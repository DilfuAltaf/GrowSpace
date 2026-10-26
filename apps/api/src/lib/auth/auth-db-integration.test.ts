import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { AppError } from '../api-error';
import {
  authService,
  consumeAuthToken,
  consumeRateLimit,
  createUser,
  hashPassword,
  hashToken,
  issueSerializedAuthToken,
  resetRateLimit,
  type Queryable,
} from './index';

process.env.RATE_LIMIT_SECRET = 'test-secret-at-least-32-bytes-long-growspace!';

function getMigrationSql(): string {
  const candidate1 = resolve(process.cwd(), 'migrations/0001_create_auth_tables.sql');
  if (existsSync(candidate1)) return readFileSync(candidate1, 'utf8');

  const candidate2 = resolve(process.cwd(), '../../migrations/0001_create_auth_tables.sql');
  if (existsSync(candidate2)) return readFileSync(candidate2, 'utf8');

  const candidate3 = resolve(import.meta.dirname, '../../../../migrations/0001_create_auth_tables.sql');
  if (existsSync(candidate3)) return readFileSync(candidate3, 'utf8');

  throw new Error('Could not locate migrations/0001_create_auth_tables.sql');
}

async function createIsolatedAuthDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.waitReady;
  const sql = getMigrationSql();
  await db.exec(sql);
  return db;
}

describe('Real PostgreSQL Integration Suite (PGlite WASM Engine)', () => {
  it('Integration 1: Applies 0001 migration and verifies all 4 auth tables exist', async () => {
    const db = await createIsolatedAuthDb();
    try {
      const res = await db.query<{ table_name: string }>(
        `SELECT table_name 
         FROM information_schema.tables 
         WHERE table_schema = 'public' 
         ORDER BY table_name;`
      );

      const tableNames = res.rows.map((r) => r.table_name);
      assert.ok(tableNames.includes('users'), 'users table must exist');
      assert.ok(tableNames.includes('sessions'), 'sessions table must exist');
      assert.ok(tableNames.includes('auth_tokens'), 'auth_tokens table must exist');
      assert.ok(tableNames.includes('auth_rate_limits'), 'auth_rate_limits table must exist');
    } finally {
      await db.close();
    }
  });

  it('Integration 2: User registration enforces database constraints (Argon2id format, normalized email)', async () => {
    const db = await createIsolatedAuthDb();
    try {
      // 1. Successful registration via AuthService
      const reg = await authService.register(db as unknown as Queryable, {
        email: 'Gardener.Jane@GrowSpace.org',
        password: 'ValidPassword123!',
        displayName: 'Jane Doe',
      });

      assert.equal(reg.user.email, 'gardener.jane@growspace.org');
      assert.equal(reg.user.displayName, 'Jane Doe');
      assert.equal(reg.user.temperatureUnit, 'celsius');

      // Verify row in database
      const userRes = await db.query<{ password_hash: string; email: string }>(
        'SELECT password_hash, email FROM users WHERE email = $1;',
        ['gardener.jane@growspace.org']
      );
      assert.equal(userRes.rows.length, 1);
      assert.ok(userRes.rows[0].password_hash.startsWith('$argon2id$'));

      // 2. Database constraint rejection: invalid password hash (not starting with $argon2id$)
      await assert.rejects(
        async () => {
          await db.query(
            `INSERT INTO users (email, password_hash) VALUES ($1, $2);`,
            ['hacker@bad.org', '$2a$12$somebcrypthashthatshouldfailcheckconstraint']
          );
        },
        /users_password_hash_format_check/
      );

      // 3. Database constraint rejection: unnormalized email
      await assert.rejects(
        async () => {
          await db.query(
            `INSERT INTO users (email, password_hash) VALUES ($1, $2);`,
            ['UPPERCASE@EXAMPLE.COM', '$argon2id$v=19$m=19456,t=2,p=1$fake$fake']
          );
        },
        /users_email_normalized_check/
      );

      // 4. Duplicate email rejection
      await assert.rejects(
        async () => {
          await createUser(db as unknown as Queryable, {
            email: 'gardener.jane@growspace.org',
            passwordHash: await hashPassword('AnotherPassword123!'),
          });
        },
        /users_email_key/
      );
    } finally {
      await db.close();
    }
  });

  it('Integration 3: Login issues 32-byte BYTEA session records satisfying schema constraints', async () => {
    const db = await createIsolatedAuthDb();
    try {
      const email = 'farmer.bob@growspace.org';
      const password = 'FarmPassword2026!';
      await authService.register(db as unknown as Queryable, {
        email,
        password,
        displayName: 'Bob The Farmer',
      });

      const loginResult = await authService.login(db as unknown as Queryable, {
        email,
        password,
      });

      assert.ok(typeof loginResult.sessionToken === 'string');
      assert.ok(typeof loginResult.csrfToken === 'string');

      // Verify session in database
      const sessRes = await db.query<{
        id: string;
        user_id: string;
        token_hash: Uint8Array;
        csrf_token_hash: Uint8Array;
        revoked_at: unknown;
      }>(
        'SELECT id, user_id, token_hash, csrf_token_hash, revoked_at FROM sessions WHERE user_id = $1;',
        [loginResult.user.id]
      );

      assert.equal(sessRes.rows.length, 1);
      const row = sessRes.rows[0];
      assert.equal(row.user_id, loginResult.user.id);
      assert.equal(row.token_hash.length, 32);
      assert.equal(row.csrf_token_hash.length, 32);
      assert.equal(row.revoked_at, null);

      // Verify foreign key cascade delete
      await db.query('DELETE FROM users WHERE id = $1;', [loginResult.user.id]);
      const checkSess = await db.query('SELECT id FROM sessions WHERE user_id = $1;', [loginResult.user.id]);
      assert.equal(checkSess.rows.length, 0, 'Cascade delete must remove sessions when user is deleted');
    } finally {
      await db.close();
    }
  });

  it('Integration 4: Session validation, throttling touch, and revocation lifecycle', async () => {
    const db = await createIsolatedAuthDb();
    try {
      const email = 'lifecycle@growspace.org';
      const password = 'LifecyclePassword1!';
      await authService.register(db as unknown as Queryable, { email, password });
      const login = await authService.login(db as unknown as Queryable, { email, password });

      // 1. Validate active session
      const valid = await authService.validateSession(db as unknown as Queryable, login.sessionToken);
      assert.equal(valid.user.email, email);
      assert.equal(valid.sessionId, valid.session.id);

      // 2. Touch throttling: artificially age created_at and last_used_at
      // Note: check constraint requires last_used_at >= created_at
      await db.query(
        `UPDATE sessions 
         SET created_at = created_at - INTERVAL '10 minutes',
             last_used_at = last_used_at - INTERVAL '6 minutes' 
         WHERE id = $1;`,
        [valid.sessionId]
      );

      // Validate again -> should trigger touchSession
      await authService.validateSession(db as unknown as Queryable, login.sessionToken);

      const sessAfterTouch = await db.query<{ last_used_at: Date }>(
        'SELECT last_used_at FROM sessions WHERE id = $1;',
        [valid.sessionId]
      );
      const lastUsed = new Date(sessAfterTouch.rows[0].last_used_at).getTime();
      assert.ok(Date.now() - lastUsed < 5000, 'last_used_at must be refreshed to approximately now');

      // 3. Logout (revocation)
      await authService.logout(db as unknown as Queryable, login.sessionToken);

      // 4. Validate after logout -> must throw session_revoked
      await assert.rejects(
        async () => {
          await authService.validateSession(db as unknown as Queryable, login.sessionToken);
        },
        (err: unknown) => err instanceof AppError && err.code === 'session_revoked' && err.status === 401
      );
    } finally {
      await db.close();
    }
  });

  it('Integration 5: Rate limiter persists HMAC-SHA-256 keys, increments attempts, and blocks', async () => {
    const db = await createIsolatedAuthDb();
    try {
      const secret = 'test-rate-limit-secret-32-chars-ok';
      const identifier = 'attacker@target.test';

      // Attempt 1: Allowed
      const r1 = await consumeRateLimit(
        db as unknown as Queryable,
        {
          action: 'login',
          scope: 'account',
          identifier,
          maxAttempts: 3,
          windowMs: 60000,
          blockDurationMs: 60000,
        },
        secret
      );
      assert.equal(r1.allowed, true);
      assert.equal(r1.remainingAttempts, 2);

      // Attempt 2: Allowed
      const r2 = await consumeRateLimit(
        db as unknown as Queryable,
        {
          action: 'login',
          scope: 'account',
          identifier,
          maxAttempts: 3,
          windowMs: 60000,
          blockDurationMs: 60000,
        },
        secret
      );
      assert.equal(r2.allowed, true);
      assert.equal(r2.remainingAttempts, 1);

      // Attempt 3: Allowed (last attempt in window)
      const r3 = await consumeRateLimit(
        db as unknown as Queryable,
        {
          action: 'login',
          scope: 'account',
          identifier,
          maxAttempts: 3,
          windowMs: 60000,
          blockDurationMs: 60000,
        },
        secret
      );
      assert.equal(r3.allowed, true);
      assert.equal(r3.remainingAttempts, 0);

      // Attempt 4: Blocked!
      const r4 = await consumeRateLimit(
        db as unknown as Queryable,
        {
          action: 'login',
          scope: 'account',
          identifier,
          maxAttempts: 3,
          windowMs: 60000,
          blockDurationMs: 60000,
        },
        secret
      );
      assert.equal(r4.allowed, false);
      assert.ok((r4.retryAfterSeconds ?? 0) > 0);

      // Verify row in auth_rate_limits
      const rowRes = await db.query<{ attempt_count: number; blocked_until: unknown }>(
        'SELECT attempt_count, blocked_until FROM auth_rate_limits;'
      );
      assert.equal(rowRes.rows.length, 1);
      assert.equal(rowRes.rows[0].attempt_count, 4);
      assert.ok(rowRes.rows[0].blocked_until !== null);

      // Reset rate limit
      await resetRateLimit(
        db as unknown as Queryable,
        {
          action: 'login',
          scope: 'account',
          identifier,
        },
        secret
      );

      // Verify row cleared
      const checkClear = await db.query('SELECT * FROM auth_rate_limits;');
      assert.equal(checkClear.rows.length, 0);
    } finally {
      await db.close();
    }
  });

  it('Integration 6: Serialized auth token issuance (SELECT FOR UPDATE) and atomic consumption', async () => {
    const db = await createIsolatedAuthDb();
    try {
      const email = 'token.owner@growspace.org';
      const reg = await authService.register(db as unknown as Queryable, {
        email,
        password: 'Password12345!',
      });
      const userId = reg.user.id;

      const tokenRaw1 = 'first-raw-token-value-secret-1';
      const tokenHash1 = hashToken(tokenRaw1);
      const expiresAt = new Date(Date.now() + 3600000);

      // Issue first token
      const issue1 = await issueSerializedAuthToken(db as unknown as Queryable, {
        userId,
        purpose: 'email_verification',
        tokenHash: tokenHash1,
        expiresAt,
      });
      assert.equal(issue1.success, true);
      assert.ok(issue1.tokenId);

      // Issue second token for the same user & purpose (must supersede the first token)
      const tokenRaw2 = 'second-raw-token-value-secret-2';
      const tokenHash2 = hashToken(tokenRaw2);

      const issue2 = await issueSerializedAuthToken(db as unknown as Queryable, {
        userId,
        purpose: 'email_verification',
        tokenHash: tokenHash2,
        expiresAt,
      });
      assert.equal(issue2.success, true);

      // Verify first token is marked consumed (superseded)
      const t1Check = await db.query<{ consumed_at: unknown }>(
        'SELECT consumed_at FROM auth_tokens WHERE token_hash = $1;',
        [tokenHash1]
      );
      assert.ok(t1Check.rows[0].consumed_at !== null, 'First token must be invalidated by second issuance');

      // Verify second token is active
      const t2Check = await db.query<{ consumed_at: unknown }>(
        'SELECT consumed_at FROM auth_tokens WHERE token_hash = $1;',
        [tokenHash2]
      );
      assert.equal(t2Check.rows[0].consumed_at, null, 'Second token must be active');

      // Consume second token
      const consumeRes = await consumeAuthToken(db as unknown as Queryable, tokenHash2, 'email_verification');
      assert.equal(consumeRes.success, true);
      assert.equal(consumeRes.userId, userId);

      // Re-consume second token -> must fail (single-use enforced)
      const reConsumeRes = await consumeAuthToken(db as unknown as Queryable, tokenHash2, 'email_verification');
      assert.equal(reConsumeRes.success, false, 'Already consumed token cannot be consumed again');
    } finally {
      await db.close();
    }
  });
});
