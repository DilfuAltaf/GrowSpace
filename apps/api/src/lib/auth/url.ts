/**
 * Resolves the canonical and trusted public application origin for email links.
 * Strictly prevents using arbitrary client-supplied Host or Forwarded headers.
 */
export function getAppOrigin(): string {
  const configured = process.env.APP_ORIGIN?.trim();

  if (configured) {
    let parsed: URL;
    try {
      parsed = new URL(configured);
    } catch {
      throw new Error('APP_ORIGIN must be a valid URL.');
    }

    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      throw new Error('APP_ORIGIN must use the https:// protocol in production.');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('APP_ORIGIN must use http:// or https:// protocol.');
    }

    return parsed.origin;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_ORIGIN is not configured. An exact HTTPS origin is required in production.');
  }

  return 'http://localhost:5173';
}

/**
 * Builds a secure email verification link using fragment identifier.
 * Fragment identifiers (#token=...) are never transmitted over the network in Referer
 * headers or web server request logs, preventing token leakage.
 */
export function buildVerificationUrl(rawToken: string): string {
  const origin = getAppOrigin();
  return `${origin}/auth/verify-email#token=${encodeURIComponent(rawToken)}`;
}

/**
 * Builds a secure password reset link using fragment identifier.
 * Fragment identifiers (#token=...) are never transmitted over the network in Referer
 * headers or web server request logs, preventing token leakage.
 */
export function buildPasswordResetUrl(rawToken: string): string {
  const origin = getAppOrigin();
  return `${origin}/auth/reset-password#token=${encodeURIComponent(rawToken)}`;
}
