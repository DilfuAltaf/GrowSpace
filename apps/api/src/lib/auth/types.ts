export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  temperature_unit: 'celsius' | 'fahrenheit';
  email_verified_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
  temperatureUnit: 'celsius' | 'fahrenheit';
  emailVerified: boolean;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  token_hash: Buffer | string;
  csrf_token_hash: Buffer | string;
  created_at: Date | string;
  last_used_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
}

export interface CreateUserData {
  email: string;
  passwordHash: string;
  displayName?: string | null;
  temperatureUnit?: 'celsius' | 'fahrenheit';
}

export interface CreateSessionData {
  userId: string;
  tokenHash: Buffer;
  csrfTokenHash: Buffer;
  expiresAt: Date;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string | null;
  temperatureUnit?: 'celsius' | 'fahrenheit';
}

export interface LoginInput {
  email: string;
  password: string;
}

export type AuthRateLimitAction = 'login' | 'register' | 'password_reset' | 'verify_resend';

export interface RateLimitOptions {
  action: AuthRateLimitAction;
  scope?: string;
  identifier: string;
  windowMs?: number;
  maxAttempts?: number;
  blockDurationMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds?: number;
}
