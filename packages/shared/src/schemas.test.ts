import { describe, expect, it } from 'vitest';
import {
  assistantChatInputSchema,
  careScheduleInputSchema,
  careScheduleUpdateSchema,
  gardenInputSchema,
  manualReadingInputSchema,
  notificationInputSchema,
  notificationLinkSchema,
  plantInputSchema,
  plantLogInputSchema,
  plantResearchProfileSchema,
  plantResearchRequestSchema,
  taskInputSchema,
} from './schemas';

describe('gardenInputSchema', () => {
  it('accepts a valid garden and normalises empty optional text', () => {
    const result = gardenInputSchema.parse({ name: '  Balcony  ', description: '   ' });
    expect(result.name).toBe('Balcony');
    expect(result.description).toBeNull();
  });

  it('rejects a blank name', () => {
    expect(gardenInputSchema.safeParse({ name: '   ' }).success).toBe(false);
  });
});

describe('plantInputSchema', () => {
  it('requires a catalog entry or custom name', () => {
    const result = plantInputSchema.safeParse({ gardenId: 'garden-1' });
    expect(result.success).toBe(false);
  });

  it('accepts a catalog plant', () => {
    const result = plantInputSchema.safeParse({
      gardenId: 'garden-1',
      catalogId: 'catalog-tomato',
    });
    expect(result.success).toBe(true);
  });
});

describe('manualReadingInputSchema', () => {
  const base = {
    gardenId: 'garden-1',
    measurementType: 'air_humidity',
    value: 55,
    recordedAt: '2026-10-20T10:00:00.000Z',
  };

  it('accepts a plausible reading', () => {
    expect(manualReadingInputSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a matching unit', () => {
    expect(manualReadingInputSchema.safeParse({ ...base, unit: '%' }).success).toBe(true);
  });

  it('rejects an impossible humidity value', () => {
    expect(manualReadingInputSchema.safeParse({ ...base, value: 140 }).success).toBe(false);
  });

  it('rejects a mismatched unit', () => {
    expect(manualReadingInputSchema.safeParse({ ...base, unit: '°C' }).success).toBe(false);
  });

  it('rejects NaN and Infinity', () => {
    expect(manualReadingInputSchema.safeParse({ ...base, value: Number.NaN }).success).toBe(false);
    expect(manualReadingInputSchema.safeParse({ ...base, value: Number.POSITIVE_INFINITY }).success).toBe(
      false,
    );
  });

  it('rejects an invalid timestamp', () => {
    expect(manualReadingInputSchema.safeParse({ ...base, recordedAt: 'yesterday' }).success).toBe(
      false,
    );
  });
});

describe('taskInputSchema', () => {
  it('applies safe defaults', () => {
    const result = taskInputSchema.parse({ gardenId: 'garden-1', title: 'Water basil' });
    expect(result.taskType).toBe('other');
    expect(result.priority).toBe('normal');
  });

  it('rejects a blank title', () => {
    expect(taskInputSchema.safeParse({ gardenId: 'garden-1', title: '  ' }).success).toBe(false);
  });

  it('normalizes empty dueAt to null', () => {
    const result = taskInputSchema.parse({
      gardenId: 'garden-1',
      title: 'Water basil',
      dueAt: '',
    });
    expect(result.dueAt).toBeNull();
  });
});

describe('plantLogInputSchema', () => {
  it('accepts valid growth log and defaults logType to note', () => {
    const result = plantLogInputSchema.parse({
      plantId: '00000000-0000-0000-0000-000000000001',
      content: 'First true leaves appeared today.',
    });
    expect(result.logType).toBe('note');
    expect(result.content).toBe('First true leaves appeared today.');
  });

  it('rejects empty content', () => {
    expect(
      plantLogInputSchema.safeParse({
        plantId: '00000000-0000-0000-0000-000000000001',
        content: '   ',
      }).success,
    ).toBe(false);
  });
});

describe('notificationLinkSchema & notificationInputSchema', () => {
  it('accepts safe internal relative paths', () => {
    expect(notificationLinkSchema.safeParse('/dashboard/tasks').success).toBe(true);
    expect(notificationLinkSchema.safeParse('/dashboard/monitoring?plantId=123').success).toBe(true);
    expect(notificationLinkSchema.safeParse(null).success).toBe(true);
  });

  it('rejects external, protocol-relative, or javascript links', () => {
    expect(notificationLinkSchema.safeParse('https://malicious.com').success).toBe(false);
    expect(notificationLinkSchema.safeParse('http://evil.com').success).toBe(false);
    expect(notificationLinkSchema.safeParse('//evil.com').success).toBe(false);
    expect(notificationLinkSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(notificationLinkSchema.safeParse('dashboard/tasks').success).toBe(false);
  });

  it('validates notificationInputSchema properly', () => {
    const valid = {
      type: 'care_task',
      title: 'Watering overdue',
      message: 'Your tomato plant needs water.',
      link: '/dashboard/tasks/1',
      dedupKey: 'task-overdue-1-2026-10-24',
    };
    expect(notificationInputSchema.safeParse(valid).success).toBe(true);

    // Rejects empty title
    expect(notificationInputSchema.safeParse({ ...valid, title: '   ' }).success).toBe(false);

    // Rejects invalid type
    expect(notificationInputSchema.safeParse({ ...valid, type: 'invalid_type' }).success).toBe(false);

    // Rejects unsafe link
    expect(notificationInputSchema.safeParse({ ...valid, link: 'https://phishing.com' }).success).toBe(false);
  });
});

describe('plantResearchRequestSchema', () => {
  it('accepts valid plant queries and trims whitespace', () => {
    const res = plantResearchRequestSchema.parse({ plantName: '  Dragon Fruit  ' });
    expect(res.plantName).toBe('Dragon Fruit');
  });

  it('rejects empty query', () => {
    expect(plantResearchRequestSchema.safeParse({ plantName: '   ' }).success).toBe(false);
  });

  it('rejects excessively long query', () => {
    expect(plantResearchRequestSchema.safeParse({ plantName: 'a'.repeat(121) }).success).toBe(false);
  });
});

describe('plantResearchProfileSchema', () => {
  const validProfile = {
    plantName: 'Dragon Fruit',
    scientificName: 'Selenicereus undatus',
    category: 'Fruits',
    difficulty: 'moderate' as const,
    growingMedium: 'Well-draining cactus and succulent mix',
    lightGuidance: 'Full sun to partial afternoon shade',
    wateringGuidance: 'Allow top 2 inches of soil to dry between waterings',
    fertilizerGuidance: 'Balanced low-nitrogen fertilizer during growing season',
    temperatureMin: 18,
    temperatureMax: 35,
    humidityMin: 40,
    humidityMax: 70,
    moistureMin: 30,
    moistureMax: 50,
    harvestDaysMin: 180,
    harvestDaysMax: 300,
    cultivationNotes: 'Needs a sturdy trellis support to bear mature vine weight.',
    safetyNotes: 'Stems possess small sharp thorns; wear protective gloves when pruning.',
    confidence: 'high' as const,
    sources: [
      {
        title: 'Pitaya (Dragonfruit) Cultivation - University Extension',
        url: 'https://extension.example.edu/pitaya',
        publisher: 'State Extension Service',
        relevantFinding: 'Prefers well-draining soil and temperatures between 18-35°C.',
        retrievedAt: '2026-10-24T12:00:00.000Z',
      },
    ],
  };

  it('validates a complete, high-quality research profile', () => {
    const parsed = plantResearchProfileSchema.parse(validProfile);
    expect(parsed.plantName).toBe('Dragon Fruit');
    expect(parsed.temperatureMin).toBe(18);
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.sources[0]?.url).toBe('https://extension.example.edu/pitaya');
  });

  it('allows optional scientific name and guidance fields when unverified', () => {
    const minimal = {
      plantName: 'Mystery Herb',
      category: 'Herbs',
      confidence: 'low' as const,
      sources: [],
    };
    const parsed = plantResearchProfileSchema.parse(minimal);
    expect(parsed.plantName).toBe('Mystery Herb');
    expect(parsed.scientificName).toBeNull();
    expect(parsed.temperatureMin).toBeNull();
  });

  it('rejects out-of-range environmental metrics', () => {
    expect(
      plantResearchProfileSchema.safeParse({
        ...validProfile,
        temperatureMin: -50,
      }).success,
    ).toBe(false);

    expect(
      plantResearchProfileSchema.safeParse({
        ...validProfile,
        humidityMax: 150,
      }).success,
    ).toBe(false);
  });
});

describe('careScheduleInputSchema & careScheduleUpdateSchema', () => {
  it('accepts valid schedule inputs and trims title', () => {
    const input = {
      gardenId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      title: '  Water Tomatoes  ',
      taskType: 'pruning' as const,
      intervalValue: 3,
      intervalUnit: 'days' as const,
      priority: 'high' as const,
    };
    const parsed = careScheduleInputSchema.parse(input);
    expect(parsed.title).toBe('Water Tomatoes');
    expect(parsed.taskType).toBe('pruning');
    expect(parsed.intervalValue).toBe(3);
    expect(parsed.intervalUnit).toBe('days');
    expect(parsed.priority).toBe('high');
  });

  it('rejects interval values less than 1 or greater than 365', () => {
    const base = {
      gardenId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      title: 'Feed Basil',
      intervalValue: 0,
    };
    expect(careScheduleInputSchema.safeParse(base).success).toBe(false);
    expect(careScheduleInputSchema.safeParse({ ...base, intervalValue: 366 }).success).toBe(false);
  });

  it('validates schedule updates with partial properties', () => {
    const update = {
      intervalValue: 7,
      intervalUnit: 'days' as const,
      isActive: false,
    };
    const parsed = careScheduleUpdateSchema.parse(update);
    expect(parsed.intervalValue).toBe(7);
    expect(parsed.isActive).toBe(false);
  });
});

describe('taskInputSchema with pruning and scheduleId', () => {
  it('accepts pruning taskType and optional scheduleId', () => {
    const task = {
      gardenId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      title: 'Prune dead leaves',
      taskType: 'pruning' as const,
      scheduleId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    };
    const parsed = taskInputSchema.parse(task);
    expect(parsed.taskType).toBe('pruning');
    expect(parsed.scheduleId).toBe('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22');
  });
});

describe('assistantChatInputSchema', () => {
  it('validates a valid assistant question payload', () => {
    const input = {
      message: 'Which of my plants need attention today?',
      gardenId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    };
    const parsed = assistantChatInputSchema.parse(input);
    expect(parsed.message).toBe('Which of my plants need attention today?');
    expect(parsed.gardenId).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });

  it('rejects empty or whitespace-only messages', () => {
    expect(assistantChatInputSchema.safeParse({ message: '   ' }).success).toBe(false);
    expect(assistantChatInputSchema.safeParse({ message: '' }).success).toBe(false);
  });

  it('rejects message exceeding 2000 characters', () => {
    const longMsg = 'a'.repeat(2001);
    expect(assistantChatInputSchema.safeParse({ message: longMsg }).success).toBe(false);
  });
});

