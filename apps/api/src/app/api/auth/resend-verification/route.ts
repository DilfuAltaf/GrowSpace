import { NextResponse, type NextRequest } from 'next/server';
import { AppError, errorResponse, jsonError } from '@/lib/api-error';
import {
  authService,
  buildVerificationUrl,
  consumeRateLimit,
  deleteAuthTokenById,
  getAuthDb,
  getAuthMailer,
  getClientIp,
  getSessionTokenFromRequest,
  resendVerificationRequestSchema,
  supersedeOtherAuthTokens,
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

    const db = getAuthDb();
    const clientIp = getClientIp(request);
    const sessionToken = getSessionTokenFromRequest(request);

    let targetUserId: string | undefined;
    let targetEmail: string | undefined;

    // 2. Resolve caller: either authenticated session or public email body
    if (sessionToken) {
      const validated = await authService.validateSession(db, sessionToken);

      // Enforce CSRF verification for cookie-authenticated mutation
      const csrfCheck = validateSessionCsrfToken(request, validated.session);
      if (!csrfCheck.valid) {
        return jsonError(403, 'csrf_detected', csrfCheck.reason ?? 'Invalid or missing CSRF token.');
      }

      targetUserId = validated.user.id;
      targetEmail = validated.user.email;
    } else {
      // Unauthenticated public resend request
      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        return jsonError(400, 'invalid_json', 'Malformed JSON in request body.');
      }

      const parsed = resendVerificationRequestSchema.parse(body);
      if (!parsed.email) {
        return jsonError(400, 'email_required', 'Email address is required to resend verification.');
      }
      targetEmail = parsed.email;
    }

    // 3. Rate limiting: IP level (10 attempts / hour)
    const ipLimit = await consumeRateLimit(db, {
      action: 'verify_resend',
      scope: 'ip',
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
            message: 'Too many resend attempts from this network. Please try again later.',
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

    // 4. Rate limiting: Account / User level (3 attempts / 15 minutes)
    const accountIdentifier = targetUserId ?? targetEmail ?? 'unknown';
    const accountLimit = await consumeRateLimit(db, {
      action: 'verify_resend',
      scope: 'account',
      identifier: accountIdentifier,
      maxAttempts: 3,
      windowMs: 15 * 60 * 1000,
      blockDurationMs: 15 * 60 * 1000,
    });

    if (!accountLimit.allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'rate_limited',
            message: 'Too many resend attempts for this account. Please try again later.',
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

    // 5. Execution via AuthService
    const resendResult = await authService.resendVerification(db, {
      userId: targetUserId,
      email: targetEmail,
    });

    // 6. Deliver verification link if account is unverified and token was generated
    if (!resendResult.alreadyVerified && resendResult.rawToken && resendResult.email && resendResult.userId && resendResult.tokenId) {
      const verificationLink = buildVerificationUrl(resendResult.rawToken);
      const mailer = getAuthMailer();

      try {
        await mailer.sendVerification(resendResult.email, verificationLink);
        // Only supersede older tokens after successful email delivery
        await supersedeOtherAuthTokens(db, resendResult.userId, 'email_verification', resendResult.tokenId);
      } catch {
        // Rollback undelivered token on failure so previous valid token remains usable
        await deleteAuthTokenById(db, resendResult.tokenId);
        throw new AppError(
          503,
          'email_delivery_failed',
          'Unable to send verification email. Please try again later.',
        );
      }
    }

    // 7. Generic Accepted (202) response to resist account enumeration
    return NextResponse.json(
      { message: 'If this email requires verification, a new link has been sent.' },
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
