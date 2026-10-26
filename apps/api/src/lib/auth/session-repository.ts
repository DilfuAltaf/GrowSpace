import { executeQuery, type Queryable } from './db-client';
import type { CreateSessionData, SessionRecord, UserRecord } from './types';

export interface SessionWithUser {
  session: SessionRecord;
  user: UserRecord;
}

/**
 * Inserts a new active server-managed session.
 * Stores binary SHA-256 digests of the opaque session and CSRF tokens.
 */
export async function createSession(
  client: Queryable,
  data: CreateSessionData,
): Promise<SessionRecord> {
  const res = await executeQuery<SessionRecord>(
    client,
    `INSERT INTO sessions (user_id, token_hash, csrf_token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, token_hash, csrf_token_hash, created_at, last_used_at, expires_at, revoked_at;`,
    [data.userId, data.tokenHash, data.csrfTokenHash, data.expiresAt],
  );

  return res.rows[0];
}

/**
 * Resolves a session and its associated parent user in a single query by binary token digest.
 */
export async function findSessionWithUser(
  client: Queryable,
  tokenHash: Buffer,
): Promise<SessionWithUser | null> {
  const res = await executeQuery<{
    session_id: string;
    user_id: string;
    token_hash: Buffer | string;
    csrf_token_hash: Buffer | string;
    session_created_at: Date | string;
    last_used_at: Date | string;
    expires_at: Date | string;
    revoked_at: Date | string | null;
    user_id_pk: string;
    email: string;
    password_hash: string;
    display_name: string | null;
    temperature_unit: 'celsius' | 'fahrenheit';
    email_verified_at: Date | string | null;
    user_created_at: Date | string;
    user_updated_at: Date | string;
  }>(
    client,
    `SELECT 
       s.id AS session_id,
       s.user_id,
       s.token_hash,
       s.csrf_token_hash,
       s.created_at AS session_created_at,
       s.last_used_at,
       s.expires_at,
       s.revoked_at,
       u.id AS user_id_pk,
       u.email,
       u.password_hash,
       u.display_name,
       u.temperature_unit,
       u.email_verified_at,
       u.created_at AS user_created_at,
       u.updated_at AS user_updated_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1;`,
    [tokenHash],
  );

  const row = res.rows[0];
  if (!row) return null;

  return {
    session: {
      id: row.session_id,
      user_id: row.user_id,
      token_hash: row.token_hash,
      csrf_token_hash: row.csrf_token_hash,
      created_at: row.session_created_at,
      last_used_at: row.last_used_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
    },
    user: {
      id: row.user_id_pk,
      email: row.email,
      password_hash: row.password_hash,
      display_name: row.display_name,
      temperature_unit: row.temperature_unit,
      email_verified_at: row.email_verified_at,
      created_at: row.user_created_at,
      updated_at: row.user_updated_at,
    },
  };
}

/**
 * Updates the last_used_at timestamp on an active session.
 */
export async function touchSession(client: Queryable, sessionId: string): Promise<void> {
  await executeQuery(
    client,
    `UPDATE sessions SET last_used_at = now() WHERE id = $1;`,
    [sessionId],
  );
}

/**
 * Revokes a single session immediately by setting revoked_at.
 */
export async function revokeSession(client: Queryable, sessionId: string): Promise<void> {
  await executeQuery(
    client,
    `UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL;`,
    [sessionId],
  );
}

/**
 * Revokes all active sessions for a user (e.g. upon password reset or security event).
 */
export async function revokeAllUserSessions(
  client: Queryable,
  userId: string,
): Promise<number> {
  const res = await executeQuery(
    client,
    `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;`,
    [userId],
  );

  return res.rowCount ?? 0;
}
