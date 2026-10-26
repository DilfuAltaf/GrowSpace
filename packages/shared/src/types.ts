export type MeasurementType = 'air_temperature' | 'air_humidity' | 'medium_moisture';

export type ReadingSource = 'simulated' | 'manual' | 'sensor';

export type GrowingMethod = 'soil' | 'hydroponic' | 'container' | 'raised_bed' | 'other';

export type Difficulty = 'easy' | 'moderate' | 'advanced';

export type GrowthStage = 'seedling' | 'vegetative' | 'flowering' | 'fruiting' | 'harvested';

export type PlantStatus = 'active' | 'archived' | 'harvested';

export type TaskType = 'watering' | 'fertilizing' | 'pruning' | 'inspect' | 'harvest' | 'other';

export type TaskStatus = 'pending' | 'completed' | 'cancelled';

export type TaskPriority = 'low' | 'normal' | 'high';

export type RecurrenceUnit = 'days' | 'weeks' | 'months';

export type LogType = 'growth' | 'care' | 'harvest' | 'note';

export type TemperatureUnit = 'celsius' | 'fahrenheit';

export type RecommendationSeverity = 'info' | 'warning' | 'critical';

export interface Profile {
  id: string;
  displayName: string | null;
  temperatureUnit: TemperatureUnit;
  createdAt: string;
  updatedAt: string;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
  temperatureUnit: TemperatureUnit;
  emailVerified: boolean;
  createdAt: string;
}

export interface Garden {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  locationLabel: string | null;
  growingMethod: GrowingMethod | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeasurementRange {
  min: number;
  max: number;
}

export interface PlantCatalogEntry {
  id: string;
  slug: string;
  commonName: string;
  scientificName: string | null;
  category: string;
  difficulty: Difficulty | null;
  imageUrl: string | null;
  lightGuidance: string | null;
  wateringGuidance: string | null;
  growingMethodNotes: string | null;
  harvestDaysMin: number | null;
  harvestDaysMax: number | null;
  referenceNotes: string | null;
  referenceRanges: Partial<Record<MeasurementType, MeasurementRange>>;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Plant {
  id: string;
  userId: string;
  gardenId: string;
  catalogId: string | null;
  customName: string | null;
  plantingDate: string | null;
  growthStage: GrowthStage;
  status: PlantStatus;
  expectedHarvestDate: string | null;
  actualHarvestDate: string | null;
  notes: string | null;
  researchProfile?: PlantResearchProfile | null;
  createdAt: string;
  updatedAt: string;
}

export interface SensorReading {
  id: string;
  userId: string;
  gardenId: string;
  plantId: string | null;
  measurementType: MeasurementType;
  value: number;
  unit: string;
  source: ReadingSource;
  recordedAt: string;
  note: string | null;
  createdAt: string;
}

export type SensorReadingWithDetails = SensorReading & {
  gardenName?: string | null;
  plantName?: string | null;
};

export interface CareTask {
  id: string;
  userId: string;
  gardenId: string;
  plantId: string | null;
  scheduleId?: string | null;
  title: string;
  taskType: TaskType;
  description: string | null;
  dueAt: string | null;
  status: TaskStatus;
  completedAt: string | null;
  priority: TaskPriority;
  createdAt: string;
  updatedAt: string;
}

export interface CareSchedule {
  id: string;
  userId: string;
  gardenId: string;
  plantId: string | null;
  title: string;
  taskType: TaskType;
  description: string | null;
  priority: TaskPriority;
  intervalValue: number;
  intervalUnit: RecurrenceUnit;
  isActive: boolean;
  nextDueAt: string;
  lastGeneratedAt: string | null;
  createdAt: string;
  updatedAt: string;
  gardenName?: string | null;
  plantName?: string | null;
}

export interface PlantLog {
  id: string;
  userId: string;
  plantId: string;
  logType: LogType;
  title: string | null;
  content: string;
  loggedAt: string;
  createdAt: string;
}

export type RecommendationCategory =
  | 'environmental'
  | 'care_task'
  | 'lifecycle'
  | 'observation';

export interface Recommendation {
  id: string;
  category?: RecommendationCategory;
  severity: RecommendationSeverity;
  measurementType?: MeasurementType;
  plantId?: string | null;
  plantName?: string | null;
  gardenId?: string | null;
  gardenName?: string | null;
  taskId?: string | null;
  actionLink?: string | null;
  actionLabel?: string | null;
  title: string;
  condition: string;
  reason: string;
  suggestedAction: string;
  context: string;
  disclaimer?: string;
  source?: ReadingSource;
  recordedAt?: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
  };
}

export type NotificationType = 'care_task' | 'environmental' | 'lifecycle' | 'system';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  readAt: string | null;
  dedupKey: string | null;
  createdAt: string;
}

export type ResearchConfidence = 'high' | 'moderate' | 'low' | 'insufficient';

export interface ResearchSource {
  title: string;
  url: string;
  publisher?: string | null;
  relevantFinding?: string | null;
  retrievedAt: string;
}

export interface PlantResearchProfile {
  plantName: string;
  scientificName: string | null;
  category: string;
  difficulty: Difficulty | null;
  growingMedium: string | null;
  lightGuidance: string | null;
  wateringGuidance: string | null;
  fertilizerGuidance: string | null;
  temperatureMin: number | null;
  temperatureMax: number | null;
  humidityMin: number | null;
  humidityMax: number | null;
  moistureMin: number | null;
  moistureMax: number | null;
  harvestDaysMin: number | null;
  harvestDaysMax: number | null;
  cultivationNotes: string | null;
  safetyNotes: string | null;
  confidence: ResearchConfidence;
  sources: ResearchSource[];
}

export interface PlantResearchRecord extends PlantResearchProfile {
  id: string;
  userId: string;
  plantId: string | null;
  status: 'draft' | 'completed' | 'failed';
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlantResearchResult {
  matchedCatalogEntry?: PlantCatalogEntry | null;
  researchRecord?: PlantResearchRecord | null;
  profile?: PlantResearchProfile | null;
}

export type PlantConditionState =
  | 'optimal'
  | 'low'
  | 'high'
  | 'insufficient_data'
  | 'stale_data'
  | 'unconfigured_range';

export interface PlantConditionInsight {
  id: string;
  plantId: string;
  plantName: string;
  gardenId: string;
  gardenName?: string | null;
  measurementType: MeasurementType;
  state: PlantConditionState;
  observedValue: number | null;
  unit: string;
  referenceRange: { min: number; max: number } | null;
  isCustomResearched: boolean;
  confidence?: string | null;
  recordedAt: string | null;
  source: ReadingSource | null;
  reason: string;
  actionLink: string;
  actionLabel: string;
  severity: 'info' | 'warning' | 'critical';
}

export type AnalyticsTimeRange = '24h' | '7d' | '30d';

export interface MeasurementStats {
  measurementType: MeasurementType;
  unit: string;
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  latest: SensorReadingWithDetails | null;
  previousAvg: number | null;
  deltaAvg: number | null;
  sourceBreakdown: Record<ReadingSource, number>;
}

export interface AnalyticsSummaryResponse {
  period: {
    timeRange: AnalyticsTimeRange;
    from: string;
    to: string;
  };
  previousPeriod: {
    from: string;
    to: string;
    hasComparableData: boolean;
  };
  filters: {
    gardenId?: string | null;
    plantId?: string | null;
    source?: ReadingSource | 'all';
    measurementType?: MeasurementType | 'all';
  };
  stats: Record<MeasurementType, MeasurementStats>;
  readings: SensorReadingWithDetails[];
  totalReadings: number;
  plantInsights: PlantConditionInsight[];
  taskSummary: {
    overdueCount: number;
    dueTodayCount: number;
    upcomingCount: number;
    completedCount: number;
  };
  recentLogs: PlantLog[];
  deterministicSummary: string;
}

export type AssistantMessageRole = 'user' | 'assistant';

export interface AssistantSource {
  title: string;
  url: string;
  publisher?: string | null;
  snippet?: string | null;
}

export interface AssistantMessageMetadata {
  webResearchUsed?: boolean;
  sources?: AssistantSource[];
  contextGardenId?: string | null;
  contextPlantId?: string | null;
  advisoryNotice?: string;
  provenanceNotes?: string[];
}

export interface AssistantMessage {
  id: string;
  conversationId: string;
  role: AssistantMessageRole;
  content: string;
  metadata?: AssistantMessageMetadata;
  createdAt: string;
}

export interface AssistantConversation {
  id: string;
  userId: string;
  title: string;
  gardenId?: string | null;
  plantId?: string | null;
  createdAt: string;
  updatedAt: string;
  messagesCount?: number;
  lastMessage?: string | null;
}

export interface AssistantChatInput {
  message: string;
  conversationId?: string;
  gardenId?: string;
  plantId?: string;
}

export interface AssistantChatResponse {
  conversationId: string;
  message: AssistantMessage;
  sources?: AssistantSource[];
  advisoryNotice: string;
  groundingDetails?: {
    gardensCount: number;
    plantsCount: number;
    readingsCount: number;
    tasksCount: number;
    webResearchUsed: boolean;
  };
}


