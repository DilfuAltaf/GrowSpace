import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  deleteAssistantConversation,
  fetchAssistantConversation,
  fetchAssistantConversations,
  sendAssistantMessage,
  ApiClientError,
} from './api';
import { firstPartyAuthClient } from '@/features/auth/first-party-client';

describe('GrowSpace Phase 5.11: AI Farming Assistant Frontend Client Suite', () => {
  const originalFetch = globalThis.fetch;
  let recordedRequests: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    recordedRequests = [];
    (firstPartyAuthClient as unknown as { inMemoryCsrfToken: string | null }).inMemoryCsrfToken = 'mock-csrf-token-5-11';
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

  it('1. sendAssistantMessage posts payload with CSRF, credentials, and parses grounding details', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/assistant/chat');
      assert.equal(init.method, 'POST');
      assert.equal(init.credentials, 'include');

      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-csrf-token'), 'mock-csrf-token-5-11');
      assert.equal(headers.get('content-type'), 'application/json');

      const body = JSON.parse(init.body as string) as { message: string; gardenId?: string };
      assert.equal(body.message, 'Which of my plants need attention?');
      assert.equal(body.gardenId, 'g-101');

      return new Response(
        JSON.stringify({
          conversationId: 'conv-101',
          message: {
            id: 'msg-1',
            conversationId: 'conv-101',
            role: 'assistant',
            content: 'Your basil needs moisture inspection; latest soil moisture reading is 35%.',
            metadata: {
              advisoryNotice: 'AI guidance is advisory.',
              provenanceNotes: ['Grounded in farm telemetry'],
            },
            createdAt: '2026-10-25T12:00:00.000Z',
          },
          sources: [],
          advisoryNotice: 'AI guidance is advisory.',
          groundingDetails: {
            gardensCount: 1,
            plantsCount: 2,
            readingsCount: 5,
            tasksCount: 2,
            webResearchUsed: false,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await sendAssistantMessage({
      message: 'Which of my plants need attention?',
      gardenId: 'g-101',
    });

    assert.equal(res.conversationId, 'conv-101');
    assert.equal(res.message.role, 'assistant');
    assert.ok(res.message.content.includes('basil needs moisture inspection'));
    assert.equal(res.groundingDetails?.plantsCount, 2);
    assert.equal(res.groundingDetails?.webResearchUsed, false);
  });

  it('2. fetchAssistantConversations lists threads with pagination and credentials', async () => {
    mockFetch((url, init) => {
      assert.equal(init.credentials, 'include');
      assert.ok(url.includes('/api/assistant/conversations?limit=10&offset=0'));

      return new Response(
        JSON.stringify({
          conversations: [
            {
              id: 'conv-1',
              userId: 'u-1',
              title: 'Tomato Pruning Routine',
              createdAt: '2026-10-25T10:00:00.000Z',
              updatedAt: '2026-10-25T10:05:00.000Z',
              messagesCount: 4,
              lastMessage: 'Inspect foliage weekly.',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchAssistantConversations({ limit: 10, offset: 0 });
    assert.equal(res.conversations.length, 1);
    assert.equal(res.conversations[0]?.title, 'Tomato Pruning Routine');
    assert.equal(res.conversations[0]?.messagesCount, 4);
  });

  it('3. fetchAssistantConversation retrieves thread and ordered messages', async () => {
    mockFetch((url, init) => {
      assert.equal(init.credentials, 'include');
      assert.equal(url, '/api/assistant/conversations/conv-1');

      return new Response(
        JSON.stringify({
          conversation: {
            id: 'conv-1',
            userId: 'u-1',
            title: 'Tomato Pruning Routine',
          },
          messages: [
            {
              id: 'm-1',
              conversationId: 'conv-1',
              role: 'user',
              content: 'How should I prune indeterminate tomatoes?',
            },
            {
              id: 'm-2',
              conversationId: 'conv-1',
              role: 'assistant',
              content: 'Pinch out suckers developing between the main stem and leaf axils.',
              metadata: {
                sources: [
                  {
                    title: 'Pruning Tomatoes in Home Gardens',
                    url: 'https://extension.umn.edu/tomatoes',
                    publisher: 'UMN Extension',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const res = await fetchAssistantConversation('conv-1');
    assert.equal(res.conversation.id, 'conv-1');
    assert.equal(res.messages.length, 2);
    assert.equal(res.messages[1]?.metadata?.sources?.[0]?.publisher, 'UMN Extension');
  });

  it('4. deleteAssistantConversation sends DELETE request with CSRF and credentials', async () => {
    mockFetch((url, init) => {
      assert.equal(url, '/api/assistant/conversations/conv-1');
      assert.equal(init.method, 'DELETE');
      assert.equal(init.credentials, 'include');

      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-csrf-token'), 'mock-csrf-token-5-11');

      return new Response(null, { status: 204 });
    });

    await deleteAssistantConversation('conv-1');
    assert.equal(recordedRequests.length, 1);
    assert.equal(recordedRequests[0]?.init.method, 'DELETE');
  });

  it('5. Captures 429 rate limiting error and surfaces retryable message', async () => {
    mockFetch(() => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'rate_limited',
            message: 'Too many assistant requests. Please wait 15 seconds.',
          },
        }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '15',
          },
        },
      );
    });

    await assert.rejects(
      async () => {
        await sendAssistantMessage({ message: 'Will this fail?' });
      },
      (err: unknown) => {
        const apiErr = err as ApiClientError;
        assert.equal(apiErr.status, 429);
        assert.equal(apiErr.code, 'rate_limited');
        assert.ok(apiErr.message.includes('15 seconds'));
        return true;
      },
    );
  });
});
