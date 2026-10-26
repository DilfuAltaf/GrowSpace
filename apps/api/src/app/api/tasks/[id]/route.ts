import { NextResponse, type NextRequest } from 'next/server';
import { taskUpdateSchema } from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { assertOwnership, requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import {
  deleteTask,
  findTaskById,
  updateTask,
  verifyPlantBelongsToGarden,
} from '@/lib/tasks/task-repository';
import { handleRecurringTaskCompleted } from '@/lib/tasks/care-schedule-repository';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/tasks/:id
 * Retrieves a single care task owned by the authenticated caller.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid task ID format.');
    }

    const user = await requireUser(request);
    const db = getAuthDb();
    const task = await findTaskById(db, id);

    if (!task) {
      throw new AppError(404, 'not_found', 'Care task not found.');
    }

    assertOwnership(task.userId, user);

    return NextResponse.json(
      { task },
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
 * PATCH /api/tasks/:id
 * Updates an owned care task, including status toggling (completion) and task details.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid task ID format.');
    }

    const user = await requireUser(request);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new AppError(400, 'bad_request', 'Invalid JSON body in request.');
    }

    const input = taskUpdateSchema.parse(rawBody);
    const db = getAuthDb();
    const existing = await findTaskById(db, id);

    if (!existing) {
      throw new AppError(404, 'not_found', 'Care task not found.');
    }

    assertOwnership(existing.userId, user);

    // If plantId is changing to another plant, verify relationship to task's garden
    if (input.plantId !== undefined && input.plantId !== null) {
      if (!isValidUuid(input.plantId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format.');
      }
      const plantCheck = await verifyPlantBelongsToGarden(
        db,
        input.plantId,
        existing.gardenId,
        user.id,
      );
      if (!plantCheck.exists || !plantCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to the specified plant.');
      }
      if (!plantCheck.inGarden) {
        throw new AppError(
          400,
          'invalid_relationship',
          'The specified plant does not belong to this task’s garden.',
        );
      }
    }

    const updated = await updateTask(db, id, user.id, input);

    // If transitioned to completed and linked to a recurring schedule, advance schedule and generate next bounded occurrence
    if (existing.status !== 'completed' && input.status === 'completed' && updated?.scheduleId) {
      await handleRecurringTaskCompleted(db, updated);
    }

    return NextResponse.json({ task: updated });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/tasks/:id
 * Deletes an owned care task.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid task ID format.');
    }

    const user = await requireUser(request);
    const db = getAuthDb();
    const existing = await findTaskById(db, id);

    if (!existing) {
      throw new AppError(404, 'not_found', 'Care task not found.');
    }

    assertOwnership(existing.userId, user);

    await deleteTask(db, id, user.id);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
