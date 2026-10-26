import {
  evaluateRecommendations,
  formatDate,
  getTaskDueClassification,
  isStale,
  type PlantContextInput,
  type PlantLog,
  type Recommendation,
} from '@growspace/shared';
import { type Queryable } from '../auth/db-client';
import { findGardensByUserId, isValidUuid } from '../gardens/garden-repository';
import {
  findPlantById,
  findPlantsByUserId,
  verifyGardenOwnership,
  type PlantWithDetails,
} from '../plants/plant-repository';
import {
  findPlantLogsByPlantId,
  verifyPlantOwnership,
} from '../plant-logs/plant-log-repository';
import { findReadings } from '../readings/reading-repository';
import { findTasksByUserId } from '../tasks/task-repository';

export interface AssembledAssistantContext {
  userId: string;
  gardenFilter?: { id: string; name: string };
  plantFilter?: { id: string; name: string };
  gardensCount: number;
  plantsCount: number;
  readingsCount: number;
  tasksCount: number;
  formattedContextText: string;
  provenanceSummary: {
    hasSimulatedReadings: boolean;
    hasManualReadings: boolean;
    hasLiveSensors: boolean;
    staleReadingCount: number;
  };
}

/**
 * Assembles authenticated, strictly user-owned farm context for the AI assistant.
 * Applies record limits, time boundaries, and provenance labels.
 */
export async function assembleAssistantContext(
  client: Queryable,
  userId: string,
  options: {
    gardenId?: string;
    plantId?: string;
    userQuery?: string;
  } = {},
): Promise<AssembledAssistantContext> {
  const now = new Date();

  // 1. Ownership Validation
  let gardenFilter: { id: string; name: string } | undefined;
  if (options.gardenId) {
    if (!isValidUuid(options.gardenId)) {
      throw new Error('Invalid garden ID format');
    }
    const gCheck = await verifyGardenOwnership(client, options.gardenId, userId);
    if (!gCheck.exists || !gCheck.owned) {
      throw new Error('You do not have access to the specified garden');
    }
    gardenFilter = { id: options.gardenId, name: gCheck.gardenName ?? 'Selected Garden' };
  }

  let plantFilter: { id: string; name: string } | undefined;
  if (options.plantId) {
    if (!isValidUuid(options.plantId)) {
      throw new Error('Invalid plant ID format');
    }
    const pCheck = await verifyPlantOwnership(client, options.plantId, userId);
    if (!pCheck.exists || !pCheck.owned) {
      throw new Error('You do not have access to the specified plant');
    }
    plantFilter = { id: options.plantId, name: pCheck.plantName ?? 'Selected Plant' };
  }

  // 2. Fetch User Gardens (limit 10)
  const allGardens = await findGardensByUserId(client, userId);
  const relevantGardens = options.gardenId
    ? allGardens.filter((g) => g.id === options.gardenId)
    : allGardens.slice(0, 10);

  // 3. Fetch User Plants with profiles (limit 20)
  const allPlants = await findPlantsByUserId(client, userId, options.gardenId);
  let relevantPlants: PlantWithDetails[] = [];

  if (options.plantId) {
    const single = await findPlantById(client, options.plantId);
    if (single && single.userId === userId) {
      relevantPlants = [single];
    }
  } else {
    // Up to 15 plants
    const subset = allPlants.slice(0, 15);
    relevantPlants = await Promise.all(
      subset.map(async (p) => {
        const enriched = await findPlantById(client, p.id);
        return enriched ?? p;
      }),
    );
  }

  // 4. Fetch Recent Sensor Readings (limit 25)
  const readingsResult = await findReadings(client, userId, {
    gardenId: options.gardenId,
    plantId: options.plantId,
    limit: 25,
  });
  const readings = readingsResult.readings;

  // Track provenance
  let hasSimulatedReadings = false;
  let hasManualReadings = false;
  let hasLiveSensors = false;
  let staleReadingCount = 0;

  for (const r of readings) {
    if (r.source === 'simulated') hasSimulatedReadings = true;
    if (r.source === 'manual') hasManualReadings = true;
    if (r.source === 'sensor') hasLiveSensors = true;
    if (isStale(r.recordedAt, 24)) {
      staleReadingCount++;
    }
  }

  // 5. Fetch Care Tasks
  const tasks = await findTasksByUserId(client, userId, {
    gardenId: options.gardenId,
    plantId: options.plantId,
  });

  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const overdueTasks = pendingTasks.filter((t) => getTaskDueClassification(t.dueAt, now) === 'overdue');
  const todayTasks = pendingTasks.filter((t) => getTaskDueClassification(t.dueAt, now) === 'today');
  const upcomingTasks = pendingTasks.filter((t) => getTaskDueClassification(t.dueAt, now) === 'upcoming');
  const otherPendingTasks = pendingTasks.filter((t) => getTaskDueClassification(t.dueAt, now) === 'none');
  const recentCompletedTasks = tasks.filter((t) => t.status === 'completed').slice(0, 5);

  // 6. Fetch Growth Logs for relevant plants (limit 10)
  const recentLogs: PlantLog[] = [];
  if (relevantPlants.length > 0) {
    for (const p of relevantPlants.slice(0, 5)) {
      try {
        const plantLogs = await findPlantLogsByPlantId(client, userId, p.id);
        recentLogs.push(...plantLogs.slice(0, 3));
      } catch {
        // Continue if logs query fails
      }
    }
  }

  // 7. Evaluate Recommendations
  const plantContextInputs: PlantContextInput[] = relevantPlants.map((p) => ({
    plant: p,
    catalog: p.catalog ?? null,
    readings: readings.filter((r) => r.plantId === p.id),
    tasks: tasks.filter((t) => t.plantId === p.id),
    logs: recentLogs.filter((l) => l.plantId === p.id),
  }));

  const activeRecommendations: Recommendation[] = evaluateRecommendations({
    plants: plantContextInputs,
    readings,
    tasks,
    logs: recentLogs,
    now,
  });

  // 8. Format Structured XML Context Text
  const sections: string[] = [];

  // Section A: Gardens & Plants
  if (relevantGardens.length === 0) {
    sections.push('GARDENS & CROPS: No gardens or plants registered yet.');
  } else {
    const gardenDescriptions = relevantGardens.map((g) => {
      const gPlants = relevantPlants.filter((p) => p.gardenId === g.id);
      const plantList = gPlants.length > 0
        ? gPlants
            .map((p) => {
              const name = p.customName || p.catalog?.commonName || 'Unnamed Plant';
              const stage = p.growthStage ? `[Stage: ${p.growthStage}]` : '';
              const notes = p.notes ? ` (Notes: ${p.notes})` : '';
              let refGuide = '';
              if (p.catalog) {
                const tempRange = p.catalog.referenceRanges?.air_temperature;
                const humRange = p.catalog.referenceRanges?.air_humidity;
                const moistRange = p.catalog.referenceRanges?.medium_moisture;
                const parts: string[] = [];
                if (tempRange) parts.push(`Temp ${tempRange.min}-${tempRange.max}°C`);
                if (humRange) parts.push(`Humidity ${humRange.min}-${humRange.max}%`);
                if (moistRange) parts.push(`Moisture ${moistRange.min}-${moistRange.max}%`);
                if (parts.length > 0) refGuide = ` {Catalog targets: ${parts.join(', ')}}`;
              } else if (p.researchProfile) {
                refGuide = ` {Researched targets: Temp ${p.researchProfile.temperatureMin ?? '?'}-${p.researchProfile.temperatureMax ?? '?'}°C, Moisture ${p.researchProfile.moistureMin ?? '?'}-${p.researchProfile.moistureMax ?? '?'}% [Confidence: ${p.researchProfile.confidence}]}`;
              }
              return `  - ${name} (ID: ${p.id}) ${stage}${refGuide}${notes}`;
            })
            .join('\n')
        : '  - No plants in this garden.';
      return `Garden: "${g.name}" (ID: ${g.id}, Method: ${g.growingMethod}${g.locationLabel ? `, Location: ${g.locationLabel}` : ''})\n${plantList}`;
    });
    sections.push(`GARDENS & CROPS:\n${gardenDescriptions.join('\n\n')}`);
  }

  // Section B: Sensor Telemetry & Provenance
  if (readings.length === 0) {
    sections.push('ENVIRONMENTAL READINGS: No sensor readings recorded yet.');
  } else {
    const readingLines = readings.slice(0, 20).map((r) => {
      const plantPart = r.plantName ? ` on "${r.plantName}"` : '';
      const gardenPart = r.gardenName ? ` in "${r.gardenName}"` : '';
      const timeStr = formatDate(r.recordedAt);
      const staleTag = isStale(r.recordedAt, 24) ? ' [STALE >24h]' : '';
      const sourceTag = `[Source: ${r.source.toUpperCase()}${r.source === 'simulated' ? ' - DEMO DATA' : ''}]`;
      return `- ${r.measurementType}: ${r.value} ${r.unit}${plantPart}${gardenPart} at ${timeStr} ${sourceTag}${staleTag}`;
    });
    sections.push(`ENVIRONMENTAL TELEMETRY READINGS (Latest first):\n${readingLines.join('\n')}`);
  }

  // Section C: Care Tasks
  const taskParts: string[] = [];
  if (overdueTasks.length > 0) {
    taskParts.push(`Overdue Tasks:\n${overdueTasks.map((t) => `  * [OVERDUE] "${t.title}" (Type: ${t.taskType}, Priority: ${t.priority}, Due: ${formatDate(t.dueAt)})`).join('\n')}`);
  }
  if (todayTasks.length > 0) {
    taskParts.push(`Tasks Due Today:\n${todayTasks.map((t) => `  * [TODAY] "${t.title}" (Type: ${t.taskType}, Priority: ${t.priority})`).join('\n')}`);
  }
  if (upcomingTasks.length > 0) {
    taskParts.push(`Upcoming Tasks:\n${upcomingTasks.slice(0, 5).map((t) => `  * "${t.title}" (Type: ${t.taskType}, Due: ${formatDate(t.dueAt)})`).join('\n')}`);
  }
  if (otherPendingTasks.length > 0) {
    taskParts.push(`General Pending Tasks:\n${otherPendingTasks.slice(0, 5).map((t) => `  * "${t.title}" (Type: ${t.taskType}, Priority: ${t.priority})`).join('\n')}`);
  }
  if (recentCompletedTasks.length > 0) {
    taskParts.push(`Recently Completed:\n${recentCompletedTasks.map((t) => `  * [COMPLETED] "${t.title}" on ${formatDate(t.completedAt)}`).join('\n')}`);
  }
  if (taskParts.length === 0) {
    sections.push('CARE TASKS: No pending or recent tasks.');
  } else {
    sections.push(`CARE TASKS & SCHEDULE:\n${taskParts.join('\n')}`);
  }

  // Section D: Growth Logs
  if (recentLogs.length > 0) {
    const logLines = recentLogs.slice(0, 8).map((l) => {
      return `- [${formatDate(l.loggedAt)}] (Type: ${l.logType}) ${l.content}`;
    });
    sections.push(`RECENT PLANT GROWTH LOGS:\n${logLines.join('\n')}`);
  }

  // Section E: Evaluated Care Recommendations
  if (activeRecommendations.length > 0) {
    const recLines = activeRecommendations.slice(0, 5).map((rec) => {
      return `- [${rec.severity.toUpperCase()}] ${rec.title}: ${rec.suggestedAction || rec.reason} (Action: ${rec.actionLabel || 'Inspect'})`;
    });
    sections.push(`SYSTEM CARE RECOMMENDATIONS:\n${recLines.join('\n')}`);
  }

  const formattedContextText = sections.join('\n\n');

  return {
    userId,
    gardenFilter,
    plantFilter,
    gardensCount: relevantGardens.length,
    plantsCount: relevantPlants.length,
    readingsCount: readings.length,
    tasksCount: tasks.length,
    formattedContextText,
    provenanceSummary: {
      hasSimulatedReadings,
      hasManualReadings,
      hasLiveSensors,
      staleReadingCount,
    },
  };
}
