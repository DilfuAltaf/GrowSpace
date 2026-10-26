import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { MAX_JSON_BODY_BYTES, proxy } from './proxy';
import { DEFAULT_DEV_ORIGIN } from './lib/env';

const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;
const originalNodeEnv = process.env.NODE_ENV;

// NODE_ENV is typed as read-only by Next.js; tests still need to exercise production mode.
function setNodeEnv(value: string | undefined): void {
  const envRecord = process.env as Record<string, string | undefined>;
  if (value === undefined) delete envRecord.NODE_ENV;
  else envRecord.NODE_ENV = value;
}

function request(
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): NextRequest {
  return new NextRequest(`http://localhost:3001${path}`, {
    method: options.method ?? 'GET',
    headers: options.headers,
  });
}

describe('Proxy: production CORS, origin enforcement, and request limits', () => {
  beforeEach(() => {
    delete process.env.ALLOWED_ORIGINS;
    setNodeEnv('test');
  });

  afterEach(() => {
    if (originalAllowedOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = originalAllowedOrigins;

    setNodeEnv(originalNodeEnv);
  });

  it('allows requests without an Origin header (server-to-server, same-origin GET)', () => {
    const res = proxy(request('/api/health'));
    assert.equal(res.headers.get('x-middleware-next'), '1');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('emits credentialed CORS headers for an allowlisted origin', () => {
    process.env.ALLOWED_ORIGINS = 'https://growspace.example';
    const res = proxy(
      request('/api/auth/session', { headers: { origin: 'https://growspace.example' } }),
    );

    assert.equal(res.headers.get('access-control-allow-origin'), 'https://growspace.example');
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(res.headers.get('vary'), 'Origin');
  });

  it('answers preflight for an allowlisted origin with 204 and allowed methods', () => {
    process.env.ALLOWED_ORIGINS = 'https://growspace.example';
    const res = proxy(
      request('/api/gardens', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://growspace.example',
          'access-control-request-method': 'POST',
        },
      }),
    );

    assert.equal(res.status, 204);
    assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/);
    assert.match(res.headers.get('access-control-allow-headers') ?? '', /X-CSRF-Token/);
  });

  it('rejects a non-allowlisted origin with 403 without CORS headers', () => {
    process.env.ALLOWED_ORIGINS = 'https://growspace.example';
    const res = proxy(
      request('/api/gardens', { headers: { origin: 'https://malicious-attacker.example' } }),
    );

    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('normalizes a trailing slash in ALLOWED_ORIGINS so browser Origin headers still match', () => {
    process.env.ALLOWED_ORIGINS = 'https://growspace.example/';
    const res = proxy(
      request('/api/gardens', { headers: { origin: 'https://growspace.example' } }),
    );

    assert.equal(res.headers.get('access-control-allow-origin'), 'https://growspace.example');
  });

  it('defaults to the Vite dev origin outside production', () => {
    const res = proxy(
      request('/api/gardens', { headers: { origin: DEFAULT_DEV_ORIGIN } }),
    );

    assert.equal(res.headers.get('access-control-allow-origin'), DEFAULT_DEV_ORIGIN);
  });

  it('fails closed with 503 when ALLOWED_ORIGINS is missing in production', async () => {
    setNodeEnv('production');
    const res = proxy(
      request('/api/auth/login', {
        method: 'POST',
        headers: { origin: 'https://growspace.example' },
      }),
    );

    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'service_misconfigured');
  });

  it('fails closed with 503 when ALLOWED_ORIGINS contains a path instead of a bare origin', () => {
    process.env.ALLOWED_ORIGINS = 'https://growspace.example/app';
    const res = proxy(
      request('/api/auth/login', { headers: { origin: 'https://growspace.example' } }),
    );

    assert.equal(res.status, 503);
  });

  it('rejects oversized JSON bodies with 413 before route handling', () => {
    const res = proxy(
      request('/api/assistant/chat', {
        method: 'POST',
        headers: {
          origin: DEFAULT_DEV_ORIGIN,
          'content-length': String(MAX_JSON_BODY_BYTES + 1),
        },
      }),
    );

    assert.equal(res.status, 413);
  });

  it('allows bodies at the size limit', () => {
    const res = proxy(
      request('/api/assistant/chat', {
        method: 'POST',
        headers: {
          origin: DEFAULT_DEV_ORIGIN,
          'content-length': String(MAX_JSON_BODY_BYTES),
        },
      }),
    );

    assert.equal(res.headers.get('x-middleware-next'), '1');
  });

  it('adds HSTS only in production', () => {
    process.env.ALLOWED_ORIGINS = 'https://growspace.example';
    const devRes = proxy(request('/api/health'));
    assert.equal(devRes.headers.get('strict-transport-security'), null);

    setNodeEnv('production');
    const prodRes = proxy(request('/api/health'));
    assert.match(prodRes.headers.get('strict-transport-security') ?? '', /max-age=31536000/);
  });
});
