import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse, jsonError } from '@/lib/api-error';
import {
  authService,
  clearSessionCookies,
  generateRandomToken,
  getAuthDb,
  getCsrfTokenFromCookie,
  getSessionTokenFromRequest,
  hashToken,
  timingSafeBufferEqual,
} from '@/lib/auth/index';
import { executeQuery } from '@/lib/auth/db-client';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const sessionToken = getSessionTokenFromRequest(request);

    if (!sessionToken) {
      return jsonError(401, 'unauthenticated', 'Sign in to continue.');
    }

    const db = getAuthDb();
    let validated;

    try {
      validated = await authService.validateSession(db, sessionToken);
    } catch {
      // Clear cookies and return non-disclosing 401 on expired, revoked, or idle-timed-out session
      const failureResponse = jsonError(401, 'unauthenticated', 'Sign in to continue.');
      clearSessionCookies(failureResponse);
      return failureResponse;
    }

    // Resolve or refresh CSRF token
    let csrfToken = getCsrfTokenFromCookie(request);
    let shouldSetCsrfCookie = false;

    // Verify whether incoming CSRF cookie matches the session's hash in database
    const storedHash = Buffer.isBuffer(validated.session.csrf_token_hash)
      ? validated.session.csrf_token_hash
      : Buffer.from(validated.session.csrf_token_hash);

    const matchesStored = csrfToken && timingSafeBufferEqual(hashToken(csrfToken), storedHash);

    if (!matchesStored) {
      // Regenerate fresh CSRF token and update session record
      csrfToken = generateRandomToken(32);
      const newHash = hashToken(csrfToken);
      await executeQuery(
        db,
        `UPDATE sessions SET csrf_token_hash = $1 WHERE id = $2;`,
        [newHash, validated.sessionId],
      );
      shouldSetCsrfCookie = true;
    }

    const response = NextResponse.json(
      {
        user: validated.user,
        csrfToken,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );

    if (shouldSetCsrfCookie && csrfToken) {
      const isProduction = process.env.NODE_ENV === 'production';
      response.cookies.set({
        name: isProduction ? '__Host-gs_csrf' : 'gs_csrf',
        value: csrfToken,
        httpOnly: false,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
      });
    }

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
