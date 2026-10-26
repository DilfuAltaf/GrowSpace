import { executeQuery, type Queryable } from './db-client';
import type { CreateUserData, SessionUser, UserRecord } from './types';

/**
 * Normalizes an email address according to the database constraint:
 * lower(btrim(email))
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validates basic email shape matching database constraints:
 * - Length between 3 and 254
 * - Contains '@' with characters before and after
 */
export function validateEmailShape(email: string): boolean {
  if (typeof email !== 'string') return false;
  const normalized = normalizeEmail(email);
  if (normalized.length < 3 || normalized.length > 254) return false;
  const atIndex = normalized.indexOf('@');
  return atIndex > 0 && atIndex < normalized.length - 1;
}

/**
 * Transforms a raw database user record into the safe public SessionUser representation.
 * Explicitly strips sensitive hash values and internal implementation fields.
 */
export function toSessionUser(record: UserRecord): SessionUser {
  return {
    id: record.id,
    email: record.email,
    displayName: record.display_name,
    temperatureUnit: record.temperature_unit,
    emailVerified: Boolean(record.email_verified_at),
    createdAt:
      record.created_at instanceof Date
        ? record.created_at.toISOString()
        : new Date(record.created_at).toISOString(),
  };
}

/**
 * Inserts a new user account into PostgreSQL.
 * Parameterized query enforces Argon2id format check and email uniqueness.
 */
export async function createUser(
  client: Queryable,
  data: CreateUserData,
): Promise<UserRecord> {
  const normalizedEmail = normalizeEmail(data.email);
  const displayName = data.displayName?.trim() || null;
  const tempUnit = data.temperatureUnit ?? 'celsius';

  const res = await executeQuery<UserRecord>(
    client,
    `INSERT INTO users (email, password_hash, display_name, temperature_unit)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, password_hash, display_name, temperature_unit, email_verified_at, created_at, updated_at;`,
    [normalizedEmail, data.passwordHash, displayName, tempUnit],
  );

  return res.rows[0];
}

/**
 * Finds a user by normalized email address.
 */
export async function findUserByEmail(
  client: Queryable,
  email: string,
): Promise<UserRecord | null> {
  const normalizedEmail = normalizeEmail(email);

  const res = await executeQuery<UserRecord>(
    client,
    `SELECT id, email, password_hash, display_name, temperature_unit, email_verified_at, created_at, updated_at
     FROM users
     WHERE email = $1;`,
    [normalizedEmail],
  );

  return res.rows[0] ?? null;
}

/**
 * Finds a user by internal UUID primary key.
 */
export async function findUserById(
  client: Queryable,
  id: string,
): Promise<UserRecord | null> {
  const res = await executeQuery<UserRecord>(
    client,
    `SELECT id, email, password_hash, display_name, temperature_unit, email_verified_at, created_at, updated_at
     FROM users
     WHERE id = $1;`,
    [id],
  );

  return res.rows[0] ?? null;
}

/**
 * Locks the user row FOR UPDATE within an active transaction.
 * Mandatory protocol for serialized auth token issuance per docs/database/production-cutover.md.
 */
export async function lockUserForUpdate(
  client: Queryable,
  id: string,
): Promise<UserRecord | null> {
  const res = await executeQuery<UserRecord>(
    client,
    `SELECT id, email, password_hash, display_name, temperature_unit, email_verified_at, created_at, updated_at
     FROM users
     WHERE id = $1
     FOR UPDATE;`,
    [id],
  );

  return res.rows[0] ?? null;
}

/**
 * Updates a user's email_verified_at timestamp upon successful token consumption.
 */
export async function markEmailVerified(
  client: Queryable,
  userId: string,
): Promise<UserRecord | null> {
  const res = await executeQuery<UserRecord>(
    client,
    `UPDATE users
     SET email_verified_at = now(),
         updated_at = now()
     WHERE id = $1
     RETURNING id, email, password_hash, display_name, temperature_unit, email_verified_at, created_at, updated_at;`,
    [userId],
  );

  return res.rows[0] ?? null;
}

/**
 * Deletes a user by internal UUID (e.g. rollback when initial verification email delivery fails).
 */
export async function deleteUserById(
  client: Queryable,
  userId: string,
): Promise<void> {
  await executeQuery(
    client,
    `DELETE FROM users WHERE id = $1;`,
    [userId],
  );
}

/**
 * Updates a user's password hash and marks email verified if currently unverified.
 */
export async function updateUserPassword(
  client: Queryable,
  userId: string,
  passwordHash: string,
): Promise<UserRecord | null> {
  const res = await executeQuery<UserRecord>(
    client,
    `UPDATE users
     SET password_hash = $2,
         email_verified_at = COALESCE(email_verified_at, now()),
         updated_at = now()
     WHERE id = $1
     RETURNING id, email, password_hash, display_name, temperature_unit, email_verified_at, created_at, updated_at;`,
    [userId, passwordHash],
  );

  return res.rows[0] ?? null;
}
