import type { ApiErrorBody, SessionUser, TemperatureUnit } from '@growspace/shared';

export type { SessionUser, TemperatureUnit };

export type AuthProviderType = 'first_party';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthUser {
  id: string;
  uid?: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  temperatureUnit?: TemperatureUnit;
}

export interface FirstPartyLoginInput {
  email: string;
  password: string;
}

export interface FirstPartyRegisterInput {
  email: string;
  password: string;
  displayName?: string | null;
  temperatureUnit?: TemperatureUnit;
}

export interface SessionResponse {
  user: SessionUser;
  csrfToken?: string;
}

export interface CsrfResponse {
  csrfToken: string;
}

export interface AuthMessageResponse {
  message: string;
}

export class FirstPartyAuthError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(status: number, body: ApiErrorBody | null, fallbackMessage?: string) {
    super(body?.error?.message ?? fallbackMessage ?? 'Authentication request failed.');
    this.name = 'FirstPartyAuthError';
    this.status = status;
    this.code = body?.error?.code ?? 'unknown_error';
    this.fieldErrors = body?.error?.fieldErrors;
  }
}
