import { NextResponse, type NextRequest } from 'next/server';
import {
  evaluateRecommendations,
  getTaskDueClassification,
  type PlantContextInput,
  type Recommendation,
} from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { executeQuery } from '@/lib/auth/db-client';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import {
  toPlantLog,
  verifyPlantOwnership,
  type PlantLogRecord,
} from '@/lib/plant-logs/plant-log-repository';
import { findPlantsByUserId, verifyGardenOwnership } from '@/lib/plants/plant-repository';
import { findReadings } from '@/lib/readings/reading-repository';
import { findTasksByUserId } from '@/lib/tasks/task-repository';

export const dynamic = 'force-dynamic';

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * GET /api/recommendations
 * Evaluates explainable care recommendations across user's plants,
 * sensor readings, care tasks, and growth logs.
 * Supports optional ?plantId= and ?gardenId= query parameters.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const searchParams = request.nextUrl.searchParams;

    const gardenId = searchParams.get('gardenId')?.trim() || undefined;
    const plantId = searchParams.get('plantId')?.trim() || undefined;

    const db = getAuthDb();

    if (gardenId) {
      if (!isValidUuid(gardenId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid garden ID format.');
      }
      const gardenCheck = await verifyGardenOwnership(db, gardenId, user.id);
      if (!gardenCheck.exists || !gardenCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to this garden.');
      }
    }

    if (plantId) {
      if (!isValidUuid(plantId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format.');
      }
      const plantCheck = await verifyPlantOwnership(db, plantId, user.id);
      if (!plantCheck.exists || !plantCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to this plant.');
      }
    }

    // 1. Fetch plants for this user
    let plants = await findPlantsByUserId(db, user.id, gardenId);
    if (plantId) {
      plants = plants.filter((p) => p.id === plantId);
    }

    // 2. Fetch care tasks
    const tasks = await findTasksByUserId(db, user.id, { gardenId, plantId });

    // 3. Fetch sensor readings (up to 300 recent readings)
    const readingsRes = await findReadings(db, user.id, {
      gardenId,
      plantId,
      limit: 300,
    });

    // 4. Fetch plant logs
    const logsRes = await executeQuery<PlantLogRecord>(
      db,
      `SELECT id, user_id, plant_id, log_type, title, content, logged_at, created_at
       FROM plant_logs
       WHERE user_id = $1
       ORDER BY logged_at DESC;`,
      [user.id],
    );
    const allLogs = logsRes.rows.map(toPlantLog);

    const now = new Date();
    const recommendations: Recommendation[] = [];

    if (plants.length > 0) {
      const plantContexts: PlantContextInput[] = plants.map((p) => {
        const plantReadings = readingsRes.readings.filter(
          (r) => r.plantId === p.id || (!r.plantId && r.gardenId === p.gardenId),
        );
        const plantTasks = tasks.filter((t) => t.plantId === p.id);
        const plantLogs = allLogs.filter((l) => l.plantId === p.id);

        return {
          plant: p,
          catalog: p.catalog ?? null,
          readings: plantReadings,
          tasks: plantTasks,
          logs: plantLogs,
        };
      });

      const plantRecs = evaluateRecommendations({
        plants: plantContexts,
        now,
      });
      recommendations.push(...plantRecs);

      // Also evaluate standalone tasks not tied to any plant
      const standaloneTasks = tasks.filter((t) => !t.plantId);
      if (standaloneTasks.length > 0) {
        const standaloneRecs = evaluateRecommendations({
          tasks: standaloneTasks,
          now,
        });
        recommendations.push(...standaloneRecs);
      }
    } else {
      // No plants tracked yet: evaluate standalone tasks and readings
      const standaloneRecs = evaluateRecommendations({
        tasks,
        readings: readingsRes.readings,
        now,
      });
      recommendations.push(...standaloneRecs);
    }

    // Sort deterministically: severity weight first, then title
    recommendations.sort((a, b) => {
      const diff = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
      if (diff !== 0) return diff;
      return a.title.localeCompare(b.title);
    });

    // Compute actionable summary counts
    const pendingTasks = tasks.filter((t) => t.status === 'pending');
    const overdueCount = pendingTasks.filter(
      (t) => getTaskDueClassification(t.dueAt, now) === 'overdue',
    ).length;
    const dueTodayCount = pendingTasks.filter(
      (t) => getTaskDueClassification(t.dueAt, now) === 'today',
    ).length;

    const summary = {
      total: recommendations.length,
      criticalCount: recommendations.filter((r) => r.severity === 'critical').length,
      warningCount: recommendations.filter((r) => r.severity === 'warning').length,
      infoCount: recommendations.filter((r) => r.severity === 'info').length,
      overdueTaskCount: overdueCount,
      dueTodayTaskCount: dueTodayCount,
      environmentalAlertCount: recommendations.filter((r) => r.category === 'environmental')
        .length,
      evaluatedAt: now.toISOString(),
    };

    return NextResponse.json(
      { recommendations, summary },
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
