import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { markAllNotificationsAsRead } from '@/lib/notifications/notification-repository';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/mark-all-read
 * Marks all unread notifications for the caller as read.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const db = getAuthDb();

    const updatedCount = await markAllNotificationsAsRead(db, user.id);

    return NextResponse.json({ updatedCount });
  } catch (error) {
    return errorResponse(error);
  }
}
