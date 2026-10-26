import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  createPlant,
  deletePlant,
  fetchPlant,
  fetchPlants,
  updatePlant,
  ApiClientError,
} from './api';
import { firstPartyAuthClient } from '@/features/auth/first-party-client';

describe('Plant Management Frontend API Client', () => {
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

  it('1. fetchPlants: issues GET /api/plants with credentials include and returns array', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/plants');
      assert.equal(init.method ?? 'GET', 'GET');
      assert.equal(init.credentials, 'include');
      return new Response(
        JSON.stringify({
          plants: [
            {
              id: 'p-1',
              userId: 'u-1',
              gardenId: 'g-1',
              catalogId: 'catalog-tomato',
              customName: 'Cherry Tomato',
              plantingDate: '2026-10-23',
              growthStage: 'seedling',
              status: 'active',
              expectedHarvestDate: '2026-12-25',
              actualHarvestDate: null,
              notes: 'Healthy starter',
              gardenName: 'Patio Garden',
              catalog: {
                id: 'catalog-tomato',
                slug: 'tomato',
                commonName: 'Tomato',
                category: 'Vegetables',
              },
              createdAt: '2026-10-23T00:00:00.000Z',
              updatedAt: '2026-10-23T00:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchPlants();
    assert.equal(res.plants.length, 1);
    assert.equal(res.plants[0]?.customName, 'Cherry Tomato');
    assert.equal(res.plants[0]?.gardenName, 'Patio Garden');
    assert.equal(res.plants[0]?.catalog?.commonName, 'Tomato');
  });

  it('2. fetchPlants with gardenId: encodes query parameter in URL', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/plants?gardenId=g-specific');
      assert.equal(init.credentials, 'include');
      return new Response(
        JSON.stringify({
          plants: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchPlants({ gardenId: 'g-specific' });
    assert.equal(res.plants.length, 0);
  });

  it('3. fetchPlant: issues GET /api/plants/:id with credentials and returns single plant', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/plants/00000000-0000-0000-0000-000000000001');
      assert.equal(init.credentials, 'include');
      return new Response(
        JSON.stringify({
          plant: {
            id: '00000000-0000-0000-0000-000000000001',
            userId: 'u-1',
            gardenId: 'g-1',
            catalogId: 'catalog-basil',
            customName: 'Sweet Basil',
            plantingDate: '2026-10-20',
            growthStage: 'vegetative',
            status: 'active',
            expectedHarvestDate: null,
            actualHarvestDate: null,
            notes: null,
            createdAt: '2026-10-20T00:00:00.000Z',
            updatedAt: '2026-10-20T00:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchPlant('00000000-0000-0000-0000-000000000001');
    assert.equal(res.plant.id, '00000000-0000-0000-0000-000000000001');
    assert.equal(res.plant.customName, 'Sweet Basil');
    assert.equal(res.plant.growthStage, 'vegetative');
  });

  it('4. createPlant: issues POST /api/plants with CSRF token and JSON body', async () => {
    mockFetch((url, init) => {
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'valid-csrf-token' }), { status: 200 });
      }

      assert.equal(url, '/api/plants');
      assert.equal(init.method, 'POST');
      assert.equal(init.credentials, 'include');

      const headers = new Headers(init.headers);
      assert.equal(headers.get('content-type'), 'application/json');
      assert.equal(headers.get('x-csrf-token'), 'valid-csrf-token');

      const parsed = JSON.parse(init.body as string);
      assert.equal(parsed.gardenId, 'g-1');
      assert.equal(parsed.catalogId, 'catalog-tomato');
      assert.equal(parsed.customName, 'Heirloom Brandywine');

      return new Response(
        JSON.stringify({
          plant: {
            id: 'p-new',
            userId: 'u-1',
            gardenId: 'g-1',
            catalogId: 'catalog-tomato',
            customName: 'Heirloom Brandywine',
            growthStage: 'seedling',
            status: 'active',
            createdAt: '2026-10-23T00:00:00.000Z',
            updatedAt: '2026-10-23T00:00:00.000Z',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await createPlant({
      gardenId: 'g-1',
      catalogId: 'catalog-tomato',
      customName: 'Heirloom Brandywine',
      growthStage: 'seedling',
      status: 'active',
    });

    assert.equal(res.plant.id, 'p-new');
    assert.equal(res.plant.customName, 'Heirloom Brandywine');
  });

  it('5. updatePlant: issues PATCH /api/plants/:id with CSRF token and updated payload', async () => {
    mockFetch((url, init) => {
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'valid-csrf-token' }), { status: 200 });
      }

      assert.equal(url, '/api/plants/p-1');
      assert.equal(init.method, 'PATCH');
      assert.equal(init.credentials, 'include');

      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-csrf-token'), 'valid-csrf-token');

      const parsed = JSON.parse(init.body as string);
      assert.equal(parsed.growthStage, 'flowering');
      assert.equal(parsed.notes, 'First flower clusters open');

      return new Response(
        JSON.stringify({
          plant: {
            id: 'p-1',
            userId: 'u-1',
            gardenId: 'g-1',
            catalogId: 'catalog-tomato',
            growthStage: 'flowering',
            status: 'active',
            notes: 'First flower clusters open',
            createdAt: '2026-10-23T00:00:00.000Z',
            updatedAt: '2026-10-23T01:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await updatePlant('p-1', {
      growthStage: 'flowering',
      notes: 'First flower clusters open',
    });
    assert.equal(res.plant.growthStage, 'flowering');
    assert.equal(res.plant.notes, 'First flower clusters open');
  });

  it('6. deletePlant: sends DELETE /api/plants/:id with CSRF and handles 204 No Content', async () => {
    mockFetch((url, init) => {
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'valid-csrf-token' }), { status: 200 });
      }

      assert.equal(url, '/api/plants/p-to-remove');
      assert.equal(init.method, 'DELETE');
      assert.equal(init.credentials, 'include');

      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-csrf-token'), 'valid-csrf-token');

      return new Response(null, { status: 204 });
    });

    await deletePlant('p-to-remove');
    assert.ok(true, 'delete completed without throwing');
  });

  it('7. ApiClientError handles 422 Validation Error with fieldErrors', async () => {
    mockFetch((url) => {
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'valid-csrf-token' }), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          error: {
            code: 'validation_error',
            message: 'Some fields need attention.',
            fieldErrors: {
              customName: ['Choose a plant from the library or enter a custom name'],
            },
          },
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      );
    });

    await assert.rejects(
      async () =>
        createPlant({
          gardenId: 'g-1',
          growthStage: 'seedling',
          status: 'active',
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.status, 422);
        assert.equal(err.code, 'validation_error');
        assert.equal(err.fieldErrors?.customName?.[0], 'Choose a plant from the library or enter a custom name');
        return true;
      },
    );
  });

  it('8. ApiClientError handles 403 Forbidden cross-user access', async () => {
    mockFetch((url) => {
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'valid-csrf-token' }), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          error: {
            code: 'forbidden',
            message: 'You do not have access to the destination garden.',
          },
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    });

    await assert.rejects(
      async () =>
        createPlant({
          gardenId: 'g-belonging-to-other-user',
          catalogId: 'catalog-tomato',
          growthStage: 'seedling',
          status: 'active',
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.status, 403);
        assert.equal(err.code, 'forbidden');
        assert.match(err.message, /destination garden/i);
        return true;
      },
    );
  });
});
