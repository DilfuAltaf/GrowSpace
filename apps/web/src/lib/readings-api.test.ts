import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  READING_SOURCES,
  formatMeasurementValue,
  isPlausibleReading,
} from '@growspace/shared';
import {
  ApiClientError,
  createSensorReading,
  fetchLatestSensorReadings,
  fetchSensorReadings,
  generateSimulatedReadings,
} from './api';
import { firstPartyAuthClient } from '@/features/auth/first-party-client';

describe('Sensor Readings & Environmental Monitoring Frontend Client Suite', () => {
  const originalFetch = globalThis.fetch;
  let recordedRequests: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    recordedRequests = [];
    (firstPartyAuthClient as unknown as { inMemoryCsrfToken: string | null }).inMemoryCsrfToken =
      null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (firstPartyAuthClient as unknown as { inMemoryCsrfToken: string | null }).inMemoryCsrfToken =
      null;
  });

  function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      recordedRequests.push({ url, init: init ?? {} });
      return handler(url, init ?? {});
    };
  }

  describe('1. Fetching Sensor Readings & Filtering', () => {
    it('fetchSensorReadings issues GET /api/readings with credentials include', async () => {
      mockFetch((url, init) => {
        assert.equal(url, '/api/readings');
        assert.equal(init.method ?? 'GET', 'GET');
        assert.equal(init.credentials, 'include');
        return new Response(
          JSON.stringify({
            readings: [
              {
                id: 'sr-1',
                userId: 'u-1',
                gardenId: 'g-1',
                plantId: 'p-1',
                measurementType: 'air_temperature',
                value: 23.5,
                unit: '°C',
                source: 'manual',
                recordedAt: '2026-10-24T08:00:00.000Z',
                note: 'Morning read',
                createdAt: '2026-10-24T08:00:00.000Z',
                plantName: 'Tomato',
                gardenName: 'Balcony',
              },
            ],
            total: 1,
            limit: 100,
            offset: 0,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });

      const res = await fetchSensorReadings();
      assert.equal(res.readings.length, 1);
      assert.equal(res.total, 1);
      assert.ok(res.readings[0]);
      assert.equal(res.readings[0].value, 23.5);
      assert.equal(res.readings[0].source, 'manual');
    });

    it('fetchSensorReadings encodes plant, metric, source, time-range, and pagination filters in query params', async () => {
      mockFetch((url) => {
        const parsed = new URL(url, 'http://localhost');
        assert.equal(parsed.pathname, '/api/readings');
        assert.equal(parsed.searchParams.get('plantId'), 'p-123');
        assert.equal(parsed.searchParams.get('measurementType'), 'air_temperature');
        assert.equal(parsed.searchParams.get('source'), 'manual');
        assert.equal(parsed.searchParams.get('from'), '2026-10-20T00:00:00.000Z');
        assert.equal(parsed.searchParams.get('to'), '2026-10-24T00:00:00.000Z');
        assert.equal(parsed.searchParams.get('limit'), '50');
        assert.equal(parsed.searchParams.get('offset'), '10');
        return new Response(JSON.stringify({ readings: [], total: 0, limit: 50, offset: 10 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const res = await fetchSensorReadings({
        plantId: 'p-123',
        measurementType: 'air_temperature',
        source: 'manual',
        from: '2026-10-20T00:00:00.000Z',
        to: '2026-10-24T00:00:00.000Z',
        limit: 50,
        offset: 10,
      });

      assert.equal(res.readings.length, 0);
      assert.equal(res.total, 0);
    });

    it('fetchLatestSensorReadings queries /api/readings?latest=true', async () => {
      mockFetch((url) => {
        const parsed = new URL(url, 'http://localhost');
        assert.equal(parsed.pathname, '/api/readings');
        assert.equal(parsed.searchParams.get('latest'), 'true');
        assert.equal(parsed.searchParams.get('plantId'), 'plant-99');
        return new Response(
          JSON.stringify({
            latest: {
              air_temperature: {
                id: 'sr-temp',
                measurementType: 'air_temperature',
                value: 22.0,
                unit: '°C',
                source: 'manual',
                recordedAt: '2026-10-24T09:00:00.000Z',
              },
              air_humidity: null,
              medium_moisture: null,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });

      const res = await fetchLatestSensorReadings({ plantId: 'plant-99' });
      assert.ok(res.latest.air_temperature);
      assert.equal(res.latest.air_temperature.value, 22.0);
      assert.equal(res.latest.air_humidity, null);
    });
  });

  describe('2. Creating Manual & Simulated Readings', () => {
    it('createSensorReading: posts payload with credentials, attaches CSRF token, and returns reading', async () => {
      mockFetch(async (url, init) => {
        if (url === '/api/auth/csrf') {
          return new Response(JSON.stringify({ csrfToken: 'mock-csrf-token-123' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        assert.equal(url, '/api/readings');
        assert.equal(init.method, 'POST');
        assert.equal(init.credentials, 'include');
        const headers = init.headers as Headers;
        assert.equal(headers.get('X-CSRF-Token'), 'mock-csrf-token-123');

        const body = JSON.parse(init.body as string);
        assert.equal(body.plantId, 'p-1');
        assert.equal(body.measurementType, 'medium_moisture');
        assert.equal(body.value, 64.5);
        assert.equal(body.source, 'manual');

        return new Response(
          JSON.stringify({
            reading: {
              id: 'sr-new',
              userId: 'u-1',
              gardenId: 'g-1',
              plantId: 'p-1',
              measurementType: 'medium_moisture',
              value: 64.5,
              unit: '%',
              source: 'manual',
              recordedAt: body.recordedAt,
              note: 'Soil check',
              createdAt: '2026-10-24T08:30:00.000Z',
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      });

      const res = await createSensorReading({
        gardenId: 'g-1',
        plantId: 'p-1',
        measurementType: 'medium_moisture',
        value: 64.5,
        unit: '%',
        source: 'manual',
        recordedAt: '2026-10-24T08:30:00.000Z',
        note: 'Soil check',
      });

      assert.equal(res.reading.id, 'sr-new');
      assert.equal(res.reading.value, 64.5);
      assert.equal(res.reading.source, 'manual');
    });

    it('generateSimulatedReadings: calls /api/readings/simulate and marks provenance as simulated', async () => {
      mockFetch(async (url, init) => {
        if (url === '/api/auth/csrf') {
          return new Response(JSON.stringify({ csrfToken: 'mock-csrf-token-456' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        assert.equal(url, '/api/readings/simulate');
        assert.equal(init.method, 'POST');

        return new Response(
          JSON.stringify({
            readings: [
              {
                id: 'sim-1',
                measurementType: 'air_temperature',
                value: 23.1,
                unit: '°C',
                source: 'simulated',
                recordedAt: '2026-10-24T08:00:00.000Z',
              },
            ],
            count: 24,
            disclaimer: 'SIMULATED / DATA DEMO: All generated readings are simulated for demonstration purposes only.',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      });

      const res = await generateSimulatedReadings({ plantId: 'p-1', gardenId: 'g-1' });
      assert.equal(res.count, 24);
      assert.ok(res.disclaimer.includes('SIMULATED / DATA DEMO'));
      assert.ok(res.readings[0]);
      assert.equal(res.readings[0].source, 'simulated');
    });
  });

  describe('3. Error Handling & State Guarantees', () => {
    it('throws ApiClientError with 401 unauthenticated and dispatches session-expired event', async () => {
      let expiredDispatched = false;
      const listener = () => {
        expiredDispatched = true;
      };
      // Polyfill window event listener for Node test environment
      if (typeof window === 'undefined') {
        (globalThis as unknown as { window: EventTarget }).window = new EventTarget();
      }
      globalThis.window.addEventListener('session-expired', listener);

      mockFetch(() => {
        return new Response(
          JSON.stringify({
            error: {
              code: 'unauthenticated',
              message: 'Sign in to continue.',
            },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        );
      });

      await assert.rejects(
        async () => {
          await fetchSensorReadings();
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiClientError);
          assert.equal(err.status, 401);
          assert.equal(err.code, 'unauthenticated');
          return true;
        },
      );

      assert.equal(expiredDispatched, true);
      globalThis.window.removeEventListener('session-expired', listener);
    });

    it('throws ApiClientError with 403 forbidden when accessing another user plant', async () => {
      mockFetch(() => {
        return new Response(
          JSON.stringify({
            error: {
              code: 'forbidden',
              message: 'You do not have access to this plant.',
            },
          }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        );
      });

      await assert.rejects(
        async () => {
          await fetchSensorReadings({ plantId: 'foreign-plant' });
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiClientError);
          assert.equal(err.status, 403);
          assert.equal(err.code, 'forbidden');
          return true;
        },
      );
    });

    it('captures validation error messages and fieldErrors map on 400 bad request', async () => {
      mockFetch(() => {
        return new Response(
          JSON.stringify({
            error: {
              code: 'validation_error',
              message: 'Invalid sensor reading parameters.',
              fieldErrors: {
                value: ['Value must be between -20 and 70 °C'],
              },
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      });

      await assert.rejects(
        async () => {
          await createSensorReading({
            gardenId: 'g-1',
            plantId: 'p-1',
            measurementType: 'air_temperature',
            value: 99.0,
            unit: '°C',
            recordedAt: '2026-10-24T00:00:00.000Z',
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiClientError);
          assert.equal(err.status, 400);
          assert.equal(err.code, 'validation_error');
          assert.deepEqual(err.fieldErrors, {
            value: ['Value must be between -20 and 70 °C'],
          });
          return true;
        },
      );
    });
  });

  describe('4. Provenance Labeling & Formatting Helpers', () => {
    it('READING_SOURCES metadata accurately describes simulated vs manual', () => {
      assert.equal(READING_SOURCES.manual.label, 'Manual entry');
      assert.ok(READING_SOURCES.manual.description.includes('by you'));
      assert.equal(READING_SOURCES.simulated.label, 'Simulated');
      assert.ok(READING_SOURCES.simulated.description.includes('demonstration'));
    });

    it('formatMeasurementValue formats decimals appropriately without coercing to zero', () => {
      assert.equal(formatMeasurementValue('air_temperature', 23.456, '°C'), '23.5°C');
      assert.equal(formatMeasurementValue('air_humidity', 55.4, '%'), '55%');
      assert.equal(formatMeasurementValue('medium_moisture', 68.9, '%'), '69%');
    });

    it('isPlausibleReading validates valid boundaries for all supported metrics', () => {
      assert.equal(isPlausibleReading('air_temperature', 25), true);
      assert.equal(isPlausibleReading('air_temperature', -20), true);
      assert.equal(isPlausibleReading('air_temperature', 70), true);
      assert.equal(isPlausibleReading('air_temperature', 71), false);
      assert.equal(isPlausibleReading('air_temperature', -21), false);

      assert.equal(isPlausibleReading('air_humidity', 0), true);
      assert.equal(isPlausibleReading('air_humidity', 100), true);
      assert.equal(isPlausibleReading('air_humidity', 101), false);
      assert.equal(isPlausibleReading('air_humidity', -1), false);

      assert.equal(isPlausibleReading('medium_moisture', 0), true);
      assert.equal(isPlausibleReading('medium_moisture', 100), true);
      assert.equal(isPlausibleReading('medium_moisture', -0.5), false);
    });
  });
});
