import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  createPlantLog,
  createTask,
  deletePlantLog,
  deleteTask,
  fetchPlantLogs,
  fetchRecommendations,
  fetchTask,
  fetchTasks,
  updateTask,
} from './api';
import { firstPartyAuthClient } from '@/features/auth/first-party-client';

describe('Phase 5.2: Plant Logs & Care Tasks Frontend API Client', () => {
  const originalFetch = globalThis.fetch;
  let recordedRequests: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    recordedRequests = [];
    (firstPartyAuthClient as unknown as { inMemoryCsrfToken: string | null }).inMemoryCsrfToken = 'test-csrf-token';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (firstPartyAuthClient as unknown as { inMemoryCsrfToken: string | null }).inMemoryCsrfToken = null;
  });

  function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      recordedRequests.push({ url, init: init ?? {} });
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'test-csrf-token' }), { status: 200 });
      }
      return handler(url, init ?? {});
    };
  }

  it('1. fetchPlantLogs: issues GET /api/plants/:id/logs with credentials include', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/plants/plant-123/logs');
      assert.equal(init.method ?? 'GET', 'GET');
      assert.equal(init.credentials, 'include');
      return new Response(
        JSON.stringify({
          logs: [
            {
              id: 'log-1',
              userId: 'u-1',
              plantId: 'plant-123',
              logType: 'growth',
              title: 'First leaf',
              content: 'Leaf sprouted nicely',
              loggedAt: '2026-10-23T10:00:00.000Z',
              createdAt: '2026-10-23T10:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchPlantLogs('plant-123');
    assert.equal(res.logs.length, 1);
    assert.equal(res.logs[0]?.title, 'First leaf');
  });

  it('2. createPlantLog: issues POST /api/plants/:id/logs with credentials and body', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/plants/plant-123/logs');
      assert.equal(init.method, 'POST');
      assert.equal(init.credentials, 'include');
      const body = JSON.parse(init.body as string) as { title: string; content: string; logType: string };
      assert.equal(body.title, 'New node');
      assert.equal(body.content, 'Healthy nodes');

      return new Response(
        JSON.stringify({
          log: {
            id: 'log-2',
            userId: 'u-1',
            plantId: 'plant-123',
            logType: 'growth',
            title: 'New node',
            content: 'Healthy nodes',
            loggedAt: '2026-10-23T11:00:00.000Z',
            createdAt: '2026-10-23T11:00:00.000Z',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await createPlantLog('plant-123', {
      title: 'New node',
      content: 'Healthy nodes',
      logType: 'growth',
    });
    assert.equal(res.log.id, 'log-2');
  });

  it('3. deletePlantLog: issues DELETE /api/plants/:id/logs/:logId', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/plants/plant-123/logs/log-2');
      assert.equal(init.method, 'DELETE');
      assert.equal(init.credentials, 'include');
      return new Response(null, { status: 204 });
    });

    await deletePlantLog('plant-123', 'log-2');
    assert.equal(recordedRequests.length, 1);
  });

  it('4. fetchTasks: issues GET /api/tasks with optional filters', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/tasks?gardenId=g-1&status=pending');
      assert.equal(init.credentials, 'include');
      return new Response(
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              userId: 'u-1',
              gardenId: 'g-1',
              plantId: null,
              title: 'Water plants',
              taskType: 'watering',
              status: 'pending',
              priority: 'normal',
              dueAt: null,
              completedAt: null,
              createdAt: '2026-10-23T00:00:00.000Z',
              updatedAt: '2026-10-23T00:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchTasks({ gardenId: 'g-1', status: 'pending' });
    assert.equal(res.tasks.length, 1);
    assert.equal(res.tasks[0]?.title, 'Water plants');
  });

  it('5. fetchTask: issues GET /api/tasks/:id', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/tasks/task-1');
      assert.equal(init.credentials, 'include');
      return new Response(
        JSON.stringify({
          task: {
            id: 'task-1',
            userId: 'u-1',
            gardenId: 'g-1',
            plantId: null,
            title: 'Water plants',
            taskType: 'watering',
            status: 'pending',
            priority: 'normal',
            dueAt: null,
            completedAt: null,
            createdAt: '2026-10-23T00:00:00.000Z',
            updatedAt: '2026-10-23T00:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchTask('task-1');
    assert.equal(res.task.id, 'task-1');
    assert.equal(res.task.title, 'Water plants');
  });

  it('6. createTask: issues POST /api/tasks and returns created task', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/tasks');
      assert.equal(init.method, 'POST');
      assert.equal(init.credentials, 'include');
      const body = JSON.parse(init.body as string) as { title: string; gardenId: string };
      assert.equal(body.title, 'Check EC');
      assert.equal(body.gardenId, 'g-1');

      return new Response(
        JSON.stringify({
          task: {
            id: 'task-2',
            userId: 'u-1',
            gardenId: 'g-1',
            plantId: null,
            title: 'Check EC',
            taskType: 'inspect',
            status: 'pending',
            priority: 'normal',
            dueAt: null,
            completedAt: null,
            createdAt: '2026-10-23T00:00:00.000Z',
            updatedAt: '2026-10-23T00:00:00.000Z',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await createTask({
      gardenId: 'g-1',
      title: 'Check EC',
      taskType: 'inspect',
      priority: 'normal',
    });
    assert.equal(res.task.id, 'task-2');
  });

  it('7. updateTask: issues PATCH /api/tasks/:id', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/tasks/task-2');
      assert.equal(init.method, 'PATCH');
      assert.equal(init.credentials, 'include');
      const body = JSON.parse(init.body as string) as { status: string };
      assert.equal(body.status, 'completed');

      return new Response(
        JSON.stringify({
          task: {
            id: 'task-2',
            userId: 'u-1',
            gardenId: 'g-1',
            plantId: null,
            title: 'Check EC',
            taskType: 'inspect',
            status: 'completed',
            completedAt: '2026-10-23T12:00:00.000Z',
            priority: 'normal',
            dueAt: null,
            createdAt: '2026-10-23T00:00:00.000Z',
            updatedAt: '2026-10-23T12:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await updateTask('task-2', { status: 'completed' });
    assert.equal(res.task.status, 'completed');
  });

  it('8. deleteTask: issues DELETE /api/tasks/:id', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/tasks/task-2');
      assert.equal(init.method, 'DELETE');
      assert.equal(init.credentials, 'include');
      return new Response(null, { status: 204 });
    });

    await deleteTask('task-2');
    assert.equal(recordedRequests.length, 1);
  });

  it('9. fetchTasks: supports due and priority filters in query parameters', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/tasks?gardenId=g-1&status=pending&due=overdue&priority=high');
      assert.equal(init.credentials, 'include');
      return new Response(
        JSON.stringify({
          tasks: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchTasks({
      gardenId: 'g-1',
      status: 'pending',
      due: 'overdue',
      priority: 'high',
    });
    assert.deepEqual(res.tasks, []);
  });

  it('10. fetchRecommendations: issues GET /api/recommendations and parses results', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/recommendations?plantId=plant-1');
      assert.equal(init.credentials, 'include');
      return new Response(
        JSON.stringify({
          recommendations: [
            {
              id: 'rec-1',
              category: 'care_task',
              severity: 'critical',
              title: 'Overdue care task: Water Tomato',
              condition: 'Task "Water Tomato" was scheduled for yesterday.',
              reason: 'Scheduled care task has passed its target deadline.',
              suggestedAction: 'Complete watering task.',
              actionLink: '/dashboard/tasks/task-1',
              actionLabel: 'View Task',
            },
          ],
          summary: {
            total: 1,
            criticalCount: 1,
            warningCount: 0,
            infoCount: 0,
            overdueTaskCount: 1,
            dueTodayTaskCount: 0,
            environmentalAlertCount: 0,
            evaluatedAt: '2026-10-24T00:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchRecommendations({ plantId: 'plant-1' });
    assert.equal(res.recommendations.length, 1);
    assert.equal(res.summary.criticalCount, 1);
    assert.equal(res.recommendations[0]?.actionLabel, 'View Task');
  });
});
