import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { setDatabaseProbeOverride } from '@/lib/health';
import { GET as healthHandler } from './route';

const originalGroqKey = process.env.GROQ_API_KEY;
const originalGroqModel = process.env.GROQ_MODEL;
const originalTavilyKey = process.env.TAVILY_API_KEY;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalEmailKey = process.env.EMAIL_PROVIDER_API_KEY;
const originalRateLimitSecret = process.env.RATE_LIMIT_SECRET;

describe('GET /api/health readiness contract', () => {
  beforeEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MODEL;
    delete process.env.TAVILY_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.EMAIL_PROVIDER_API_KEY;
    delete process.env.RATE_LIMIT_SECRET;
  });

  afterEach(() => {
    setDatabaseProbeOverride(null);

    if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqKey;

    if (originalGroqModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = originalGroqModel;

    if (originalTavilyKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalTavilyKey;

    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;

    if (originalEmailKey === undefined) delete process.env.EMAIL_PROVIDER_API_KEY;
    else process.env.EMAIL_PROVIDER_API_KEY = originalEmailKey;

    if (originalRateLimitSecret === undefined) delete process.env.RATE_LIMIT_SECRET;
    else process.env.RATE_LIMIT_SECRET = originalRateLimitSecret;
  });

  it('returns 200 and status ok when the database is reachable', async () => {
    setDatabaseProbeOverride(async () => 'ok');
    const res = await healthHandler();
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'growspace-api');
    assert.equal(body.database, 'ok');
    assert.equal(body.databaseConfigured, false);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.ok(body.timestamp);
  });

  it('returns 200 with AI providers marked unavailable when optional credentials are absent', async () => {
    setDatabaseProbeOverride(async () => 'ok');
    const res = await healthHandler();
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.aiProviders.groqConfigured, false);
    assert.equal(body.aiProviders.searchConfigured, false);
    assert.equal(body.aiProviders.searchProvider, null);
    assert.equal(body.authConfigured.emailDelivery, false);
    assert.equal(body.authConfigured.rateLimiting, false);
  });

  it('reads provider readiness from the server environment without exposing values', async () => {
    process.env.GROQ_API_KEY = 'gsk_super_secret_test_value';
    process.env.TAVILY_API_KEY = 'tvly_super_secret_test_value';
    process.env.EMAIL_PROVIDER_API_KEY = 're_super_secret_test_value';
    process.env.RATE_LIMIT_SECRET = 'super-secret-rate-limit-value-32-chars';
    setDatabaseProbeOverride(async () => 'ok');

    const res = await healthHandler();
    const raw = JSON.stringify(await res.json());

    assert.equal(res.status, 200);
    assert.match(raw, /"groqConfigured":true/);
    assert.match(raw, /"searchProvider":"tavily"/);
    assert.match(raw, /"emailDelivery":true/);
    assert.match(raw, /"rateLimiting":true/);
    assert.ok(!raw.includes('gsk_super_secret_test_value'));
    assert.ok(!raw.includes('tvly_super_secret_test_value'));
    assert.ok(!raw.includes('re_super_secret_test_value'));
    assert.ok(!raw.includes('super-secret-rate-limit-value-32-chars'));
  });

  it('returns 503 and degraded when the database is unreachable', async () => {
    setDatabaseProbeOverride(async () => 'unreachable');
    const res = await healthHandler();
    const body = await res.json();

    assert.equal(res.status, 503);
    assert.equal(body.status, 'degraded');
    assert.equal(body.database, 'unreachable');
  });

  it('returns 503 and degraded when DATABASE_URL is not configured', async () => {
    setDatabaseProbeOverride(async () => 'not_configured');
    const res = await healthHandler();
    const body = await res.json();

    assert.equal(res.status, 503);
    assert.equal(body.database, 'not_configured');
    assert.equal(body.databaseConfigured, false);
  });
});
