import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createPlant, fetchResearchRecord, researchPlant } from './api';

describe('AI Plant Research Frontend API Client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Reset fetch
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('1. researchPlant: posts query payload and handles matched library plant response', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          matchedCatalogEntry: {
            id: 'catalog-tomato',
            commonName: 'Tomato',
            slug: 'tomato',
          },
          message: '"Tomato" is already available in the GrowSpace Plant Library.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;

    const res = await researchPlant('Tomato');

    assert.equal(capturedUrl, '/api/plants/research');
    assert.equal(capturedInit?.method, 'POST');
    assert.equal(capturedInit?.credentials, 'include');
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), { plantName: 'Tomato' });

    assert.equal(res.matchedCatalogEntry?.commonName, 'Tomato');
  });

  it('2. researchPlant: receives synthesized AI profile and verifiable citations', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          researchRecord: {
            id: 'res-uuid-1',
            plantName: 'Dragon Fruit',
            scientificName: 'Selenicereus undatus',
            temperatureMin: 18,
            temperatureMax: 35,
            confidence: 'high',
            sources: [
              {
                title: 'University Extension Pitaya Guide',
                url: 'https://extension.example.edu/pitaya',
                retrievedAt: '2026-10-24T12:00:00.000Z',
              },
            ],
          },
          profile: {
            plantName: 'Dragon Fruit',
            scientificName: 'Selenicereus undatus',
            temperatureMin: 18,
            temperatureMax: 35,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;

    const res = await researchPlant('Dragon Fruit');
    assert.equal(res.researchRecord?.id, 'res-uuid-1');
    assert.equal(res.researchRecord?.plantName, 'Dragon Fruit');
    assert.equal(res.researchRecord?.sources[0]?.url, 'https://extension.example.edu/pitaya');
  });

  it('3. fetchResearchRecord: issues GET /api/plants/research/[id] with credentials', async () => {
    let capturedUrl = '';

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          researchRecord: {
            id: 'res-uuid-1',
            plantName: 'Dragon Fruit',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;

    const res = await fetchResearchRecord('res-uuid-1');
    assert.equal(capturedUrl, '/api/plants/research/res-uuid-1');
    assert.equal(res.researchRecord.id, 'res-uuid-1');
  });

  it('4. researchPlant: propagates setup_required error properly when credentials missing', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'setup_required',
            message: 'GROQ_API_KEY is not configured.',
          },
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await researchPlant('Dragon Fruit');
      },
      (err: unknown) => {
        return (
          err instanceof Error &&
          'code' in err &&
          (err as { code: string }).code === 'setup_required' &&
          'status' in err &&
          (err as { status: number }).status === 503
        );
      },
    );
  });

  it('5. createPlant: transmits researchRecordId and reviewedProfile when saving researched plant', async () => {
    let capturedBody: Record<string, unknown> | undefined;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'mock-csrf' }), { status: 200 });
      }

      if (url === '/api/plants') {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            plant: {
              id: 'plant-uuid-1',
              customName: 'Dragon Fruit',
              researchProfile: {
                id: 'res-uuid-1',
                scientificName: 'Selenicereus undatus',
              },
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const res = await createPlant({
      gardenId: '00000000-0000-0000-0000-000000000001',
      customName: 'Dragon Fruit',
      growthStage: 'seedling',
      status: 'active',
      researchRecordId: '00000000-0000-0000-0000-000000000002',
      reviewedProfile: {
        scientificName: 'Selenicereus undatus (Reviewed)',
        temperatureMin: 20,
        temperatureMax: 35,
      },
    });

    assert.equal(res.plant.id, 'plant-uuid-1');
    assert.equal(capturedBody?.researchRecordId, '00000000-0000-0000-0000-000000000002');
    assert.deepEqual(capturedBody?.reviewedProfile, {
      scientificName: 'Selenicereus undatus (Reviewed)',
      temperatureMin: 20,
      temperatureMax: 35,
    });
  });
});
