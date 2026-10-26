import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse } from '@/lib/api-error';
import {
  authService,
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
    const isProduction = process.env.NODE_ENV === 'production';
    const csrfCookieName = isProduction ? '__Host-gs_csrf' : 'gs_csrf';
    const db = getAuthDb();

    let csrfToken = getCsrfTokenFromCookie(request);

    if (sessionToken) {
      try {
        const validated = await authService.validateSession(db, sessionToken);
        const storedHash = Buffer.isBuffer(validated.session.csrf_token_hash)
          ? validated.session.csrf_token_hash
          : Buffer.from(validated.session.csrf_token_hash);

        const matchesStored = csrfToken && timingSafeBufferEqual(hashToken(csrfToken), storedHash);

        if (!matchesStored) {
          csrfToken = generateRandomToken(32);
          const newHash = hashToken(csrfToken);
          await executeQuery(
            db,
            `UPDATE sessions SET csrf_token_hash = $1 WHERE id = $2;`,
            [newHash, validated.sessionId],
          );
        }
      } catch {
        csrfToken = generateRandomToken(32);
      }
    } else if (!csrfToken) {
      csrfToken = generateRandomToken(32);
    }

    if (!csrfToken) {
      csrfToken = generateRandomToken(32);
    }

    const response = NextResponse.json(
      { csrfToken },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );

    response.cookies.set({
      name: csrfCookieName,
      value: csrfToken,
      httpOnly: false,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
