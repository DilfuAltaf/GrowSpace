import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../api-error';
import {
  hashPassword,
  verifyPassword,
  dummyVerifyPassword,
  validatePasswordPolicy,
  generateRandomToken,
  hashToken,
  generateRateLimitKey,
  timingSafeBufferEqual,
  normalizeEmail,
  validateEmailShape,
  getRateLimitSecret,
  authService,
  type Queryable,
  type UserRecord,
} from './index';

process.env.RATE_LIMIT_SECRET = 'test-secret-at-least-32-bytes-long-growspace!';

function createMockDb(handler: (sql: string, params?: unknown[]) => Promise<unknown[]> | unknown[]): Queryable {
  return {
    query: async <R = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const rows = await handler(sql, params);
      return { rows: rows as R[] };
    },
  };
}

describe('Auth Primitives: Password Hashing and Policy', () => {
  it('hashes password with Argon2id and validates against hash', async () => {
    const password = 'SuperSecretSecurePassword!2026';
    const hash = await hashPassword(password);

    assert.ok(hash.startsWith('$argon2id$v=19$'), `Hash must be Argon2id, got: ${hash}`);
    assert.ok(hash.includes('m=19456,t=2,p=1'), 'Hash must use configured memory/time/parallelism params');

    const isValid = await verifyPassword(hash, password);
    assert.equal(isValid, true, 'Correct password must verify');

    const isWrongValid = await verifyPassword(hash, 'WrongPassword123!');
    assert.equal(isWrongValid, false, 'Incorrect password must be rejected');
  });

  it('rejects passwords shorter than 12 characters in policy check and hashPassword', async () => {
    const policy = validatePasswordPolicy('Short1!');
    assert.equal(policy.valid, false);
    assert.ok(policy.error?.includes('at least 12 characters'));

    await assert.rejects(
      async () => hashPassword('Short1!'),
      /Password policy violation/
    );
  });

  it('rejects passwords longer than 128 characters', async () => {
    const longPassword = 'A'.repeat(129);
    const policy = validatePasswordPolicy(longPassword);
    assert.equal(policy.valid, false);
    assert.ok(policy.error?.includes('128 characters or fewer'));

    await assert.rejects(
      async () => hashPassword(longPassword),
      /Password policy violation/
    );
  });

  it('rejects passwords with only whitespace', async () => {
    const policy = validatePasswordPolicy('              ');
    assert.equal(policy.valid, false);
    assert.ok(policy.error?.includes('empty or whitespace'));

    await assert.rejects(
      async () => hashPassword('              '),
      /Password policy violation/
    );
  });

  it('accepts valid 12+ character passwords with mixed characters', () => {
    const policy = validatePasswordPolicy('CorrectHorse12!');
    assert.equal(policy.valid, true);
    assert.equal(policy.error, undefined);
  });

  it('dummyVerifyPassword completes without error', async () => {
    await assert.doesNotReject(async () => {
      await dummyVerifyPassword();
    });
  });
});

describe('Auth Primitives: Cryptographic Tokens and Hashes', () => {
  it('generates cryptographically secure base64url random tokens of requested length', () => {
    const token1 = generateRandomToken(32);
    const token2 = generateRandomToken(32);

    assert.equal(typeof token1, 'string');
    assert.notEqual(token1, token2, 'Generated tokens must be distinct');
    // 32 bytes in base64url is 43 characters
    assert.equal(token1.length, 43);
    assert.match(token1, /^[A-Za-z0-9_-]+$/, 'Must be url-safe base64');
  });

  it('hashes token to 32-byte SHA-256 binary buffer', () => {
    const token = generateRandomToken(32);
    const hash = hashToken(token);

    assert.ok(Buffer.isBuffer(hash));
    assert.equal(hash.length, 32, 'SHA-256 output must be exactly 32 bytes');

    // Deterministic hashing
    const hash2 = hashToken(token);
    assert.ok(timingSafeBufferEqual(hash, hash2));
  });

  it('generates 32-byte HMAC-SHA-256 rate-limit key', () => {
    const key = generateRateLimitKey('test-secret-salt', 'login', 'account', 'user@example.com');
    assert.ok(Buffer.isBuffer(key));
    assert.equal(key.length, 32, 'Rate limit key must be 32 bytes');

    const keyIdentical = generateRateLimitKey('test-secret-salt', 'login', 'account', 'user@example.com');
    assert.ok(timingSafeBufferEqual(key, keyIdentical));

    const keyDifferent = generateRateLimitKey('test-secret-salt', 'login', 'account', 'different@example.com');
    assert.equal(timingSafeBufferEqual(key, keyDifferent), false);
  });

  it('timingSafeBufferEqual handles identical, different, and length-mismatched buffers', () => {
    const b1 = Buffer.from('12345678901234567890123456789012');
    const b2 = Buffer.from('12345678901234567890123456789012');
    const b3 = Buffer.from('99995678901234567890123456789012');
    const bShort = Buffer.from('1234');

    assert.equal(timingSafeBufferEqual(b1, b2), true);
    assert.equal(timingSafeBufferEqual(b1, b3), false);
    assert.equal(timingSafeBufferEqual(b1, bShort), false);
  });

  it('enforces mandatory and strong RATE_LIMIT_SECRET without fallbacks', () => {
    const saved = process.env.RATE_LIMIT_SECRET;
    try {
      delete process.env.RATE_LIMIT_SECRET;
      assert.throws(() => getRateLimitSecret(), /RATE_LIMIT_SECRET environment variable is missing/);

      process.env.RATE_LIMIT_SECRET = 'short-secret';
      assert.throws(() => getRateLimitSecret(), /at least 32 characters long/);

      process.env.RATE_LIMIT_SECRET = 'valid-long-secret-at-least-32-bytes-long!';
      assert.equal(getRateLimitSecret(), 'valid-long-secret-at-least-32-bytes-long!');
    } finally {
      process.env.RATE_LIMIT_SECRET = saved;
    }
  });
});

describe('Auth Primitives: Email Normalization and Validation', () => {
  it('normalizes email to trimmed lowercase', () => {
    assert.equal(normalizeEmail('  User.Name@Example.COM  '), 'user.name@example.com');
  });

  it('validates email addresses shape', () => {
    assert.equal(validateEmailShape('gardener@growspace.test'), true);
    assert.equal(validateEmailShape('not-an-email'), false);
    assert.equal(validateEmailShape(''), false);
    assert.equal(validateEmailShape('@nodomain.com'), false);
  });
});

describe('AuthService: Unit Logic with Mock Queryable', () => {
  const mockUser: UserRecord = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'test@example.com',
    password_hash: '$argon2id$v=19$m=19456,t=2,p=1$uSp4VHVMdG/D9DObyRw8Wg$7YVqM3+mYtqQ52P+kUfPmgK5eNfJ4X6F1aX3x0o5UoY', // "TestPassword123!"
    display_name: 'Test User',
    temperature_unit: 'celsius',
    email_verified_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  it('register creates user and returns safe public user object', async () => {
    let insertedValues: unknown[] = [];
    const mockDb = createMockDb(async (sql, params = []) => {
      if (sql.includes('FROM users') && sql.includes('WHERE email = $1')) {
        return []; // No existing user
      }
      if (sql.includes('INSERT INTO users')) {
        insertedValues = params;
        return [
          {
            id: '22222222-2222-4222-8222-222222222222',
            email: params[0],
            password_hash: params[1],
            display_name: params[2],
            temperature_unit: 'celsius',
            email_verified_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ];
      }
      return [];
    });

    const result = await authService.register(mockDb, {
      email: 'NewGardener@GrowSpace.org',
      password: 'SecurePassword123!',
      displayName: 'Green Thumb',
    });

    assert.equal(result.user.email, 'newgardener@growspace.org');
    assert.equal(result.user.displayName, 'Green Thumb');
    assert.equal(result.isExistingAccount, false);
    assert.ok(insertedValues.length >= 4);
    assert.ok((insertedValues[1] as string).startsWith('$argon2id$'));
  });

  it('register handles existing email without disclosing account existence', async () => {
    const mockDb = createMockDb((sql) => {
      if (sql.includes('FROM users') && sql.includes('WHERE email = $1')) {
        return [mockUser];
      }
      return [];
    });

    const result = await authService.register(mockDb, {
      email: 'test@example.com',
      password: 'SomeOtherPassword123!',
    });

    assert.equal(result.user.email, 'test@example.com');
    assert.equal(result.isExistingAccount, true);
  });

  it('login fails on non-existent user with generic invalid_credentials', async () => {
    const mockDb = createMockDb((sql) => {
      if (sql.includes('auth_rate_limits')) {
        return [];
      }
      return [];
    });

    await assert.rejects(
      async () => {
        await authService.login(mockDb, {
          email: 'nonexistent@example.com',
          password: 'Password12345!',
        });
      },
      (err: unknown) => err instanceof AppError && err.code === 'invalid_credentials' && err.status === 401
    );
  });

  it('login fails on invalid password with generic invalid_credentials', async () => {
    const mockDb = createMockDb((sql) => {
      if (sql.includes('FROM users') && sql.includes('WHERE email = $1')) {
        return [mockUser];
      }
      return [];
    });

    await assert.rejects(
      async () => {
        await authService.login(mockDb, {
          email: 'test@example.com',
          password: 'IncorrectPassword123!',
        });
      },
      (err: unknown) => err instanceof AppError && err.code === 'invalid_credentials' && err.status === 401
    );
  });

  it('login creates a session token when credentials are valid', async () => {
    const validPassword = 'ValidPassword123!';
    const validHash = await hashPassword(validPassword);
    const userWithKnownHash: UserRecord = {
      ...mockUser,
      password_hash: validHash,
    };

    let sessionInserted = false;
    const mockDb = createMockDb((sql) => {
      if (sql.includes('FROM users') && sql.includes('WHERE email = $1')) {
        return [userWithKnownHash];
      }
      if (sql.includes('INSERT INTO sessions')) {
        sessionInserted = true;
        return [
          {
            id: 'sess-123',
            user_id: userWithKnownHash.id,
            token_hash: Buffer.alloc(32),
            csrf_token_hash: Buffer.alloc(32),
            created_at: new Date(),
            last_used_at: new Date(),
            expires_at: new Date(Date.now() + 7 * 86400000),
            revoked_at: null,
          },
        ];
      }
      return [];
    });

    const result = await authService.login(mockDb, {
      email: 'test@example.com',
      password: validPassword,
    });

    assert.equal(sessionInserted, true);
    assert.equal(result.user.email, 'test@example.com');
    assert.ok(typeof result.sessionToken === 'string');
    assert.equal(result.sessionToken.length, 43); // 32 bytes base64url
    assert.ok(typeof result.csrfToken === 'string');
    assert.equal(result.csrfToken.length, 43);
  });

  it('validateSession rejects expired sessions (absolute and idle)', async () => {
    const now = new Date();
    // Absolute expired
    const expiredAbsoluteSession = {
      session_id: 'sess-expired-abs',
      user_id: mockUser.id,
      token_hash: Buffer.alloc(32),
      csrf_token_hash: Buffer.alloc(32),
      session_created_at: new Date(now.getTime() - 8 * 86400000),
      last_used_at: new Date(now.getTime() - 1000),
      expires_at: new Date(now.getTime() - 1000), // in the past
      revoked_at: null,
      user_id_pk: mockUser.id,
      email: mockUser.email,
      password_hash: mockUser.password_hash,
      display_name: mockUser.display_name,
      temperature_unit: mockUser.temperature_unit,
      email_verified_at: mockUser.email_verified_at,
      user_created_at: mockUser.created_at,
      user_updated_at: mockUser.updated_at,
    };

    const mockDbAbs = createMockDb(() => [expiredAbsoluteSession]);

    await assert.rejects(
      async () => {
        await authService.validateSession(mockDbAbs, generateRandomToken());
      },
      (err: unknown) => err instanceof AppError && err.code === 'session_expired' && err.status === 401
    );

    // Idle expired (last_used_at > 24 hours ago)
    const expiredIdleSession = {
      ...expiredAbsoluteSession,
      expires_at: new Date(now.getTime() + 86400000),
      last_used_at: new Date(now.getTime() - 25 * 3600 * 1000), // 25 hours ago
    };
    const mockDbIdle = createMockDb(() => [expiredIdleSession]);

    await assert.rejects(
      async () => {
        await authService.validateSession(mockDbIdle, generateRandomToken());
      },
      (err: unknown) => err instanceof AppError && err.code === 'session_idle_timeout' && err.status === 401
    );
  });

  it('logout marks session as revoked', async () => {
    let updateSql = '';
    const mockSessionRow = {
      session_id: 'sess-active',
      user_id: mockUser.id,
      token_hash: Buffer.alloc(32),
      csrf_token_hash: Buffer.alloc(32),
      session_created_at: new Date(),
      last_used_at: new Date(),
      expires_at: new Date(Date.now() + 86400000),
      revoked_at: null,
      user_id_pk: mockUser.id,
      email: mockUser.email,
      password_hash: mockUser.password_hash,
      display_name: mockUser.display_name,
      temperature_unit: mockUser.temperature_unit,
      email_verified_at: null,
      user_created_at: new Date(),
      user_updated_at: new Date(),
    };

    const mockDb = createMockDb((sql) => {
      if (sql.includes('findSessionWithUser') || sql.includes('JOIN users u')) {
        return [mockSessionRow];
      }
      if (sql.includes('UPDATE sessions SET revoked_at = now()')) {
        updateSql = sql;
        return [{ id: 'sess-active' }];
      }
      return [];
    });

    const token = generateRandomToken();
    await authService.logout(mockDb, token);

    assert.ok(updateSql.includes('UPDATE sessions SET revoked_at = now()'));
  });
});
