import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse, jsonError } from '@/lib/api-error';
import {
  authService,
  buildPasswordResetUrl,
  consumeRateLimit,
  forgotPasswordRequestSchema,
  getAuthDb,
  getAuthMailer,
  getClientIp,
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

    // 2. IP-based rate limiting (10 requests per hour per IP)
    const ipLimit = await consumeRateLimit(db, {
      action: 'password_reset',
      scope: 'forgot_ip',
      identifier: clientIp,
      maxAttempts: 10,
      windowMs: 60 * 60 * 1000,
      blockDurationMs: 60 * 60 * 1000,
    });

    if (!ipLimit.allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'rate_limited',
            message: 'Too many password reset requests from this network. Please try again later.',
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

    // 3. Body parsing
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'invalid_json', 'Malformed JSON in request body.');
    }

    // 4. Schema validation
    const parsed = forgotPasswordRequestSchema.parse(body);

    // 5. Account-level rate limiting (3 requests per 15 minutes per normalized email)
    const normalizedEmail = parsed.email.trim().toLowerCase();
    const accountLimit = await consumeRateLimit(db, {
      action: 'password_reset',
      scope: 'forgot_account',
      identifier: normalizedEmail,
      maxAttempts: 3,
      windowMs: 15 * 60 * 1000,
      blockDurationMs: 15 * 60 * 1000,
    });

    if (!accountLimit.allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'rate_limited',
            message: 'Too many password reset requests for this account. Please try again later.',
          },
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(accountLimit.retryAfterSeconds ?? 900),
            'Cache-Control': 'no-store',
          },
        },
      );
    }

    // 6. Issue single-use token or execute dummy work to prevent enumeration
    const result = await authService.forgotPassword(db, parsed.email);

    // 7. Deliver reset email if account exists
    if (result.isExistingAccount && result.rawToken && result.email && result.tokenId && result.userId) {
      const resetLink = buildPasswordResetUrl(result.rawToken);
      const mailer = getAuthMailer();

      try {
        await mailer.sendPasswordReset(result.email, resetLink);
        // Step 7A: ONLY after successful email handoff do we supersede prior active reset tokens
        await authService.finalizePasswordResetDispatch(db, result.userId, result.tokenId);
      } catch (err: unknown) {
        // Log sanitized provider warning without sensitive token, email, or credentials
        console.error(
          '[auth] Password reset email dispatch failed:',
          err instanceof Error ? err.message : 'Unknown provider error',
        );
        // Step 7B: Rollback the undelivered token so it does not linger.
        // Previously usable reset links remain valid and are not destroyed by provider failures.
        await authService.rollbackFailedResetDispatch(db, result.tokenId);
        // Do not expose email delivery failure to client: return constant 202 to maintain enumeration resistance
      }
    }

    // 8. Uniform 202 Accepted response for both existing and nonexistent accounts
    return NextResponse.json(
      { message: 'If an account matching that email exists, a password reset link has been sent.' },
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
