import type {
  AssistantConversation,
  AssistantMessage,
  AssistantMessageMetadata,
  AssistantMessageRole,
} from '@growspace/shared';
import { executeQuery, type Queryable } from '../auth/db-client';
import { isValidUuid } from '../gardens/garden-repository';

export interface ConversationRecord {
  id: string;
  user_id: string;
  title: string;
  garden_id: string | null;
  plant_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  messages_count?: number | string | null;
  last_message?: string | null;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  metadata: unknown;
  created_at: Date | string;
}

export function toConversation(record: ConversationRecord): AssistantConversation {
  return {
    id: record.id,
    userId: record.user_id,
    title: record.title,
    gardenId: record.garden_id ?? null,
    plantId: record.plant_id ?? null,
    createdAt:
      record.created_at instanceof Date
        ? record.created_at.toISOString()
        : new Date(record.created_at).toISOString(),
    updatedAt:
      record.updated_at instanceof Date
        ? record.updated_at.toISOString()
        : new Date(record.updated_at).toISOString(),
    messagesCount:
      record.messages_count != null ? parseInt(String(record.messages_count), 10) : undefined,
    lastMessage: record.last_message ?? null,
  };
}

export function toMessage(record: MessageRecord): AssistantMessage {
  let metadata: AssistantMessageMetadata | undefined;
  if (record.metadata && typeof record.metadata === 'object') {
    metadata = record.metadata as AssistantMessageMetadata;
  } else if (typeof record.metadata === 'string') {
    try {
      metadata = JSON.parse(record.metadata) as AssistantMessageMetadata;
    } catch {
      metadata = undefined;
    }
  }

  return {
    id: record.id,
    conversationId: record.conversation_id,
    role: record.role as AssistantMessageRole,
    content: record.content,
    metadata,
    createdAt:
      record.created_at instanceof Date
        ? record.created_at.toISOString()
        : new Date(record.created_at).toISOString(),
  };
}

/**
 * Creates a new assistant conversation thread for a user.
 */
export async function createConversation(
  client: Queryable,
  userId: string,
  input: {
    title: string;
    gardenId?: string | null;
    plantId?: string | null;
  },
): Promise<AssistantConversation | null> {
  const title = input.title.trim().slice(0, 200) || 'New Conversation';
  const gardenId = input.gardenId && isValidUuid(input.gardenId) ? input.gardenId : null;
  const plantId = input.plantId && isValidUuid(input.plantId) ? input.plantId : null;

  try {
    const res = await executeQuery<ConversationRecord>(
      client,
      `INSERT INTO assistant_conversations (user_id, title, garden_id, plant_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, title, garden_id, plant_id, created_at, updated_at;`,
      [userId, title, gardenId, plantId],
    );

    if (res.rows.length === 0) return null;
    return toConversation(res.rows[0]);
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '42P01') {
      // Table assistant_conversations does not exist
      return null;
    }
    throw err;
  }
}

/**
 * Lists conversations belonging to a user, ordered latest first.
 */
export async function findConversationsByUserId(
  client: Queryable,
  userId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<AssistantConversation[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);

  try {
    const res = await executeQuery<ConversationRecord>(
      client,
      `SELECT c.id, c.user_id, c.title, c.garden_id, c.plant_id, c.created_at, c.updated_at,
              COUNT(m.id) AS messages_count,
              (
                SELECT m2.content
                FROM assistant_messages m2
                WHERE m2.conversation_id = c.id
                ORDER BY m2.created_at DESC
                LIMIT 1
              ) AS last_message
       FROM assistant_conversations c
       LEFT JOIN assistant_messages m ON m.conversation_id = c.id
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY c.updated_at DESC
       LIMIT $2 OFFSET $3;`,
      [userId, limit, offset],
    );

    return res.rows.map(toConversation);
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '42P01') {
      return [];
    }
    throw err;
  }
}

/**
 * Retrieves a conversation by ID, enforcing user ownership.
 */
export async function findConversationById(
  client: Queryable,
  id: string,
  userId: string,
): Promise<{ exists: boolean; owned: boolean; conversation?: AssistantConversation }> {
  if (!isValidUuid(id)) {
    return { exists: false, owned: false };
  }

  try {
    const res = await executeQuery<ConversationRecord>(
      client,
      `SELECT c.id, c.user_id, c.title, c.garden_id, c.plant_id, c.created_at, c.updated_at,
              COUNT(m.id) AS messages_count
       FROM assistant_conversations c
       LEFT JOIN assistant_messages m ON m.conversation_id = c.id
       WHERE c.id = $1
       GROUP BY c.id;`,
      [id],
    );

    if (res.rows.length === 0) {
      return { exists: false, owned: false };
    }

    const row = res.rows[0];
    const isOwner = row.user_id === userId;
    return {
      exists: true,
      owned: isOwner,
      conversation: isOwner ? toConversation(row) : undefined,
    };
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '42P01') {
      return { exists: false, owned: false };
    }
    throw err;
  }
}

/**
 * Appends a message to a conversation.
 */
export async function addMessageToConversation(
  client: Queryable,
  conversationId: string,
  role: AssistantMessageRole,
  content: string,
  metadata: AssistantMessageMetadata = {},
): Promise<AssistantMessage | null> {
  try {
    const res = await executeQuery<MessageRecord>(
      client,
      `INSERT INTO assistant_messages (conversation_id, role, content, metadata)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, conversation_id, role, content, metadata, created_at;`,
      [conversationId, role, content.trim(), JSON.stringify(metadata)],
    );

    if (res.rows.length === 0) return null;

    // Update conversation updated_at
    await executeQuery(
      client,
      `UPDATE assistant_conversations SET updated_at = now() WHERE id = $1;`,
      [conversationId],
    ).catch(() => {});

    return toMessage(res.rows[0]);
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '42P01') {
      return null;
    }
    throw err;
  }
}

/**
 * Retrieves ordered messages for a conversation thread.
 */
export async function findMessagesByConversationId(
  client: Queryable,
  conversationId: string,
  options: { limit?: number } = {},
): Promise<AssistantMessage[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

  try {
    const res = await executeQuery<MessageRecord>(
      client,
      `SELECT id, conversation_id, role, content, metadata, created_at
       FROM assistant_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC
       LIMIT $2;`,
      [conversationId, limit],
    );

    return res.rows.map(toMessage);
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '42P01') {
      return [];
    }
    throw err;
  }
}

/**
 * Deletes a conversation and all its messages, asserting user ownership.
 */
export async function deleteConversation(
  client: Queryable,
  id: string,
  userId: string,
): Promise<boolean> {
  if (!isValidUuid(id)) return false;

  try {
    const res = await executeQuery(
      client,
      `DELETE FROM assistant_conversations WHERE id = $1 AND user_id = $2;`,
      [id, userId],
    );

    return (res.rowCount ?? 0) > 0;
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '42P01') {
      return false;
    }
    throw err;
  }
}
