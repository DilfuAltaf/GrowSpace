import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse, jsonError } from '@/lib/api-error';
import {
  authService,
  clearSessionCookies,
  consumeRateLimit,
  getAuthDb,
  getClientIp,
  resetPasswordRequestSchema,
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

    // 2. IP-based rate limiting (20 attempts per hour per IP)
    const ipLimit = await consumeRateLimit(db, {
      action: 'password_reset',
      scope: 'reset_ip',
      identifier: clientIp,
      maxAttempts: 20,
      windowMs: 60 * 60 * 1000,
      blockDurationMs: 60 * 60 * 1000,
    });

    if (!ipLimit.allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'rate_limited',
            message: 'Too many password reset attempts. Please try again later.',
          },
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(ipLimit.retryAfterSeconds ?? 3600),
            'Cache-Control': 'no-store',
          },
        },
      );
    }

    // 3. Request body parsing
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'invalid_json', 'Malformed JSON in request body.');
    }

    // 4. Schema validation
    const parsed = resetPasswordRequestSchema.parse(body);

    // 5. Execute atomic transaction: consume token, update password hash, revoke sessions, verify email
    await authService.resetPassword(db, {
      token: parsed.token,
      password: parsed.password,
    });

    // 6. Build response and clear any active session cookies to enforce re-authentication
    const response = NextResponse.json(
      {
        message: 'Password has been reset successfully. Please sign in with your new password.',
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );

    clearSessionCookies(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
