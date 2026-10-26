import { createHash, createHmac, randomBytes, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';

/**
 * Generates an opaque cryptographically random string token.
 * Defaults to 32 bytes of high-entropy random data encoded as URL-safe base64.
 */
export function generateRandomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Computes the 32-byte binary SHA-256 digest of a raw token.
 * The raw token is sent to the client (in HttpOnly cookie or email link fragment),
 * while only this binary digest is persisted in `sessions.token_hash` or `auth_tokens.token_hash`.
 */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Computes a keyed binary HMAC-SHA-256 digest for rate-limiting counters.
 * Used for `auth_rate_limits.key_hash` (32 bytes binary).
 * Ensures IP addresses and emails are never persisted in plaintext.
 */
export function generateRateLimitKey(
  secret: string,
  action: string,
  scope: string,
  identifier: string,
): Buffer {
  const payload = `${action}:${scope}:${identifier.trim().toLowerCase()}`;
  return createHmac('sha256', secret).update(payload, 'utf8').digest();
}

/**
 * Timing-safe comparison of two token buffers of equal length.
 */
export function timingSafeBufferEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return cryptoTimingSafeEqual(a, b);
}
