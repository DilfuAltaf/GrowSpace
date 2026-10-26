import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { FirstPartyAuthClient } from './first-party-client';
import { FirstPartyAuthError } from './types';
import { getAuthProvider, isFirstPartyAuthEnabled } from './auth-config';
import { safeRedirect } from './protected-route';
import { authErrorMessage } from './auth-context';
import { apiFetch, ApiClientError } from '@/lib/api';

describe('First-Party Auth Frontend Foundation', () => {
  const originalFetch = globalThis.fetch;
  let client: FirstPartyAuthClient;
  let recordedRequests: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    recordedRequests = [];
    client = new FirstPartyAuthClient('http://localhost:3001');

    // Clean mock environment storage
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      recordedRequests.push({ url, init: init ?? {} });
      return handler(url, init ?? {});
    };
  }

  it('1. Auth Provider: First-party auth is the sole and unconditional provider', () => {
    assert.equal(getAuthProvider(), 'first_party', 'Provider must always be first_party');
    assert.equal(isFirstPartyAuthEnabled(), true, 'First-party auth must always be enabled');
  });

  it('2. Session Restoration: getSession includes credentials, parses SessionUser, and caches CSRF token', async () => {
    mockFetch((url, init) => {
      assert.equal(url, 'http://localhost:3001/api/auth/session');
      assert.equal(init.credentials, 'include', 'Must include credentials for session cookie');
      return new Response(
        JSON.stringify({
          user: {
            id: 'usr-123',
            email: 'user@growspace.org',
            displayName: 'Gardener',
            temperatureUnit: 'celsius',
            emailVerified: true,
            createdAt: '2026-10-22T00:00:00Z',
          },
          csrfToken: 'test-csrf-token-1234567890123456',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const user = await client.getSession();
    assert.ok(user);
    assert.equal(user.id, 'usr-123');
    assert.equal(user.email, 'user@growspace.org');
    assert.equal(user.emailVerified, true);

    // Verify CSRF was cached without another network request
    const csrf = await client.getCsrfToken();
    assert.equal(csrf, 'test-csrf-token-1234567890123456');
    assert.equal(recordedRequests.length, 1, 'getCsrfToken should use in-memory cache');
  });

  it('3. getSession: on 401 returns null and does NOT mark user as authenticated', async () => {
    mockFetch(() => {
      return new Response(
        JSON.stringify({
          error: { code: 'unauthenticated', message: 'Sign in to continue.' },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const user = await client.getSession();
    assert.equal(user, null, 'Unauthenticated session must resolve to null, not throw');
  });

  it('4. Logout: sends credentials and attaches X-CSRF-Token header, then clears cache', async () => {
    mockFetch((url) => {
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'active-csrf-token-abc' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/logout')) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    });

    await client.getCsrfToken();
    assert.equal(recordedRequests.length, 1);

    await client.logout();
    assert.equal(recordedRequests.length, 2);

    const logoutReq = recordedRequests[1];
    assert.ok(logoutReq);
    assert.equal(logoutReq.url, 'http://localhost:3001/api/auth/logout');
    assert.equal(logoutReq.init.credentials, 'include');
    const headers = new Headers(logoutReq.init.headers);
    assert.equal(headers.get('X-CSRF-Token'), 'active-csrf-token-abc');

    // Ensure CSRF token cache was cleared on logout
    mockFetch((url) => {
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'new-csrf-token-xyz' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 404 });
    });

    const newCsrf = await client.getCsrfToken();
    assert.equal(newCsrf, 'new-csrf-token-xyz', 'Subsequent CSRF call must fetch fresh token');
  });

  it('5. Successful Login: posts trimmed email and password, includes credentials, and returns SessionUser', async () => {
    mockFetch((url, init) => {
      assert.equal(url, 'http://localhost:3001/api/auth/login');
      assert.equal(init.credentials, 'include');
      const body = JSON.parse(init.body as string);
      assert.equal(body.email, 'login@growspace.org');
      assert.equal(body.password, 'SecretPass123!');

      return new Response(
        JSON.stringify({
          user: {
            id: 'usr-456',
            email: 'login@growspace.org',
            displayName: null,
            temperatureUnit: 'fahrenheit',
            emailVerified: true,
            createdAt: '2026-10-22T00:00:00Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const user = await client.login({
      email: '  login@growspace.org  ',
      password: 'SecretPass123!',
    });

    assert.equal(user.id, 'usr-456');
    assert.equal(user.temperatureUnit, 'fahrenheit');
  });

  it('6. Failed Login: throws FirstPartyAuthError with 401 status and invalid_credentials code', async () => {
    mockFetch(() => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'invalid_credentials',
            message: 'Email or password is incorrect.',
          },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    });

    await assert.rejects(
      async () => client.login({ email: 'wrong@growspace.org', password: 'WrongPassword123!' }),
      (err: unknown) => {
        assert.ok(err instanceof FirstPartyAuthError);
        assert.equal(err.status, 401);
        assert.equal(err.code, 'invalid_credentials');
        assert.equal(err.message, 'Email or password is incorrect.');
        return true;
      },
    );
  });

  it('7. Registration Request: posts payload with credentials and handles generic 202 response', async () => {
    mockFetch((url, init) => {
      assert.equal(url, 'http://localhost:3001/api/auth/register');
      assert.equal(init.credentials, 'include');
      const body = JSON.parse(init.body as string);
      assert.equal(body.email, 'newuser@growspace.org');
      assert.equal(body.password, 'NewSecurePassword123!');
      assert.equal(body.displayName, 'New User');

      return new Response(
        JSON.stringify({
          message: 'If that email address is eligible, a confirmation link has been sent.',
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const res = await client.register({
      email: 'newuser@growspace.org',
      password: 'NewSecurePassword123!',
      displayName: 'New User',
    });

    assert.ok(res.message.includes('confirmation link has been sent'));
  });

  it('8. Storage Isolation: Client NEVER writes session tokens to localStorage or sessionStorage', async () => {
    mockFetch(() => {
      return new Response(
        JSON.stringify({
          user: { id: 'usr-secure', email: 'sec@growspace.org', emailVerified: true },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    await client.login({ email: 'sec@growspace.org', password: 'Pass1234567890!' });

    if (typeof localStorage !== 'undefined') {
      assert.equal(localStorage.length, 0, 'localStorage must contain zero keys');
    }
    if (typeof sessionStorage !== 'undefined') {
      assert.equal(sessionStorage.length, 0, 'sessionStorage must contain zero keys');
    }
  });

  it('9. extractTokenFromFragment: correctly parses token from hash fragment and scrubs history', () => {
    const rawToken = 'abcdef1234567890abcdef1234567890';
    const fragment = `#token=${rawToken}`;
    const extracted = client.extractTokenFromFragment(fragment, false);
    assert.equal(extracted, rawToken);

    // Empty or malformed fragments return null
    assert.equal(client.extractTokenFromFragment('', false), null);
    assert.equal(client.extractTokenFromFragment('#other=value', false), null);

    // Test history scrubbing when window is present
    let scrubbedUrl = '';
    const fakeWindow = {
      location: { pathname: '/reset-password', search: '?source=email', hash: fragment },
      history: {
        replaceState: (_data: unknown, _unused: string, url: string) => {
          scrubbedUrl = url;
        },
      },
    };
    (globalThis as unknown as { window: unknown }).window = fakeWindow;

    const scrubbedToken = client.extractTokenFromFragment(fragment, true);
    assert.equal(scrubbedToken, rawToken);
    assert.equal(scrubbedUrl, '/reset-password?source=email', 'Fragment must be scrubbed from history');

    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('10. safeRedirect: securely validates paths and prevents open redirects', () => {
    // Valid same-origin relative paths
    assert.equal(safeRedirect('/dashboard'), '/dashboard');
    assert.equal(safeRedirect('/plants/123'), '/plants/123');
    assert.equal(safeRedirect('/settings?tab=profile#section'), '/settings?tab=profile#section');

    // Defaults to fallback on empty/null
    assert.equal(safeRedirect(null), '/dashboard');
    assert.equal(safeRedirect(''), '/dashboard');
    assert.equal(safeRedirect(null, '/plants'), '/plants');

    // Protocol-relative URLs (open redirect attacks)
    assert.equal(safeRedirect('//evil.com'), '/dashboard');
    assert.equal(safeRedirect('//attacker.org/steal'), '/dashboard');

    // Windows backslash traversal / bypasses
    assert.equal(safeRedirect('/\\evil.com'), '/dashboard');
    assert.equal(safeRedirect('\\evil.com'), '/dashboard');
    assert.equal(safeRedirect('/\\/\\evil.com'), '/dashboard');

    // Full external URLs
    assert.equal(safeRedirect('https://evil.com'), '/dashboard');
    assert.equal(safeRedirect('http://evil.com/path'), '/dashboard');

    // Dangerous URI schemes
    assert.equal(safeRedirect('javascript:alert(1)'), '/dashboard');
    assert.equal(safeRedirect('data:text/html,<script>alert(1)</script>'), '/dashboard');
  });

  it('11. authErrorMessage: accurately maps first-party error codes', () => {
    assert.equal(
      authErrorMessage(
        new FirstPartyAuthError(401, { error: { code: 'invalid_credentials', message: 'Bad creds' } }),
      ),
      'Email or password is incorrect.',
    );
    assert.equal(
      authErrorMessage(
        new FirstPartyAuthError(429, { error: { code: 'rate_limited', message: 'Too fast' } }),
      ),
      'Too many attempts. Wait a moment and try again.',
    );
    assert.equal(
      authErrorMessage(
        new FirstPartyAuthError(403, { error: { code: 'email_unverified', message: 'Verify' } }),
      ),
      'Please verify your email address before signing in.',
    );
    assert.equal(
      authErrorMessage(
        new FirstPartyAuthError(403, { error: { code: 'forbidden_origin', message: 'Origin' } }),
      ),
      'Untrusted request origin.',
    );
    assert.equal(
      authErrorMessage(
        new FirstPartyAuthError(403, { error: { code: 'csrf_detected', message: 'CSRF' } }),
      ),
      'Security validation failed. Please refresh and try again.',
    );
    assert.equal(
      authErrorMessage(
        new FirstPartyAuthError(400, { error: { code: 'invalid_token', message: 'Expired' } }),
      ),
      'The link or token is invalid, expired, or has already been used.',
    );
    assert.equal(
      authErrorMessage(
        new FirstPartyAuthError(401, { error: { code: 'unauthenticated', message: 'Unauth' } }),
      ),
      'Sign in to continue.',
    );
    assert.equal(
      authErrorMessage(new Error('Generic failure')),
      'Generic failure',
    );
  });

  it('12. apiFetch: attaches credentials, manages CSRF for mutating calls, and dispatches session-expired on 401', async () => {
    // Mock firstPartyAuthClient CSRF response
    mockFetch((url, init) => {
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'active-api-csrf' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/test-get')) {
        assert.equal(init.credentials, 'include');
        const headers = new Headers(init.headers);
        assert.equal(headers.has('X-CSRF-Token'), false, 'GET request must NOT attach CSRF token');
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/test-post')) {
        assert.equal(init.credentials, 'include');
        const headers = new Headers(init.headers);
        assert.equal(headers.get('X-CSRF-Token'), 'active-api-csrf', 'Mutating request must attach CSRF token');
        return new Response(JSON.stringify({ created: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/expired')) {
        return new Response(JSON.stringify({ error: { code: 'session_expired', message: 'Expired' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 404 });
    });

    // 1. Non-mutating GET
    const getResult = await apiFetch<{ success: boolean }>('/api/test-get');
    assert.equal(getResult.success, true);

    // 2. Mutating POST
    const postResult = await apiFetch<{ created: boolean }>('/api/test-post', {
      method: 'POST',
      body: JSON.stringify({ name: 'Monstera' }),
    });
    assert.equal(postResult.created, true);

    // 3. 401 session-expired event dispatch
    let eventFired = false;
    const fakeWindow = {
      dispatchEvent: (event: CustomEvent) => {
        if (event.type === 'session-expired') {
          eventFired = true;
        }
        return true;
      },
    };
    (globalThis as unknown as { window: unknown }).window = fakeWindow;

    await assert.rejects(
      async () => apiFetch('/api/expired'),
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.status, 401);
        return true;
      },
    );

    assert.equal(eventFired, true, 'session-expired event must be dispatched on 401');

    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('13. No Firebase Bearer Token: apiFetch NEVER attaches Authorization Bearer header', async () => {
    mockFetch((_url, init) => {
      const headers = new Headers(init.headers);
      assert.equal(headers.has('Authorization'), false, 'Must NOT attach Authorization Bearer header');
      return new Response(JSON.stringify({ data: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    await apiFetch('/api/test-no-bearer');
    assert.equal(recordedRequests.length, 1);
    const req = recordedRequests[0];
    assert.ok(req);
    const headers = new Headers(req.init.headers);
    assert.equal(headers.has('Authorization'), false);
  });

  it('14. getSession Fail-Closed: network error or 500 server response throws and never yields user', async () => {
    mockFetch(() => {
      throw new Error('Network offline or connection refused');
    });

    await assert.rejects(
      async () => client.getSession(),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, 'Network offline or connection refused');
        return true;
      },
    );

    mockFetch(() => {
      return new Response(JSON.stringify({ error: { code: 'internal_error', message: 'DB down' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await assert.rejects(
      async () => client.getSession(),
      (err: unknown) => {
        assert.ok(err instanceof FirstPartyAuthError);
        assert.equal(err.status, 500);
        return true;
      },
    );
  });
});
