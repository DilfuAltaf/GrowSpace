import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse, jsonError } from '@/lib/api-error';
import {
  authService,
  clearSessionCookies,
  findSessionWithUser,
  getAuthDb,
  getSessionTokenFromRequest,
  hashToken,
  validateRequestOrigin,
  validateSessionCsrfToken,
} from '@/lib/auth/index';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // 1. Origin verification
    const originCheck = validateRequestOrigin(request);
    if (!originCheck.valid) {
      return jsonError(403, 'forbidden_origin', originCheck.reason ?? 'Forbidden request origin.');
    }

    const sessionToken = getSessionTokenFromRequest(request);
    const db = getAuthDb();

    // 2. If a session token is provided, enforce CSRF validation before mutating state
    if (sessionToken) {
      const tokenHash = hashToken(sessionToken);
      const resolved = await findSessionWithUser(db, tokenHash);

      if (resolved && !resolved.session.revoked_at) {
        // Enforce session-bound CSRF token verification
        const csrfCheck = validateSessionCsrfToken(request, resolved.session);
        if (!csrfCheck.valid) {
          return jsonError(403, 'csrf_detected', csrfCheck.reason ?? 'Invalid or missing CSRF token.');
        }

        // Revoke active session in database
        await authService.logout(db, sessionToken);
      }
    }

    // 3. Clear session and CSRF cookies on client with Max-Age=0
    const response = new NextResponse(null, {
      status: 204,
      headers: {
        'Cache-Control': 'no-store',
      },
    });

    clearSessionCookies(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
