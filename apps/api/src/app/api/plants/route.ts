import { NextResponse, type NextRequest } from 'next/server';
import { findCatalogEntry, plantInputSchema } from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import {
  checkDuplicatePlant,
  createPlant,
  ensureCatalogEntryExists,
  findPlantsByUserId,
  verifyGardenOwnership,
} from '@/lib/plants/plant-repository';
import { linkResearchRecordToPlant } from '@/lib/research/research-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/plants
 * Lists all plants belonging to the authenticated user.
 * Supports optional ?gardenId= query parameter.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const searchParams = request.nextUrl.searchParams;
    const gardenId = searchParams.get('gardenId')?.trim() || undefined;

    if (gardenId && !isValidUuid(gardenId)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid garden ID format.');
    }

    const db = getAuthDb();

    // If gardenId is requested, verify user owns that garden
    if (gardenId) {
      const gardenCheck = await verifyGardenOwnership(db, gardenId, user.id);
      if (!gardenCheck.exists || !gardenCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to this garden.');
      }
    }

    const plants = await findPlantsByUserId(db, user.id, gardenId);

    return NextResponse.json(
      { plants },
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
 * POST /api/plants
 * Adds a new plant to an owned garden.
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

    // Normalize catalogId if supplied as slug
    if (rawBody && typeof rawBody === 'object' && 'catalogId' in rawBody) {
      const b = rawBody as { catalogId?: string };
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

    const input = plantInputSchema.parse(rawBody);

    if (!isValidUuid(input.gardenId)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid garden ID format.');
    }

    const db = getAuthDb();

    // Strict garden ownership check
    const gardenCheck = await verifyGardenOwnership(db, input.gardenId, user.id);
    if (!gardenCheck.exists || !gardenCheck.owned) {
      throw new AppError(403, 'forbidden', 'You do not have access to the destination garden.');
    }

    // If catalogId is provided, verify it exists in plant_catalog
    if (input.catalogId) {
      const exists = await ensureCatalogEntryExists(db, input.catalogId);
      if (!exists) {
        throw new AppError(422, 'validation_error', 'Selected plant reference does not exist.', {
          catalogId: ['Plant reference not found in catalog.'],
        });
      }
    }

    // Check for duplicate plant name in the destination garden
    if (input.customName) {
      const isDuplicate = await checkDuplicatePlant(
        db,
        input.gardenId,
        input.customName,
        input.catalogId ?? null,
      );
      if (isDuplicate) {
        throw new AppError(
          409,
          'duplicate_plant',
          `A plant named "${input.customName}" is already growing in this garden. Please choose a distinct variety label.`,
        );
      }
    }

    const plant = await createPlant(db, user.id, input);

    // If researchRecordId is provided, link the research record to the plant
    if (input.researchRecordId) {
      try {
        const linked = await linkResearchRecordToPlant(
          db,
          input.researchRecordId,
          plant.id,
          user.id,
          input.reviewedProfile,
        );
        if (linked) {
          plant.researchProfile = linked;
        }
      } catch (err) {
        console.error('Failed to link research record to plant:', err);
      }
    }

    return NextResponse.json({ plant }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
