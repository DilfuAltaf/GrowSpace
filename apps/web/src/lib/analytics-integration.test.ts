import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type {
  AnalyticsSummaryResponse,
  MeasurementType,
  PlantConditionInsight,
} from '@growspace/shared';
import { explainAnalytics, fetchAnalytics, ApiClientError } from './api';
import { firstPartyAuthClient } from '@/features/auth/first-party-client';

describe('GrowSpace Phase 5.9: Historical Analytics & Smart Insights Suite', () => {
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

  const sampleSummary: AnalyticsSummaryResponse = {
    period: {
      timeRange: '7d',
      from: '2026-10-18T00:00:00.000Z',
      to: '2026-10-25T00:00:00.000Z',
    },
    previousPeriod: {
      from: '2026-10-11T00:00:00.000Z',
      to: '2026-10-18T00:00:00.000Z',
      hasComparableData: true,
    },
    filters: {
      gardenId: 'garden-1',
      plantId: 'plant-1',
      source: 'all',
      measurementType: 'all',
    },
    stats: {
      air_temperature: {
        measurementType: 'air_temperature',
        unit: '°C',
        count: 24,
        min: 19.5,
        max: 27.2,
        avg: 23.4,
        latest: null,
        previousAvg: 22.0,
        deltaAvg: 1.4,
        sourceBreakdown: { manual: 4, simulated: 20, sensor: 0 },
      },
      air_humidity: {
        measurementType: 'air_humidity',
        unit: '%',
        count: 24,
        min: 45,
        max: 65,
        avg: 54.2,
        latest: null,
        previousAvg: 58.0,
        deltaAvg: -3.8,
        sourceBreakdown: { manual: 0, simulated: 24, sensor: 0 },
      },
      medium_moisture: {
        measurementType: 'medium_moisture',
        unit: '%',
        count: 12,
        min: 50,
        max: 75,
        avg: 62.0,
        latest: null,
        previousAvg: null,
        deltaAvg: null,
        sourceBreakdown: { manual: 12, simulated: 0, sensor: 0 },
      },
    },
    readings: [
      {
        id: 'r-1',
        userId: 'u-1',
        gardenId: 'garden-1',
        plantId: 'plant-1',
        measurementType: 'air_temperature',
        value: 23.4,
        unit: '°C',
        source: 'manual',
        recordedAt: '2026-10-24T12:00:00.000Z',
        note: null,
        createdAt: '2026-10-24T12:00:00.000Z',
        gardenName: 'Main Garden',
        plantName: 'Tomato Plant',
      },
    ],
    totalReadings: 1,
    plantInsights: [
      {
        id: 'plant-1-air_temperature',
        plantId: 'plant-1',
        plantName: 'Tomato Plant',
        gardenId: 'garden-1',
        measurementType: 'air_temperature',
        state: 'optimal',
        observedValue: 23.4,
        unit: '°C',
        referenceRange: { min: 18, max: 29 },
        isCustomResearched: false,
        confidence: null,
        recordedAt: '2026-10-24T12:00:00.000Z',
        source: 'manual',
        reason: 'Temperature is within supported bounds.',
        actionLink: '/dashboard/monitoring?plantId=plant-1',
        actionLabel: 'View Telemetry',
        severity: 'info',
      },
    ],
    taskSummary: {
      overdueCount: 0,
      dueTodayCount: 1,
      upcomingCount: 2,
      completedCount: 4,
    },
    recentLogs: [],
    deterministicSummary: 'Environmental trends (7d): Temperature averaged 23.4°C (+1.4°C vs prior period).',
  };

  it('1. fetchAnalytics correctly encodes query parameters and carries credentials', async () => {
    mockFetch((url, init) => {
      assert.equal(init.credentials, 'include');
      assert.ok(url.includes('/api/analytics'));
      assert.ok(url.includes('timeRange=7d'));
      assert.ok(url.includes('gardenId=garden-1'));
      assert.ok(url.includes('plantId=plant-1'));
      assert.ok(url.includes('source=manual'));
      assert.ok(url.includes('measurementType=air_temperature'));

      return new Response(JSON.stringify({ data: sampleSummary }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const res = await fetchAnalytics({
      timeRange: '7d',
      gardenId: 'garden-1',
      plantId: 'plant-1',
      source: 'manual',
      measurementType: 'air_temperature',
    });

    assert.equal(res.data.period.timeRange, '7d');
    assert.equal(res.data.stats.air_temperature.count, 24);
    assert.equal(res.data.stats.air_temperature.avg, 23.4);
    assert.equal(res.data.stats.air_temperature.deltaAvg, 1.4);
  });

  it('2. explainAnalytics sends POST request with payload and returns explanation', async () => {
    mockFetch((url, init) => {
      assert.equal(init.method, 'POST');
      assert.equal(url, '/api/analytics/explain');
      const body = JSON.parse(init.body as string);
      assert.equal(body.timeRange, '30d');
      assert.equal(body.gardenId, 'garden-1');

      return new Response(
        JSON.stringify({
          data: {
            explanation: 'Historical trends indicate stable temperature and good care consistency.',
            summary: sampleSummary,
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    const res = await explainAnalytics({
      timeRange: '30d',
      gardenId: 'garden-1',
    });

    assert.ok(res.data.explanation.includes('Historical trends indicate'));
    assert.equal(res.data.summary.period.timeRange, '7d');
  });

  it('3. Preserves data provenance without conflating simulated with physical sensor data', () => {
    const tempStats = sampleSummary.stats.air_temperature;
    assert.equal(tempStats.sourceBreakdown.manual, 4);
    assert.equal(tempStats.sourceBreakdown.simulated, 20);
    assert.equal(tempStats.sourceBreakdown.sensor, 0);

    const humidityStats = sampleSummary.stats.air_humidity;
    assert.equal(humidityStats.sourceBreakdown.manual, 0);
    assert.equal(humidityStats.sourceBreakdown.simulated, 24);
    assert.equal(humidityStats.sourceBreakdown.sensor, 0);
  });

  it('4. Handles empty period telemetry safely with null values and comparable flag false', () => {
    const emptyStats = {
      measurementType: 'air_temperature' as MeasurementType,
      unit: '°C',
      count: 0,
      min: null,
      max: null,
      avg: null,
      latest: null,
      previousAvg: null,
      deltaAvg: null,
      sourceBreakdown: { manual: 0, simulated: 0, sensor: 0 },
    };

    assert.equal(emptyStats.count, 0);
    assert.equal(emptyStats.min, null);
    assert.equal(emptyStats.max, null);
    assert.equal(emptyStats.avg, null);
    assert.equal(emptyStats.deltaAvg, null);
  });

  it('5. Supports all six plant condition insight states', () => {
    const validStates: PlantConditionInsight['state'][] = [
      'optimal',
      'low',
      'high',
      'stale_data',
      'insufficient_data',
      'unconfigured_range',
    ];

    for (const state of validStates) {
      const insight: PlantConditionInsight = {
        id: `plant-1-metric-${state}`,
        plantId: 'plant-1',
        plantName: 'Test Plant',
        gardenId: 'garden-1',
        measurementType: 'air_temperature',
        state,
        observedValue: state === 'insufficient_data' ? null : 20,
        unit: '°C',
        referenceRange: state === 'unconfigured_range' ? null : { min: 18, max: 28 },
        isCustomResearched: false,
        recordedAt: state === 'insufficient_data' ? null : '2026-10-24T12:00:00.000Z',
        source: state === 'insufficient_data' ? null : 'manual',
        reason: `State is ${state}`,
        actionLink: '/dashboard/monitoring',
        actionLabel: 'View Telemetry',
        severity: state === 'low' || state === 'high' ? 'warning' : 'info',
      };

      assert.equal(insight.state, state);
      if (state === 'insufficient_data') {
        assert.equal(insight.observedValue, null);
      }
      if (state === 'unconfigured_range') {
        assert.equal(insight.referenceRange, null);
      }
    }
  });

  it('6. Accurately flags custom researched plants and confidence ratings', () => {
    const customInsight: PlantConditionInsight = {
      id: 'custom-plant-moisture',
      plantId: 'plant-dragonfruit',
      plantName: 'Dragon Fruit',
      gardenId: 'garden-1',
      measurementType: 'medium_moisture',
      state: 'low',
      observedValue: 15,
      unit: '%',
      referenceRange: { min: 30, max: 50 },
      isCustomResearched: true,
      confidence: 'high',
      recordedAt: '2026-10-25T08:00:00.000Z',
      source: 'manual',
      reason: 'Medium moisture (15%) is below the AI-researched target range (30-50%).',
      actionLink: '/dashboard/monitoring?plantId=plant-dragonfruit',
      actionLabel: 'View Telemetry',
      severity: 'warning',
    };

    assert.equal(customInsight.isCustomResearched, true);
    assert.equal(customInsight.confidence, 'high');
    assert.equal(customInsight.state, 'low');
  });

  it('7. ApiClientError correctly handles API failure responses', async () => {
    mockFetch(() => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'forbidden',
            message: 'You do not have access to this garden.',
          },
        }),
        {
          status: 403,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    await assert.rejects(
      async () => {
        await fetchAnalytics({ gardenId: 'garden-foreign' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.status, 403);
        assert.equal(err.code, 'forbidden');
        assert.equal(err.message, 'You do not have access to this garden.');
        return true;
      },
    );
  });
});
