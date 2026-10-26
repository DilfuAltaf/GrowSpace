import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  getTaskDueClassification,
  isStale,
  MEASUREMENTS,
  type MeasurementType,
} from '@growspace/shared';
import {
  fetchGardens,
  fetchLatestSensorReadings,
  fetchNotifications,
  fetchPlants,
  fetchRecommendations,
  fetchSensorReadings,
  fetchTasks,
  generateNotifications,
  markNotificationRead,
  updateTask,
  type PlantWithDetails,
} from './api';
import { firstPartyAuthClient } from '@/features/auth/first-party-client';

describe('GrowSpace Phase 5.8: Smart Dashboard Integration Suite', () => {
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

  it('1. Unified Dashboard Metrics: aggregates gardens, active plants, tasks, readings, and unread counts', async () => {
    const fixedNow = new Date('2026-10-25T10:00:00.000Z');

    mockFetch((url, init) => {
      assert.equal(init.credentials, 'include', 'Every request must include credentials');
      if (url === '/api/gardens') {
        return new Response(
          JSON.stringify({
            gardens: [
              { id: 'g-1', name: 'Balcony Garden', plantCount: 2 },
              { id: 'g-2', name: 'Kitchen Herbs', plantCount: 1 },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url === '/api/plants') {
        return new Response(
          JSON.stringify({
            plants: [
              { id: 'p-1', customName: 'Cherry Tomato', status: 'active', growthStage: 'vegetative' },
              { id: 'p-2', customName: 'Sweet Basil', status: 'active', growthStage: 'seedling' },
              { id: 'p-3', customName: 'Old Lettuce', status: 'harvested', growthStage: 'harvested' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.startsWith('/api/tasks')) {
        return new Response(
          JSON.stringify({
            tasks: [
              { id: 't-1', title: 'Water tomato', status: 'pending', dueAt: '2026-10-24T09:00:00.000Z', priority: 'high' }, // overdue
              { id: 't-2', title: 'Check basil', status: 'pending', dueAt: '2026-10-25T14:00:00.000Z', priority: 'normal' }, // today
              { id: 't-3', title: 'Fertilize herbs', status: 'pending', dueAt: '2026-10-28T10:00:00.000Z', priority: 'low' }, // upcoming
              { id: 't-4', title: 'Completed prune', status: 'completed', dueAt: '2026-10-20T10:00:00.000Z', priority: 'normal' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.startsWith('/api/notifications')) {
        return new Response(
          JSON.stringify({
            notifications: [{ id: 'n-1', title: 'Overdue task', isRead: false }],
            unreadCount: 3,
            total: 5,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const [gardensRes, plantsRes, tasksRes, notifsRes] = await Promise.all([
      fetchGardens(),
      fetchPlants(),
      fetchTasks(),
      fetchNotifications(),
    ]);

    // Derived metric checks
    const gardensCount = gardensRes.gardens.length;
    const activePlantsCount = plantsRes.plants.filter((p) => p.status === 'active').length;
    const pendingTasks = tasksRes.tasks.filter((t) => t.status === 'pending');
    const overdueTasks = pendingTasks.filter((t) => getTaskDueClassification(t.dueAt, fixedNow) === 'overdue');
    const dueTodayTasks = pendingTasks.filter((t) => getTaskDueClassification(t.dueAt, fixedNow) === 'today');
    const upcomingTasks = pendingTasks.filter((t) => getTaskDueClassification(t.dueAt, fixedNow) === 'upcoming');

    assert.equal(gardensCount, 2);
    assert.equal(activePlantsCount, 2, 'Harvested crops must not count as active crops');
    assert.equal(pendingTasks.length, 3);
    assert.equal(overdueTasks.length, 1, 'Past task dueAt must classify as overdue');
    assert.equal(dueTodayTasks.length, 1, 'Current date task dueAt must classify as today');
    assert.equal(upcomingTasks.length, 1, 'Future task dueAt must classify as upcoming');
    assert.equal(notifsRes.unreadCount, 3);
  });

  it('2. Empty State Integrity: truthful empty counts without fabricated values or zeros', async () => {
    mockFetch((url) => {
      if (url === '/api/gardens') return new Response(JSON.stringify({ gardens: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url === '/api/plants') return new Response(JSON.stringify({ plants: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.startsWith('/api/tasks')) return new Response(JSON.stringify({ tasks: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.startsWith('/api/readings')) {
        return new Response(
          JSON.stringify({
            readings: [],
            latest: { air_temperature: null, air_humidity: null, medium_moisture: null },
            total: 0,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.startsWith('/api/notifications')) {
        return new Response(JSON.stringify({ notifications: [], unreadCount: 0, total: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    });

    const [gardensRes, plantsRes, tasksRes, readingsRes, notifsRes] = await Promise.all([
      fetchGardens(),
      fetchPlants(),
      fetchTasks(),
      fetchLatestSensorReadings(),
      fetchNotifications(),
    ]);

    assert.equal(gardensRes.gardens.length, 0);
    assert.equal(plantsRes.plants.length, 0);
    assert.equal(tasksRes.tasks.length, 0);
    assert.equal(notifsRes.unreadCount, 0);
    assert.equal(readingsRes.latest.air_temperature, null, 'Never invent readings or zeros for empty data');
    assert.equal(readingsRes.latest.medium_moisture, null);
    assert.equal(readingsRes.latest.air_humidity, null);
  });

  it('3. Partially Populated Dashboard: handles gardens and plants without readings, and vice-versa', async () => {
    mockFetch((url) => {
      if (url === '/api/gardens') {
        return new Response(JSON.stringify({ gardens: [{ id: 'g-1', name: 'Indoor Tent' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === '/api/plants') {
        return new Response(JSON.stringify({ plants: [{ id: 'p-1', customName: 'Mint', status: 'active' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.startsWith('/api/readings')) {
        return new Response(
          JSON.stringify({ readings: [], latest: { air_temperature: null, air_humidity: null, medium_moisture: null }, total: 0 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const [gardensRes, plantsRes, readingsRes] = await Promise.all([
      fetchGardens(),
      fetchPlants(),
      fetchLatestSensorReadings(),
    ]);

    assert.equal(gardensRes.gardens.length, 1);
    assert.equal(plantsRes.plants.length, 1);
    assert.equal(readingsRes.latest.air_temperature, null, 'Missing readings must remain explicitly null');
  });

  it('4. Distinguishes Manual vs. Simulated Readings: preserves source attribution faithfully', async () => {
    mockFetch(() => {
      return new Response(
        JSON.stringify({
          readings: [
            {
              id: 'r-manual',
              measurementType: 'medium_moisture',
              value: 48,
              unit: '%',
              source: 'manual',
              recordedAt: '2026-10-25T09:00:00.000Z',
            },
            {
              id: 'r-simulated',
              measurementType: 'air_temperature',
              value: 23.5,
              unit: '°C',
              source: 'simulated',
              recordedAt: '2026-10-25T08:30:00.000Z',
            },
          ],
          total: 2,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchSensorReadings();
    const manualReading = res.readings.find((r) => r.source === 'manual');
    const simulatedReading = res.readings.find((r) => r.source === 'simulated');

    assert.ok(manualReading, 'Manual reading must be preserved');
    assert.equal(manualReading.source, 'manual');
    assert.ok(simulatedReading, 'Simulated reading must be preserved');
    assert.equal(simulatedReading.source, 'simulated');
    assert.notEqual(manualReading.source, simulatedReading.source);
  });

  it('5. Freshness and Stale Readings: isStale accurately detects aged readings', () => {
    const referenceNow = new Date('2026-10-25T10:00:00.000Z');

    // Air temperature stale threshold is 24 hours
    const freshTempDate = new Date('2026-10-25T08:00:00.000Z').toISOString(); // 2 hours old
    const staleTempDate = new Date('2026-10-23T10:00:00.000Z').toISOString(); // 48 hours old

    assert.equal(isStale(freshTempDate, MEASUREMENTS.air_temperature.staleAfterHours, referenceNow), false);
    assert.equal(isStale(staleTempDate, MEASUREMENTS.air_temperature.staleAfterHours, referenceNow), true);

    // Medium moisture stale threshold is 8 hours
    const freshMoistureDate = new Date('2026-10-25T07:00:00.000Z').toISOString(); // 3 hours old (< 8h)
    const staleMoistureDate = new Date('2026-10-24T12:00:00.000Z').toISOString(); // 22 hours old (> 8h)

    assert.equal(isStale(freshMoistureDate, MEASUREMENTS.medium_moisture.staleAfterHours, referenceNow), false);
    assert.equal(isStale(staleMoistureDate, MEASUREMENTS.medium_moisture.staleAfterHours, referenceNow), true);
  });

  it('6. Custom Plants with AI Research: compares readings with research ranges and handles incomplete fields safely', () => {
    // Custom plant created via AI research with complete temperature & moisture, but null humidity
    const customPlantWithPartialProfile: PlantWithDetails = {
      id: 'p-custom-1',
      userId: 'u-1',
      gardenId: 'g-1',
      catalogId: null,
      customName: 'Carolina Reaper',
      plantingDate: '2026-10-01',
      growthStage: 'vegetative',
      status: 'active',
      expectedHarvestDate: null,
      actualHarvestDate: null,
      notes: 'Hot pepper',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      researchProfile: {
        plantName: 'Carolina Reaper',
        scientificName: 'Capsicum chinense',
        category: 'Vegetables',
        difficulty: 'advanced',
        growingMedium: 'Rich loamy soil',
        lightGuidance: 'Full sun',
        wateringGuidance: 'Allow to dry between waterings',
        fertilizerGuidance: null,
        temperatureMin: 22,
        temperatureMax: 32,
        humidityMin: null, // Partial field: unverified / absent
        humidityMax: null, // Partial field: unverified / absent
        moistureMin: 40,
        moistureMax: 65,
        harvestDaysMin: 120,
        harvestDaysMax: 150,
        cultivationNotes: 'Requires heat',
        safetyNotes: 'Wear gloves when handling',
        confidence: 'high',
        sources: [
          {
            title: 'Chili Pepper Institute',
            url: 'https://example.edu/reaper',
            retrievedAt: '2026-10-01T00:00:00.000Z',
          },
        ],
      },
    };

    // Helper to evaluate reading vs range safely
    function evaluateAgainstProfile(
      plant: PlantWithDetails,
      type: MeasurementType,
      value: number,
    ): 'optimal' | 'low' | 'high' | 'unconfigured' {
      const rp = plant.researchProfile;
      if (!rp) return 'unconfigured';

      let range: { min: number; max: number } | null = null;
      if (type === 'air_temperature' && rp.temperatureMin != null && rp.temperatureMax != null) {
        range = { min: rp.temperatureMin, max: rp.temperatureMax };
      } else if (type === 'medium_moisture' && rp.moistureMin != null && rp.moistureMax != null) {
        range = { min: rp.moistureMin, max: rp.moistureMax };
      } else if (type === 'air_humidity' && rp.humidityMin != null && rp.humidityMax != null) {
        range = { min: rp.humidityMin, max: rp.humidityMax };
      }

      if (!range) return 'unconfigured';
      if (value < range.min) return 'low';
      if (value > range.max) return 'high';
      return 'optimal';
    }

    // Temperature checks (range 22 - 32)
    assert.equal(evaluateAgainstProfile(customPlantWithPartialProfile, 'air_temperature', 26), 'optimal');
    assert.equal(evaluateAgainstProfile(customPlantWithPartialProfile, 'air_temperature', 18), 'low');
    assert.equal(evaluateAgainstProfile(customPlantWithPartialProfile, 'air_temperature', 35), 'high');

    // Moisture checks (range 40 - 65)
    assert.equal(evaluateAgainstProfile(customPlantWithPartialProfile, 'medium_moisture', 50), 'optimal');
    assert.equal(evaluateAgainstProfile(customPlantWithPartialProfile, 'medium_moisture', 25), 'low');

    // Humidity checks (null range) must return unconfigured without inventing numbers
    assert.equal(evaluateAgainstProfile(customPlantWithPartialProfile, 'air_humidity', 60), 'unconfigured');
  });

  it('7. Actionable Tasks Integration: updates task status from pending to completed and back', async () => {
    (firstPartyAuthClient as unknown as { inMemoryCsrfToken: string | null }).inMemoryCsrfToken = 'mock-csrf';

    let currentStatus = 'pending';
    mockFetch((url, init) => {
      if (url === '/api/tasks/task-123' && init.method === 'PATCH') {
        const body = JSON.parse(init.body as string);
        currentStatus = body.status;
        return new Response(
          JSON.stringify({
            task: {
              id: 'task-123',
              title: 'Water Rosemary',
              status: currentStatus,
              updatedAt: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const res1 = await updateTask('task-123', { status: 'completed' });
    assert.equal(res1.task.status, 'completed');

    const res2 = await updateTask('task-123', { status: 'pending' });
    assert.equal(res2.task.status, 'pending');
  });

  it('8. In-App Notifications Integration: marking notification read updates status with X-CSRF-Token', async () => {
    (firstPartyAuthClient as unknown as { inMemoryCsrfToken: string | null }).inMemoryCsrfToken = 'mock-csrf-token';

    mockFetch((url, init) => {
      if (url === '/api/notifications/notif-abc' && init.method === 'PATCH') {
        assert.equal(init.headers instanceof Headers ? init.headers.get('X-CSRF-Token') : (init.headers as Record<string, string>)['X-CSRF-Token'], 'mock-csrf-token');
        return new Response(
          JSON.stringify({
            notification: {
              id: 'notif-abc',
              title: 'Low moisture warning',
              isRead: true,
              readAt: '2026-10-25T10:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const res = await markNotificationRead('notif-abc', true);
    assert.equal(res.notification.isRead, true);
    assert.ok(res.notification.readAt);
  });

  it('9. Care Reminder Workflow: generateNotifications calls POST /api/notifications/generate and returns counts', async () => {
    (firstPartyAuthClient as unknown as { inMemoryCsrfToken: string | null }).inMemoryCsrfToken = 'mock-csrf-token';

    mockFetch((url, init) => {
      if (url === '/api/notifications/generate' && init.method === 'POST') {
        return new Response(
          JSON.stringify({
            generatedCount: 2,
            unreadCount: 4,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const res = await generateNotifications();
    assert.equal(res.generatedCount, 2);
    assert.equal(res.unreadCount, 4);
  });

  it('10. Partial Failure Resilience: failure in recommendations does not crash gardens and plants fetching', async () => {
    mockFetch((url) => {
      if (url === '/api/gardens') {
        return new Response(
          JSON.stringify({ gardens: [{ id: 'g-1', name: 'Terrace Garden' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url === '/api/plants') {
        return new Response(
          JSON.stringify({ plants: [{ id: 'p-1', customName: 'Rosemary', status: 'active' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.startsWith('/api/recommendations')) {
        // Simulated partial failure: 500 internal error
        return new Response(
          JSON.stringify({ error: { code: 'server_error', message: 'Temporary intelligence outage' } }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    // Emulate dashboard Promise.allSettled pattern
    const results = await Promise.allSettled([
      fetchGardens(),
      fetchPlants(),
      fetchRecommendations(),
    ]);

    assert.equal(results[0].status, 'fulfilled', 'Gardens must resolve successfully');
    assert.equal(results[1].status, 'fulfilled', 'Plants must resolve successfully');
    assert.equal(results[2].status, 'rejected', 'Recommendations failure is safely caught');

    if (results[0].status === 'fulfilled') {
      assert.equal(results[0].value.gardens.length, 1);
    }
    if (results[1].status === 'fulfilled') {
      assert.equal(results[1].value.plants.length, 1);
    }
  });
});
