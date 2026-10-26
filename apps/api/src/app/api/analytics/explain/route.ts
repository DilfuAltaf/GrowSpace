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
import { explainAnalytics } from '@/lib/analytics/analytics-groq';

export const dynamic = 'force-dynamic';

const explainBodySchema = z.object({
  timeRange: z.enum(['24h', '7d', '30d']).default('7d'),
  gardenId: z.string().trim().optional(),
  plantId: z.string().trim().optional(),
  source: z.enum(['all', 'manual', 'simulated', 'sensor']).default('all'),
  measurementType: z
    .enum(['all', 'air_temperature', 'air_humidity', 'medium_moisture'])
    .default('all'),
});

/**
 * POST /api/analytics/explain
 * Provides an explainable, LLM-synthesized narrative for the user's historical
 * telemetry and plant conditions, grounded strictly in computed facts.
 * Falls back gracefully to deterministic summary if Groq is unconfigured or unavailable.
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

    const parsed = explainBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new AppError(400, 'validation_error', 'Invalid explanation parameters.');
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

    // Server-side compute verified summary for the authenticated user
    const summary = await fetchAnalyticsSummary(db, user.id, {
      timeRange: timeRange as AnalyticsTimeRange,
      gardenId,
      plantId,
      source: source as ReadingSource | 'all',
      measurementType: measurementType as MeasurementType | 'all',
    });

    const explanation = await explainAnalytics(summary);

    return NextResponse.json({
      data: {
        explanation,
        summary,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
