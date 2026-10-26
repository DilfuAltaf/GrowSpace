import { NextResponse, type NextRequest } from 'next/server';
import { plantLogInputSchema } from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import {
  createPlantLog,
  findPlantLogsByPlantId,
  verifyPlantOwnership,
} from '@/lib/plant-logs/plant-log-repository';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/plants/:id/logs
 * Lists all growth logs for an owned plant, in reverse chronological order.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format.');
    }

    const user = await requireUser(request);
    const db = getAuthDb();

    const plantCheck = await verifyPlantOwnership(db, id, user.id);
    if (!plantCheck.exists) {
      throw new AppError(404, 'not_found', 'Plant not found.');
    }
    if (!plantCheck.owned) {
      throw new AppError(403, 'forbidden', 'You do not have access to this plant.');
    }

    const logs = await findPlantLogsByPlantId(db, user.id, id);

    return NextResponse.json(
      { logs },
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
 * POST /api/plants/:id/logs
 * Creates a new growth log / journal entry for an owned plant.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
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

    // Ensure plantId matches URL parameter
    if (rawBody && typeof rawBody === 'object') {
      (rawBody as Record<string, unknown>).plantId = id;
    }

    const input = plantLogInputSchema.parse(rawBody);
    const db = getAuthDb();

    const plantCheck = await verifyPlantOwnership(db, id, user.id);
    if (!plantCheck.exists) {
      throw new AppError(404, 'not_found', 'Plant not found.');
    }
    if (!plantCheck.owned) {
      throw new AppError(403, 'forbidden', 'You do not have access to this plant.');
    }

    const log = await createPlantLog(db, user.id, id, input);

    return NextResponse.json({ log }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
