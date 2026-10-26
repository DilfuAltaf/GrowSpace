import { NextResponse, type NextRequest } from 'next/server';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import {
  deleteConversation,
  findConversationById,
  findMessagesByConversationId,
} from '@/lib/assistant/assistant-repository';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/assistant/conversations/[id]
 * Retrieves conversation thread and bounded message history.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    const db = getAuthDb();
    const result = await findConversationById(db, id, user.id);

    if (!result.exists) {
      throw new AppError(404, 'not_found', 'Conversation not found');
    }
    if (!result.owned) {
      throw new AppError(403, 'forbidden', 'You do not have access to this conversation');
    }

    const messages = await findMessagesByConversationId(db, id, { limit: 50 });

    return NextResponse.json({
      conversation: result.conversation,
      messages,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/assistant/conversations/[id]
 * Deletes a conversation thread and all its messages.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    const db = getAuthDb();
    const result = await findConversationById(db, id, user.id);

    if (!result.exists) {
      throw new AppError(404, 'not_found', 'Conversation not found');
    }
    if (!result.owned) {
      throw new AppError(403, 'forbidden', 'You do not have access to this conversation');
    }

    await deleteConversation(db, id, user.id);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
