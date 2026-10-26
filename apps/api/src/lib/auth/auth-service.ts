import { AppError } from '../api-error';
import { executeQuery, type Queryable } from './db-client';
import { dummyVerifyPassword, hashPassword, validatePasswordPolicy, verifyPassword } from './password';
import { consumeRateLimit, resetRateLimit } from './rate-limiter';
import { createSession, findSessionWithUser, revokeAllUserSessions, revokeSession, touchSession } from './session-repository';
import {
  consumeAuthToken,
  deleteAuthTokenById,
  insertAuthToken,
  issueSerializedAuthToken,
  supersedeOtherAuthTokens,
} from './token-repository';
import { generateRandomToken, hashToken } from './tokens';
import type { LoginInput, RegisterInput, SessionRecord, SessionUser, UserRecord } from './types';
import {
  createUser,
  findUserByEmail,
  findUserById,
  markEmailVerified,
  normalizeEmail,
  toSessionUser,
  validateEmailShape,
} from './user-repository';

export interface RegisterResult {
  user: SessionUser;
  isExistingAccount?: boolean;
  rawVerificationToken?: string;
  userId?: string;
}

export interface LoginResult {
  user: SessionUser;
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface ValidateSessionResult {
  user: SessionUser;
  sessionId: string;
  session: SessionRecord;
}

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days absolute expiry
const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;          // 24 hours idle timeout
const TOUCH_THROTTLE_MS = 5 * 60 * 1000;              // 5 minutes throttle on last_used_at

/**
 * First-Party Authentication Service Engine
 * Encapsulates all registration, login, session lifecycle, and security validation.
 */
export class AuthService {
  /**
   * Registers a new user account with Argon2id password hashing.
   * Returns generic responses to resist email enumeration attacks.
   */
  async register(client: Queryable, input: RegisterInput): Promise<RegisterResult> {
    const { email, password, displayName, temperatureUnit } = input;

    if (!validateEmailShape(email)) {
      throw new AppError(400, 'invalid_email', 'Please provide a valid email address.');
    }

    const policyCheck = validatePasswordPolicy(password);
    if (!policyCheck.valid) {
      throw new AppError(400, 'weak_password', policyCheck.error || 'Password does not meet security requirements.');
    }

    const normalizedEmail = normalizeEmail(email);

    // Check for existing account
    const existing = await findUserByEmail(client, normalizedEmail);
    if (existing) {
      // In accordance with docs/auth/architecture.md Section 6.4 (enumeration resistance),
      // do not reveal account existence with a distinct error code like 409.
      // Mitigate timing side channel difference by executing dummy password verification
      await dummyVerifyPassword();
      return {
        user: {
          id: existing.id,
          email: existing.email,
          displayName: existing.display_name,
          temperatureUnit: existing.temperature_unit,
          emailVerified: Boolean(existing.email_verified_at),
          createdAt: new Date(existing.created_at).toISOString(),
        },
        isExistingAccount: true,
        userId: existing.id,
      };
    }

    // Hash password using Argon2id
    const passwordHash = await hashPassword(password);

    try {
      const created = await createUser(client, {
        email: normalizedEmail,
        passwordHash,
        displayName,
        temperatureUnit,
      });

      // Issue single-use 24h verification token following serialization requirement
      const rawVerificationToken = generateRandomToken(32);
      const tokenHash = hashToken(rawVerificationToken);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await issueSerializedAuthToken(client, {
        userId: created.id,
        purpose: 'email_verification',
        tokenHash,
        expiresAt,
      });

      return {
        user: toSessionUser(created),
        isExistingAccount: false,
        rawVerificationToken,
        userId: created.id,
      };
    } catch (err: unknown) {
      // Catch concurrent insertion unique violation
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unique') || msg.includes('users_email_key')) {
        const fallback = await findUserByEmail(client, normalizedEmail);
        if (fallback) {
          await dummyVerifyPassword();
          return {
            user: toSessionUser(fallback),
            isExistingAccount: true,
            userId: fallback.id,
          };
        }
      }
      throw new AppError(500, 'registration_error', 'Registration could not be completed. Please try again.');
    }
  }

  /**
   * Authenticates a user, verifies their Argon2id password hash, and issues an opaque session.
   * Enforces rate-limiting and timing-attack mitigation for invalid credentials.
   */
  async login(
    client: Queryable,
    input: LoginInput,
    options: { ip?: string } = {},
  ): Promise<LoginResult> {
    const { email, password } = input;

    if (!validateEmailShape(email) || typeof password !== 'string') {
      throw new AppError(401, 'invalid_credentials', 'Invalid email or password.');
    }

    const normalizedEmail = normalizeEmail(email);

    // Rate limit check: account level (max 5 failures / 15 mins)
    const accountLimit = await consumeRateLimit(client, {
      action: 'login',
      scope: 'account',
      identifier: normalizedEmail,
      maxAttempts: 5,
      windowMs: 15 * 60 * 1000,
      blockDurationMs: 15 * 60 * 1000,
    });

    if (!accountLimit.allowed) {
      throw new AppError(
        429,
        'rate_limited',
        `Too many login attempts. Please try again in ${accountLimit.retryAfterSeconds} seconds.`,
      );
    }

    // Rate limit check: IP level if provided (max 20 attempts / 15 mins)
    if (options.ip) {
      const ipLimit = await consumeRateLimit(client, {
        action: 'login',
        scope: 'ip',
        identifier: options.ip,
        maxAttempts: 20,
        windowMs: 15 * 60 * 1000,
      });

      if (!ipLimit.allowed) {
        throw new AppError(
          429,
          'rate_limited',
          `Too many login attempts from this network. Please try again in ${ipLimit.retryAfterSeconds} seconds.`,
        );
      }
    }

    // Look up user
    const user = await findUserByEmail(client, normalizedEmail);

    if (!user) {
      // Execute dummy Argon2id hash verification to mitigate timing enumeration
      await dummyVerifyPassword();
      throw new AppError(401, 'invalid_credentials', 'Invalid email or password.');
    }

    // Verify Argon2id password hash
    const isValid = await verifyPassword(user.password_hash, password);
    if (!isValid) {
      throw new AppError(401, 'invalid_credentials', 'Invalid email or password.');
    }

    // Generate 32-byte cryptographically random session & CSRF tokens
    const sessionToken = generateRandomToken(32);
    const csrfToken = generateRandomToken(32);

    const tokenHash = hashToken(sessionToken);
    const csrfTokenHash = hashToken(csrfToken);
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);

    await createSession(client, {
      userId: user.id,
      tokenHash,
      csrfTokenHash,
      expiresAt,
    });

    // Reset account failure counter upon successful authentication
    try {
      await resetRateLimit(client, {
        action: 'login',
        scope: 'account',
        identifier: normalizedEmail,
      });
    } catch {
      // Non-fatal if counter reset fails
    }

    return {
      user: toSessionUser(user),
      sessionToken,
      csrfToken,
      expiresAt,
    };
  }

  /**
   * Validates an incoming session token, enforcing absolute expiry, idle timeout, and revocation.
   * Throttles `last_used_at` updates to at most once per 5 minutes when touch is enabled.
   */
  async validateSession(
    client: Queryable,
    rawSessionToken: string,
    options: { touch?: boolean } = { touch: true },
  ): Promise<ValidateSessionResult> {
    if (!rawSessionToken || typeof rawSessionToken !== 'string') {
      throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
    }

    const tokenHash = hashToken(rawSessionToken);
    const resolved = await findSessionWithUser(client, tokenHash);

    if (!resolved) {
      throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
    }

    const { session, user } = resolved;
    const now = Date.now();

    // Check revocation
    if (session.revoked_at) {
      throw new AppError(401, 'session_revoked', 'Your session has been signed out. Please sign in again.');
    }

    // Check absolute expiration (7 days)
    const expiresAtTime = new Date(session.expires_at).getTime();
    if (expiresAtTime <= now) {
      throw new AppError(401, 'session_expired', 'Your session has expired. Please sign in again.');
    }

    // Check idle timeout (24 hours)
    const lastUsedTime = new Date(session.last_used_at).getTime();
    if (now - lastUsedTime > IDLE_TIMEOUT_MS) {
      // Mark revoked upon idle timeout
      await revokeSession(client, session.id);
      throw new AppError(401, 'session_idle_timeout', 'Your session timed out due to inactivity. Please sign in again.');
    }

    // Throttled update of last_used_at (at most once every 5 minutes), unless touch is explicitly disabled
    if (options.touch !== false && now - lastUsedTime > TOUCH_THROTTLE_MS) {
      await touchSession(client, session.id);
    }

    return {
      user: toSessionUser(user),
      sessionId: session.id,
      session,
    };
  }

  /**
   * Idempotently signs out a session.
   */
  async logout(client: Queryable, rawSessionToken: string): Promise<void> {
    if (!rawSessionToken) return;
    const tokenHash = hashToken(rawSessionToken);
    const resolved = await findSessionWithUser(client, tokenHash);
    if (resolved && !resolved.session.revoked_at) {
      await revokeSession(client, resolved.session.id);
    }
  }

  /**
   * Revokes all active sessions for a user (e.g. upon password reset or security event).
   */
  async revokeAllSessions(client: Queryable, userId: string): Promise<number> {
    return revokeAllUserSessions(client, userId);
  }

  /**
   * Atomically verifies an account using a single-use verification token.
   * Enforces atomic consumption in auth_tokens before marking users.email_verified_at.
   */
  async verifyEmail(client: Queryable, rawToken: string): Promise<SessionUser> {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new AppError(400, 'invalid_token', 'Invalid, expired, or already-consumed verification token.');
    }

    const tokenHash = hashToken(rawToken);
    const result = await consumeAuthToken(client, tokenHash, 'email_verification');

    if (!result.success || !result.userId) {
      throw new AppError(400, 'invalid_token', 'Verification link is invalid, expired, or has already been used.');
    }

    const user = await markEmailVerified(client, result.userId);
    if (!user) {
      throw new AppError(400, 'invalid_token', 'User associated with verification token was not found.');
    }

    return toSessionUser(user);
  }

  /**
   * Issues a fresh verification token, invalidating prior active tokens with row-level locks.
   * Returns consistent responses to prevent email enumeration.
   */
  async resendVerification(
    client: Queryable,
    options: { userId?: string; email?: string },
  ): Promise<{
    success: boolean;
    alreadyVerified: boolean;
    tokenId?: string;
    userId?: string;
    rawToken?: string;
    email?: string;
  }> {
    let user: UserRecord | null;

    if (options.userId) {
      user = await findUserById(client, options.userId);
    } else if (options.email) {
      const normalized = normalizeEmail(options.email);
      user = await findUserByEmail(client, normalized);
    } else {
      throw new AppError(400, 'invalid_request', 'User identifier or email is required.');
    }

    if (!user) {
      // Execute dummy password verification work to equalize timing against enumeration
      await dummyVerifyPassword();
      return {
        success: true,
        alreadyVerified: false,
        email: options.email,
      };
    }

    if (user.email_verified_at) {
      return {
        success: true,
        alreadyVerified: true,
        email: user.email,
      };
    }

    const rawToken = generateRandomToken(32);
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const issueRes = await insertAuthToken(client, {
      userId: user.id,
      purpose: 'email_verification',
      tokenHash,
      expiresAt,
    });

    if (!issueRes.success || !issueRes.tokenId) {
      throw new AppError(500, 'token_error', 'Unable to issue new verification token.');
    }

    return {
      success: true,
      alreadyVerified: false,
      tokenId: issueRes.tokenId,
      userId: user.id,
      rawToken,
      email: user.email,
    };
  }

  /**
   * Generates a 30-minute password reset token with parent user row-level locks.
   * Inserts the token without immediately superseding prior tokens, allowing prior links
   * to remain valid if email delivery fails.
   * Returns constant responses and performs dummy work when the account does not exist to prevent enumeration.
   */
  async forgotPassword(
    client: Queryable,
    email: string,
  ): Promise<{
    success: boolean;
    isExistingAccount: boolean;
    tokenId?: string;
    rawToken?: string;
    email?: string;
    userId?: string;
  }> {
    if (!validateEmailShape(email)) {
      throw new AppError(400, 'invalid_email', 'Please provide a valid email address.');
    }

    const normalized = normalizeEmail(email);
    const user = await findUserByEmail(client, normalized);

    if (!user) {
      // Execute dummy password verification work to equalize execution time against enumeration
      await dummyVerifyPassword();
      return {
        success: true,
        isExistingAccount: false,
      };
    }

    const rawToken = generateRandomToken(32);
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes lifetime

    const issueRes = await insertAuthToken(client, {
      userId: user.id,
      purpose: 'password_reset',
      tokenHash,
      expiresAt,
    });

    if (!issueRes.success || !issueRes.tokenId) {
      throw new AppError(500, 'token_error', 'Unable to issue password reset token.');
    }

    return {
      success: true,
      isExistingAccount: true,
      tokenId: issueRes.tokenId,
      rawToken,
      email: user.email,
      userId: user.id,
    };
  }

  /**
   * Finalizes reset token issuance by superseding prior active tokens after email delivery succeeds.
   */
  async finalizePasswordResetDispatch(client: Queryable, userId: string, tokenId: string): Promise<void> {
    await supersedeOtherAuthTokens(client, userId, 'password_reset', tokenId);
  }

  /**
   * Rolls back an undelivered reset token if email delivery fails, ensuring prior tokens remain valid.
   */
  async rollbackFailedResetDispatch(client: Queryable, tokenId: string): Promise<void> {
    await deleteAuthTokenById(client, tokenId);
  }

  /**
   * Atomically validates and consumes a single-use password reset token, updates the user's password hash
   * with Argon2id, revokes all active sessions, and marks email verified in a single atomic transaction CTE.
   */
  async resetPassword(
    client: Queryable,
    input: { token: string; password: string },
  ): Promise<{ success: boolean; user: SessionUser; revokedSessionsCount: number }> {
    const { token, password } = input;
    if (!token || typeof token !== 'string') {
      throw new AppError(400, 'invalid_token', 'Password reset link is invalid, expired, or has already been used.');
    }

    const policyCheck = validatePasswordPolicy(password);
    if (!policyCheck.valid) {
      throw new AppError(400, 'weak_password', policyCheck.error || 'Password does not meet security requirements.');
    }

    const tokenHash = hashToken(token);
    const newPasswordHash = await hashPassword(password);

    const res = await executeQuery<{
      id: string;
      email: string;
      display_name: string | null;
      temperature_unit: 'celsius' | 'fahrenheit';
      email_verified_at: Date | string | null;
      created_at: Date | string;
      revoked_sessions_count: number;
    }>(
      client,
      `WITH consumed_token AS (
         UPDATE auth_tokens
         SET consumed_at = now()
         WHERE token_hash = $1
           AND purpose = 'password_reset'
           AND consumed_at IS NULL
           AND expires_at > now()
         RETURNING user_id
       ),
       invalidated_tokens AS (
         UPDATE auth_tokens
         SET consumed_at = now()
         FROM consumed_token
         WHERE auth_tokens.user_id = consumed_token.user_id
           AND auth_tokens.purpose = 'password_reset'
           AND auth_tokens.token_hash != $1
           AND auth_tokens.consumed_at IS NULL
         RETURNING auth_tokens.id
       ),
       updated_user AS (
         UPDATE users
         SET password_hash = $2,
             email_verified_at = COALESCE(users.email_verified_at, now()),
             updated_at = now()
         FROM consumed_token
         WHERE users.id = consumed_token.user_id
         RETURNING users.id, users.email, users.display_name, users.temperature_unit, users.email_verified_at, users.created_at
       ),
       revoked_sessions AS (
         UPDATE sessions
         SET revoked_at = now()
         FROM consumed_token
         WHERE sessions.user_id = consumed_token.user_id
           AND sessions.revoked_at IS NULL
         RETURNING sessions.id
       )
       SELECT 
         u.id, 
         u.email, 
         u.display_name, 
         u.temperature_unit, 
         u.email_verified_at, 
         u.created_at,
         (SELECT count(*)::int FROM revoked_sessions) as revoked_sessions_count
       FROM updated_user u;`,
      [tokenHash, newPasswordHash],
    );

    const row = res.rows[0];
    if (!row) {
      throw new AppError(400, 'invalid_token', 'Password reset link is invalid, expired, or has already been used.');
    }

    return {
      success: true,
      user: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        temperatureUnit: row.temperature_unit,
        emailVerified: Boolean(row.email_verified_at),
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : new Date(row.created_at).toISOString(),
      },
      revokedSessionsCount: row.revoked_sessions_count,
    };
  }
}

export const authService = new AuthService();
