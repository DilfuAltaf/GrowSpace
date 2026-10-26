import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { generateCareReminders } from '@/lib/notifications/notification-repository';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/generate
 * Evaluates active tasks and care intelligence to generate fresh reminders
 * with idempotent deduplication (preventing duplicate alerts for the same event on the same day).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const db = getAuthDb();

    const result = await generateCareReminders(db, user.id);

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
