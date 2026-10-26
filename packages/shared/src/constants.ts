import type {
  Difficulty,
  GrowthStage,
  GrowingMethod,
  LogType,
  MeasurementType,
  NotificationType,
  PlantStatus,
  ReadingSource,
  RecurrenceUnit,
  TaskPriority,
  TaskStatus,
  TaskType,
  TemperatureUnit,
} from './types';

export interface MeasurementMeta {
  type: MeasurementType;
  label: string;
  shortLabel: string;
  unit: string;
  plausibleMin: number;
  plausibleMax: number;
  staleAfterHours: number;
  helperText: string;
}

export const MEASUREMENTS: Record<MeasurementType, MeasurementMeta> = {
  air_temperature: {
    type: 'air_temperature',
    label: 'Air temperature',
    shortLabel: 'Temperature',
    unit: '°C',
    plausibleMin: -20,
    plausibleMax: 70,
    staleAfterHours: 12,
    helperText: 'Typical greenhouse or room temperatures fall between 10 °C and 35 °C.',
  },
  air_humidity: {
    type: 'air_humidity',
    label: 'Air humidity',
    shortLabel: 'Humidity',
    unit: '%',
    plausibleMin: 0,
    plausibleMax: 100,
    staleAfterHours: 12,
    helperText: 'Relative humidity is a percentage between 0 and 100.',
  },
  medium_moisture: {
    type: 'medium_moisture',
    label: 'Media moisture',
    shortLabel: 'Moisture',
    unit: '%',
    plausibleMin: 0,
    plausibleMax: 100,
    staleAfterHours: 8,
    helperText: 'Moisture describes the growing medium, not the air.',
  },
};

export const MEASUREMENT_ORDER: MeasurementType[] = [
  'air_temperature',
  'air_humidity',
  'medium_moisture',
];

export const READING_SOURCES: Record<ReadingSource, { label: string; description: string }> = {
  simulated: {
    label: 'Simulated',
    description: 'Sample data generated for demonstration. Not a live sensor reading.',
  },
  manual: {
    label: 'Manual entry',
    description: 'Entered by you. No connected device produced this value.',
  },
  sensor: {
    label: 'Sensor',
    description: 'Reserved for a verified device integration. Not available in this release.',
  },
};

export const GROWING_METHODS: Record<GrowingMethod, string> = {
  soil: 'Soil',
  hydroponic: 'Hydroponic',
  container: 'Container',
  raised_bed: 'Raised bed',
  other: 'Other',
};

export const GROWTH_STAGES: Record<GrowthStage, string> = {
  seedling: 'Seedling',
  vegetative: 'Vegetative',
  flowering: 'Flowering',
  fruiting: 'Fruiting',
  harvested: 'Harvested',
};

export const PLANT_STATUSES: Record<PlantStatus, string> = {
  active: 'Active',
  archived: 'Archived',
  harvested: 'Harvested',
};

export const TASK_TYPES: Record<TaskType, string> = {
  watering: 'Watering',
  fertilizing: 'Fertilizing',
  pruning: 'Pruning',
  inspect: 'Inspection',
  harvest: 'Harvest',
  other: 'Other',
};

export const RECURRENCE_UNITS: Record<RecurrenceUnit, string> = {
  days: 'Days',
  weeks: 'Weeks',
  months: 'Months',
};

export const TASK_STATUSES: Record<TaskStatus, string> = {
  pending: 'Pending',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const TASK_PRIORITIES: Record<TaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
};

export const LOG_TYPES: Record<LogType, string> = {
  growth: 'Growth',
  care: 'Care',
  harvest: 'Harvest',
  note: 'Note',
};

export const DIFFICULTIES: Record<Difficulty, string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  advanced: 'Advanced',
};

export const TEMPERATURE_UNITS: Record<TemperatureUnit, string> = {
  celsius: 'Celsius (°C)',
  fahrenheit: 'Fahrenheit (°F)',
};

export const PLANT_CATEGORIES = ['Vegetables', 'Herbs', 'Fruits'] as const;

export const NOTIFICATION_TYPES: Record<NotificationType, string> = {
  care_task: 'Care Task',
  environmental: 'Environmental Alert',
  lifecycle: 'Plant Lifecycle',
  system: 'System Alert',
};
