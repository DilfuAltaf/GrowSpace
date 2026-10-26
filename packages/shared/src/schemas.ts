import { z } from 'zod';
import { MEASUREMENTS } from './constants';
import type { MeasurementType } from './types';

const idSchema = z.string().trim().min(1, 'Required').max(128);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

const isoDateTime = z.iso.datetime({ offset: true });
const optionalDateTime = z
  .union([isoDateTime, z.literal('')])
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

export const measurementTypeSchema = z.enum([
  'air_temperature',
  'air_humidity',
  'medium_moisture',
]);

export const readingSourceSchema = z.enum(['simulated', 'manual', 'sensor']);
export const difficultySchema = z.enum(['easy', 'moderate', 'advanced']);
export const growingMethodSchema = z.enum([
  'soil',
  'hydroponic',
  'container',
  'raised_bed',
  'other',
]);
export const growthStageSchema = z.enum([
  'seedling',
  'vegetative',
  'flowering',
  'fruiting',
  'harvested',
]);
export const plantStatusSchema = z.enum(['active', 'archived', 'harvested']);
export const taskTypeSchema = z.enum(['watering', 'fertilizing', 'pruning', 'inspect', 'harvest', 'other']);
export const taskStatusSchema = z.enum(['pending', 'completed', 'cancelled']);
export const taskPrioritySchema = z.enum(['low', 'normal', 'high']);
export const recurrenceUnitSchema = z.enum(['days', 'weeks', 'months']);
export const logTypeSchema = z.enum(['growth', 'care', 'harvest', 'note']);
export const temperatureUnitSchema = z.enum(['celsius', 'fahrenheit']);

export function isPlausibleReading(type: MeasurementType, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const meta = MEASUREMENTS[type];
  return value >= meta.plausibleMin && value <= meta.plausibleMax;
}

export function unitForMeasurement(type: MeasurementType): string {
  return MEASUREMENTS[type].unit;
}

export const gardenInputSchema = z.object({
  name: z.string().trim().min(1, 'Garden name is required').max(80),
  description: optionalText(500),
  locationLabel: optionalText(120),
  growingMethod: growingMethodSchema.nullable().optional(),
  imageUrl: z.union([z.url({ protocol: /^https$/ }), z.null()]).optional(),
});

export const gardenUpdateSchema = gardenInputSchema.partial();

export const researchConfidenceSchema = z.enum(['high', 'moderate', 'low', 'insufficient']);

export const researchSourceSchema = z.object({
  title: z.string().trim().min(1, 'Source title is required').max(255),
  url: z.string().url('Source URL must be a valid URL'),
  publisher: z.string().trim().max(120).nullable().optional(),
  relevantFinding: z.string().trim().max(1000).nullable().optional(),
  retrievedAt: z.string().min(1, 'Retrieval timestamp is required'),
});

export const plantResearchProfileSchema = z.object({
  plantName: z.string().trim().min(1, 'Plant name is required').max(120),
  scientificName: optionalText(120).default(null),
  category: z.string().trim().min(1).max(80).default('Other'),
  difficulty: difficultySchema.nullable().optional().default(null),
  growingMedium: optionalText(500).default(null),
  lightGuidance: optionalText(500).default(null),
  wateringGuidance: optionalText(500).default(null),
  fertilizerGuidance: optionalText(500).default(null),
  temperatureMin: z.number().min(-20).max(70).nullable().optional().default(null),
  temperatureMax: z.number().min(-20).max(70).nullable().optional().default(null),
  humidityMin: z.number().min(0).max(100).nullable().optional().default(null),
  humidityMax: z.number().min(0).max(100).nullable().optional().default(null),
  moistureMin: z.number().min(0).max(100).nullable().optional().default(null),
  moistureMax: z.number().min(0).max(100).nullable().optional().default(null),
  harvestDaysMin: z.number().int().min(0).max(3650).nullable().optional().default(null),
  harvestDaysMax: z.number().int().min(0).max(3650).nullable().optional().default(null),
  cultivationNotes: optionalText(2000).default(null),
  safetyNotes: optionalText(1000).default(null),
  confidence: researchConfidenceSchema.default('moderate'),
  sources: z.array(researchSourceSchema).default([]),
});

export const plantInputSchema = z
  .object({
    gardenId: idSchema,
    catalogId: idSchema.nullable().optional(),
    customName: optionalText(80),
    plantingDate: z.iso.date().nullable().optional(),
    growthStage: growthStageSchema.default('seedling'),
    status: plantStatusSchema.default('active'),
    expectedHarvestDate: z.iso.date().nullable().optional(),
    actualHarvestDate: z.iso.date().nullable().optional(),
    notes: optionalText(1000),
    researchRecordId: idSchema.optional(),
    reviewedProfile: plantResearchProfileSchema.partial().optional(),
  })
  .refine((input) => Boolean(input.customName || input.catalogId), {
    message: 'Choose a plant from the library or enter a custom name',
    path: ['customName'],
  });

export const plantUpdateSchema = z
  .object({
    gardenId: idSchema.optional(),
    catalogId: idSchema.nullable().optional(),
    customName: optionalText(80),
    plantingDate: z.iso.date().nullable().optional(),
    growthStage: growthStageSchema.optional(),
    status: plantStatusSchema.optional(),
    expectedHarvestDate: z.iso.date().nullable().optional(),
    actualHarvestDate: z.iso.date().nullable().optional(),
    notes: optionalText(1000),
  })
  .refine((input) => Object.keys(input).length > 0, { message: 'No changes provided' });

export const manualReadingInputSchema = z
  .object({
    gardenId: idSchema.optional(),
    plantId: idSchema.nullable().optional(),
    measurementType: measurementTypeSchema,
    value: z.number({ error: 'Enter a valid number' }),
    unit: z.string().trim().min(1).max(12).optional(),
    source: readingSourceSchema.optional().default('manual'),
    recordedAt: isoDateTime.optional(),
    note: optionalText(500),
  })
  .superRefine((input, ctx) => {
    if (!input.gardenId && !input.plantId) {
      ctx.addIssue({
        code: 'custom',
        path: ['gardenId'],
        message: 'A garden or plant must be specified',
      });
    }
    const meta = MEASUREMENTS[input.measurementType];
    if (!Number.isFinite(input.value)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Value must be a finite number' });
      return;
    }
    if (input.value < meta.plausibleMin || input.value > meta.plausibleMax) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `Value must be between ${meta.plausibleMin} and ${meta.plausibleMax} ${meta.unit}`,
      });
    }
    if (input.unit && input.unit !== meta.unit) {
      ctx.addIssue({
        code: 'custom',
        path: ['unit'],
        message: `Unit must be ${meta.unit} for ${meta.label.toLowerCase()}`,
      });
    }
  });

export const readingFilterSchema = z.object({
  gardenId: idSchema.optional(),
  plantId: idSchema.optional(),
  measurementType: measurementTypeSchema.optional(),
  source: readingSourceSchema.optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ReadingFilter = z.infer<typeof readingFilterSchema>;

export const taskInputSchema = z.object({
  gardenId: idSchema,
  plantId: idSchema.nullable().optional(),
  title: z.string().trim().min(1, 'Task title is required').max(120),
  taskType: taskTypeSchema.default('other'),
  description: optionalText(1000),
  dueAt: optionalDateTime,
  priority: taskPrioritySchema.default('normal'),
  scheduleId: idSchema.nullable().optional(),
});

export const taskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  taskType: taskTypeSchema.optional(),
  description: optionalText(1000),
  dueAt: optionalDateTime,
  plantId: idSchema.nullable().optional(),
  priority: taskPrioritySchema.optional(),
  status: taskStatusSchema.optional(),
  scheduleId: idSchema.nullable().optional(),
});

export const careScheduleInputSchema = z.object({
  gardenId: idSchema,
  plantId: idSchema.nullable().optional(),
  title: z.string().trim().min(1, 'Schedule title is required').max(120),
  taskType: taskTypeSchema.default('watering'),
  description: optionalText(1000),
  priority: taskPrioritySchema.default('normal'),
  intervalValue: z.coerce.number().int().min(1, 'Interval must be at least 1').max(365, 'Interval cannot exceed 365'),
  intervalUnit: recurrenceUnitSchema.default('days'),
  startDate: optionalDateTime,
});

export const careScheduleUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  taskType: taskTypeSchema.optional(),
  description: optionalText(1000),
  priority: taskPrioritySchema.optional(),
  intervalValue: z.coerce.number().int().min(1).max(365).optional(),
  intervalUnit: recurrenceUnitSchema.optional(),
  isActive: z.boolean().optional(),
  nextDueAt: optionalDateTime,
});

export const plantLogInputSchema = z.object({
  plantId: idSchema,
  logType: logTypeSchema.default('note'),
  title: optionalText(120),
  content: z.string().trim().min(1, 'Log content is required').max(2000),
  loggedAt: optionalDateTime,
});

export const profileUpdateSchema = z.object({
  displayName: optionalText(80),
  temperatureUnit: temperatureUnitSchema.optional(),
});

export type GardenInput = z.infer<typeof gardenInputSchema>;
export type GardenUpdate = z.infer<typeof gardenUpdateSchema>;
export type PlantInput = z.infer<typeof plantInputSchema>;
export type PlantUpdate = z.infer<typeof plantUpdateSchema>;
export type ManualReadingInput = z.input<typeof manualReadingInputSchema>;
export type ManualReadingOutput = z.infer<typeof manualReadingInputSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
export type CareScheduleInput = z.infer<typeof careScheduleInputSchema>;
export type CareScheduleUpdate = z.infer<typeof careScheduleUpdateSchema>;
export type PlantLogInput = z.infer<typeof plantLogInputSchema>;
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const notificationTypeSchema = z.enum(['care_task', 'environmental', 'lifecycle', 'system']);

export const notificationLinkSchema = z
  .string()
  .trim()
  .regex(/^\/(?!\/)/, 'Notification link must be a safe internal relative path starting with /')
  .max(500, 'Link exceeds maximum length')
  .nullable()
  .optional();

export const notificationInputSchema = z.object({
  type: notificationTypeSchema,
  title: z.string().trim().min(1, 'Title is required').max(255),
  message: z.string().trim().min(1, 'Message is required').max(2000),
  link: notificationLinkSchema,
  dedupKey: z.string().trim().min(1).max(255).nullable().optional(),
});

export const notificationUpdateSchema = z.object({
  isRead: z.boolean(),
});

export const notificationQuerySchema = z.object({
  unreadOnly: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  type: notificationTypeSchema.optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? Math.min(Math.max(parseInt(val, 10) || 20, 1), 100) : 20)),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? Math.max(parseInt(val, 10) || 0, 0) : 0)),
});

export type NotificationInput = z.infer<typeof notificationInputSchema>;
export type NotificationUpdate = z.infer<typeof notificationUpdateSchema>;

export const plantResearchRequestSchema = z.object({
  plantName: z
    .string()
    .trim()
    .min(1, 'Please enter a plant name to research')
    .max(120, 'Plant name must not exceed 120 characters'),
});

export type ResearchSourceInput = z.infer<typeof researchSourceSchema>;
export type PlantResearchProfileInput = z.infer<typeof plantResearchProfileSchema>;
export type PlantResearchRequestInput = z.infer<typeof plantResearchRequestSchema>;

export const assistantMessageRoleSchema = z.enum(['user', 'assistant']);

export const assistantChatInputSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Please enter a question or message.')
    .max(2000, 'Message cannot exceed 2000 characters.'),
  conversationId: idSchema.optional(),
  gardenId: idSchema.optional(),
  plantId: idSchema.optional(),
});

export const assistantConversationUpdateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title cannot exceed 200 characters'),
});

export type AssistantChatPayload = z.infer<typeof assistantChatInputSchema>;
export type AssistantConversationUpdate = z.infer<typeof assistantConversationUpdateSchema>;

