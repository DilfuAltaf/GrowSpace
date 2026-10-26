import { NextResponse, type NextRequest } from 'next/server';
import { notificationUpdateSchema } from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { assertOwnership, requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import {
  findNotificationById,
  updateNotificationReadState,
} from '@/lib/notifications/notification-repository';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/notifications/:id
 * Retrieves a single notification belonging to the caller.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid notification ID format.');
    }

    const user = await requireUser(request);
    const db = getAuthDb();
    const notification = await findNotificationById(db, id);

    if (!notification) {
      throw new AppError(404, 'not_found', 'Notification not found.');
    }

    assertOwnership(notification.userId, user);

    return NextResponse.json(
      { notification },
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
 * PATCH /api/notifications/:id
 * Updates a notification's read state (mark read or unread).
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid notification ID format.');
    }

    const user = await requireUser(request);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new AppError(400, 'bad_request', 'Invalid JSON body in request.');
    }

    const input = notificationUpdateSchema.parse(rawBody);
    const db = getAuthDb();
    const existing = await findNotificationById(db, id);

    if (!existing) {
      throw new AppError(404, 'not_found', 'Notification not found.');
    }

    assertOwnership(existing.userId, user);

    const updated = await updateNotificationReadState(db, id, user.id, input.isRead);

    return NextResponse.json({ notification: updated });
  } catch (error) {
    return errorResponse(error);
  }
}
