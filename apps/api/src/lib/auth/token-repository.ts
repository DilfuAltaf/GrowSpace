import { executeQuery, type Queryable } from './db-client';
import { lockUserForUpdate } from './user-repository';

export type AuthTokenPurpose = 'email_verification' | 'password_reset';

export interface IssueTokenOptions {
  userId: string;
  purpose: AuthTokenPurpose;
  tokenHash: Buffer;
  expiresAt: Date;
}

export interface IssueTokenResult {
  success: boolean;
  tokenId?: string;
  error?: string;
}

/**
 * Issues a single-use authentication token following the strict concurrency protocol
 * specified in docs/database/production-cutover.md Section 4.2.
 *
 * Protocol:
 * 1. Acquires row-level lock on the parent user entity (`SELECT id FROM users WHERE id = $1 FOR UPDATE`).
 * 2. If user does not exist, aborts immediately without writing to auth_tokens.
 * 3. Atomically supersedes any existing active token for (user_id, purpose).
 * 4. Inserts the newly generated 32-byte cryptographic token digest.
 */
export async function issueSerializedAuthToken(
  client: Queryable,
  options: IssueTokenOptions,
): Promise<IssueTokenResult> {
  const { userId, purpose, tokenHash, expiresAt } = options;

  // Step 1: Explicitly serialize access on the parent user entity
  const lockedUser = await lockUserForUpdate(client, userId);
  if (!lockedUser) {
    return {
      success: false,
      error: 'User not found for token issuance serialization.',
    };
  }

  // Step 2: Atomically supersede any existing active token for this user and purpose
  await executeQuery(
    client,
    `UPDATE auth_tokens
     SET consumed_at = clock_timestamp()
     WHERE user_id = $1 
       AND purpose = $2 
       AND consumed_at IS NULL;`,
    [userId, purpose],
  );

  // Step 3: Insert the single active token digest with clock_timestamp() to prevent
  // older-started transaction lock contention from skewing token ordering.
  const insertRes = await executeQuery<{ id: string }>(
    client,
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, clock_timestamp())
     RETURNING id;`,
    [userId, purpose, tokenHash, expiresAt],
  );

  return {
    success: true,
    tokenId: insertRes.rows[0]?.id,
  };
}

/**
 * Inserts a single-use authentication token with parent user row-level locking
 * WITHOUT immediately superseding prior tokens.
 * Uses an atomic CTE to acquire the parent user lock and insert the token in a single statement.
 * Explicitly records `clock_timestamp()` so that an older-started transaction waiting on
 * user row locks gets a monotonically advancing timestamp upon lock acquisition.
 */
export async function insertAuthToken(
  client: Queryable,
  options: IssueTokenOptions,
): Promise<IssueTokenResult> {
  const { userId, purpose, tokenHash, expiresAt } = options;

  const insertRes = await executeQuery<{ id: string }>(
    client,
    `WITH locked_user AS (
       SELECT id FROM users WHERE id = $1 FOR UPDATE
     )
     INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at, created_at)
     SELECT id, $2, $3, $4, clock_timestamp()
     FROM locked_user
     RETURNING id;`,
    [userId, purpose, tokenHash, expiresAt],
  );

  const row = insertRes.rows[0];
  if (!row) {
    return {
      success: false,
      error: 'User not found for token issuance serialization.',
    };
  }

  return {
    success: true,
    tokenId: row.id,
  };
}

/**
 * Supersedes all other active tokens for a user and purpose that are older than the specified current token.
 * Uses total ordering on (created_at, id) tuple so that:
 * 1. Tokens dispatched prior to this one are superseded.
 * 2. Newer tokens generated concurrently by another request are NEVER invalidated by an earlier request.
 * 3. Interleaved concurrent dispatches leave exactly the newest delivered token active.
 */
export async function supersedeOtherAuthTokens(
  client: Queryable,
  userId: string,
  purpose: AuthTokenPurpose,
  currentTokenId: string,
): Promise<void> {
  await executeQuery(
    client,
    `WITH current_token AS (
       SELECT created_at, id FROM auth_tokens WHERE id = $3
     )
     UPDATE auth_tokens
     SET consumed_at = clock_timestamp()
     FROM current_token
     WHERE auth_tokens.user_id = $1
       AND auth_tokens.purpose = $2
       AND auth_tokens.id != $3
       AND (
         auth_tokens.created_at < current_token.created_at
         OR (auth_tokens.created_at = current_token.created_at AND auth_tokens.id < current_token.id)
       )
       AND auth_tokens.consumed_at IS NULL;`,
    [userId, purpose, currentTokenId],
  );
}

/**
 * Deletes an unconsumed auth token by primary key (e.g. rollback when email delivery fails).
 */
export async function deleteAuthTokenById(
  client: Queryable,
  tokenId: string,
): Promise<void> {
  await executeQuery(
    client,
    `DELETE FROM auth_tokens WHERE id = $1;`,
    [tokenId],
  );
}

/**
 * Atomically consumes an unexpired, unconsumed token.
 * Prevents token replay and enforces single-use semantics.
 */
export async function consumeAuthToken(
  client: Queryable,
  tokenHash: Buffer,
  purpose: AuthTokenPurpose,
): Promise<{ success: boolean; userId?: string }> {
  const res = await executeQuery<{ id: string; user_id: string }>(
    client,
    `UPDATE auth_tokens
     SET consumed_at = clock_timestamp()
     WHERE token_hash = $1
       AND purpose = $2
       AND consumed_at IS NULL
       AND expires_at > clock_timestamp()
     RETURNING id, user_id;`,
    [tokenHash, purpose],
  );

  const row = res.rows[0];
  if (!row) {
    return { success: false };
  }

  return { success: true, userId: row.user_id };
}
