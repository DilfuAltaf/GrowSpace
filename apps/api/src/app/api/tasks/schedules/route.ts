import { NextResponse, type NextRequest } from 'next/server';
import { careScheduleInputSchema } from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import { verifyPlantBelongsToGarden, verifyGardenOwnershipForTask } from '@/lib/tasks/task-repository';
import {
  createCareSchedule,
  findCareSchedulesByUserId,
} from '@/lib/tasks/care-schedule-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks/schedules
 * Lists care schedules belonging to the authenticated user.
 * Supports optional ?gardenId=, ?plantId=, and ?isActive= query parameters.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const searchParams = request.nextUrl.searchParams;

    const gardenId = searchParams.get('gardenId')?.trim() || undefined;
    const plantId = searchParams.get('plantId')?.trim() || undefined;
    const isActiveParam = searchParams.get('isActive')?.trim() || undefined;

    let isActive: boolean | undefined = undefined;
    if (isActiveParam !== undefined) {
      if (isActiveParam === 'true') isActive = true;
      else if (isActiveParam === 'false') isActive = false;
      else {
        throw new AppError(400, 'invalid_parameter', `Invalid isActive filter '${isActiveParam}'.`);
      }
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

    const schedules = await findCareSchedulesByUserId(db, user.id, {
      gardenId,
      plantId,
      isActive,
    });

    return NextResponse.json(
      { schedules },
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
 * POST /api/tasks/schedules
 * Creates a new recurring care schedule and generates its initial bounded care task.
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

    const input = careScheduleInputSchema.parse(rawBody);

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

    const { schedule, initialTask } = await createCareSchedule(db, user.id, input);

    return NextResponse.json({ schedule, initialTask }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
