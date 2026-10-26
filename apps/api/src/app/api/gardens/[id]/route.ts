import { NextResponse, type NextRequest } from 'next/server';
import { gardenUpdateSchema } from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { assertOwnership, requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import {
  countPlantsInGarden,
  deleteGarden,
  findGardenById,
  isValidUuid,
  updateGarden,
} from '@/lib/gardens/garden-repository';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/gardens/:id
 * Retrieves one garden owned by the authenticated caller.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid garden ID format.');
    }

    const user = await requireUser(request);
    const db = getAuthDb();
    const garden = await findGardenById(db, id);

    if (!garden) {
      throw new AppError(404, 'not_found', 'Garden not found.');
    }

    assertOwnership(garden.userId, user);

    return NextResponse.json(
      { garden },
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
 * PATCH /api/gardens/:id
 * Updates an owned garden record.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid garden ID format.');
    }

    const user = await requireUser(request);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new AppError(400, 'bad_request', 'Invalid JSON body in request.');
    }

    const input = gardenUpdateSchema.parse(rawBody);
    const db = getAuthDb();
    const existing = await findGardenById(db, id);

    if (!existing) {
      throw new AppError(404, 'not_found', 'Garden not found.');
    }

    assertOwnership(existing.userId, user);

    const updated = await updateGarden(db, id, user.id, input);

    return NextResponse.json({ garden: updated });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/gardens/:id
 * Deletes an owned garden according to the safe deletion policy:
 * - If the garden contains plants, deletion requires explicit `?cascade=true` confirmation.
 * - Otherwise, rejects with 409 Conflict (code: garden_not_empty) to prevent accidental data loss.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid garden ID format.');
    }

    const user = await requireUser(request);
    const db = getAuthDb();
    const existing = await findGardenById(db, id);

    if (!existing) {
      throw new AppError(404, 'not_found', 'Garden not found.');
    }

    assertOwnership(existing.userId, user);

    const plantCount = await countPlantsInGarden(db, id, user.id);
    const cascade = request.nextUrl.searchParams.get('cascade') === 'true';

    if (plantCount > 0 && !cascade) {
      throw new AppError(
        409,
        'garden_not_empty',
        `This garden contains ${plantCount} plant(s). Remove the plants first or confirm cascade deletion.`,
      );
    }

    await deleteGarden(db, id, user.id);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
