import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  DEFAULT_DEV_ORIGIN,
  getAllowedOrigins,
  getDatabaseUrl,
  getGroqApiKey,
  getGroqModel,
  getSearchConfig,
  isEmailConfigured,
  isRateLimitConfigured,
} from './env';

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalGroqKey = process.env.GROQ_API_KEY;
const originalGroqModel = process.env.GROQ_MODEL;
const originalTavilyKey = process.env.TAVILY_API_KEY;
const originalBraveKey = process.env.BRAVE_SEARCH_API_KEY;
const originalSearchProvider = process.env.SEARCH_PROVIDER;
const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;
const originalNodeEnv = process.env.NODE_ENV;
const originalEmailKey = process.env.EMAIL_PROVIDER_API_KEY;
const originalResendKey = process.env.RESEND_API_KEY;
const originalRateLimitSecret = process.env.RATE_LIMIT_SECRET;

// NODE_ENV is typed as read-only by Next.js; tests still need to exercise production mode.
function setNodeEnv(value: string | undefined): void {
  const envRecord = process.env as Record<string, string | undefined>;
  if (value === undefined) delete envRecord.NODE_ENV;
  else envRecord.NODE_ENV = value;
}

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;

  if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqKey;

  if (originalGroqModel === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = originalGroqModel;

  if (originalTavilyKey === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = originalTavilyKey;

  if (originalBraveKey === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
  else process.env.BRAVE_SEARCH_API_KEY = originalBraveKey;

  if (originalSearchProvider === undefined) delete process.env.SEARCH_PROVIDER;
  else process.env.SEARCH_PROVIDER = originalSearchProvider;

  if (originalAllowedOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = originalAllowedOrigins;

  setNodeEnv(originalNodeEnv);

  if (originalEmailKey === undefined) delete process.env.EMAIL_PROVIDER_API_KEY;
  else process.env.EMAIL_PROVIDER_API_KEY = originalEmailKey;

  if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalResendKey;

  if (originalRateLimitSecret === undefined) delete process.env.RATE_LIMIT_SECRET;
  else process.env.RATE_LIMIT_SECRET = originalRateLimitSecret;
});

test('returns the configured PostgreSQL connection URL', () => {
  const value = 'postgresql://growspace:test@localhost:5432/growspace';
  process.env.DATABASE_URL = value;

  assert.equal(getDatabaseUrl(), value);
});

test('accepts both postgres and postgresql protocols', () => {
  process.env.DATABASE_URL = 'postgres://growspace:test@localhost:5432/growspace';
  assert.equal(getDatabaseUrl(), process.env.DATABASE_URL);

  process.env.DATABASE_URL = 'postgresql://growspace:test@localhost:5432/growspace';
  assert.equal(getDatabaseUrl(), process.env.DATABASE_URL);
});

test('trims surrounding whitespace', () => {
  const value = 'postgresql://growspace:test@localhost:5432/growspace';
  process.env.DATABASE_URL = `  ${value}  `;

  assert.equal(getDatabaseUrl(), value);
});

test('throws a descriptive error when DATABASE_URL is missing', () => {
  delete process.env.DATABASE_URL;
  assert.throws(() => getDatabaseUrl(), /DATABASE_URL is not configured/);
});

test('rejects a non-PostgreSQL protocol', () => {
  process.env.DATABASE_URL = 'https://example.com/database';

  assert.throws(() => getDatabaseUrl(), /postgres:\/\/ or postgresql:\/\//);
});

test('does not include an invalid secret in the error message', () => {
  const invalidValue = 'this-value-must-not-appear-in-errors';
  process.env.DATABASE_URL = invalidValue;

  assert.throws(
    () => getDatabaseUrl(),
    (error: unknown) =>
      error instanceof Error &&
      /DATABASE_URL must be a valid PostgreSQL connection URL/.test(error.message) &&
      !error.message.includes(invalidValue),
  );
});

test('getGroqApiKey returns configured key and trims whitespace, or null when absent', () => {
  delete process.env.GROQ_API_KEY;
  assert.equal(getGroqApiKey(), null);

  process.env.GROQ_API_KEY = '   ';
  assert.equal(getGroqApiKey(), null);

  process.env.GROQ_API_KEY = '  gsk_test12345  ';
  assert.equal(getGroqApiKey(), 'gsk_test12345');
});

test('getGroqModel returns configured model or defaults to llama-3.3-70b-versatile', () => {
  delete process.env.GROQ_MODEL;
  assert.equal(getGroqModel(), 'llama-3.3-70b-versatile');

  process.env.GROQ_MODEL = 'llama-3.1-8b-instant';
  assert.equal(getGroqModel(), 'llama-3.1-8b-instant');
});

test('getAllowedOrigins defaults to the Vite dev origin outside production', () => {
  delete process.env.ALLOWED_ORIGINS;
  setNodeEnv('development');
  assert.deepEqual(getAllowedOrigins(), [DEFAULT_DEV_ORIGIN]);
});

test('getAllowedOrigins parses, trims, and normalizes a comma-separated allowlist', () => {
  process.env.ALLOWED_ORIGINS =
    ' https://growspace.example/ , https://www.growspace.example , https://growspace.example ';

  assert.deepEqual(getAllowedOrigins(), [
    'https://growspace.example',
    'https://www.growspace.example',
  ]);
});

test('getAllowedOrigins rejects malformed entries instead of silently ignoring them', () => {
  process.env.ALLOWED_ORIGINS = 'https://growspace.example/app';
  assert.throws(() => getAllowedOrigins(), /bare origins/);

  process.env.ALLOWED_ORIGINS = 'not-a-url';
  assert.throws(() => getAllowedOrigins(), /invalid origin/);

  process.env.ALLOWED_ORIGINS = 'ftp://growspace.example';
  assert.throws(() => getAllowedOrigins(), /http:\/\/ or https:\/\//);
});

test('getAllowedOrigins fails closed when unset in production', () => {
  delete process.env.ALLOWED_ORIGINS;
  setNodeEnv('production');

  assert.throws(() => getAllowedOrigins(), /ALLOWED_ORIGINS must be configured in production/);
});

test('getAllowedOrigins honors an explicit production allowlist', () => {
  setNodeEnv('production');
  process.env.ALLOWED_ORIGINS = 'https://growspace.example';

  assert.deepEqual(getAllowedOrigins(), ['https://growspace.example']);
});

test('provider readiness helpers report configuration without exposing values', () => {
  delete process.env.EMAIL_PROVIDER_API_KEY;
  delete process.env.RESEND_API_KEY;
  delete process.env.RATE_LIMIT_SECRET;
  assert.equal(isEmailConfigured(), false);
  assert.equal(isRateLimitConfigured(), false);

  process.env.RESEND_API_KEY = 're_test_key';
  process.env.RATE_LIMIT_SECRET = 'x'.repeat(32);
  assert.equal(isEmailConfigured(), true);
  assert.equal(isRateLimitConfigured(), true);

  process.env.EMAIL_PROVIDER_API_KEY = 're_override_key';
  delete process.env.RESEND_API_KEY;
  assert.equal(isEmailConfigured(), true);
});

test('getSearchConfig returns correct provider and API key with fallback resolution', () => {
  delete process.env.TAVILY_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.SEARCH_PROVIDER;
  assert.equal(getSearchConfig(), null);

  process.env.TAVILY_API_KEY = 'tvly-secret';
  assert.deepEqual(getSearchConfig(), { provider: 'tavily', apiKey: 'tvly-secret' });

  delete process.env.TAVILY_API_KEY;
  process.env.BRAVE_SEARCH_API_KEY = 'BSA-secret';
  assert.deepEqual(getSearchConfig(), { provider: 'brave', apiKey: 'BSA-secret' });

  // Preferred provider overrides order
  process.env.TAVILY_API_KEY = 'tvly-secret';
  process.env.BRAVE_SEARCH_API_KEY = 'BSA-secret';
  process.env.SEARCH_PROVIDER = 'brave';
  assert.deepEqual(getSearchConfig(), { provider: 'brave', apiKey: 'BSA-secret' });
});

