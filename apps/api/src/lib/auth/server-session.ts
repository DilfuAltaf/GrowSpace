import type { NextRequest } from 'next/server';
import { AppError } from '../api-error';
import { authService, type ValidateSessionResult } from './auth-service';
import { getSessionTokenFromRequest } from './cookies';
import { getAuthDb } from './db-provider';

/**
 * Validates the first-party session cookie for incoming API requests.
 * Enforces server-side checks for revocation, absolute expiration (7d), and idle timeout (24h).
 * Throws AppError(401, 'unauthenticated') on missing, expired, or revoked sessions.
 */
export async function requireFirstPartySession(
  request: NextRequest,
  options: { touch?: boolean } = { touch: true },
): Promise<ValidateSessionResult> {
  const token = getSessionTokenFromRequest(request);

  if (!token) {
    throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
  }

  const db = getAuthDb();
  return authService.validateSession(db, token, options);
}

/**
 * Validates the first-party session cookie AND confirms the user has verified their email address.
 * Throws AppError(403, 'email_unverified') if the account's email has not been confirmed.
 */
export async function requireVerifiedFirstPartySession(
  request: NextRequest,
  options: { touch?: boolean } = { touch: true },
): Promise<ValidateSessionResult> {
  const session = await requireFirstPartySession(request, options);

  if (!session.user.emailVerified) {
    throw new AppError(
      403,
      'email_unverified',
      'Please verify your email address to access this resource.',
    );
  }

  return session;
}
