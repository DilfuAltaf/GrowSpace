import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  createGarden,
  deleteGarden,
  fetchGarden,
  fetchGardens,
  updateGarden,
  ApiClientError,
} from './api';
import { firstPartyAuthClient } from '@/features/auth/first-party-client';

describe('Garden Management Frontend API Client', () => {
  const originalFetch = globalThis.fetch;
  let recordedRequests: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    recordedRequests = [];
    (firstPartyAuthClient as unknown as { inMemoryCsrfToken: string | null }).inMemoryCsrfToken = null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (firstPartyAuthClient as unknown as { inMemoryCsrfToken: string | null }).inMemoryCsrfToken = null;
  });

  function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      recordedRequests.push({ url, init: init ?? {} });
      return handler(url, init ?? {});
    };
  }

  it('1. fetchGardens: issues GET /api/gardens with credentials include and returns array', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/gardens');
      assert.equal(init.method ?? 'GET', 'GET');
      assert.equal(init.credentials, 'include');
      return new Response(
        JSON.stringify({
          gardens: [
            {
              id: 'g-1',
              userId: 'u-1',
              name: 'Patio Garden',
              description: 'Outdoor pots',
              locationLabel: 'Patio',
              growingMethod: 'container',
              imageUrl: null,
              createdAt: '2026-10-23T00:00:00.000Z',
              updatedAt: '2026-10-23T00:00:00.000Z',
              plantCount: 3,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchGardens();
    assert.equal(res.gardens.length, 1);
    assert.equal(res.gardens[0]?.name, 'Patio Garden');
    assert.equal(res.gardens[0]?.plantCount, 3);
  });

  it('2. fetchGarden: issues GET /api/gardens/:id with credentials and returns single garden', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/gardens/00000000-0000-0000-0000-000000000001');
      assert.equal(init.credentials, 'include');
      return new Response(
        JSON.stringify({
          garden: {
            id: '00000000-0000-0000-0000-000000000001',
            userId: 'u-1',
            name: 'Balcony Herbs',
            description: null,
            locationLabel: '2nd Floor Balcony',
            growingMethod: 'container',
            imageUrl: null,
            createdAt: '2026-10-23T00:00:00.000Z',
            updatedAt: '2026-10-23T00:00:00.000Z',
            plantCount: 0,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchGarden('00000000-0000-0000-0000-000000000001');
    assert.equal(res.garden.name, 'Balcony Herbs');
    assert.equal(res.garden.locationLabel, '2nd Floor Balcony');
  });

  it('3. createGarden: issues POST /api/gardens with CSRF token and JSON body', async () => {
    mockFetch((url, init) => {
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'valid-csrf-token' }), { status: 200 });
      }

      assert.equal(url, '/api/gardens');
      assert.equal(init.method, 'POST');
      assert.equal(init.credentials, 'include');

      const headers = new Headers(init.headers);
      assert.equal(headers.get('content-type'), 'application/json');
      assert.equal(headers.get('x-csrf-token'), 'valid-csrf-token');

      const parsed = JSON.parse(init.body as string);
      assert.equal(parsed.name, 'Hydroponic Tower');
      assert.equal(parsed.growingMethod, 'hydroponic');

      return new Response(
        JSON.stringify({
          garden: {
            id: 'new-id',
            userId: 'u-1',
            name: 'Hydroponic Tower',
            description: null,
            locationLabel: null,
            growingMethod: 'hydroponic',
            imageUrl: null,
            createdAt: '2026-10-23T00:00:00.000Z',
            updatedAt: '2026-10-23T00:00:00.000Z',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await createGarden({
      name: 'Hydroponic Tower',
      growingMethod: 'hydroponic',
    });

    assert.equal(res.garden.id, 'new-id');
    assert.equal(res.garden.name, 'Hydroponic Tower');
  });

  it('4. updateGarden: issues PATCH /api/gardens/:id with CSRF token and updated payload', async () => {
    mockFetch((url, init) => {
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'valid-csrf-token' }), { status: 200 });
      }

      assert.equal(url, '/api/gardens/g-1');
      assert.equal(init.method, 'PATCH');
      assert.equal(init.credentials, 'include');

      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-csrf-token'), 'valid-csrf-token');

      const parsed = JSON.parse(init.body as string);
      assert.equal(parsed.name, 'Renovated Garden');

      return new Response(
        JSON.stringify({
          garden: {
            id: 'g-1',
            userId: 'u-1',
            name: 'Renovated Garden',
            description: null,
            locationLabel: null,
            growingMethod: null,
            imageUrl: null,
            createdAt: '2026-10-23T00:00:00.000Z',
            updatedAt: '2026-10-23T00:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await updateGarden('g-1', { name: 'Renovated Garden' });
    assert.equal(res.garden.name, 'Renovated Garden');
  });

  it('5. deleteGarden: sends DELETE with CSRF and handles 204 No Content', async () => {
    mockFetch((url, init) => {
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'valid-csrf-token' }), { status: 200 });
      }

      assert.equal(url, '/api/gardens/g-empty');
      assert.equal(init.method, 'DELETE');
      assert.equal(init.credentials, 'include');

      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-csrf-token'), 'valid-csrf-token');

      return new Response(null, { status: 204 });
    });

    await deleteGarden('g-empty');
    assert.ok(true, 'delete completed without throwing');
  });

  it('6. deleteGarden with cascade: appends ?cascade=true to URL query', async () => {
    mockFetch((url, init) => {
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'valid-csrf-token' }), { status: 200 });
      }

      assert.equal(url, '/api/gardens/g-with-plants?cascade=true');
      assert.equal(init.method, 'DELETE');
      return new Response(null, { status: 204 });
    });

    await deleteGarden('g-with-plants', { cascade: true });
    assert.ok(true, 'cascade delete request executed');
  });

  it('7. ApiClientError handles 409 Conflict garden_not_empty with error code and message', async () => {
    mockFetch((url) => {
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'valid-csrf-token' }), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          error: {
            code: 'garden_not_empty',
            message: 'This garden contains 2 plant(s). Remove the plants first or confirm cascade deletion.',
          },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    });

    await assert.rejects(
      async () => deleteGarden('g-full'),
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.status, 409);
        assert.equal(err.code, 'garden_not_empty');
        assert.match(err.message, /contains 2 plant/i);
        return true;
      },
    );
  });
});
