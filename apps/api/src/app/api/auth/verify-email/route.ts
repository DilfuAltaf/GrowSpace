import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse, jsonError } from '@/lib/api-error';
import {
  authService,
  consumeRateLimit,
  getAuthDb,
  getClientIp,
  validateRequestOrigin,
  verifyEmailRequestSchema,
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

    // 2. IP-based rate limiting (20 verification attempts per hour per IP)
    const rateLimit = await consumeRateLimit(db, {
      action: 'verify_resend',
      scope: 'verify_ip',
      identifier: clientIp,
      maxAttempts: 20,
      windowMs: 60 * 60 * 1000,
      blockDurationMs: 60 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'rate_limited',
            message: 'Too many verification attempts. Please try again later.',
          },
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimit.retryAfterSeconds ?? 3600),
            'Cache-Control': 'no-store',
          },
        },
      );
    }

    // 3. Body parsing
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'invalid_json', 'Malformed JSON in request body.');
    }

    // 4. Schema validation
    const parsed = verifyEmailRequestSchema.parse(body);

    // 5. Atomically consume token and update users.email_verified_at
    const verifiedUser = await authService.verifyEmail(db, parsed.token);

    return NextResponse.json(
      {
        message: 'Email verified successfully.',
        user: verifiedUser,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
