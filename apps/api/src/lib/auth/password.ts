import { hash, verify, type Algorithm, type Options } from '@node-rs/argon2';

/**
 * Standard OWASP-aligned Argon2id parameters matching docs/auth/architecture.md.
 * Algorithm 2 = Argon2id (default in @node-rs/argon2).
 */
export const ARGON2ID_OPTIONS: Options = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,       // 2 iterations
  outputLen: 32,     // 32-byte digest
  parallelism: 1,    // 1 lane
  algorithm: 2 as unknown as Algorithm, // Argon2id
};

/**
 * Precomputed valid Argon2id hash used to mitigate timing side-channel attacks
 * when a login request targets a non-existent email.
 */
const DUMMY_TIMING_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$uSp4VHVMdG/D9DObyRw8Wg$5lJC0NOzFldQDM/2eLz3JqMki+n5H7LRR1WvY3xXJuo';

/**
 * Validates password length and composition against the GrowSpace security policy.
 * Policy: 12-128 characters, max 1024 UTF-8 bytes, not whitespace-only.
 * Note: Password is never trimmed to preserve intentional leading/trailing characters.
 */
export function validatePasswordPolicy(password: string): { valid: boolean; error?: string } {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password must be a string.' };
  }

  if (password.trim().length === 0) {
    return { valid: false, error: 'Password cannot be empty or whitespace only.' };
  }

  if (password.length < 12) {
    return { valid: false, error: 'Password must be at least 12 characters long.' };
  }

  if (password.length > 128) {
    return { valid: false, error: 'Password must be 128 characters or fewer.' };
  }

  if (Buffer.byteLength(password, 'utf8') > 1024) {
    return { valid: false, error: 'Password exceeds maximum byte limit.' };
  }

  return { valid: true };
}

/**
 * Encodes a plaintext password into an Argon2id PHC string hash.
 * Output strictly starts with `$argon2id$` to satisfy the database check constraint.
 */
export async function hashPassword(password: string): Promise<string> {
  const policy = validatePasswordPolicy(password);
  if (!policy.valid) {
    throw new Error(`Password policy violation: ${policy.error}`);
  }

  return hash(password, ARGON2ID_OPTIONS);
}

/**
 * Verifies a plaintext password against an Argon2id PHC encoded hash.
 * Safely handles invalid or malformed hash strings by returning false instead of throwing.
 */
export async function verifyPassword(hashString: string, password: string): Promise<boolean> {
  if (typeof hashString !== 'string' || !hashString.startsWith('$argon2id$')) {
    return false;
  }

  try {
    return await verify(hashString, password);
  } catch {
    return false;
  }
}

/**
 * Performs a constant-work dummy verification against a static hash
 * to equalize execution time between valid and invalid usernames.
 */
export async function dummyVerifyPassword(): Promise<void> {
  try {
    await verify(DUMMY_TIMING_HASH, 'dummy-guess-constant-time');
  } catch {
    // Ignore dummy verification errors
  }
}
