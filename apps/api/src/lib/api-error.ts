import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@growspace/shared';

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

const SENSITIVE_LOG_PATTERNS: RegExp[] = [
  /postgres(?:ql)?:\/\/[^\s"']+/gi,
  /\bgsk_[A-Za-z0-9_-]{8,}/g,
  /\btvly-[A-Za-z0-9_-]{8,}/g,
  /\bBSA[A-Za-z0-9_-]{8,}/g,
  /\bre_[A-Za-z0-9_-]{16,}/g,
];

/**
 * Redacts credentials that driver or SDK error messages can embed, so server logs
 * never persist connection strings or provider keys.
 */
export function redactSensitiveText(text: string): string {
  return SENSITIVE_LOG_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, '[redacted]'),
    text,
  );
}

export function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors } },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_error',
          message: 'Some fields need attention.',
          fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
        },
      },
      { status: 422 },
    );
  }

  const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error('[api] unhandled error', redactSensitiveText(details));
  return NextResponse.json(
    { error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } },
    { status: 500 },
  );
}

export function jsonError(
  status: number,
  code: string,
  message: string,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message } }, { status });
}
