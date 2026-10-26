import type { NextRequest } from 'next/server';
import { AppError } from './api-error';
import { authService, type ValidateSessionResult } from './auth/auth-service';
import { getSessionTokenFromRequest } from './auth/cookies';
import { validateRequestOrigin, validateSessionCsrfToken } from './auth/csrf';
import { getAuthDb } from './auth/db-provider';
import type { SessionRecord } from './auth/types';

export interface AuthenticatedUser {
  uid: string;
  id: string;
  email: string | null;
  name: string | null;
  displayName: string | null;
  emailVerified: boolean;
  authProvider: 'first_party';
  temperatureUnit?: 'celsius' | 'fahrenheit';
  sessionId?: string;
  session?: SessionRecord;
}

export interface RequireUserOptions {
  requireVerified?: boolean;
  touchSession?: boolean;
}

export function readBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

/**
 * Pure first-party session authentication resolver.
 *
 * Validates authoritative session cookies (`gs_session` / `__Host-gs_session`)
 * against Neon PostgreSQL `sessions`.
 *
 * Security Guarantees:
 * - Validates credentials cryptographically against Neon PostgreSQL; never trusts raw headers or cookies blindly.
 * - Strict Fail-Closed: Missing, invalid, expired, or revoked sessions reject with 401 unauthenticated.
 * - No Bearer Token Acceptance: Rejects Authorization: Bearer tokens with 401 unauthenticated ("Bearer token authentication has been retired. Please sign in with your credentials.").
 * - CSRF & Origin Enforcement: On mutating calls (POST, PUT, PATCH, DELETE), Origin and session-bound CSRF are strictly enforced.
 * - Canonical Identity: Always resolves to canonical Neon user UUID (`user.id`).
 */
export async function requireUser(
  request: NextRequest,
  options?: RequireUserOptions,
): Promise<AuthenticatedUser> {
  const bearerToken = readBearerToken(request);
  if (bearerToken) {
    throw new AppError(
      401,
      'unauthenticated',
      'Bearer token authentication has been retired. Please sign in with your credentials.',
    );
  }

  const sessionToken = getSessionTokenFromRequest(request);
  if (!sessionToken) {
    throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
  }

  const db = getAuthDb();
  let sessionResult: ValidateSessionResult;

  try {
    sessionResult = await authService.validateSession(db, sessionToken, {
      touch: options?.touchSession ?? true,
    });
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
  }

  // Mutating CSRF & Origin enforcement
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase());
  if (isMutating) {
    const originCheck = validateRequestOrigin(request, { requireOriginIfCookiePresent: true });
    if (!originCheck.valid) {
      throw new AppError(403, 'forbidden_origin', originCheck.reason ?? 'Forbidden request origin.');
    }

    const csrfCheck = validateSessionCsrfToken(request, sessionResult.session);
    if (!csrfCheck.valid) {
      throw new AppError(403, 'csrf_detected', csrfCheck.reason ?? 'Invalid or missing CSRF token.');
    }
  }

  if (options?.requireVerified && !sessionResult.user.emailVerified) {
    throw new AppError(
      403,
      'email_unverified',
      'Please verify your email address to access this resource.',
    );
  }

  return {
    uid: sessionResult.user.id,
    id: sessionResult.user.id,
    email: sessionResult.user.email,
    name: sessionResult.user.displayName,
    displayName: sessionResult.user.displayName,
    emailVerified: sessionResult.user.emailVerified,
    authProvider: 'first_party',
    temperatureUnit: sessionResult.user.temperatureUnit,
    sessionId: sessionResult.sessionId,
    session: sessionResult.session,
  };
}

/**
 * Convenient alias for requireUser with email-verification enforcement.
 */
export async function requireVerifiedUser(
  request: NextRequest,
  options?: Omit<RequireUserOptions, 'requireVerified'>,
): Promise<AuthenticatedUser> {
  return requireUser(request, { ...options, requireVerified: true });
}

/**
 * Exported alias to resolve authenticated caller.
 */
export const resolveAuthUser = requireUser;

/**
 * Validates that an accessed resource is owned by the authenticated caller.
 * Strictly verifies against the canonical Neon user UUID.
 */
export function assertOwnership(resourceUserId: string, user: AuthenticatedUser): void {
  if (resourceUserId !== user.id) {
    throw new AppError(403, 'forbidden', 'You do not have access to this record.');
  }
}
