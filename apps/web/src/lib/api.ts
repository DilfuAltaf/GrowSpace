import type {
  AnalyticsSummaryResponse,
  AnalyticsTimeRange,
  ApiErrorBody,
  AssistantChatInput,
  AssistantChatResponse,
  AssistantConversation,
  AssistantMessage,
  CareSchedule,
  CareScheduleInput,
  CareScheduleUpdate,
  CareTask,
  Garden,
  GardenInput,
  GardenUpdate,
  ManualReadingInput,
  MeasurementType,
  Notification,
  NotificationType,
  Plant,
  PlantCatalogEntry,
  PlantInput,
  PlantLog,
  PlantLogInput,
  PlantResearchProfile,
  PlantResearchRecord,
  PlantUpdate,
  ReadingSource,
  Recommendation,
  SensorReadingWithDetails,
  TaskInput,
  TaskUpdate,
} from '@growspace/shared';
import { firstPartyAuthClient } from '@/features/auth/first-party-client';

const API_BASE_URL =
  ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
    (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL) ||
    '').replace(/\/$/, '');

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error?.message ?? 'Something went wrong. Please try again.');
    this.name = 'ApiClientError';
    this.status = status;
    this.code = body?.error?.code ?? 'unknown_error';
    this.fieldErrors = body?.error?.fieldErrors;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const isMutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes((init.method ?? 'GET').toUpperCase());
  if (isMutating && !headers.has('X-CSRF-Token')) {
    const csrf = await firstPartyAuthClient.getCsrfToken().catch(() => null);
    if (csrf) {
      headers.set('X-CSRF-Token', csrf);
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    let body: ApiErrorBody | null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = null;
    }
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('session-expired'));
    }
    throw new ApiClientError(response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function fetchCatalog(params?: {
  query?: string;
  category?: string;
  signal?: AbortSignal;
}): Promise<PlantCatalogEntry[]> {
  const search = new URLSearchParams();
  if (params?.query) search.set('q', params.query);
  if (params?.category) search.set('category', params.category);
  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  return apiFetch<PlantCatalogEntry[]>(`/api/catalog${suffix}`, { signal: params?.signal });
}

export async function fetchSelf(): Promise<{ user: { id: string; email: string | null } }> {
  return apiFetch('/api/me');
}

export type GardenWithStats = Garden & { plantCount?: number };

export async function fetchGardens(signal?: AbortSignal): Promise<{ gardens: GardenWithStats[] }> {
  return apiFetch<{ gardens: GardenWithStats[] }>('/api/gardens', { signal });
}

export async function fetchGarden(
  id: string,
  signal?: AbortSignal,
): Promise<{ garden: GardenWithStats }> {
  return apiFetch<{ garden: GardenWithStats }>(`/api/gardens/${id}`, { signal });
}

export async function createGarden(data: GardenInput): Promise<{ garden: Garden }> {
  return apiFetch<{ garden: Garden }>('/api/gardens', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateGarden(
  id: string,
  data: GardenUpdate,
): Promise<{ garden: Garden }> {
  return apiFetch<{ garden: Garden }>(`/api/gardens/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteGarden(
  id: string,
  options?: { cascade?: boolean },
): Promise<void> {
  const query = options?.cascade ? '?cascade=true' : '';
  return apiFetch<void>(`/api/gardens/${id}${query}`, {
    method: 'DELETE',
  });
}

export type PlantWithDetails = Plant & {
  gardenName?: string | null;
  catalog?: PlantCatalogEntry | null;
};

export async function fetchPlants(params?: {
  gardenId?: string;
  signal?: AbortSignal;
}): Promise<{ plants: PlantWithDetails[] }> {
  const query = params?.gardenId ? `?gardenId=${encodeURIComponent(params.gardenId)}` : '';
  return apiFetch<{ plants: PlantWithDetails[] }>(`/api/plants${query}`, { signal: params?.signal });
}

export async function fetchPlant(
  id: string,
  signal?: AbortSignal,
): Promise<{ plant: PlantWithDetails }> {
  return apiFetch<{ plant: PlantWithDetails }>(`/api/plants/${id}`, { signal });
}

export async function createPlant(data: PlantInput): Promise<{ plant: PlantWithDetails }> {
  return apiFetch<{ plant: PlantWithDetails }>('/api/plants', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePlant(
  id: string,
  data: PlantUpdate,
): Promise<{ plant: PlantWithDetails }> {
  return apiFetch<{ plant: PlantWithDetails }>(`/api/plants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deletePlant(id: string): Promise<void> {
  return apiFetch<void>(`/api/plants/${id}`, {
    method: 'DELETE',
  });
}

// Plant Logs API
export async function fetchPlantLogs(
  plantId: string,
  signal?: AbortSignal,
): Promise<{ logs: PlantLog[] }> {
  return apiFetch<{ logs: PlantLog[] }>(`/api/plants/${encodeURIComponent(plantId)}/logs`, { signal });
}

export async function createPlantLog(
  plantId: string,
  data: Omit<PlantLogInput, 'plantId'>,
): Promise<{ log: PlantLog }> {
  return apiFetch<{ log: PlantLog }>(`/api/plants/${encodeURIComponent(plantId)}/logs`, {
    method: 'POST',
    body: JSON.stringify({ ...data, plantId }),
  });
}

export async function deletePlantLog(plantId: string, logId: string): Promise<void> {
  return apiFetch<void>(
    `/api/plants/${encodeURIComponent(plantId)}/logs/${encodeURIComponent(logId)}`,
    {
      method: 'DELETE',
    },
  );
}

// Care Tasks API
export type CareTaskWithDetails = CareTask & {
  gardenName?: string | null;
  plantName?: string | null;
  scheduleTitle?: string | null;
};

export async function fetchTasks(params?: {
  gardenId?: string;
  plantId?: string;
  status?: string;
  due?: string;
  priority?: string;
  search?: string;
  from?: string;
  to?: string;
  signal?: AbortSignal;
}): Promise<{ tasks: CareTaskWithDetails[] }> {
  const query = new URLSearchParams();
  if (params?.gardenId) query.set('gardenId', params.gardenId);
  if (params?.plantId) query.set('plantId', params.plantId);
  if (params?.status) query.set('status', params.status);
  if (params?.due) query.set('due', params.due);
  if (params?.priority) query.set('priority', params.priority);
  if (params?.search) query.set('search', params.search);
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return apiFetch<{ tasks: CareTaskWithDetails[] }>(`/api/tasks${suffix}`, { signal: params?.signal });
}

export async function fetchCareSchedules(params?: {
  gardenId?: string;
  plantId?: string;
  isActive?: boolean;
  signal?: AbortSignal;
}): Promise<{ schedules: CareSchedule[] }> {
  const query = new URLSearchParams();
  if (params?.gardenId) query.set('gardenId', params.gardenId);
  if (params?.plantId) query.set('plantId', params.plantId);
  if (params?.isActive !== undefined) query.set('isActive', String(params.isActive));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return apiFetch<{ schedules: CareSchedule[] }>(`/api/tasks/schedules${suffix}`, { signal: params?.signal });
}

export async function fetchCareSchedule(
  id: string,
  signal?: AbortSignal,
): Promise<{ schedule: CareSchedule }> {
  return apiFetch<{ schedule: CareSchedule }>(`/api/tasks/schedules/${encodeURIComponent(id)}`, { signal });
}

export async function createCareSchedule(
  data: CareScheduleInput,
): Promise<{ schedule: CareSchedule; initialTask: CareTaskWithDetails }> {
  return apiFetch<{ schedule: CareSchedule; initialTask: CareTaskWithDetails }>('/api/tasks/schedules', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCareSchedule(
  id: string,
  data: CareScheduleUpdate,
): Promise<{ schedule: CareSchedule }> {
  return apiFetch<{ schedule: CareSchedule }>(`/api/tasks/schedules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteCareSchedule(id: string): Promise<void> {
  return apiFetch<void>(`/api/tasks/schedules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export interface RecommendationsResponse {
  recommendations: Recommendation[];
  summary: {
    total: number;
    criticalCount: number;
    warningCount: number;
    infoCount: number;
    overdueTaskCount: number;
    dueTodayTaskCount: number;
    environmentalAlertCount: number;
    evaluatedAt: string;
  };
}

export async function fetchRecommendations(params?: {
  gardenId?: string;
  plantId?: string;
  signal?: AbortSignal;
}): Promise<RecommendationsResponse> {
  const query = new URLSearchParams();
  if (params?.gardenId) query.set('gardenId', params.gardenId);
  if (params?.plantId) query.set('plantId', params.plantId);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return apiFetch<RecommendationsResponse>(`/api/recommendations${suffix}`, {
    signal: params?.signal,
  });
}

export async function fetchTask(
  id: string,
  signal?: AbortSignal,
): Promise<{ task: CareTaskWithDetails }> {
  return apiFetch<{ task: CareTaskWithDetails }>(`/api/tasks/${encodeURIComponent(id)}`, { signal });
}

export async function createTask(data: TaskInput): Promise<{ task: CareTaskWithDetails }> {
  return apiFetch<{ task: CareTaskWithDetails }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateTask(
  id: string,
  data: TaskUpdate,
): Promise<{ task: CareTaskWithDetails }> {
  return apiFetch<{ task: CareTaskWithDetails }>(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteTask(id: string): Promise<void> {
  return apiFetch<void>(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// Sensor Readings & Environmental Monitoring API
export interface FetchSensorReadingsParams {
  plantId?: string;
  gardenId?: string;
  measurementType?: MeasurementType;
  source?: ReadingSource;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  latest?: boolean;
  signal?: AbortSignal;
}

export async function fetchSensorReadings(params?: FetchSensorReadingsParams): Promise<{
  readings: SensorReadingWithDetails[];
  latest?: Record<MeasurementType, SensorReadingWithDetails | null>;
  total: number;
  limit: number;
  offset: number;
}> {
  const query = new URLSearchParams();
  if (params?.plantId) query.set('plantId', params.plantId);
  if (params?.gardenId) query.set('gardenId', params.gardenId);
  if (params?.measurementType) query.set('measurementType', params.measurementType);
  if (params?.source) query.set('source', params.source);
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  if (params?.offset !== undefined) query.set('offset', String(params.offset));
  if (params?.latest) query.set('latest', 'true');
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return apiFetch(`/api/readings${suffix}`, { signal: params?.signal });
}

export async function fetchLatestSensorReadings(params?: {
  plantId?: string;
  gardenId?: string;
  signal?: AbortSignal;
}): Promise<{ latest: Record<MeasurementType, SensorReadingWithDetails | null> }> {
  const query = new URLSearchParams({ latest: 'true' });
  if (params?.plantId) query.set('plantId', params.plantId);
  if (params?.gardenId) query.set('gardenId', params.gardenId);
  return apiFetch(`/api/readings?${query.toString()}`, { signal: params?.signal });
}

export async function createSensorReading(
  data: ManualReadingInput,
): Promise<{ reading: SensorReadingWithDetails }> {
  return apiFetch<{ reading: SensorReadingWithDetails }>('/api/readings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function generateSimulatedReadings(data: {
  gardenId?: string;
  plantId?: string;
}): Promise<{ readings: SensorReadingWithDetails[]; count: number; disclaimer: string }> {
  return apiFetch<{ readings: SensorReadingWithDetails[]; count: number; disclaimer: string }>(
    '/api/readings/simulate',
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
}

// In-App Notifications API
export interface FetchNotificationsParams {
  unreadOnly?: boolean;
  type?: NotificationType;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export async function fetchNotifications(params?: FetchNotificationsParams): Promise<{
  notifications: Notification[];
  total: number;
  unreadCount: number;
  limit: number;
  offset: number;
}> {
  const query = new URLSearchParams();
  if (params?.unreadOnly) query.set('unreadOnly', 'true');
  if (params?.type) query.set('type', params.type);
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  if (params?.offset !== undefined) query.set('offset', String(params.offset));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return apiFetch(`/api/notifications${suffix}`, { signal: params?.signal });
}

export async function markNotificationRead(
  id: string,
  isRead = true,
): Promise<{ notification: Notification }> {
  return apiFetch<{ notification: Notification }>(
    `/api/notifications/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isRead }),
    },
  );
}

export async function markAllNotificationsRead(): Promise<{ updatedCount: number }> {
  return apiFetch<{ updatedCount: number }>('/api/notifications/mark-all-read', {
    method: 'POST',
  });
}

export async function generateNotifications(): Promise<{
  generatedCount: number;
  unreadCount: number;
}> {
  return apiFetch<{ generatedCount: number; unreadCount: number }>(
    '/api/notifications/generate',
    {
      method: 'POST',
    },
  );
}

// AI Plant Research API
export interface PlantResearchResponse {
  matchedCatalogEntry?: PlantCatalogEntry;
  researchRecord?: PlantResearchRecord;
  profile?: PlantResearchProfile;
  sources?: PlantResearchProfile['sources'];
  confidence?: PlantResearchProfile['confidence'];
  message?: string;
}

export async function researchPlant(
  plantName: string,
  signal?: AbortSignal,
): Promise<PlantResearchResponse> {
  return apiFetch<PlantResearchResponse>('/api/plants/research', {
    method: 'POST',
    body: JSON.stringify({ plantName }),
    signal,
  });
}

export async function fetchResearchRecord(
  id: string,
  signal?: AbortSignal,
): Promise<{ researchRecord: PlantResearchRecord }> {
  return apiFetch<{ researchRecord: PlantResearchRecord }>(
    `/api/plants/research/${encodeURIComponent(id)}`,
    { signal },
  );
}

// Smart Insights & Historical Analytics API
export interface FetchAnalyticsParams {
  timeRange?: AnalyticsTimeRange;
  gardenId?: string;
  plantId?: string;
  source?: ReadingSource | 'all';
  measurementType?: MeasurementType | 'all';
  signal?: AbortSignal;
}

export async function fetchAnalytics(
  params?: FetchAnalyticsParams,
): Promise<{ data: AnalyticsSummaryResponse }> {
  const query = new URLSearchParams();
  if (params?.timeRange) query.set('timeRange', params.timeRange);
  if (params?.gardenId) query.set('gardenId', params.gardenId);
  if (params?.plantId) query.set('plantId', params.plantId);
  if (params?.source && params.source !== 'all') query.set('source', params.source);
  if (params?.measurementType && params.measurementType !== 'all')
    query.set('measurementType', params.measurementType);

  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return apiFetch<{ data: AnalyticsSummaryResponse }>(`/api/analytics${suffix}`, {
    signal: params?.signal,
  });
}

export async function explainAnalytics(
  params?: FetchAnalyticsParams,
): Promise<{ data: { explanation: string; summary: AnalyticsSummaryResponse } }> {
  return apiFetch<{ data: { explanation: string; summary: AnalyticsSummaryResponse } }>(
    '/api/analytics/explain',
    {
      method: 'POST',
      body: JSON.stringify({
        timeRange: params?.timeRange,
        gardenId: params?.gardenId,
        plantId: params?.plantId,
        source: params?.source,
        measurementType: params?.measurementType,
      }),
      signal: params?.signal,
    },
  );
}

// AI Farming Assistant API
export async function sendAssistantMessage(
  payload: AssistantChatInput,
  signal?: AbortSignal,
): Promise<AssistantChatResponse> {
  return apiFetch<AssistantChatResponse>('/api/assistant/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function fetchAssistantConversations(
  options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
): Promise<{ conversations: AssistantConversation[] }> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.offset !== undefined) query.set('offset', String(options.offset));

  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return apiFetch<{ conversations: AssistantConversation[] }>(`/api/assistant/conversations${suffix}`, {
    signal: options.signal,
  });
}

export async function fetchAssistantConversation(
  id: string,
  signal?: AbortSignal,
): Promise<{ conversation: AssistantConversation; messages: AssistantMessage[] }> {
  return apiFetch<{ conversation: AssistantConversation; messages: AssistantMessage[] }>(
    `/api/assistant/conversations/${encodeURIComponent(id)}`,
    { signal },
  );
}

export async function deleteAssistantConversation(
  id: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiFetch<void>(`/api/assistant/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal,
  });
}



