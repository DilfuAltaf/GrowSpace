import { NextResponse, type NextRequest } from 'next/server';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import {
  deletePlantLog,
  verifyPlantOwnership,
} from '@/lib/plant-logs/plant-log-repository';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string; logId: string }>;
}

/**
 * DELETE /api/plants/:id/logs/:logId
 * Deletes a growth log entry belonging to the owned plant.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id, logId } = await params;
    if (!isValidUuid(id) || !isValidUuid(logId)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid identifier format.');
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

    const deleted = await deletePlantLog(db, user.id, logId, id);
    if (!deleted) {
      throw new AppError(404, 'not_found', 'Log entry not found.');
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
