import { NextResponse, type NextRequest } from 'next/server';
import { careScheduleUpdateSchema } from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { assertOwnership, requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import {
  deleteCareSchedule,
  findCareScheduleById,
  updateCareSchedule,
} from '@/lib/tasks/care-schedule-repository';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/tasks/schedules/:id
 * Retrieves a single care schedule owned by the authenticated caller.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid schedule ID format.');
    }

    const user = await requireUser(request);
    const db = getAuthDb();
    const schedule = await findCareScheduleById(db, id);

    if (!schedule) {
      throw new AppError(404, 'not_found', 'Care schedule not found.');
    }

    assertOwnership(schedule.userId, user);

    return NextResponse.json(
      { schedule },
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
 * PATCH /api/tasks/schedules/:id
 * Updates an owned care schedule, such as changing recurrence interval or toggling isActive.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid schedule ID format.');
    }

    const user = await requireUser(request);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new AppError(400, 'bad_request', 'Invalid JSON body in request.');
    }

    const input = careScheduleUpdateSchema.parse(rawBody);
    const db = getAuthDb();
    const existing = await findCareScheduleById(db, id);

    if (!existing) {
      throw new AppError(404, 'not_found', 'Care schedule not found.');
    }

    assertOwnership(existing.userId, user);

    const updated = await updateCareSchedule(db, id, user.id, input);

    return NextResponse.json({ schedule: updated });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/tasks/schedules/:id
 * Deletes an owned care schedule.
 * Crucial invariant: deleting a schedule does NOT delete historical completed tasks;
 * tasks have schedule_id set to NULL automatically.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid schedule ID format.');
    }

    const user = await requireUser(request);
    const db = getAuthDb();
    const existing = await findCareScheduleById(db, id);

    if (!existing) {
      throw new AppError(404, 'not_found', 'Care schedule not found.');
    }

    assertOwnership(existing.userId, user);

    await deleteCareSchedule(db, id, user.id);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
