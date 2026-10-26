interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export interface ResearchRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Checks in-memory rate limit for AI plant research requests.
 * Defaults to 10 requests per 5 minutes per user.
 */
export function checkResearchRateLimit(
  userId: string,
  options: { maxRequests?: number; windowMs?: number } = {},
): ResearchRateLimitResult {
  const maxRequests = options.maxRequests ?? 10;
  const windowMs = options.windowMs ?? 5 * 60 * 1000;
  const now = Date.now();

  const entry = rateLimitStore.get(userId);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(userId, {
      count: 1,
      resetAt: now + windowMs,
    });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      retryAfterSeconds: 0,
    };
  }

  if (entry.count >= maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    retryAfterSeconds: 0,
  };
}

/**
 * Resets the in-memory research rate limit store. Useful for testing.
 */
export function resetResearchRateLimits(): void {
  rateLimitStore.clear();
}
