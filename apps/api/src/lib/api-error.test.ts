import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { AppError, errorResponse, jsonError, redactSensitiveText } from './api-error';

async function readBody(res: Response): Promise<{ error: { code: string; message: string } }> {
  return (await res.json()) as { error: { code: string; message: string } };
}

describe('API error handling', () => {
  it('serializes AppError status, code, and message', async () => {
    const res = errorResponse(new AppError(403, 'forbidden', 'You do not have access.'));
    const body = await readBody(res);

    assert.equal(res.status, 403);
    assert.equal(body.error.code, 'forbidden');
    assert.equal(body.error.message, 'You do not have access.');
  });

  it('maps Zod validation failures to 422 without echoing internals', async () => {
    const schema = z.object({ name: z.string().min(3) });
    const parsed = schema.safeParse({ name: 'x' });
    assert.equal(parsed.success, false);

    const res = errorResponse(parsed.error);
    const body = await readBody(res);

    assert.equal(res.status, 422);
    assert.equal(body.error.code, 'validation_error');
  });

  it('returns a generic 500 that never exposes the underlying error message', async () => {
    const res = errorResponse(
      new Error('connect failed for postgresql://growspace:hunter2@db.example/db'),
    );
    const body = await readBody(res);

    assert.equal(res.status, 500);
    assert.equal(body.error.code, 'internal_error');
    assert.ok(!JSON.stringify(body).includes('hunter2'));
  });

  it('redacts connection strings and provider keys from log text', () => {
    const text = [
      'failed: postgresql://user:password@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require',
      'groq gsk_abcdefghijklmnop',
      'tavily tvly-abcdefghijklmnop',
      'resend re_abcdefghijklmnopqrstuvwx',
    ].join(' | ');

    const redacted = redactSensitiveText(text);

    assert.ok(!redacted.includes('password@'));
    assert.ok(!redacted.includes('gsk_abcdefghijklmnop'));
    assert.ok(!redacted.includes('tvly-abcdefghijklmnop'));
    assert.ok(!redacted.includes('re_abcdefghijklmnopqrstuvwx'));
    assert.match(redacted, /\[redacted\]/);
  });

  it('jsonError builds a stable error envelope', async () => {
    const res = jsonError(429, 'rate_limited', 'Slow down.');
    const body = await readBody(res);

    assert.equal(res.status, 429);
    assert.equal(body.error.code, 'rate_limited');
  });
});
