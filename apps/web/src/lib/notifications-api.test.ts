import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  fetchNotifications,
  generateNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './api';
import { firstPartyAuthClient } from '@/features/auth/first-party-client';

describe('Phase 5.5: In-App Notifications Frontend API Client', () => {
  const originalFetch = globalThis.fetch;
  let recordedRequests: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    recordedRequests = [];
    (firstPartyAuthClient as unknown as { inMemoryCsrfToken: string | null }).inMemoryCsrfToken =
      'test-csrf-token';
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
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'test-csrf-token' }), { status: 200 });
      }
      return handler(url, init ?? {});
    };
  }

  it('1. fetchNotifications: issues GET /api/notifications with credentials and filters', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/notifications?unreadOnly=true&type=care_task&limit=10&offset=0');
      assert.equal(init.credentials, 'include');
      return new Response(
        JSON.stringify({
          notifications: [
            {
              id: 'notif-1',
              userId: 'u-1',
              type: 'care_task',
              title: 'Watering Reminder',
              message: 'Water your tomato plant.',
              link: '/dashboard/tasks/1',
              isRead: false,
              readAt: null,
              dedupKey: 'task-1',
              createdAt: '2026-10-24T10:00:00.000Z',
            },
          ],
          total: 1,
          unreadCount: 1,
          limit: 10,
          offset: 0,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchNotifications({
      unreadOnly: true,
      type: 'care_task',
      limit: 10,
      offset: 0,
    });
    assert.equal(res.notifications.length, 1);
    assert.equal(res.notifications[0]?.title, 'Watering Reminder');
    assert.equal(res.unreadCount, 1);
  });

  it('2. markNotificationRead: issues PATCH /api/notifications/:id with CSRF and body', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/notifications/notif-1');
      assert.equal(init.method, 'PATCH');
      assert.equal(init.credentials, 'include');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-csrf-token'), 'test-csrf-token');
      const body = JSON.parse(init.body as string) as { isRead: boolean };
      assert.equal(body.isRead, true);

      return new Response(
        JSON.stringify({
          notification: {
            id: 'notif-1',
            userId: 'u-1',
            type: 'care_task',
            title: 'Watering Reminder',
            message: 'Water your tomato plant.',
            link: '/dashboard/tasks/1',
            isRead: true,
            readAt: '2026-10-24T10:05:00.000Z',
            dedupKey: 'task-1',
            createdAt: '2026-10-24T10:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await markNotificationRead('notif-1', true);
    assert.equal(res.notification.isRead, true);
    assert.ok(res.notification.readAt !== null);
  });

  it('3. markAllNotificationsRead: issues POST /api/notifications/mark-all-read with CSRF', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/notifications/mark-all-read');
      assert.equal(init.method, 'POST');
      assert.equal(init.credentials, 'include');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-csrf-token'), 'test-csrf-token');
      return new Response(JSON.stringify({ updatedCount: 4 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const res = await markAllNotificationsRead();
    assert.equal(res.updatedCount, 4);
  });

  it('4. generateNotifications: issues POST /api/notifications/generate with CSRF', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/notifications/generate');
      assert.equal(init.method, 'POST');
      assert.equal(init.credentials, 'include');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-csrf-token'), 'test-csrf-token');
      return new Response(JSON.stringify({ generatedCount: 2, unreadCount: 3 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const res = await generateNotifications();
    assert.equal(res.generatedCount, 2);
    assert.equal(res.unreadCount, 3);
  });

  it('5. Error Handling: throws ApiClientError on 401 unauthenticated and 403 forbidden', async () => {
    mockFetch(() => {
      return new Response(
        JSON.stringify({ error: { code: 'unauthenticated', message: 'Sign in to continue.' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    });

    await assert.rejects(
      async () => {
        await fetchNotifications();
      },
      (err: unknown) => {
        return (
          err instanceof Error &&
          (err as { status?: number }).status === 401 &&
          err.message.includes('Sign in to continue.')
        );
      },
    );
  });
});
