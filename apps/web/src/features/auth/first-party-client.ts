import type { ApiErrorBody } from '@growspace/shared';
import {
  FirstPartyAuthError,
  type AuthMessageResponse,
  type CsrfResponse,
  type FirstPartyLoginInput,
  type FirstPartyRegisterInput,
  type SessionResponse,
  type SessionUser,
} from './types';

export class FirstPartyAuthClient {
  private readonly baseUrl: string;
  private inMemoryCsrfToken: string | null = null;

  constructor(baseUrl?: string) {
    const defaultUrl =
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
      (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL) ||
      '';
    this.baseUrl = (baseUrl ?? defaultUrl).replace(/\/$/, '');
  }

  /**
   * Internal fetch wrapper ensuring strict credentials inclusion and standard headers.
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    requireCsrf = false,
  ): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');

    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    if (requireCsrf) {
      const csrf = await this.getCsrfToken();
      if (csrf) {
        headers.set('X-CSRF-Token', csrf);
      }
    }

    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include', // Always include HttpOnly session and CSRF cookies
    });

    if (!res.ok) {
      let body: ApiErrorBody | null;
      try {
        body = (await res.json()) as ApiErrorBody;
      } catch {
        body = null;
      }

      // If a CSRF rejection occurs, invalidate the cached token
      if (res.status === 403 && body?.error.code === 'csrf_detected') {
        this.inMemoryCsrfToken = null;
      }

      throw new FirstPartyAuthError(res.status, body);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  /**
   * Fetches the current session and resolves the authenticated SessionUser.
   * Caches the returned session-bound CSRF token in-memory.
   * Returns null if unauthenticated (401), without throwing.
   */
  async getSession(): Promise<SessionUser | null> {
    try {
      const data = await this.request<SessionResponse>('/api/auth/session', {
        method: 'GET',
      });

      if (data.csrfToken) {
        this.inMemoryCsrfToken = data.csrfToken;
      }

      return data.user;
    } catch (err: unknown) {
      if (err instanceof FirstPartyAuthError && err.status === 401) {
        this.inMemoryCsrfToken = null;
        return null;
      }
      throw err;
    }
  }

  /**
   * Retrieves the CSRF token. Returns the in-memory cached token if present,
   * or fetches a fresh CSRF token from GET /api/auth/csrf.
   */
  async getCsrfToken(): Promise<string> {
    if (this.inMemoryCsrfToken) {
      return this.inMemoryCsrfToken;
    }

    const data = await this.request<CsrfResponse>('/api/auth/csrf', {
      method: 'GET',
    });

    this.inMemoryCsrfToken = data.csrfToken;
    return data.csrfToken;
  }

  /**
   * Authenticates using email and password.
   * Upon success, the server sets HttpOnly session and CSRF cookies and returns the SessionUser.
   */
  async login(credentials: FirstPartyLoginInput): Promise<SessionUser> {
    const data = await this.request<{ user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: credentials.email.trim(),
        password: credentials.password,
      }),
    });

    // Refresh session to synchronize in-memory CSRF token
    await this.getSession().catch(() => undefined);

    return data.user;
  }

  /**
   * Registers a new account.
   * Returns generic 202 Accepted message. In accordance with the unverified account policy,
   * registration does not immediately set an active session cookie.
   */
  async register(input: FirstPartyRegisterInput): Promise<AuthMessageResponse> {
    return this.request<AuthMessageResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email.trim(),
        password: input.password,
        displayName: input.displayName?.trim() || undefined,
        temperatureUnit: input.temperatureUnit,
      }),
    });
  }

  /**
   * Logs out the current session. Requires CSRF verification and clears cookies on the client.
   */
  async logout(): Promise<void> {
    try {
      await this.request<void>(
        '/api/auth/logout',
        {
          method: 'POST',
        },
        true, // Require CSRF token
      );
    } finally {
      this.inMemoryCsrfToken = null;
    }
  }

  /**
   * Verifies an email address using an opaque one-time token from a link fragment.
   */
  async verifyEmail(token: string): Promise<AuthMessageResponse> {
    return this.request<AuthMessageResponse>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token: token.trim() }),
    });
  }

  /**
   * Dispatches a fresh email verification link.
   */
  async resendVerification(email?: string): Promise<AuthMessageResponse> {
    return this.request<AuthMessageResponse>('/api/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({
        email: email?.trim() || undefined,
      }),
    });
  }

  /**
   * Requests a password reset link.
   */
  async forgotPassword(email: string): Promise<AuthMessageResponse> {
    return this.request<AuthMessageResponse>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim() }),
    });
  }

  /**
   * Resets the password using an opaque one-time token and new password.
   */
  async resetPassword(token: string, password: string): Promise<AuthMessageResponse> {
    return this.request<AuthMessageResponse>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        token: token.trim(),
        password,
      }),
    });
  }

  /**
   * Securely extracts a token from a URL fragment (e.g. `#token=<opaque>`),
   * preventing sensitive recovery tokens from being leaked via query strings,
   * Referer headers, or client-side analytics.
   *
   * Optionally scrubs the hash from browser history if window is available.
   */
  extractTokenFromFragment(fragment: string, scrubHistory = true): string | null {
    if (!fragment) return null;
    const cleanHash = fragment.startsWith('#') ? fragment.slice(1) : fragment;
    const params = new URLSearchParams(cleanHash);
    const token = params.get('token')?.trim();

    if (token && scrubHistory && typeof window !== 'undefined' && window.history?.replaceState) {
      // Remove hash from the browser address bar to prevent logging/analytics leakage
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    return token || null;
  }
}

export const firstPartyAuthClient = new FirstPartyAuthClient();
