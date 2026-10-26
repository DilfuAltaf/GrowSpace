import { NextResponse, type NextRequest } from 'next/server';
import {
  notificationInputSchema,
  notificationQuerySchema,
  type NotificationType,
} from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import {
  createNotification,
  findNotifications,
} from '@/lib/notifications/notification-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/notifications
 * Lists notifications for the authenticated user.
 * Supports ?unreadOnly=true, ?type=, ?limit=, and ?offset=.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const searchParams = request.nextUrl.searchParams;

    const unreadOnlyParam = searchParams.get('unreadOnly')?.trim() || undefined;
    const typeParam = searchParams.get('type')?.trim() || undefined;
    const limitParam = searchParams.get('limit')?.trim() || undefined;
    const offsetParam = searchParams.get('offset')?.trim() || undefined;

    const parsedQuery = notificationQuerySchema.parse({
      unreadOnly: unreadOnlyParam,
      type: typeParam as NotificationType | undefined,
      limit: limitParam,
      offset: offsetParam,
    });

    const db = getAuthDb();
    const result = await findNotifications(db, user.id, {
      unreadOnly: parsedQuery.unreadOnly,
      type: parsedQuery.type,
      limit: parsedQuery.limit,
      offset: parsedQuery.offset,
    });

    return NextResponse.json(
      {
        notifications: result.notifications,
        total: result.total,
        unreadCount: result.unreadCount,
        limit: parsedQuery.limit,
        offset: parsedQuery.offset,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/notifications
 * Creates a notification for the authenticated user.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new AppError(400, 'bad_request', 'Invalid JSON body in request.');
    }

    const input = notificationInputSchema.parse(rawBody);
    const db = getAuthDb();

    const notification = await createNotification(db, user.id, input);

    if (!notification) {
      // Deduplication hit: already exists
      return NextResponse.json(
        { message: 'Notification already exists for this deduplication key.' },
        { status: 200 },
      );
    }

    return NextResponse.json({ notification }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
