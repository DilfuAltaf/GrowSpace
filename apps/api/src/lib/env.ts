export const DEFAULT_DEV_ORIGIN = 'http://localhost:5173';

/**
 * Normalizes and validates a single configured browser origin.
 * Origins are compared byte-for-byte against the browser `Origin` header, which
 * never carries a trailing slash, path, query, or fragment. Configuring
 * "https://growspace.app/" would silently reject every mutating request, so the
 * trailing slash is normalized away and any other path content is rejected.
 */
function normalizeOrigin(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`ALLOWED_ORIGINS contains an invalid origin: "${raw}".`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`ALLOWED_ORIGINS entry must use http:// or https://: "${raw}".`);
  }

  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error(
      `ALLOWED_ORIGINS entries must be bare origins (scheme://host[:port]), received: "${raw}".`,
    );
  }

  return parsed.origin;
}

/**
 * Resolves the allowlist used for CORS responses and CSRF Origin validation.
 *
 * - Development/test default to the Vite dev server when unset.
 * - Production fails closed: an unset or empty allowlist throws instead of
 *   silently trusting a localhost default or accepting arbitrary origins.
 * - Invalid entries fail fast with a descriptive (non-secret) message.
 */
export function getAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS;

  const entries = (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ALLOWED_ORIGINS must be configured in production with the exact browser origin(s) that serve the SPA.',
      );
    }
    return [DEFAULT_DEV_ORIGIN];
  }

  return Array.from(new Set(entries.map(normalizeOrigin)));
}

export function getDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();

  if (!value) {
    throw new Error(
      'DATABASE_URL is not configured. Add it to apps/api/.env.local or load the repository root .env before starting the API.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use the postgres:// or postgresql:// protocol.');
  }

  return value;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * Reports whether transactional email delivery is configured, without revealing
 * the credential. Registration and password reset cannot deliver links without it.
 */
export function isEmailConfigured(): boolean {
  return Boolean(
    (process.env.EMAIL_PROVIDER_API_KEY ?? process.env.RESEND_API_KEY)?.trim(),
  );
}

/**
 * Reports whether the auth rate limiter secret is configured. Login, registration,
 * and password reset fail closed (500) when it is missing.
 */
export function isRateLimitConfigured(): boolean {
  return Boolean(process.env.RATE_LIMIT_SECRET?.trim());
}

export function getGroqApiKey(): string | null {
  const value = process.env.GROQ_API_KEY?.trim();
  return value ? value : null;
}

export function getGroqModel(): string {
  const value = process.env.GROQ_MODEL?.trim();
  return value || 'llama-3.3-70b-versatile';
}

export interface SearchConfig {
  provider: 'tavily' | 'brave';
  apiKey: string;
}

export function getSearchConfig(): SearchConfig | null {
  const preferred = process.env.SEARCH_PROVIDER?.trim().toLowerCase();
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  const braveKey = process.env.BRAVE_SEARCH_API_KEY?.trim();

  if (preferred === 'brave' && braveKey) {
    return { provider: 'brave', apiKey: braveKey };
  }
  if (preferred === 'tavily' && tavilyKey) {
    return { provider: 'tavily', apiKey: tavilyKey };
  }

  // Auto-detect if not explicitly specified
  if (tavilyKey) {
    return { provider: 'tavily', apiKey: tavilyKey };
  }
  if (braveKey) {
    return { provider: 'brave', apiKey: braveKey };
  }

  return null;
}
