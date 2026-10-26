import { executeQuery, type Queryable } from './db-client';
import { generateRateLimitKey } from './tokens';
import type { RateLimitOptions, RateLimitResult } from './types';

/**
 * Resolves the HMAC secret for rate limiting.
 * Requires RATE_LIMIT_SECRET to be configured with at least 32 characters.
 * Enforces mandatory secret without insecure fallbacks to fail closed.
 */
export function getRateLimitSecret(): string {
  const secret = process.env.RATE_LIMIT_SECRET?.trim();
  if (!secret) {
    throw new Error('RATE_LIMIT_SECRET environment variable is missing. A secret of at least 32 characters is required.');
  }
  if (secret.length < 32) {
    throw new Error('RATE_LIMIT_SECRET must be at least 32 characters long.');
  }
  return secret;
}

/**
 * Checks and records an attempt against the `auth_rate_limits` table.
 * Uses HMAC-SHA-256 binary keys to prevent persisting raw emails or IP addresses.
 */
export async function consumeRateLimit(
  client: Queryable,
  options: RateLimitOptions,
  secret?: string,
): Promise<RateLimitResult> {
  const {
    action,
    scope = 'default',
    identifier,
    windowMs = 15 * 60 * 1000, // 15 minutes default
    maxAttempts = 5,
    blockDurationMs = 15 * 60 * 1000,
  } = options;

  const hmacSecret = secret ?? getRateLimitSecret();
  const keyHash = generateRateLimitKey(hmacSecret, action, scope, identifier);
  const now = Date.now();

  // 1. Fetch current status
  const existingRes = await executeQuery<{
    window_started_at: Date | string;
    attempt_count: number;
    blocked_until: Date | string | null;
  }>(
    client,
    `SELECT window_started_at, attempt_count, blocked_until
     FROM auth_rate_limits
     WHERE key_hash = $1;`,
    [keyHash],
  );

  const row = existingRes.rows[0];

  if (row) {
    const blockedUntilTime = row.blocked_until ? new Date(row.blocked_until).getTime() : null;

    // A. Check if currently blocked
    if (blockedUntilTime && blockedUntilTime > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((blockedUntilTime - now) / 1000));
      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds,
      };
    }

    const windowStartTime = new Date(row.window_started_at).getTime();

    // B. Check if window has expired; reset if older than windowMs
    if (now - windowStartTime > windowMs) {
      await executeQuery(
        client,
        `UPDATE auth_rate_limits
         SET window_started_at = now(),
             attempt_count = 1,
             blocked_until = NULL,
             updated_at = now()
         WHERE key_hash = $1;`,
        [keyHash],
      );

      return {
        allowed: true,
        remainingAttempts: maxAttempts - 1,
      };
    }

    // C. Within active window: atomically increment count
    const blockUntilSeconds = Math.ceil(blockDurationMs / 1000);
    const updateRes = await executeQuery<{ attempt_count: number; blocked_until: Date | string | null }>(
      client,
      `UPDATE auth_rate_limits
       SET attempt_count = auth_rate_limits.attempt_count + 1,
           blocked_until = CASE
             WHEN (auth_rate_limits.attempt_count + 1) > $2 THEN now() + ($3 || ' seconds')::interval
             ELSE auth_rate_limits.blocked_until
           END,
           updated_at = now()
       WHERE key_hash = $1
       RETURNING attempt_count, blocked_until;`,
      [keyHash, maxAttempts, blockUntilSeconds.toString()],
    );

    const updatedRow = updateRes.rows[0];
    const currentCount = updatedRow?.attempt_count ?? row.attempt_count + 1;

    if (currentCount > maxAttempts) {
      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds: blockUntilSeconds,
      };
    }

    return {
      allowed: true,
      remainingAttempts: Math.max(0, maxAttempts - currentCount),
    };
  }

  // 2. No record exists: atomically create new row with attempt 1 (with ON CONFLICT for concurrent races)
  const blockUntilSeconds = Math.ceil(blockDurationMs / 1000);
  const insertRes = await executeQuery<{ attempt_count: number; blocked_until: Date | string | null }>(
    client,
    `INSERT INTO auth_rate_limits (key_hash, action, window_started_at, attempt_count, blocked_until, updated_at)
     VALUES ($1, $2, now(), 1, CASE WHEN 1 > $3 THEN now() + ($4 || ' seconds')::interval ELSE NULL END, now())
     ON CONFLICT (key_hash) DO UPDATE
     SET attempt_count = auth_rate_limits.attempt_count + 1,
         blocked_until = CASE
           WHEN (auth_rate_limits.attempt_count + 1) > $3 THEN now() + ($4 || ' seconds')::interval
           ELSE auth_rate_limits.blocked_until
         END,
         updated_at = now()
     RETURNING attempt_count, blocked_until;`,
    [keyHash, action, maxAttempts, blockUntilSeconds.toString()],
  );

  const insertedRow = insertRes.rows[0];
  const count = insertedRow?.attempt_count ?? 1;

  if (count > maxAttempts) {
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds: blockUntilSeconds,
    };
  }

  return {
    allowed: true,
    remainingAttempts: Math.max(0, maxAttempts - count),
  };
}

/**
 * Resets or clears rate limit record for a specific key (e.g. after successful authentication).
 */
export async function resetRateLimit(
  client: Queryable,
  options: Pick<RateLimitOptions, 'action' | 'scope' | 'identifier'>,
  secret?: string,
): Promise<void> {
  const { action, scope = 'default', identifier } = options;
  const hmacSecret = secret ?? getRateLimitSecret();
  const keyHash = generateRateLimitKey(hmacSecret, action, scope, identifier);

  await executeQuery(
    client,
    `DELETE FROM auth_rate_limits WHERE key_hash = $1;`,
    [keyHash],
  );
}

