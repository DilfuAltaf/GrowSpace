import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { findConversationsByUserId } from '@/lib/assistant/assistant-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/assistant/conversations
 * Lists persistent assistant conversations for the authenticated user.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const searchParams = request.nextUrl.searchParams;

    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');

    const limit = limitParam ? parseInt(limitParam, 10) || 20 : 20;
    const offset = offsetParam ? parseInt(offsetParam, 10) || 0 : 0;

    const db = getAuthDb();
    const conversations = await findConversationsByUserId(db, user.id, { limit, offset });

    return NextResponse.json({
      conversations,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
