import { NextResponse, type NextRequest } from 'next/server';
import { taskInputSchema } from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import { verifyPlantOwnership } from '@/lib/plant-logs/plant-log-repository';
import {
  createTask,
  findTasksByUserId,
  verifyGardenOwnershipForTask,
  verifyPlantBelongsToGarden,
} from '@/lib/tasks/task-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks
 * Lists care tasks belonging to the authenticated user.
 * Supports optional ?gardenId=, ?plantId=, and ?status= query parameters.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const searchParams = request.nextUrl.searchParams;

    const gardenId = searchParams.get('gardenId')?.trim() || undefined;
    const plantId = searchParams.get('plantId')?.trim() || undefined;
    const status = searchParams.get('status')?.trim() || undefined;
    const due = searchParams.get('due')?.trim() || undefined;
    const priority = searchParams.get('priority')?.trim() || undefined;
    const search = searchParams.get('search')?.trim() || undefined;
    const from = searchParams.get('from')?.trim() || undefined;
    const to = searchParams.get('to')?.trim() || undefined;

    if (status && !['pending', 'completed', 'cancelled', 'all'].includes(status)) {
      throw new AppError(400, 'invalid_parameter', `Invalid status filter '${status}'.`);
    }

    if (due && !['overdue', 'today', 'upcoming'].includes(due)) {
      throw new AppError(400, 'invalid_parameter', `Invalid due filter '${due}'.`);
    }

    if (priority && !['low', 'normal', 'high'].includes(priority)) {
      throw new AppError(400, 'invalid_parameter', `Invalid priority filter '${priority}'.`);
    }

    if (from && Number.isNaN(new Date(from).getTime())) {
      throw new AppError(400, 'invalid_parameter', 'Invalid from date format.');
    }

    if (to && Number.isNaN(new Date(to).getTime())) {
      throw new AppError(400, 'invalid_parameter', 'Invalid to date format.');
    }

    if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
      throw new AppError(400, 'invalid_parameter', 'From date cannot be after to date.');
    }

    const db = getAuthDb();

    if (gardenId) {
      if (!isValidUuid(gardenId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid garden ID format.');
      }
      const gardenCheck = await verifyGardenOwnershipForTask(db, gardenId, user.id);
      if (!gardenCheck.exists || !gardenCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to this garden.');
      }
    }

    if (plantId) {
      if (!isValidUuid(plantId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format.');
      }
      const plantCheck = await verifyPlantOwnership(db, plantId, user.id);
      if (!plantCheck.exists || !plantCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to this plant.');
      }
    }

    const tasks = await findTasksByUserId(db, user.id, {
      gardenId,
      plantId,
      status: status === 'all' ? undefined : status,
      due: due as 'overdue' | 'today' | 'upcoming' | undefined,
      priority: priority as 'low' | 'normal' | 'high' | undefined,
      search,
      from,
      to,
    });

    return NextResponse.json(
      { tasks },
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
 * POST /api/tasks
 * Creates a new care task for a garden and optional plant.
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

    const input = taskInputSchema.parse(rawBody);

    if (!isValidUuid(input.gardenId)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid garden ID format.');
    }

    const db = getAuthDb();

    // Verify garden ownership
    const gardenCheck = await verifyGardenOwnershipForTask(db, input.gardenId, user.id);
    if (!gardenCheck.exists || !gardenCheck.owned) {
      throw new AppError(403, 'forbidden', 'You do not have access to the destination garden.');
    }

    // Verify plant ownership and relationship to garden if specified
    if (input.plantId) {
      if (!isValidUuid(input.plantId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format.');
      }
      const plantCheck = await verifyPlantBelongsToGarden(
        db,
        input.plantId,
        input.gardenId,
        user.id,
      );
      if (!plantCheck.exists || !plantCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to the specified plant.');
      }
      if (!plantCheck.inGarden) {
        throw new AppError(
          400,
          'invalid_relationship',
          'The specified plant does not belong to the destination garden.',
        );
      }
    }

    const task = await createTask(db, user.id, input);

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
