import { NextResponse, type NextRequest } from 'next/server';
import {
  MEASUREMENTS,
  manualReadingInputSchema,
  readingSourceSchema,
  type MeasurementType,
  type ReadingSource,
} from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import { verifyGardenOwnership } from '@/lib/plants/plant-repository';
import { verifyPlantOwnership } from '@/lib/plant-logs/plant-log-repository';
import {
  createSensorReading,
  findLatestReadings,
  findReadings,
} from '@/lib/readings/reading-repository';

export const dynamic = 'force-dynamic';

const VALID_MEASUREMENT_TYPES = new Set<string>([
  'air_temperature',
  'air_humidity',
  'medium_moisture',
]);

/**
 * GET /api/readings
 * Lists sensor readings belonging to the authenticated user.
 * Supports filters: plantId, gardenId, measurementType, source, from, to, limit, offset, and latest.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const searchParams = request.nextUrl.searchParams;

    const plantId = searchParams.get('plantId')?.trim() || undefined;
    const gardenId = searchParams.get('gardenId')?.trim() || undefined;
    const measurementType = searchParams.get('measurementType')?.trim() || undefined;
    const source = searchParams.get('source')?.trim() || undefined;
    const from = searchParams.get('from')?.trim() || undefined;
    const to = searchParams.get('to')?.trim() || undefined;
    const limitParam = searchParams.get('limit')?.trim();
    const offsetParam = searchParams.get('offset')?.trim();
    const latestParam = searchParams.get('latest')?.trim();

    const db = getAuthDb();

    if (plantId) {
      if (!isValidUuid(plantId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format.');
      }
      const plantCheck = await verifyPlantOwnership(db, plantId, user.id);
      if (!plantCheck.exists) {
        throw new AppError(404, 'not_found', 'Plant not found.');
      }
      if (!plantCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to this plant.');
      }
    }

    if (gardenId) {
      if (!isValidUuid(gardenId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid garden ID format.');
      }
      const gardenCheck = await verifyGardenOwnership(db, gardenId, user.id);
      if (!gardenCheck.exists || !gardenCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to this garden.');
      }
    }

    if (measurementType) {
      if (!VALID_MEASUREMENT_TYPES.has(measurementType)) {
        throw new AppError(
          400,
          'invalid_parameter',
          `Unsupported measurement type '${measurementType}'. Supported types: air_temperature, air_humidity, medium_moisture.`,
        );
      }
    }

    if (source) {
      const sourceResult = readingSourceSchema.safeParse(source);
      if (!sourceResult.success) {
        throw new AppError(400, 'invalid_parameter', 'Invalid source filter.');
      }
    }

    if (from && Number.isNaN(new Date(from).getTime())) {
      throw new AppError(400, 'invalid_parameter', 'Invalid from date format.');
    }

    if (to && Number.isNaN(new Date(to).getTime())) {
      throw new AppError(400, 'invalid_parameter', 'Invalid to date format.');
    }

    // If latest=true requested, return latest readings by measurement type
    if (latestParam === 'true') {
      const latest = await findLatestReadings(db, user.id, { plantId, gardenId });
      return NextResponse.json(
        { latest },
        {
          headers: {
            'Cache-Control': 'no-store',
          },
        },
      );
    }

    const limit = limitParam ? Number.parseInt(limitParam, 10) : 100;
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;

    if (Number.isNaN(limit) || limit < 1) {
      throw new AppError(400, 'invalid_parameter', 'Limit must be a positive integer.');
    }
    if (Number.isNaN(offset) || offset < 0) {
      throw new AppError(400, 'invalid_parameter', 'Offset must be a non-negative integer.');
    }

    const { readings, total } = await findReadings(db, user.id, {
      plantId,
      gardenId,
      measurementType: measurementType as MeasurementType | undefined,
      source: source as ReadingSource | undefined,
      from,
      to,
      limit,
      offset,
    });

    return NextResponse.json(
      { readings, total, limit, offset },
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
 * POST /api/readings
 * Records a new manual or simulated sensor reading for an owned plant/garden.
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

    const parseResult = manualReadingInputSchema.safeParse(rawBody);
    if (!parseResult.success) {
      throw new AppError(
        400,
        'validation_error',
        'Invalid sensor reading parameters.',
        parseResult.error.flatten().fieldErrors,
      );
    }

    const input = parseResult.data;

    // Reject sensor source since no live hardware device integration exists
    if (input.source === 'sensor') {
      throw new AppError(
        400,
        'validation_error',
        'Direct hardware sensor provenance is reserved and unavailable in this release.',
        { source: ['Sensor hardware integration is not yet supported.'] },
      );
    }

    const db = getAuthDb();
    let resolvedGardenId = input.gardenId;

    if (input.plantId) {
      if (!isValidUuid(input.plantId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format.');
      }
      const plantCheck = await verifyPlantOwnership(db, input.plantId, user.id);
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
            'The specified plant does not belong to the selected garden.',
          );
        }
      } else {
        resolvedGardenId = plantCheck.gardenId;
      }
    }

    if (!resolvedGardenId) {
      throw new AppError(400, 'validation_error', 'Garden ID could not be determined.');
    }

    if (!isValidUuid(resolvedGardenId)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid garden ID format.');
    }

    // Check garden ownership
    const gardenCheck = await verifyGardenOwnership(db, resolvedGardenId, user.id);
    if (!gardenCheck.exists || !gardenCheck.owned) {
      throw new AppError(403, 'forbidden', 'You do not have access to the destination garden.');
    }

    const meta = MEASUREMENTS[input.measurementType];
    const unit = input.unit?.trim() || meta.unit;

    const reading = await createSensorReading(db, user.id, {
      gardenId: resolvedGardenId,
      plantId: input.plantId ?? null,
      measurementType: input.measurementType,
      value: input.value,
      unit,
      source: input.source,
      recordedAt: input.recordedAt ?? null,
      note: input.note ?? null,
    });

    return NextResponse.json({ reading }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
