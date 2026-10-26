import { MEASUREMENTS, READING_SOURCES } from './constants';
import type {
  AnalyticsTimeRange,
  CareTask,
  MeasurementStats,
  MeasurementType,
  Plant,
  PlantCatalogEntry,
  PlantConditionInsight,
  PlantLog,
  ReadingSource,
  Recommendation,
  RecommendationCategory,
  SensorReading,
} from './types';
import { formatDate, getTaskDueClassification, isStale } from './formatters';

export interface PlantContextInput {
  plant: Plant;
  catalog?: PlantCatalogEntry | null;
  readings?: SensorReading[];
  tasks?: CareTask[];
  logs?: PlantLog[];
}

export interface RecommendationInput {
  readings?: SensorReading[];
  catalog?: PlantCatalogEntry | null;
  plant?: Plant | null;
  tasks?: CareTask[];
  logs?: PlantLog[];
  plants?: PlantContextInput[];
  now?: Date;
}

const SOURCE_DISCLAIMERS: Record<ReadingSource, string> = {
  simulated:
    'This guidance uses simulated demonstration data, not a live sensor reading. Use it as an example and verify conditions directly.',
  manual:
    'This guidance is based on a manual entry. Check the plant and medium directly before changing your care routine.',
  sensor:
    'This guidance is based on a verified sensor reading. Still check the plant and local conditions before acting.',
};

function latestByMeasurement(readings: SensorReading[]): Map<MeasurementType, SensorReading> {
  const latest = new Map<MeasurementType, SensorReading>();
  for (const reading of readings) {
    const existing = latest.get(reading.measurementType);
    if (!existing || new Date(reading.recordedAt) > new Date(existing.recordedAt)) {
      latest.set(reading.measurementType, reading);
    }
  }
  return latest;
}

const SEVERITY_WEIGHT = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * Evaluates plant care intelligence rules across environmental readings,
 * care tasks, plant lifecycle status, and growth observations.
 *
 * Guarantees:
 * - Deterministic, rule-based, and explainable output.
 * - Always distinguishes simulated demonstration data from real manual entries.
 * - Conservative advice: never invents data, diagnoses pests/diseases, or recommends harmful changes.
 * - Explains trigger conditions and suggests safe, actionable next steps.
 */
export function evaluateRecommendations(input: RecommendationInput): Recommendation[] {
  const now = input.now ?? new Date();
  const recommendations: Recommendation[] = [];

  // Multi-plant aggregation mode
  if (input.plants && input.plants.length > 0) {
    for (const p of input.plants) {
      const plantRecs = evaluateSinglePlantCare({
        plant: p.plant,
        catalog: p.catalog ?? null,
        readings: p.readings ?? [],
        tasks: p.tasks ?? [],
        logs: p.logs ?? [],
        now,
      });
      recommendations.push(...plantRecs);
    }
  } else {
    // Single plant or standalone readings mode
    const standaloneRecs = evaluateSinglePlantCare({
      plant: input.plant ?? null,
      catalog: input.catalog ?? null,
      readings: input.readings ?? [],
      tasks: input.tasks ?? [],
      logs: input.logs ?? [],
      now,
    });
    recommendations.push(...standaloneRecs);
  }

  // Deterministic sorting: critical first, then warning, then info, then title
  return recommendations.sort((a, b) => {
    const sDiff = SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
    if (sDiff !== 0) return sDiff;
    return a.title.localeCompare(b.title);
  });
}

interface SinglePlantEvaluationProps {
  plant: Plant | null;
  catalog: PlantCatalogEntry | null;
  readings: SensorReading[];
  tasks: CareTask[];
  logs: PlantLog[];
  now: Date;
}

function evaluateSinglePlantCare({
  plant,
  catalog,
  readings,
  tasks,
  logs,
  now,
}: SinglePlantEvaluationProps): Recommendation[] {
  const recs: Recommendation[] = [];
  const plantName = plant?.customName || catalog?.commonName || 'Plant';
  const plantId = plant?.id ?? null;
  const gardenId = plant?.gardenId ?? null;

  // -------------------------------------------------------------------------
  // 1. Environmental Telemetry Rules (Readings vs Reference Ranges)
  // -------------------------------------------------------------------------
  const latestReadings = latestByMeasurement(readings);

  for (const [measurementType, reading] of latestReadings) {
    const meta = MEASUREMENTS[measurementType];
    let range = catalog?.referenceRanges[measurementType];
    let isAiResearchRange = false;

    if (!range && plant?.researchProfile) {
      const p = plant.researchProfile;
      if (measurementType === 'air_temperature' && p.temperatureMin != null && p.temperatureMax != null) {
        range = { min: p.temperatureMin, max: p.temperatureMax };
        isAiResearchRange = true;
      } else if (measurementType === 'air_humidity' && p.humidityMin != null && p.humidityMax != null) {
        range = { min: p.humidityMin, max: p.humidityMax };
        isAiResearchRange = true;
      } else if (measurementType === 'medium_moisture' && p.moistureMin != null && p.moistureMax != null) {
        range = { min: p.moistureMin, max: p.moistureMax };
        isAiResearchRange = true;
      }
    }

    const sourceLabel = READING_SOURCES[reading.source].label.toLowerCase();
    const displayValue = `${reading.value}${reading.unit}`;
    const stale = isStale(reading.recordedAt, meta.staleAfterHours, now);

    if (stale) {
      recs.push({
        id: `${plantId ? `${plantId}-` : ''}${measurementType}-stale`,
        category: 'environmental' as RecommendationCategory,
        severity: 'info',
        measurementType,
        plantId,
        plantName: plant ? plantName : undefined,
        gardenId,
        actionLink: plantId ? `/dashboard/monitoring?plantId=${plantId}` : '/dashboard/monitoring',
        actionLabel: 'Record new reading',
        title: `Refresh the ${meta.shortLabel.toLowerCase()} reading`,
        condition: `The latest reading was recorded at ${reading.recordedAt}.`,
        reason: `Readings older than ${meta.staleAfterHours} hours may not reflect current conditions.`,
        suggestedAction: `Check the garden and add a new manual ${meta.label.toLowerCase()} reading if needed.`,
        context: catalog
          ? `${catalog.commonName}${catalog.referenceNotes ? ` — ${catalog.referenceNotes}` : ''}`
          : isAiResearchRange
            ? `AI-researched cultivation profile for ${plantName}.`
            : 'No plant-specific reference is available for this garden.',
        disclaimer: SOURCE_DISCLAIMERS[reading.source],
        source: reading.source,
        recordedAt: reading.recordedAt,
      });
      continue;
    }

    if (!range) {
      recs.push({
        id: `${plantId ? `${plantId}-` : ''}${measurementType}-check`,
        category: 'environmental' as RecommendationCategory,
        severity: 'info',
        measurementType,
        plantId,
        plantName: plant ? plantName : undefined,
        gardenId,
        actionLink: plantId ? `/dashboard/monitoring?plantId=${plantId}` : '/dashboard/monitoring',
        actionLabel: 'View monitoring',
        title: `Check conditions for ${meta.shortLabel.toLowerCase()}`,
        condition: `Latest ${sourceLabel} reading: ${displayValue}.`,
        reason:
          'There is no plant-specific reference range available for this measurement, so a definitive interpretation is not possible.',
        suggestedAction: `Inspect the plant and growing medium directly, and compare with the guidance on the plant reference page.`,
        context: catalog
          ? `${catalog.commonName} — reference ranges are not configured for this measurement.`
          : isAiResearchRange
            ? `AI-researched profile for ${plantName} — reference range not configured for this metric.`
            : 'No plant-specific reference range is configured.',
        disclaimer: SOURCE_DISCLAIMERS[reading.source],
        source: reading.source,
        recordedAt: reading.recordedAt,
      });
      continue;
    }

    if (reading.value < range.min || reading.value > range.max) {
      const direction = reading.value < range.min ? 'below' : 'above';
      const referenceText = `${range.min}–${range.max}${meta.unit}`;
      const severity =
        (measurementType === 'medium_moisture' && reading.value <= 5) ||
        (measurementType === 'air_temperature' && (reading.value <= 2 || reading.value >= 40))
          ? 'critical'
          : 'warning';

      // Correlate with pending watering task if moisture is low
      const pendingWatering =
        measurementType === 'medium_moisture' && direction === 'below'
          ? tasks.find((t) => t.status === 'pending' && t.taskType === 'watering')
          : undefined;

      const suggestedAction = pendingWatering
        ? `Moisture is below target and a watering task (${pendingWatering.title}) is already scheduled. Check the medium at root depth and complete your scheduled watering.`
        : measurementType === 'medium_moisture'
          ? 'Check the medium at root depth, confirm drainage, and adjust watering gradually. Do not flood the medium based on one reading.'
          : measurementType === 'air_temperature'
            ? 'Check shade, ventilation, and proximity to heat sources. Move the plant only if conditions are clearly unsuitable.'
            : 'Check ventilation and local weather. Avoid large humidity changes based on a single reading.';

      recs.push({
        id: `${plantId ? `${plantId}-` : ''}${measurementType}-${direction}`,
        category: 'environmental' as RecommendationCategory,
        severity,
        measurementType,
        plantId,
        plantName: plant ? plantName : undefined,
        gardenId,
        taskId: pendingWatering?.id,
        actionLink: pendingWatering
          ? `/dashboard/tasks/${pendingWatering.id}`
          : plantId
            ? `/dashboard/monitoring?plantId=${plantId}`
            : '/dashboard/monitoring',
        actionLabel: pendingWatering ? 'View Scheduled Task' : 'View Telemetry',
        title: `${meta.shortLabel} is ${direction} the reference range`,
        condition: `Latest ${sourceLabel} reading: ${displayValue}. Reference range: ${referenceText}.`,
        reason:
          direction === 'below'
            ? `${catalog?.commonName ?? plantName} may be experiencing conditions below its usual reference range.`
            : `${catalog?.commonName ?? plantName} may be experiencing conditions above its usual reference range.`,
        suggestedAction,
        context: catalog
          ? `${catalog.commonName} — ${catalog.referenceNotes ?? 'General reference range.'} Growing method: ${catalog.growingMethodNotes ?? 'Not specified.'}`
          : isAiResearchRange
            ? `AI-researched cultivation profile (${plant?.researchProfile?.confidence ?? 'moderate'} confidence) for ${plantName}. Growing medium: ${plant?.researchProfile?.growingMedium ?? 'Standard'}.`
            : 'General reference range. No plant-specific context is available.',
        disclaimer: isAiResearchRange
          ? `${SOURCE_DISCLAIMERS[reading.source]} Reference range is synthesized by AI research from agricultural and botanical sources. Verify local growing conditions before acting.`
          : SOURCE_DISCLAIMERS[reading.source],
        source: reading.source,
        recordedAt: reading.recordedAt,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. Care Task Prioritization Rules (Overdue & Due Today)
  // -------------------------------------------------------------------------
  for (const task of tasks) {
    if (task.status !== 'pending') continue;

    const dueClassification = getTaskDueClassification(task.dueAt, now);

    if (dueClassification === 'overdue') {
      const isCritical = task.priority === 'high';
      recs.push({
        id: `task-overdue-${task.id}`,
        category: 'care_task' as RecommendationCategory,
        severity: isCritical ? 'critical' : 'warning',
        plantId: task.plantId ?? plantId,
        plantName: plant ? plantName : undefined,
        gardenId: task.gardenId,
        taskId: task.id,
        actionLink: `/dashboard/tasks/${task.id}`,
        actionLabel: 'Complete Task',
        title: `Overdue ${task.taskType}: ${task.title}`,
        condition: `Task was due on ${formatDate(task.dueAt)} and remains pending.`,
        reason: `Timely ${task.taskType.toLowerCase()} is essential to prevent plant stress and maintain vigorous growth.`,
        suggestedAction: `Inspect the plant, perform the necessary ${task.taskType.toLowerCase()} care, and mark the task completed.`,
        context: `Task priority: ${task.priority}. Garden: ${task.gardenId}.`,
      });
    } else if (dueClassification === 'today') {
      recs.push({
        id: `task-today-${task.id}`,
        category: 'care_task' as RecommendationCategory,
        severity: task.priority === 'high' ? 'warning' : 'info',
        plantId: task.plantId ?? plantId,
        plantName: plant ? plantName : undefined,
        gardenId: task.gardenId,
        taskId: task.id,
        actionLink: `/dashboard/tasks/${task.id}`,
        actionLabel: 'View Task',
        title: `Due today: ${task.title}`,
        condition: `Task is scheduled for today (${formatDate(task.dueAt)}).`,
        reason: `Executing planned tasks on schedule keeps crop care consistent.`,
        suggestedAction: `Complete ${task.taskType.toLowerCase()} during today's garden routine.`,
        context: `Task priority: ${task.priority}.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 3. Plant Lifecycle & Harvest Window Rules
  // -------------------------------------------------------------------------
  if (plant && plant.status === 'active') {
    // Expected harvest date reached
    if (plant.expectedHarvestDate) {
      const expDate = new Date(plant.expectedHarvestDate);
      if (!Number.isNaN(expDate.getTime()) && expDate <= now) {
        recs.push({
          id: `lifecycle-harvest-due-${plant.id}`,
          category: 'lifecycle' as RecommendationCategory,
          severity: 'warning',
          plantId: plant.id,
          plantName,
          gardenId: plant.gardenId,
          actionLink: `/dashboard/plants/${plant.id}`,
          actionLabel: 'Inspect Plant',
          title: `Harvest window open for ${plantName}`,
          condition: `Expected harvest date (${plant.expectedHarvestDate}) has been reached.`,
          reason: `Mature produce left on the plant can lose tenderness, develop bitterness, or attract pests.`,
          suggestedAction: `Check fruit or foliage maturity, harvest ripe produce, and record your harvest in the plant journal.`,
          context: catalog ? `${catalog.commonName} (${catalog.category})` : 'Active crop.',
        });
      }
    } else if (plant.plantingDate && catalog?.harvestDaysMin) {
      // Days since planting vs catalog expected days
      const plantedDate = new Date(plant.plantingDate);
      if (!Number.isNaN(plantedDate.getTime())) {
        const daysGrowing = Math.floor(
          (now.getTime() - plantedDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysGrowing >= catalog.harvestDaysMin) {
          recs.push({
            id: `lifecycle-harvest-window-${plant.id}`,
            category: 'lifecycle' as RecommendationCategory,
            severity: 'info',
            plantId: plant.id,
            plantName,
            gardenId: plant.gardenId,
            actionLink: `/dashboard/plants/${plant.id}`,
            actionLabel: 'View Plant Details',
            title: `Harvest window approaching for ${plantName}`,
            condition: `Planted ${daysGrowing} days ago (catalog harvest window: ${catalog.harvestDaysMin}–${catalog.harvestDaysMax ?? catalog.harvestDaysMin} days).`,
            reason: `${catalog.commonName} typically enters its productive harvest stage around this time.`,
            suggestedAction: `Inspect pods, fruits, or leaves for signs of harvest maturity.`,
            context: `Cultivar guidance: ${catalog.referenceNotes ?? 'General guidelines'}.`,
          });
        }
      }
    }

    // -------------------------------------------------------------------------
    // 4. Stale Observation Warning for Active Plants
    // -------------------------------------------------------------------------
    const hasRecentReading = readings.some((r) => !isStale(r.recordedAt, 14 * 24, now));
    const hasRecentLog = logs.some((l) => {
      const logDate = new Date(l.loggedAt || l.createdAt);
      return !Number.isNaN(logDate.getTime()) && now.getTime() - logDate.getTime() < 14 * 24 * 60 * 60 * 1000;
    });

    if (!hasRecentReading && !hasRecentLog && readings.length === 0 && logs.length === 0) {
      // Active plant with zero telemetry or journal notes
      recs.push({
        id: `observation-check-${plant.id}`,
        category: 'observation' as RecommendationCategory,
        severity: 'info',
        plantId: plant.id,
        plantName,
        gardenId: plant.gardenId,
        actionLink: `/dashboard/plants/${plant.id}`,
        actionLabel: 'Add Observation',
        title: `Check progress for ${plantName}`,
        condition: `No observations, journal notes, or environmental readings have been recorded yet for this active plant.`,
        reason: `Periodic monitoring helps identify hydration and nutrient needs before visual stress symptoms appear.`,
        suggestedAction: `Take a quick look at the foliage and soil medium, and record an observation or measurement.`,
        context: `Current lifecycle stage: ${plant.growthStage}.`,
      });
    }
  }

  return recs;
}

const SUPPORTED_MEASUREMENTS: MeasurementType[] = [
  'air_temperature',
  'air_humidity',
  'medium_moisture',
];

export interface EvaluatePlantConditionInsightsInput {
  plants: PlantContextInput[];
  now?: Date;
}

export function evaluatePlantConditionInsights(
  input: EvaluatePlantConditionInsightsInput,
): PlantConditionInsight[] {
  const now = input.now ?? new Date();
  const insights: PlantConditionInsight[] = [];

  for (const plantCtx of input.plants) {
    const { plant, catalog } = plantCtx;
    const plantName = plant.customName || catalog?.commonName || 'Plant';
    const gardenId = plant.gardenId;

    // Filter readings relevant to this plant (either assigned to this plant or general to its garden)
    const plantReadings = (plantCtx.readings ?? []).filter(
      (r) => r.plantId === plant.id || (!r.plantId && r.gardenId === plant.gardenId),
    );
    const latestMap = latestByMeasurement(plantReadings);

    for (const measurementType of SUPPORTED_MEASUREMENTS) {
      const meta = MEASUREMENTS[measurementType];

      // Determine plant-specific reference range
      let range = catalog?.referenceRanges[measurementType] ?? null;
      let isCustomResearched = false;

      if (!range && plant.researchProfile) {
        const p = plant.researchProfile;
        if (
          measurementType === 'air_temperature' &&
          p.temperatureMin != null &&
          p.temperatureMax != null
        ) {
          range = { min: p.temperatureMin, max: p.temperatureMax };
          isCustomResearched = true;
        } else if (
          measurementType === 'air_humidity' &&
          p.humidityMin != null &&
          p.humidityMax != null
        ) {
          range = { min: p.humidityMin, max: p.humidityMax };
          isCustomResearched = true;
        } else if (
          measurementType === 'medium_moisture' &&
          p.moistureMin != null &&
          p.moistureMax != null
        ) {
          range = { min: p.moistureMin, max: p.moistureMax };
          isCustomResearched = true;
        }
      }

      const reading = latestMap.get(measurementType);

      // State 1: Insufficient Data (no readings at all)
      if (!reading) {
        insights.push({
          id: `${plant.id}-${measurementType}`,
          plantId: plant.id,
          plantName,
          gardenId,
          measurementType,
          state: 'insufficient_data',
          observedValue: null,
          unit: meta.unit,
          referenceRange: range,
          isCustomResearched,
          confidence: plant.researchProfile?.confidence ?? null,
          recordedAt: null,
          source: null,
          reason: `No ${meta.shortLabel.toLowerCase()} readings have been recorded yet for ${plantName}.`,
          actionLink: `/dashboard/monitoring?plantId=${plant.id}`,
          actionLabel: 'Record Reading',
          severity: 'info',
        });
        continue;
      }

      const stale = isStale(reading.recordedAt, meta.staleAfterHours, now);

      // State 2: Stale Data
      if (stale) {
        insights.push({
          id: `${plant.id}-${measurementType}`,
          plantId: plant.id,
          plantName,
          gardenId,
          measurementType,
          state: 'stale_data',
          observedValue: reading.value,
          unit: reading.unit,
          referenceRange: range,
          isCustomResearched,
          confidence: plant.researchProfile?.confidence ?? null,
          recordedAt: reading.recordedAt,
          source: reading.source,
          reason: `Latest ${meta.shortLabel.toLowerCase()} observation (${reading.value}${reading.unit}) was recorded at ${reading.recordedAt} and exceeds the ${meta.staleAfterHours}h freshness threshold.`,
          actionLink: `/dashboard/monitoring?plantId=${plant.id}`,
          actionLabel: 'Record Fresh Reading',
          severity: 'info',
        });
        continue;
      }

      // State 3: Unconfigured Range
      if (!range) {
        insights.push({
          id: `${plant.id}-${measurementType}`,
          plantId: plant.id,
          plantName,
          gardenId,
          measurementType,
          state: 'unconfigured_range',
          observedValue: reading.value,
          unit: reading.unit,
          referenceRange: null,
          isCustomResearched,
          confidence: plant.researchProfile?.confidence ?? null,
          recordedAt: reading.recordedAt,
          source: reading.source,
          reason: `Latest reading is ${reading.value}${reading.unit}, but no target reference range is configured for ${plantName}.`,
          actionLink: `/dashboard/plants/${plant.id}`,
          actionLabel: 'Review Plant Profile',
          severity: 'info',
        });
        continue;
      }

      // State 4: Low
      if (reading.value < range.min) {
        const isCritical =
          (measurementType === 'medium_moisture' && reading.value <= 5) ||
          (measurementType === 'air_temperature' && reading.value <= 2);
        insights.push({
          id: `${plant.id}-${measurementType}`,
          plantId: plant.id,
          plantName,
          gardenId,
          measurementType,
          state: 'low',
          observedValue: reading.value,
          unit: reading.unit,
          referenceRange: range,
          isCustomResearched,
          confidence: plant.researchProfile?.confidence ?? null,
          recordedAt: reading.recordedAt,
          source: reading.source,
          reason: `${meta.shortLabel} (${reading.value}${reading.unit}) is below the supported reference range of ${range.min}–${range.max}${reading.unit}.`,
          actionLink: `/dashboard/monitoring?plantId=${plant.id}`,
          actionLabel: 'View Telemetry',
          severity: isCritical ? 'critical' : 'warning',
        });
        continue;
      }

      // State 5: High
      if (reading.value > range.max) {
        const isCritical =
          measurementType === 'air_temperature' && reading.value >= 40;
        insights.push({
          id: `${plant.id}-${measurementType}`,
          plantId: plant.id,
          plantName,
          gardenId,
          measurementType,
          state: 'high',
          observedValue: reading.value,
          unit: reading.unit,
          referenceRange: range,
          isCustomResearched,
          confidence: plant.researchProfile?.confidence ?? null,
          recordedAt: reading.recordedAt,
          source: reading.source,
          reason: `${meta.shortLabel} (${reading.value}${reading.unit}) is above the supported reference range of ${range.min}–${range.max}${reading.unit}.`,
          actionLink: `/dashboard/monitoring?plantId=${plant.id}`,
          actionLabel: 'View Telemetry',
          severity: isCritical ? 'critical' : 'warning',
        });
        continue;
      }

      // State 6: Optimal
      insights.push({
        id: `${plant.id}-${measurementType}`,
        plantId: plant.id,
        plantName,
        gardenId,
        measurementType,
        state: 'optimal',
        observedValue: reading.value,
        unit: reading.unit,
        referenceRange: range,
        isCustomResearched,
        confidence: plant.researchProfile?.confidence ?? null,
        recordedAt: reading.recordedAt,
        source: reading.source,
        reason: `${meta.shortLabel} (${reading.value}${reading.unit}) is within optimal reference range of ${range.min}–${range.max}${reading.unit}.`,
        actionLink: `/dashboard/monitoring?plantId=${plant.id}`,
        actionLabel: 'View Telemetry',
        severity: 'info',
      });
    }
  }

  // Deterministic order: critical -> warning -> info, then plant name, then measurement
  const insightOrder: Record<PlantConditionInsight['severity'], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return insights.sort((a, b) => {
    const sDiff = insightOrder[a.severity] - insightOrder[b.severity];
    if (sDiff !== 0) return sDiff;
    const pDiff = a.plantName.localeCompare(b.plantName);
    if (pDiff !== 0) return pDiff;
    return a.measurementType.localeCompare(b.measurementType);
  });
}

export interface DeterministicSummaryInput {
  timeRange: AnalyticsTimeRange;
  stats: Record<MeasurementType, MeasurementStats>;
  insights: PlantConditionInsight[];
  taskSummary: {
    overdueCount: number;
    dueTodayCount: number;
    upcomingCount: number;
    completedCount: number;
  };
  recentLogsCount?: number;
  previousPeriodHasComparableData: boolean;
}

export function generateDeterministicAnalyticsSummary(
  input: DeterministicSummaryInput,
): string {
  const parts: string[] = [];
  const { timeRange, stats, insights, taskSummary, recentLogsCount, previousPeriodHasComparableData } = input;

  // 1. Environmental section
  const totalReadings =
    (stats.air_temperature?.count ?? 0) +
    (stats.air_humidity?.count ?? 0) +
    (stats.medium_moisture?.count ?? 0);

  if (totalReadings === 0) {
    parts.push(`No environmental readings were recorded during the selected ${timeRange} period.`);
  } else {
    const envSummaries: string[] = [];
    for (const type of SUPPORTED_MEASUREMENTS) {
      const s = stats[type];
      if (s && s.count > 0 && s.avg != null && s.min != null && s.max != null) {
        let deltaText = '';
        if (previousPeriodHasComparableData && s.deltaAvg != null) {
          const sign = s.deltaAvg >= 0 ? '+' : '';
          deltaText = ` (${sign}${s.deltaAvg.toFixed(1)}${s.unit} vs prior period)`;
        } else if (!previousPeriodHasComparableData) {
          deltaText = ' (prior period comparison unavailable)';
        }
        envSummaries.push(
          `${MEASUREMENTS[type].shortLabel}: avg ${s.avg.toFixed(1)}${s.unit} (range ${s.min}–${s.max}${s.unit}, ${s.count} readings)${deltaText}`,
        );
      }
    }
    if (envSummaries.length > 0) {
      parts.push(`Environmental trends (${timeRange}): ${envSummaries.join('; ')}.`);
    }
  }

  // 2. Condition Insights
  const alertInsights = insights.filter((i) => i.state === 'low' || i.state === 'high');
  const staleInsights = insights.filter((i) => i.state === 'stale_data');

  if (alertInsights.length > 0) {
    const alertDescriptions = alertInsights
      .slice(0, 3)
      .map((i) => `${i.plantName} (${MEASUREMENTS[i.measurementType].shortLabel.toLowerCase()} is ${i.state})`)
      .join(', ');
    const extra = alertInsights.length > 3 ? ` and ${alertInsights.length - 3} more` : '';
    parts.push(`Condition alerts: ${alertInsights.length} reading(s) outside supported ranges: ${alertDescriptions}${extra}.`);
  } else if (insights.some((i) => i.state === 'optimal')) {
    parts.push('Plant conditions: All fresh observations with configured reference ranges are within optimal parameters.');
  }

  if (staleInsights.length > 0) {
    parts.push(`Observation freshness: ${staleInsights.length} plant metric(s) have stale telemetry exceeding standard observation thresholds.`);
  }

  // 3. Care tasks & journal activity
  const taskParts: string[] = [];
  if (taskSummary.overdueCount > 0) {
    taskParts.push(`${taskSummary.overdueCount} overdue`);
  }
  if (taskSummary.dueTodayCount > 0) {
    taskParts.push(`${taskSummary.dueTodayCount} due today`);
  }
  if (taskSummary.upcomingCount > 0) {
    taskParts.push(`${taskSummary.upcomingCount} upcoming`);
  }
  if (taskSummary.completedCount > 0) {
    taskParts.push(`${taskSummary.completedCount} completed`);
  }
  const taskText = taskParts.length > 0 ? `Care tasks: ${taskParts.join(', ')}.` : 'Care tasks: No active tasks.';
  const logText = (recentLogsCount ?? 0) > 0 ? ` ${recentLogsCount} growth log entry(ies) recorded.` : '';
  parts.push(`${taskText}${logText}`);

  // 4. Grounded operational note
  parts.push('Note: Environmental metrics and care task progress represent operational tracking data; observations do not demonstrate direct causation without controlled conditions.');

  return parts.join('\n\n');
}
