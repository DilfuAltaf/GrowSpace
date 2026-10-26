import type { NextRequest } from 'next/server';

/**
 * Validates a basic IPv4 or IPv6 address string.
 */
function isValidIp(ip: string): boolean {
  // IPv4 simple check
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    const parts = ip.split('.').map(Number);
    return parts.every((p) => p >= 0 && p <= 255);
  }

  // IPv6 simple check
  if (/^[a-fA-F0-9:]+$/.test(ip) && ip.includes(':')) {
    return true;
  }

  return false;
}

/**
 * Resolves trustworthy client IP address based on system configuration.
 * When TRUST_PROXY is not enabled (default), arbitrary X-Forwarded-For headers
 * are strictly ignored to prevent IP spoofing and rate-limiting bypass.
 */
export function getClientIp(request: NextRequest): string {
  const trustProxy = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';

  if (trustProxy) {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
      // In a reverse-proxy topology, client IP is the first entry in the comma-separated chain
      const firstIp = forwarded.split(',')[0].trim();
      if (isValidIp(firstIp)) {
        return firstIp;
      }
    }

    const realIp = request.headers.get('x-real-ip')?.trim();
    if (realIp && isValidIp(realIp)) {
      return realIp;
    }
  }

  // Fallback to Next.js request.ip (if runtime populates it) or safe local default
  // Note: arbitrary client-supplied headers are never trusted here
  const directIp = (request as { ip?: string }).ip;
  if (directIp && isValidIp(directIp)) {
    return directIp;
  }

  return '127.0.0.1';
}
