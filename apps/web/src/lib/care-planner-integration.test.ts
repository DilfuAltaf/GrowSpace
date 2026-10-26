import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  computeNextOccurrence,
  getCalendarMonthDays,
  getCalendarWeekDays,
  getTaskDueClassification,
} from '@growspace/shared';
import {
  createCareSchedule,
  deleteCareSchedule,
  fetchCareSchedule,
  fetchCareSchedules,
  fetchTasks,
  updateCareSchedule,
  updateTask,
} from './api';
import { firstPartyAuthClient } from '@/features/auth/first-party-client';

describe('GrowSpace Phase 5.10: Care Planner & Calendar Integration Suite', () => {
  const originalFetch = globalThis.fetch;
  let recordedRequests: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    recordedRequests = [];
    (firstPartyAuthClient as unknown as { inMemoryCsrfToken: string | null }).inMemoryCsrfToken = 'mock-csrf-token-5-10';
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

  it('1. fetchTasks encodes calendar search, date ranges, and priority filters', async () => {
    mockFetch((url, init) => {
      assert.equal(init.credentials, 'include');
      assert.ok(url.includes('search=prune'));
      assert.ok(url.includes('from=2026-10-01T00%3A00%3A00.000Z'));
      assert.ok(url.includes('to=2026-10-31T23%3A59%3A59.999Z'));
      assert.ok(url.includes('priority=high'));

      return new Response(
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Prune vines',
              taskType: 'pruning',
              dueAt: '2026-10-25T10:00:00.000Z',
              status: 'pending',
              priority: 'high',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchTasks({
      search: 'prune',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T23:59:59.999Z',
      priority: 'high',
    });

    assert.equal(res.tasks.length, 1);
    assert.equal(res.tasks[0]?.title, 'Prune vines');
  });

  it('2. Care Schedules API: lists, creates, updates, and deletes with CSRF & credentials', async () => {
    mockFetch((url, init) => {
      assert.equal(init.credentials, 'include');

      if (url === '/api/tasks/schedules' && init.method === 'POST') {
        const headers = new Headers(init.headers);
        assert.equal(headers.get('x-csrf-token'), 'mock-csrf-token-5-10');
        const body = JSON.parse(init.body as string) as { title: string; intervalValue: number };
        assert.equal(body.title, 'Water basil daily');
        assert.equal(body.intervalValue, 1);

        return new Response(
          JSON.stringify({
            schedule: {
              id: 'sched-1',
              title: 'Water basil daily',
              intervalValue: 1,
              intervalUnit: 'days',
              isActive: true,
            },
            initialTask: {
              id: 'task-gen-1',
              title: 'Water basil daily',
              scheduleId: 'sched-1',
              status: 'pending',
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }

      if (url === '/api/tasks/schedules?isActive=true') {
        return new Response(
          JSON.stringify({
            schedules: [{ id: 'sched-1', title: 'Water basil daily', isActive: true }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (url === '/api/tasks/schedules/sched-1' && (!init.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
            schedule: { id: 'sched-1', title: 'Water basil daily', isActive: true },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (url === '/api/tasks/schedules/sched-1' && init.method === 'PATCH') {
        return new Response(
          JSON.stringify({
            schedule: { id: 'sched-1', isActive: false },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (url === '/api/tasks/schedules/sched-1' && init.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unhandled mock URL: ${url}`);
    });

    // Create schedule
    const created = await createCareSchedule({
      gardenId: 'g-1',
      title: 'Water basil daily',
      taskType: 'watering',
      priority: 'normal',
      intervalValue: 1,
      intervalUnit: 'days',
    });
    assert.equal(created.schedule.id, 'sched-1');
    assert.equal(created.initialTask.scheduleId, 'sched-1');

    // Fetch single schedule
    const fetched = await fetchCareSchedule('sched-1');
    assert.equal(fetched.schedule.id, 'sched-1');

    // List active schedules
    const list = await fetchCareSchedules({ isActive: true });
    assert.equal(list.schedules.length, 1);

    // Update schedule
    const updated = await updateCareSchedule('sched-1', { isActive: false });
    assert.equal(updated.schedule.isActive, false);

    // Delete schedule
    await deleteCareSchedule('sched-1');
  });

  it('3. Calendar Month & Week View Generators: correct dimensions and today tracking', () => {
    const fixedToday = new Date('2026-10-25T12:00:00.000Z');

    // Month view: October 2026 (index 9)
    const month = getCalendarMonthDays(2026, 9, fixedToday);
    assert.equal(month.length, 42, 'Month view must always return 42 grid cells (6 rows x 7 days)');

    const todayCell = month.find((d) => d.dateStr === '2026-10-25');
    assert.ok(todayCell, 'Today cell must exist in calendar month');
    assert.equal(todayCell.isToday, true);
    assert.equal(todayCell.isCurrentMonth, true);

    // Week view: Week of Oct 25, 2026
    const week = getCalendarWeekDays(fixedToday, fixedToday);
    assert.equal(week.length, 7, 'Week view must return 7 days');
    assert.equal(week[0]?.dateStr, '2026-10-25', 'Week starts on Sunday');
    assert.equal(week[0]?.isToday, true);
  });

  it('4. Task Status Transitions: completion and reopening maintains completedAt consistency', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/tasks/task-99');
      const body = JSON.parse(init.body as string) as { status: string };

      if (body.status === 'completed') {
        return new Response(
          JSON.stringify({
            task: { id: 'task-99', status: 'completed', completedAt: '2026-10-25T14:30:00.000Z' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (body.status === 'pending') {
        return new Response(
          JSON.stringify({
            task: { id: 'task-99', status: 'pending', completedAt: null },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      throw new Error('Unexpected status');
    });

    const completedRes = await updateTask('task-99', { status: 'completed' });
    assert.equal(completedRes.task.status, 'completed');
    assert.ok(completedRes.task.completedAt);

    const reopenedRes = await updateTask('task-99', { status: 'pending' });
    assert.equal(reopenedRes.task.status, 'pending');
    assert.equal(reopenedRes.task.completedAt, null);
  });

  it('5. Late recurrence calculation correctly spaces next occurrence from completion date', () => {
    const lateCompletionTime = new Date('2026-10-25T16:00:00.000Z');
    // Task was originally due on 2026-10-20, completed on Oct 25 with 4 days interval
    const nextDue = computeNextOccurrence(lateCompletionTime, 4, 'days');
    assert.equal(nextDue.toISOString(), '2026-10-29T16:00:00.000Z');
  });

  it('6. Due date classifications classify overdue, today, and upcoming tasks deterministically', () => {
    const now = new Date('2026-10-25T12:00:00.000Z');

    assert.equal(getTaskDueClassification('2026-10-24T23:59:59.000Z', now), 'overdue');
    assert.equal(getTaskDueClassification('2026-10-25T08:00:00.000Z', now), 'today');
    assert.equal(getTaskDueClassification('2026-10-25T20:00:00.000Z', now), 'today');
    assert.equal(getTaskDueClassification('2026-10-26T00:00:00.000Z', now), 'upcoming');
    assert.equal(getTaskDueClassification(null, now), 'none');
  });
});
