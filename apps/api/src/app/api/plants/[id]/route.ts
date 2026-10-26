import { NextResponse, type NextRequest } from 'next/server';
import { findCatalogEntry, plantUpdateSchema } from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { assertOwnership, requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import {
  deletePlant,
  ensureCatalogEntryExists,
  findPlantById,
  updatePlant,
  verifyGardenOwnership,
} from '@/lib/plants/plant-repository';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/plants/:id
 * Retrieves one plant owned by the authenticated caller.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format.');
    }

    const user = await requireUser(request);
    const db = getAuthDb();
    const plant = await findPlantById(db, id);

    if (!plant) {
      throw new AppError(404, 'not_found', 'Plant not found.');
    }

    assertOwnership(plant.userId, user);

    return NextResponse.json(
      { plant },
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
 * PATCH /api/plants/:id
 * Updates an owned plant record.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format.');
    }

    const user = await requireUser(request);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new AppError(400, 'bad_request', 'Invalid JSON body in request.');
    }

    // Normalize catalogId if supplied as slug
    if (rawBody && typeof rawBody === 'object' && 'catalogId' in rawBody) {
      const b = rawBody as { catalogId?: string | null };
      if (b.catalogId && typeof b.catalogId === 'string') {
        const trimmed = b.catalogId.trim();
        if (!trimmed.startsWith('catalog-')) {
          const entry = findCatalogEntry(trimmed);
          if (entry) {
            b.catalogId = entry.id;
          }
        }
      }
    }

    const input = plantUpdateSchema.parse(rawBody);
    const db = getAuthDb();
    const existing = await findPlantById(db, id);

    if (!existing) {
      throw new AppError(404, 'not_found', 'Plant not found.');
    }

    assertOwnership(existing.userId, user);

    // If gardenId is changing, ensure user owns the destination garden
    if (input.gardenId && input.gardenId !== existing.gardenId) {
      if (!isValidUuid(input.gardenId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid destination garden ID format.');
      }
      const gardenCheck = await verifyGardenOwnership(db, input.gardenId, user.id);
      if (!gardenCheck.exists || !gardenCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to the destination garden.');
      }
    }

    // If catalogId is changing, verify it exists
    if (input.catalogId) {
      const exists = await ensureCatalogEntryExists(db, input.catalogId);
      if (!exists) {
        throw new AppError(422, 'validation_error', 'Selected plant reference does not exist.', {
          catalogId: ['Plant reference not found in catalog.'],
        });
      }
    }

    const updated = await updatePlant(db, id, user.id, input);

    return NextResponse.json({ plant: updated });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/plants/:id
 * Removes a plant from a garden.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format.');
    }

    const user = await requireUser(request);
    const db = getAuthDb();
    const existing = await findPlantById(db, id);

    if (!existing) {
      throw new AppError(404, 'not_found', 'Plant not found.');
    }

    assertOwnership(existing.userId, user);

    await deletePlant(db, id, user.id);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
