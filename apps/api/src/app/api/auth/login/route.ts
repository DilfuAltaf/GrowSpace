import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse, jsonError } from '@/lib/api-error';
import {
  authService,
  getAuthDb,
  getClientIp,
  loginRequestSchema,
  setSessionCookies,
  validateRequestOrigin,
} from '@/lib/auth/index';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // 1. Origin verification
    const originCheck = validateRequestOrigin(request);
    if (!originCheck.valid) {
      return jsonError(403, 'forbidden_origin', originCheck.reason ?? 'Forbidden request origin.');
    }

    const db = getAuthDb();
    const clientIp = getClientIp(request);

    // 2. Request body parsing
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'invalid_json', 'Malformed JSON in request body.');
    }

    // 3. Schema validation
    const parsed = loginRequestSchema.parse(body);

    // 4. Authenticate credentials, enforce rate-limits, and create opaque session
    const result = await authService.login(
      db,
      {
        email: parsed.email,
        password: parsed.password,
      },
      { ip: clientIp },
    );

    // 5. Successful login response:
    // Session token is strictly set in HttpOnly cookie; never exposed in JSON payload.
    // CSRF token is provided in both cookie and JSON response to support same-origin and cross-origin SPAs.
    const response = NextResponse.json(
      {
        user: result.user,
        csrfToken: result.csrfToken,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );

    setSessionCookies(response, result.sessionToken, result.csrfToken);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
