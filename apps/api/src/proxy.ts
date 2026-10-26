import { NextResponse, type NextRequest } from 'next/server';
import { getAllowedOrigins } from './lib/env';

/**
 * JSON API request bodies are small (largest assistant message is 2,000 characters).
 * Rejecting oversized payloads at the edge keeps every route handler from buffering
 * an attacker-controlled body before Zod validation runs.
 */
export const MAX_JSON_BODY_BYTES = 256 * 1024; // 256 KiB

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function applySecurityHeaders(response: NextResponse): void {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');

  // Only browsers on HTTPS honor HSTS; the API is served over HTTPS in production.
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function applyCorsHeaders(response: NextResponse, origin: string): void {
  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  response.headers.set(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-CSRF-Token',
  );
  response.headers.set('Access-Control-Max-Age', '600');
}

export function proxy(request: NextRequest) {
  let allowedOrigins: string[];

  try {
    allowedOrigins = getAllowedOrigins();
  } catch (error) {
    // Fail closed on missing/malformed origin configuration rather than serving
    // requests with an empty or defaulted allowlist.
    console.error('[proxy] Invalid ALLOWED_ORIGINS configuration:', (error as Error).message);
    const misconfigured = NextResponse.json(
      { error: { code: 'service_misconfigured', message: 'Server configuration error.' } },
      { status: 503 },
    );
    applySecurityHeaders(misconfigured);
    return misconfigured;
  }

  const origin = request.headers.get('origin');
  const isAllowed = Boolean(origin && allowedOrigins.includes(origin));

  if (origin && !isAllowed) {
    const rejected = NextResponse.json(
      { error: { code: 'origin_not_allowed', message: 'Request origin is not allowed.' } },
      { status: 403 },
    );
    rejected.headers.set('Vary', 'Origin');
    applySecurityHeaders(rejected);
    return rejected;
  }

  if (MUTATING_METHODS.has(request.method)) {
    const contentLength = Number(request.headers.get('content-length') ?? '0');

    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
      const tooLarge = NextResponse.json(
        {
          error: {
            code: 'payload_too_large',
            message: `Request body must not exceed ${MAX_JSON_BODY_BYTES} bytes.`,
          },
        },
        { status: 413 },
      );
      if (isAllowed && origin) applyCorsHeaders(tooLarge, origin);
      tooLarge.headers.set('Vary', 'Origin');
      applySecurityHeaders(tooLarge);
      return tooLarge;
    }
  }

  const response =
    request.method === 'OPTIONS'
      ? new NextResponse(null, { status: 204 })
      : NextResponse.next();

  if (isAllowed && origin) {
    applyCorsHeaders(response, origin);
  }

  response.headers.set('Vary', 'Origin');
  applySecurityHeaders(response);

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
