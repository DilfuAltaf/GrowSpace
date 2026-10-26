interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const assistantRateLimitStore = new Map<string, RateLimitEntry>();

export interface AssistantRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Checks in-memory rate limit for AI Farming Assistant requests.
 * Defaults to 20 requests per 5 minutes per user.
 */
export function checkAssistantRateLimit(
  userId: string,
  options: { maxRequests?: number; windowMs?: number } = {},
): AssistantRateLimitResult {
  const maxRequests = options.maxRequests ?? 20;
  const windowMs = options.windowMs ?? 5 * 60 * 1000;
  const now = Date.now();

  const entry = assistantRateLimitStore.get(userId);

  if (!entry || now > entry.resetAt) {
    assistantRateLimitStore.set(userId, {
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
 * Resets the in-memory assistant rate limit store. Useful for testing.
 */
export function resetAssistantRateLimits(): void {
  assistantRateLimitStore.clear();
}
