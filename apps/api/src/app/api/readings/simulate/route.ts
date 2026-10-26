import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import { verifyGardenOwnership } from '@/lib/plants/plant-repository';
import { verifyPlantOwnership } from '@/lib/plant-logs/plant-log-repository';
import { generateSimulatedReadings } from '@/lib/readings/reading-repository';

export const dynamic = 'force-dynamic';

const simulateBodySchema = z.object({
  gardenId: z.string().trim().optional(),
  plantId: z.string().trim().optional(),
});

/**
 * POST /api/readings/simulate
 * Generates clearly labeled demo / simulated sensor readings for a user's plant or garden.
 * All readings are permanently marked with source = 'simulated'.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }

    const parseResult = simulateBodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      throw new AppError(400, 'validation_error', 'Invalid simulation request body.');
    }

    const { plantId, gardenId } = parseResult.data;
    const db = getAuthDb();

    let resolvedGardenId = gardenId;

    if (plantId) {
      if (!isValidUuid(plantId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format.');
      }
      const plantCheck = await verifyPlantOwnership(db, plantId, user.id);
      if (!plantCheck.exists) {
        throw new AppError(404, 'not_found', 'Specified plant does not exist.');
      }
      if (!plantCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to the specified plant.');
      }

      if (resolvedGardenId) {
        if (plantCheck.gardenId && plantCheck.gardenId !== resolvedGardenId) {
          throw new AppError(
            400,
            'invalid_relationship',
            'The plant does not belong to the specified garden.',
          );
        }
      } else {
        resolvedGardenId = plantCheck.gardenId;
      }
    }

    if (!resolvedGardenId) {
      throw new AppError(
        400,
        'validation_error',
        'Either gardenId or plantId must be specified to generate simulated readings.',
      );
    }

    if (!isValidUuid(resolvedGardenId)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid garden ID format.');
    }

    const gardenCheck = await verifyGardenOwnership(db, resolvedGardenId, user.id);
    if (!gardenCheck.exists || !gardenCheck.owned) {
      throw new AppError(403, 'forbidden', 'You do not have access to the destination garden.');
    }

    const readings = await generateSimulatedReadings(db, user.id, {
      gardenId: resolvedGardenId,
      plantId: plantId ?? null,
    });

    return NextResponse.json(
      {
        readings,
        count: readings.length,
        disclaimer: 'SIMULATED / DATA DEMO: All generated readings are simulated for demonstration purposes only.',
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
