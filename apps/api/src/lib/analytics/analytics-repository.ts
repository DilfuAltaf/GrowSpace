import {
  MEASUREMENTS,
  evaluatePlantConditionInsights,
  generateDeterministicAnalyticsSummary,
  getTaskDueClassification,
  type AnalyticsSummaryResponse,
  type AnalyticsTimeRange,
  type MeasurementStats,
  type MeasurementType,
  type PlantContextInput,
  type PlantLog,
  type ReadingSource,
  type SensorReadingWithDetails,
} from '@growspace/shared';
import { executeQuery, type Queryable } from '../auth/db-client';
import { toPlantLog, type PlantLogRecord } from '../plant-logs/plant-log-repository';
import { findPlantsByUserId } from '../plants/plant-repository';
import {
  findLatestReadings,
  toSensorReading,
  type SensorReadingRecord,
} from '../readings/reading-repository';
import { findTasksByUserId } from '../tasks/task-repository';

export interface AnalyticsOptions {
  timeRange: AnalyticsTimeRange;
  gardenId?: string;
  plantId?: string;
  source?: ReadingSource | 'all';
  measurementType?: MeasurementType | 'all';
  now?: Date;
}

const SUPPORTED_MEASUREMENTS: MeasurementType[] = [
  'air_temperature',
  'air_humidity',
  'medium_moisture',
];

function getTimeDurationMs(timeRange: AnalyticsTimeRange): number {
  switch (timeRange) {
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
  }
}

interface PeriodAggregateRow {
  measurement_type: string;
  count: number | string;
  min_val?: number | string | null;
  max_val?: number | string | null;
  avg_val?: number | string | null;
  manual_count?: number | string;
  simulated_count?: number | string;
  sensor_count?: number | string;
}

export async function fetchAnalyticsSummary(
  client: Queryable,
  userId: string,
  options: AnalyticsOptions,
): Promise<AnalyticsSummaryResponse> {
  const now = options.now ?? new Date();
  const duration = getTimeDurationMs(options.timeRange);

  const currentTo = now;
  const currentFrom = new Date(now.getTime() - duration);
  const priorTo = currentFrom;
  const priorFrom = new Date(currentFrom.getTime() - duration);

  const currentFromIso = currentFrom.toISOString();
  const currentToIso = currentTo.toISOString();
  const priorFromIso = priorFrom.toISOString();
  const priorToIso = priorTo.toISOString();

  // Build filter conditions
  const filterClauses: string[] = ['user_id = $1'];
  const filterParams: unknown[] = [userId];

  if (options.gardenId) {
    filterParams.push(options.gardenId);
    filterClauses.push(`garden_id = $${filterParams.length}`);
  }

  if (options.plantId) {
    filterParams.push(options.plantId);
    filterClauses.push(`plant_id = $${filterParams.length}`);
  }

  if (options.source && options.source !== 'all') {
    filterParams.push(options.source);
    filterClauses.push(`source = $${filterParams.length}`);
  }

  if (options.measurementType && options.measurementType !== 'all') {
    filterParams.push(options.measurementType);
    filterClauses.push(`measurement_type = $${filterParams.length}`);
  }

  // 1. Current Period Aggregates
  const currentWhere = [
    ...filterClauses,
    `recorded_at >= $${filterParams.length + 1}`,
    `recorded_at <= $${filterParams.length + 2}`,
  ].join(' AND ');

  const currentAggSql = `
    SELECT
      measurement_type,
      COUNT(*)::int AS count,
      MIN(value) AS min_val,
      MAX(value) AS max_val,
      AVG(value) AS avg_val,
      COUNT(CASE WHEN source = 'manual' THEN 1 END)::int AS manual_count,
      COUNT(CASE WHEN source = 'simulated' THEN 1 END)::int AS simulated_count,
      COUNT(CASE WHEN source = 'sensor' THEN 1 END)::int AS sensor_count
    FROM sensor_readings
    WHERE ${currentWhere}
    GROUP BY measurement_type;
  `;

  const currentAggRes = await executeQuery<PeriodAggregateRow>(client, currentAggSql, [
    ...filterParams,
    currentFromIso,
    currentToIso,
  ]);

  // 2. Prior Period Aggregates
  const priorWhere = [
    ...filterClauses,
    `recorded_at >= $${filterParams.length + 1}`,
    `recorded_at < $${filterParams.length + 2}`,
  ].join(' AND ');

  const priorAggSql = `
    SELECT
      measurement_type,
      COUNT(*)::int AS count,
      AVG(value) AS avg_val
    FROM sensor_readings
    WHERE ${priorWhere}
    GROUP BY measurement_type;
  `;

  const priorAggRes = await executeQuery<PeriodAggregateRow>(client, priorAggSql, [
    ...filterParams,
    priorFromIso,
    priorToIso,
  ]);

  const priorAggMap = new Map<string, { count: number; avg: number | null }>();
  let priorTotalCount = 0;
  for (const row of priorAggRes.rows) {
    const cnt = Number(row.count) || 0;
    priorTotalCount += cnt;
    priorAggMap.set(row.measurement_type, {
      count: cnt,
      avg: row.avg_val != null ? Number(Number(row.avg_val).toFixed(2)) : null,
    });
  }

  const hasComparableData = priorTotalCount > 0;

  // 3. Chronological bounded readings for charts
  const readingsTableWhere = [
    filterClauses
      .map((c) => (c.startsWith('user_id') ? `r.${c}` : c.startsWith('garden_id') ? `r.${c}` : c.startsWith('plant_id') ? `r.${c}` : c.startsWith('source') ? `r.${c}` : `r.${c}`))
      .join(' AND '),
    `r.recorded_at >= $${filterParams.length + 1}`,
    `r.recorded_at <= $${filterParams.length + 2}`,
  ].join(' AND ');

  const readingsSql = `
    SELECT
      r.id,
      r.user_id,
      r.garden_id,
      r.plant_id,
      r.measurement_type,
      r.value,
      r.unit,
      r.source,
      r.recorded_at,
      r.note,
      r.created_at,
      g.name AS garden_name,
      COALESCE(p.custom_name, p.catalog_id) AS plant_name
    FROM sensor_readings r
    LEFT JOIN gardens g ON g.id = r.garden_id
    LEFT JOIN plants p ON p.id = r.plant_id
    WHERE ${readingsTableWhere}
    ORDER BY r.recorded_at ASC
    LIMIT 500;
  `;

  const readingsRes = await executeQuery<SensorReadingRecord>(client, readingsSql, [
    ...filterParams,
    currentFromIso,
    currentToIso,
  ]);
  const readings: SensorReadingWithDetails[] = readingsRes.rows.map(toSensorReading);

  // 4. Latest readings per measurement type
  const latestReadings = await findLatestReadings(client, userId, {
    gardenId: options.gardenId,
    plantId: options.plantId,
  });

  // Map aggregates into stats
  const currentAggMap = new Map<string, PeriodAggregateRow>();
  for (const row of currentAggRes.rows) {
    currentAggMap.set(row.measurement_type, row);
  }

  const stats: Record<MeasurementType, MeasurementStats> = {} as Record<
    MeasurementType,
    MeasurementStats
  >;

  for (const type of SUPPORTED_MEASUREMENTS) {
    const meta = MEASUREMENTS[type];
    const cur = currentAggMap.get(type);
    const count = cur ? Number(cur.count) : 0;
    const min = cur && cur.min_val != null ? Number(Number(cur.min_val).toFixed(1)) : null;
    const max = cur && cur.max_val != null ? Number(Number(cur.max_val).toFixed(1)) : null;
    const avg = cur && cur.avg_val != null ? Number(Number(cur.avg_val).toFixed(1)) : null;
    const prior = priorAggMap.get(type);

    let previousAvg: number | null = null;
    let deltaAvg: number | null = null;

    if (hasComparableData && prior && prior.avg != null && avg != null) {
      previousAvg = prior.avg;
      deltaAvg = Number((avg - prior.avg).toFixed(1));
    }

    stats[type] = {
      measurementType: type,
      unit: meta.unit,
      count,
      min,
      max,
      avg,
      latest: latestReadings[type] ?? null,
      previousAvg,
      deltaAvg,
      sourceBreakdown: {
        manual: cur ? Number(cur.manual_count) || 0 : 0,
        simulated: cur ? Number(cur.simulated_count) || 0 : 0,
        sensor: cur ? Number(cur.sensor_count) || 0 : 0,
      },
    };
  }

  // 5. Tasks
  const tasks = await findTasksByUserId(client, userId, {
    gardenId: options.gardenId,
    plantId: options.plantId,
  });

  let overdueCount = 0;
  let dueTodayCount = 0;
  let upcomingCount = 0;
  let completedCount = 0;

  for (const t of tasks) {
    if (t.status === 'completed') {
      completedCount++;
    } else if (t.status === 'pending') {
      const cls = getTaskDueClassification(t.dueAt, now);
      if (cls === 'overdue') overdueCount++;
      else if (cls === 'today') dueTodayCount++;
      else upcomingCount++;
    }
  }

  const taskSummary = {
    overdueCount,
    dueTodayCount,
    upcomingCount,
    completedCount,
  };

  // 6. Plant Logs (recent bounded)
  const logParams: unknown[] = [userId];
  const logClauses: string[] = ['user_id = $1'];
  if (options.plantId) {
    logParams.push(options.plantId);
    logClauses.push(`plant_id = $${logParams.length}`);
  }

  const logsSql = `
    SELECT id, user_id, plant_id, log_type, title, content, logged_at, created_at
    FROM plant_logs
    WHERE ${logClauses.join(' AND ')}
    ORDER BY logged_at DESC
    LIMIT 20;
  `;

  const logsRes = await executeQuery<PlantLogRecord>(client, logsSql, logParams);
  const recentLogs: PlantLog[] = logsRes.rows.map(toPlantLog);

  // 7. Plants and Condition Insights
  let userPlants = await findPlantsByUserId(client, userId, options.gardenId);
  if (options.plantId) {
    userPlants = userPlants.filter((p) => p.id === options.plantId);
  }

  const plantContexts: PlantContextInput[] = userPlants.map((p) => {
    const plantReadings = readings.filter(
      (r) => r.plantId === p.id || (!r.plantId && r.gardenId === p.gardenId),
    );
    const plantTasks = tasks.filter((t) => t.plantId === p.id);
    const plantLogs = recentLogs.filter((l) => l.plantId === p.id);

    return {
      plant: p,
      catalog: p.catalog ?? null,
      readings: plantReadings,
      tasks: plantTasks,
      logs: plantLogs,
    };
  });

  const plantInsights = evaluatePlantConditionInsights({
    plants: plantContexts,
    now,
  });

  // 8. Deterministic Summary
  const deterministicSummary = generateDeterministicAnalyticsSummary({
    timeRange: options.timeRange,
    stats,
    insights: plantInsights,
    taskSummary,
    recentLogsCount: recentLogs.length,
    previousPeriodHasComparableData: hasComparableData,
  });

  return {
    period: {
      timeRange: options.timeRange,
      from: currentFromIso,
      to: currentToIso,
    },
    previousPeriod: {
      from: priorFromIso,
      to: priorToIso,
      hasComparableData,
    },
    filters: {
      gardenId: options.gardenId ?? null,
      plantId: options.plantId ?? null,
      source: options.source ?? 'all',
      measurementType: options.measurementType ?? 'all',
    },
    stats,
    readings,
    totalReadings: readings.length,
    plantInsights,
    taskSummary,
    recentLogs,
    deterministicSummary,
  };
}
