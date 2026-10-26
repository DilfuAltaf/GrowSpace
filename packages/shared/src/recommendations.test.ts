import { describe, expect, it } from 'vitest';
import { PLANT_CATALOG } from './catalog';
import {
  evaluatePlantConditionInsights,
  evaluateRecommendations,
  generateDeterministicAnalyticsSummary,
} from './recommendations';
import type { MeasurementStats, Plant, SensorReading } from './types';

const now = new Date('2026-10-20T12:00:00.000Z');
const tomato = PLANT_CATALOG.find((entry) => entry.slug === 'tomato');

function reading(overrides: Partial<SensorReading>): SensorReading {
  return {
    id: 'reading-1',
    userId: 'user-1',
    gardenId: 'garden-1',
    plantId: null,
    measurementType: 'medium_moisture',
    value: 50,
    unit: '%',
    source: 'manual',
    recordedAt: '2026-10-20T11:00:00.000Z',
    note: null,
    createdAt: '2026-10-20T11:00:00.000Z',
    ...overrides,
  };
}

describe('evaluateRecommendations', () => {
  it('returns no warning when the latest reading is within the reference range', () => {
    const result = evaluateRecommendations({
      readings: [reading({ value: 65 })],
      catalog: tomato,
      now,
    });
    expect(result).toHaveLength(0);
  });

  it('explains a below-range condition with trigger and action', () => {
    const result = evaluateRecommendations({
      readings: [reading({ value: 20 })],
      catalog: tomato,
      now,
    });
    expect(result).toHaveLength(1);
    const recommendation = result[0]!;
    expect(recommendation.severity).toBe('warning');
    expect(recommendation.condition).toContain('20%');
    expect(recommendation.reason).toContain('Tomato');
    expect(recommendation.suggestedAction).toContain('root depth');
    expect(recommendation.disclaimer).toContain('manual entry');
  });

  it('flags critical moisture only for extreme values', () => {
    const result = evaluateRecommendations({
      readings: [reading({ value: 3 })],
      catalog: tomato,
      now,
    });
    expect(result[0]?.severity).toBe('critical');
  });

  it('returns a neutral check when data is stale', () => {
    const result = evaluateRecommendations({
      readings: [reading({ value: 20, recordedAt: '2026-10-18T11:00:00.000Z' })],
      catalog: tomato,
      now,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('info');
    expect(result[0]?.title.toLowerCase()).toContain('refresh');
  });

  it('does not invent a diagnosis without a reference range', () => {
    const result = evaluateRecommendations({
      readings: [
        reading({
          measurementType: 'air_humidity',
          value: 99,
          unit: '%',
        }),
      ],
      catalog: undefined,
      now,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('info');
    expect(result[0]?.title).toContain('Check conditions');
  });

  it('discloses simulated data in the recommendation', () => {
    const result = evaluateRecommendations({
      readings: [reading({ value: 20, source: 'simulated' })],
      catalog: tomato,
      now,
    });
    expect(result[0]?.disclaimer).toContain('simulated');
    expect(result[0]?.disclaimer).toContain('not a live sensor reading');
  });

  it('uses the latest reading per measurement type', () => {
    const result = evaluateRecommendations({
      readings: [
        reading({ id: 'old', value: 10, recordedAt: '2026-10-20T08:00:00.000Z' }),
        reading({ id: 'new', value: 65, recordedAt: '2026-10-20T11:30:00.000Z' }),
      ],
      catalog: tomato,
      now,
    });
    expect(result).toHaveLength(0);
  });

  it('generates an overdue task recommendation with task action link', () => {
    const overdueTask = {
      id: 'task-1',
      userId: 'user-1',
      gardenId: 'garden-1',
      plantId: 'plant-1',
      title: 'Water tomato bed',
      taskType: 'watering' as const,
      description: null,
      dueAt: '2026-10-18T10:00:00.000Z', // 2 days before ref date
      status: 'pending' as const,
      completedAt: null,
      priority: 'high' as const,
      createdAt: '2026-10-15T00:00:00.000Z',
      updatedAt: '2026-10-15T00:00:00.000Z',
    };

    const result = evaluateRecommendations({
      tasks: [overdueTask],
      now,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.category).toBe('care_task');
    expect(result[0]?.severity).toBe('critical'); // High priority overdue -> critical
    expect(result[0]?.title).toContain('Overdue watering');
    expect(result[0]?.actionLink).toBe('/dashboard/tasks/task-1');
  });

  it('correlates low media moisture with pending watering task', () => {
    const pendingWatering = {
      id: 'task-w',
      userId: 'user-1',
      gardenId: 'garden-1',
      plantId: 'plant-1',
      title: 'Feed and water',
      taskType: 'watering' as const,
      description: null,
      dueAt: '2026-10-20T14:00:00.000Z',
      status: 'pending' as const,
      completedAt: null,
      priority: 'normal' as const,
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:00.000Z',
    };

    const dryReading = reading({ value: 20 }); // below tomato range 50-70

    const result = evaluateRecommendations({
      catalog: tomato,
      readings: [dryReading],
      tasks: [pendingWatering],
      now,
    });

    // Expect: environmental recommendation mentions pending watering task, plus due today task
    const moistureRec = result.find((r) => r.measurementType === 'medium_moisture');
    expect(moistureRec).toBeDefined();
    expect(moistureRec?.suggestedAction).toContain('watering task');
    expect(moistureRec?.actionLink).toBe('/dashboard/tasks/task-w');
  });

  it('flags harvest window open when expected harvest date is reached', () => {
    const activePlant = {
      id: 'plant-ripe',
      userId: 'user-1',
      gardenId: 'garden-1',
      catalogId: 'catalog-tomato',
      customName: 'San Marzano',
      plantingDate: '2026-07-01',
      growthStage: 'fruiting' as const,
      status: 'active' as const,
      expectedHarvestDate: '2026-10-15', // past now (2026-10-20)
      actualHarvestDate: null,
      notes: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };

    const result = evaluateRecommendations({
      plant: activePlant,
      catalog: tomato,
      now,
    });

    const harvestRec = result.find((r) => r.category === 'lifecycle');
    expect(harvestRec).toBeDefined();
    expect(harvestRec?.title).toContain('Harvest window open');
    expect(harvestRec?.severity).toBe('warning');
    expect(harvestRec?.actionLink).toBe('/dashboard/plants/plant-ripe');
  });

  it('evaluates environmental readings against an AI research profile for custom plants', () => {
    const customResearchedPlant = {
      id: 'plant-dragonfruit',
      userId: 'user-1',
      gardenId: 'garden-1',
      catalogId: null,
      customName: 'Red Dragon Fruit',
      plantingDate: '2026-08-01',
      growthStage: 'vegetative' as const,
      status: 'active' as const,
      expectedHarvestDate: null,
      actualHarvestDate: null,
      notes: null,
      researchProfile: {
        plantName: 'Red Dragon Fruit',
        scientificName: 'Selenicereus costaricensis',
        category: 'Fruits',
        difficulty: 'moderate' as const,
        growingMedium: 'Cactus soil mix',
        lightGuidance: 'Full sun',
        wateringGuidance: 'Keep moderately moist',
        fertilizerGuidance: null,
        temperatureMin: 18,
        temperatureMax: 35,
        humidityMin: 40,
        humidityMax: 70,
        moistureMin: 30,
        moistureMax: 50,
        harvestDaysMin: 180,
        harvestDaysMax: 300,
        cultivationNotes: 'Needs trellis',
        safetyNotes: null,
        confidence: 'high' as const,
        sources: [],
      },
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };

    // Cold reading: 10°C, while dragon fruit researched range is 18–35°C
    const coldReading = reading({
      plantId: 'plant-dragonfruit',
      measurementType: 'air_temperature',
      value: 10,
      unit: '°C',
    });

    const result = evaluateRecommendations({
      plant: customResearchedPlant,
      catalog: null,
      readings: [coldReading],
      now,
    });

    const tempRec = result.find((r) => r.measurementType === 'air_temperature');
    expect(tempRec).toBeDefined();
    expect(tempRec?.title).toContain('Temperature is below the reference range');
    expect(tempRec?.context).toContain('AI-researched cultivation profile (high confidence)');
    expect(tempRec?.disclaimer).toContain('synthesized by AI research');
  });
});

describe('evaluatePlantConditionInsights', () => {
  const tomatoPlant: Plant = {
    id: 'plant-tomato',
    userId: 'user-1',
    gardenId: 'garden-1',
    catalogId: 'catalog-tomato',
    customName: 'Cherokee Purple',
    growthStage: 'vegetative',
    plantingDate: '2026-09-01',
    expectedHarvestDate: null,
    actualHarvestDate: null,
    status: 'active',
    notes: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  it('correctly classifies optimal, low, and high readings for a catalog plant', () => {
    // Tomato ranges: temp: 18-29°C, humidity: 50-70%, moisture: 55-75%
    const readings = [
      reading({
        plantId: 'plant-tomato',
        measurementType: 'air_temperature',
        value: 22,
        unit: '°C',
        recordedAt: '2026-10-20T11:30:00.000Z',
      }),
      reading({
        plantId: 'plant-tomato',
        measurementType: 'air_humidity',
        value: 30, // below 50%
        unit: '%',
        recordedAt: '2026-10-20T11:30:00.000Z',
      }),
      reading({
        plantId: 'plant-tomato',
        measurementType: 'medium_moisture',
        value: 85, // above 75%
        unit: '%',
        recordedAt: '2026-10-20T11:30:00.000Z',
      }),
    ];

    const insights = evaluatePlantConditionInsights({
      plants: [{ plant: tomatoPlant, catalog: tomato, readings }],
      now,
    });

    expect(insights).toHaveLength(3);

    const tempInsight = insights.find((i) => i.measurementType === 'air_temperature');
    expect(tempInsight?.state).toBe('optimal');
    expect(tempInsight?.observedValue).toBe(22);
    expect(tempInsight?.severity).toBe('info');

    const humidityInsight = insights.find((i) => i.measurementType === 'air_humidity');
    expect(humidityInsight?.state).toBe('low');
    expect(humidityInsight?.observedValue).toBe(30);
    expect(humidityInsight?.severity).toBe('warning');

    const moistureInsight = insights.find((i) => i.measurementType === 'medium_moisture');
    expect(moistureInsight?.state).toBe('high');
    expect(moistureInsight?.observedValue).toBe(85);
    expect(moistureInsight?.severity).toBe('warning');
  });

  it('marks missing readings as insufficient_data', () => {
    const insights = evaluatePlantConditionInsights({
      plants: [{ plant: tomatoPlant, catalog: tomato, readings: [] }],
      now,
    });

    expect(insights).toHaveLength(3);
    for (const insight of insights) {
      expect(insight.state).toBe('insufficient_data');
      expect(insight.observedValue).toBeNull();
      expect(insight.severity).toBe('info');
    }
  });

  it('flags stale readings when observation exceeds staleAfterHours threshold', () => {
    // Air humidity stale after 12 hours
    const staleHumidityReading = reading({
      plantId: 'plant-tomato',
      measurementType: 'air_humidity',
      value: 55,
      unit: '%',
      recordedAt: '2026-10-19T20:00:00.000Z', // 16 hours before now (12:00:00 on 2026-10-20)
    });

    const insights = evaluatePlantConditionInsights({
      plants: [{ plant: tomatoPlant, catalog: tomato, readings: [staleHumidityReading] }],
      now,
    });

    const humidityInsight = insights.find((i) => i.measurementType === 'air_humidity');
    expect(humidityInsight?.state).toBe('stale_data');
    expect(humidityInsight?.observedValue).toBe(55);
  });

  it('marks unconfigured_range when a custom plant lacks reference ranges', () => {
    const customUnconfiguredPlant: Plant = {
      ...tomatoPlant,
      catalogId: null,
      researchProfile: null,
    };

    const tempReading = reading({
      plantId: 'plant-tomato',
      measurementType: 'air_temperature',
      value: 24,
      unit: '°C',
      recordedAt: '2026-10-20T11:00:00.000Z',
    });

    const insights = evaluatePlantConditionInsights({
      plants: [{ plant: customUnconfiguredPlant, catalog: null, readings: [tempReading] }],
      now,
    });

    const tempInsight = insights.find((i) => i.measurementType === 'air_temperature');
    expect(tempInsight?.state).toBe('unconfigured_range');
    expect(tempInsight?.referenceRange).toBeNull();
  });

  it('uses AI research profile ranges for custom researched plants', () => {
    const dragonFruitPlant: Plant = {
      ...tomatoPlant,
      id: 'plant-df',
      customName: 'Dragon Fruit',
      catalogId: null,
      researchProfile: {
        plantName: 'Dragon Fruit',
        scientificName: 'Selenicereus undatus',
        category: 'Fruits',
        difficulty: 'moderate',
        growingMedium: 'Well-draining potting mix',
        lightGuidance: 'Full sun',
        wateringGuidance: 'Weekly',
        fertilizerGuidance: 'Balanced',
        temperatureMin: 18,
        temperatureMax: 35,
        humidityMin: 40,
        humidityMax: 70,
        moistureMin: 30,
        moistureMax: 50,
        harvestDaysMin: 180,
        harvestDaysMax: 300,
        cultivationNotes: 'Needs trellis',
        safetyNotes: null,
        confidence: 'high',
        sources: [],
      },
    };

    const coldReading = reading({
      plantId: 'plant-df',
      measurementType: 'air_temperature',
      value: 12,
      unit: '°C',
      recordedAt: '2026-10-20T11:00:00.000Z',
    });

    const insights = evaluatePlantConditionInsights({
      plants: [{ plant: dragonFruitPlant, catalog: null, readings: [coldReading] }],
      now,
    });

    const tempInsight = insights.find((i) => i.measurementType === 'air_temperature');
    expect(tempInsight?.state).toBe('low');
    expect(tempInsight?.isCustomResearched).toBe(true);
    expect(tempInsight?.referenceRange).toEqual({ min: 18, max: 35 });
    expect(tempInsight?.confidence).toBe('high');
  });
});

describe('generateDeterministicAnalyticsSummary', () => {
  const dummyStats: Record<'air_temperature' | 'air_humidity' | 'medium_moisture', MeasurementStats> = {
    air_temperature: {
      measurementType: 'air_temperature',
      unit: '°C',
      count: 24,
      min: 20,
      max: 28,
      avg: 24.5,
      latest: null,
      previousAvg: 23.0,
      deltaAvg: 1.5,
      sourceBreakdown: { manual: 4, simulated: 20, sensor: 0 },
    },
    air_humidity: {
      measurementType: 'air_humidity',
      unit: '%',
      count: 24,
      min: 50,
      max: 65,
      avg: 58.0,
      latest: null,
      previousAvg: 60.0,
      deltaAvg: -2.0,
      sourceBreakdown: { manual: 0, simulated: 24, sensor: 0 },
    },
    medium_moisture: {
      measurementType: 'medium_moisture',
      unit: '%',
      count: 12,
      min: 45,
      max: 70,
      avg: 55.0,
      latest: null,
      previousAvg: null,
      deltaAvg: null,
      sourceBreakdown: { manual: 12, simulated: 0, sensor: 0 },
    },
  };

  it('generates a complete summary with period comparisons when comparable data exists', () => {
    const summary = generateDeterministicAnalyticsSummary({
      timeRange: '7d',
      stats: dummyStats,
      insights: [
        {
          id: 'insight-1',
          plantId: 'plant-1',
          plantName: 'Roma Tomato',
          gardenId: 'garden-1',
          measurementType: 'air_temperature',
          state: 'optimal',
          observedValue: 24.5,
          unit: '°C',
          referenceRange: { min: 18, max: 29 },
          isCustomResearched: false,
          recordedAt: '2026-10-20T11:00:00.000Z',
          source: 'manual',
          reason: 'Temperature is within range',
          actionLink: '/dashboard/monitoring',
          actionLabel: 'View Telemetry',
          severity: 'info',
        },
      ],
      taskSummary: {
        overdueCount: 1,
        dueTodayCount: 2,
        upcomingCount: 3,
        completedCount: 5,
      },
      recentLogsCount: 4,
      previousPeriodHasComparableData: true,
    });

    expect(summary).toContain('Environmental trends (7d)');
    expect(summary).toContain('+1.5°C vs prior period');
    expect(summary).toContain('optimal');
    expect(summary).toContain('1 overdue');
    expect(summary).toContain('2 due today');
    expect(summary).toContain('4 growth log entry(ies) recorded');
    expect(summary).toContain('Note: Environmental metrics and care task progress represent operational tracking data');
  });

  it('clearly notes when prior period comparison is unavailable', () => {
    const summary = generateDeterministicAnalyticsSummary({
      timeRange: '24h',
      stats: dummyStats,
      insights: [],
      taskSummary: {
        overdueCount: 0,
        dueTodayCount: 0,
        upcomingCount: 0,
        completedCount: 0,
      },
      previousPeriodHasComparableData: false,
    });

    expect(summary).toContain('prior period comparison unavailable');
  });
});

