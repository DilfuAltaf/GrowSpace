import { Buffer } from 'node:buffer';
import type { NextRequest } from 'next/server';
import { getAllowedOrigins } from '../env';
import { getCsrfTokenFromCookie, getSessionTokenFromRequest } from './cookies';
import { hashToken, timingSafeBufferEqual } from './tokens';
import type { SessionRecord } from './types';

/**
 * Validates the syntax of a 32-byte base64url-encoded CSRF token (43 chars).
 */
export function isValidCsrfTokenFormat(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/**
 * Validates the Origin header against the explicit allowed origins list.
 * For browser requests, prevents cross-origin state-changing attacks.
 */
export function validateRequestOrigin(
  request: NextRequest,
  options: { requireOriginIfCookiePresent?: boolean } = { requireOriginIfCookiePresent: true },
): { valid: boolean; reason?: string } {
  const origin = request.headers.get('origin');
  const allowed = getAllowedOrigins();

  // 1. Explicit Origin header present
  if (origin) {
    if (allowed.includes(origin)) {
      return { valid: true };
    }
    return { valid: false, reason: `Origin '${origin}' is not in the allowed origins list.` };
  }

  // 2. Fallback to Referer header if Origin header was omitted
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (allowed.includes(refererOrigin)) {
        return { valid: true };
      }
      return { valid: false, reason: `Referer origin '${refererOrigin}' is not allowed.` };
    } catch {
      return { valid: false, reason: 'Malformed Referer header.' };
    }
  }

  // 3. Neither Origin nor Referer provided:
  // If the request carries a session cookie, it is an ambient-credentialed browser request
  // and MUST supply an Origin or Referer header on state-changing requests.
  const hasSessionCookie = Boolean(getSessionTokenFromRequest(request));
  if (options.requireOriginIfCookiePresent && hasSessionCookie) {
    return {
      valid: false,
      reason: 'State-changing cookie-authenticated request must provide a valid Origin header.',
    };
  }

  // Non-browser or direct requests without cookies
  return { valid: true };
}

/**
 * Validates session-bound double-submit CSRF token against the active session in PostgreSQL.
 *
 * Enforces:
 * 1. X-CSRF-Token header presence and 43-character base64url format.
 * 2. gs_csrf / __Host-gs_csrf cookie presence and format.
 * 3. Exact string match between header and cookie.
 * 4. Timing-safe cryptographic SHA-256 hash match against sessions.csrf_token_hash.
 */
export function validateSessionCsrfToken(
  request: NextRequest,
  session: SessionRecord,
): { valid: boolean; reason?: string } {
  const headerToken = request.headers.get('x-csrf-token')?.trim();
  const cookieToken = getCsrfTokenFromCookie(request);

  if (!headerToken) {
    return { valid: false, reason: 'Missing X-CSRF-Token header.' };
  }

  if (!isValidCsrfTokenFormat(headerToken)) {
    return { valid: false, reason: 'Malformed X-CSRF-Token header format.' };
  }

  if (!cookieToken) {
    return { valid: false, reason: 'Missing CSRF cookie.' };
  }

  if (!isValidCsrfTokenFormat(cookieToken)) {
    return { valid: false, reason: 'Malformed CSRF cookie format.' };
  }

  // Double-submit token equality check
  if (headerToken !== cookieToken) {
    return { valid: false, reason: 'CSRF header and cookie tokens do not match.' };
  }

  // Database-bound SHA-256 hash check using timing-safe comparison
  const calculatedHash = hashToken(headerToken);
  const storedHashBuffer = Buffer.isBuffer(session.csrf_token_hash)
    ? session.csrf_token_hash
    : Buffer.from(session.csrf_token_hash);

  if (!timingSafeBufferEqual(calculatedHash, storedHashBuffer)) {
    return { valid: false, reason: 'CSRF token is not valid for this active session.' };
  }

  return { valid: true };
}
