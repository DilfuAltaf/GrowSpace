import { NextResponse, type NextRequest } from 'next/server';
import { AppError, errorResponse, jsonError } from '@/lib/api-error';
import {
  authService,
  buildVerificationUrl,
  consumeRateLimit,
  deleteUserById,
  getAuthDb,
  getAuthMailer,
  getClientIp,
  registerRequestSchema,
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

    // 2. IP-based rate limiting (5 attempts per hour per IP)
    const rateLimit = await consumeRateLimit(db, {
      action: 'register',
      scope: 'ip',
      identifier: clientIp,
      maxAttempts: 5,
      windowMs: 60 * 60 * 1000,
      blockDurationMs: 60 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'rate_limited',
            message: 'Too many registration attempts. Please try again later.',
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

    // 3. Request body parsing
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'invalid_json', 'Malformed JSON in request body.');
    }

    // 4. Schema validation
    const parsed = registerRequestSchema.parse(body);

    // 5. Registration execution via AuthService (Argon2id password hashing + serialized verification token)
    const regResult = await authService.register(db, {
      email: parsed.email,
      password: parsed.password,
      displayName: parsed.displayName,
      temperatureUnit: parsed.temperatureUnit,
    });

    // 6. Deliver verification email if brand-new account
    const mailer = getAuthMailer();

    if (!regResult.isExistingAccount && regResult.rawVerificationToken) {
      const verificationUrl = buildVerificationUrl(regResult.rawVerificationToken);

      try {
        await mailer.sendVerification(parsed.email, verificationUrl);
      } catch {
        // Rollback unverified user so the user does not become permanently locked out or unusable
        if (regResult.userId) {
          try {
            await deleteUserById(db, regResult.userId);
          } catch {
            // Ignore rollback failure
          }
        }
        throw new AppError(
          503,
          'email_delivery_failed',
          'Unable to send verification email. Please try again later.',
        );
      }
    }

    // 7. Generic Accepted (202) response to resist account enumeration.
    // No session cookie is created and response is completely identical for new vs existing accounts.
    return NextResponse.json(
      { message: 'If this email can be registered, a verification link has been sent.' },
      {
        status: 202,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
