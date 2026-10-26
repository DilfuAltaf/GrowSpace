import { NextResponse, type NextRequest } from 'next/server';
import {
  MEASUREMENTS,
  manualReadingInputSchema,
  type MeasurementType,
  type ReadingSource,
} from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import { verifyPlantOwnership } from '@/lib/plant-logs/plant-log-repository';
import {
  createSensorReading,
  findLatestReadings,
  findReadings,
} from '@/lib/readings/reading-repository';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/plants/:id/readings
 * Lists readings for an owned plant, along with the latest values for each metric.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: plantId } = await params;
    if (!isValidUuid(plantId)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format.');
    }

    const user = await requireUser(request);
    const db = getAuthDb();

    const plantCheck = await verifyPlantOwnership(db, plantId, user.id);
    if (!plantCheck.exists) {
      throw new AppError(404, 'not_found', 'Plant not found.');
    }
    if (!plantCheck.owned) {
      throw new AppError(403, 'forbidden', 'You do not have access to this plant.');
    }

    const searchParams = request.nextUrl.searchParams;
    const measurementType = searchParams.get('measurementType')?.trim() || undefined;
    const source = searchParams.get('source')?.trim() || undefined;
    const from = searchParams.get('from')?.trim() || undefined;
    const to = searchParams.get('to')?.trim() || undefined;
    const limitParam = searchParams.get('limit')?.trim();
    const offsetParam = searchParams.get('offset')?.trim();

    const limit = limitParam ? Number.parseInt(limitParam, 10) : 100;
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;

    const [readingsResult, latest] = await Promise.all([
      findReadings(db, user.id, {
        plantId,
        measurementType: measurementType as MeasurementType | undefined,
        source: source as ReadingSource | undefined,
        from,
        to,
        limit,
        offset,
      }),
      findLatestReadings(db, user.id, { plantId }),
    ]);

    return NextResponse.json(
      {
        readings: readingsResult.readings,
        latest,
        total: readingsResult.total,
        limit,
        offset,
      },
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
 * POST /api/plants/:id/readings
 * Creates a reading specifically attached to this plant.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: plantId } = await params;
    if (!isValidUuid(plantId)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format.');
    }

    const user = await requireUser(request);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new AppError(400, 'bad_request', 'Invalid JSON body in request.');
    }

    if (rawBody && typeof rawBody === 'object') {
      (rawBody as Record<string, unknown>).plantId = plantId;
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
    if (input.source === 'sensor') {
      throw new AppError(
        400,
        'validation_error',
        'Direct hardware sensor provenance is reserved and unavailable in this release.',
        { source: ['Sensor hardware integration is not yet supported.'] },
      );
    }

    const db = getAuthDb();
    const plantCheck = await verifyPlantOwnership(db, plantId, user.id);
    if (!plantCheck.exists) {
      throw new AppError(404, 'not_found', 'Specified plant does not exist.');
    }
    if (!plantCheck.owned) {
      throw new AppError(403, 'forbidden', 'You do not have access to the specified plant.');
    }

    const gardenId = plantCheck.gardenId;
    if (!gardenId) {
      throw new AppError(500, 'server_error', 'Plant has no associated garden.');
    }

    const meta = MEASUREMENTS[input.measurementType];
    const unit = input.unit?.trim() || meta.unit;

    const reading = await createSensorReading(db, user.id, {
      gardenId,
      plantId,
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
