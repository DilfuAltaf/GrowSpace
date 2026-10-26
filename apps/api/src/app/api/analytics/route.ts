import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { AnalyticsTimeRange, MeasurementType, ReadingSource } from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import { verifyGardenOwnership } from '@/lib/plants/plant-repository';
import { verifyPlantOwnership } from '@/lib/plant-logs/plant-log-repository';
import { fetchAnalyticsSummary } from '@/lib/analytics/analytics-repository';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  timeRange: z.enum(['24h', '7d', '30d']).default('7d'),
  gardenId: z.string().trim().optional(),
  plantId: z.string().trim().optional(),
  source: z.enum(['all', 'manual', 'simulated', 'sensor']).default('all'),
  measurementType: z
    .enum(['all', 'air_temperature', 'air_humidity', 'medium_moisture'])
    .default('all'),
});

/**
 * GET /api/analytics
 * Retrieves historical environmental analytics, period min/max/avg/delta statistics,
 * chronological trend readings, plant condition insights, and care task summaries.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const searchParams = request.nextUrl.searchParams;

    const rawParams = {
      timeRange: searchParams.get('timeRange') || undefined,
      gardenId: searchParams.get('gardenId')?.trim() || undefined,
      plantId: searchParams.get('plantId')?.trim() || undefined,
      source: searchParams.get('source')?.trim() || undefined,
      measurementType: searchParams.get('measurementType')?.trim() || undefined,
    };

    const parsed = querySchema.safeParse(rawParams);
    if (!parsed.success) {
      throw new AppError(400, 'invalid_parameter', 'Invalid analytics query parameters.');
    }

    const { timeRange, gardenId, plantId, source, measurementType } = parsed.data;
    const db = getAuthDb();

    if (gardenId) {
      if (!isValidUuid(gardenId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid garden ID format.');
      }
      const gardenCheck = await verifyGardenOwnership(db, gardenId, user.id);
      if (!gardenCheck.exists) {
        throw new AppError(404, 'not_found', 'Specified garden does not exist.');
      }
      if (!gardenCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to this garden.');
      }
    }

    if (plantId) {
      if (!isValidUuid(plantId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format.');
      }
      const plantCheck = await verifyPlantOwnership(db, plantId, user.id);
      if (!plantCheck.exists) {
        throw new AppError(404, 'not_found', 'Specified plant does not exist.');
      }
      if (!plantCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to this plant.');
      }
    }

    const summary = await fetchAnalyticsSummary(db, user.id, {
      timeRange: timeRange as AnalyticsTimeRange,
      gardenId,
      plantId,
      source: source as ReadingSource | 'all',
      measurementType: measurementType as MeasurementType | 'all',
    });

    return NextResponse.json({ data: summary });
  } catch (error) {
    return errorResponse(error);
  }
}
