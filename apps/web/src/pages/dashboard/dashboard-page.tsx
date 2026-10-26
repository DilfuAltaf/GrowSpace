import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  Droplets,
  ExternalLink,
  ListChecks,
  MapPin,
  Plus,
  Sparkles,
  Sprout,
  Thermometer,
  Wind,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/features/auth/auth-context';
import {
  formatDate,
  formatDateTime,
  formatMeasurementValue,
  getTaskDueClassification,
  isStale,
  MEASUREMENTS,
  type GrowthStage,
  type MeasurementType,
  type Notification,
  type ReadingSource,
  type Recommendation,
  type SensorReadingWithDetails,
} from '@growspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataSourceBadge } from '@/components/ui/data-source-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import {
  fetchGardens,
  fetchLatestSensorReadings,
  fetchNotifications,
  fetchPlants,
  fetchRecommendations,
  fetchSensorReadings,
  fetchTasks,
  generateNotifications,
  markNotificationRead,
  updateTask,
  type CareTaskWithDetails,
  type GardenWithStats,
  type PlantWithDetails,
  type RecommendationsResponse,
} from '@/lib/api';

const GROWTH_STAGE_LABELS: Record<GrowthStage, string> = {
  seedling: 'Seedling',
  vegetative: 'Vegetative',
  flowering: 'Flowering',
  fruiting: 'Fruiting',
  harvested: 'Harvested',
};

const GROWTH_STAGE_VARIANTS: Record<
  GrowthStage,
  'neutral' | 'sage' | 'success' | 'warning' | 'info'
> = {
  seedling: 'info',
  vegetative: 'sage',
  flowering: 'warning',
  fruiting: 'success',
  harvested: 'neutral',
};

interface MetricCardProps {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  to: string;
  badge?: { text: string; variant: 'critical' | 'warning' | 'sage' | 'neutral' };
}

function MetricCard({ label, value, hint, icon: Icon, to, badge }: MetricCardProps) {
  return (
    <Link
      to={to}
      className="card-surface flex flex-col p-5 transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-float focus:outline-hidden focus:ring-2 focus:ring-sage"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted">{label}</span>
        <div className="flex items-center gap-1.5">
          {badge ? (
            <Badge variant={badge.variant} className="text-[10px] px-1.5 py-0.5">
              {badge.text}
            </Badge>
          ) : null}
          <span className="flex h-8 w-8 items-center justify-center rounded-control bg-soft-sage text-forest">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums text-forest">{value}</p>
      <p className="mt-1 text-xs text-muted truncate">{hint}</p>
    </Link>
  );
}

interface ChartPoint {
  timestamp: string;
  timeLabel: string;
  air_temperature?: number;
  air_humidity?: number;
  medium_moisture?: number;
  source?: ReadingSource;
}

interface TooltipPayloadItem {
  name?: string;
  value?: number;
  dataKey?: string;
  color?: string;
  payload?: ChartPoint;
}

function CustomChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const first = payload[0]?.payload;
  return (
    <div className="rounded-control border border-line bg-card p-3 shadow-md text-xs space-y-1.5">
      <p className="font-semibold text-ink">{first?.timeLabel || 'Observation'}</p>
      {first?.source ? (
        <div className="pb-1">
          <DataSourceBadge source={first.source} />
        </div>
      ) : null}
      {payload.map((item, idx) => (
        <div key={idx} className="flex items-center justify-between gap-4">
          <span className="font-medium text-muted">{item.name}:</span>
          <span className="font-semibold text-ink tabular-nums">
            {item.value != null ? `${item.value}` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Extracts reference range for a specific measurement from a plant's catalog entry or AI research profile.
 */
function getMeasurementRange(
  plant: PlantWithDetails,
  type: MeasurementType,
): { min: number; max: number } | null {
  // 1. Curated botanical catalog entry
  if (plant.catalog?.referenceRanges?.[type]) {
    const r = plant.catalog.referenceRanges[type];
    if (r && typeof r.min === 'number' && typeof r.max === 'number') {
      return { min: r.min, max: r.max };
    }
  }

  // 2. AI Research Profile (verified/reviewed saved record)
  if (plant.researchProfile) {
    const rp = plant.researchProfile;
    if (type === 'air_temperature' && rp.temperatureMin != null && rp.temperatureMax != null) {
      return { min: rp.temperatureMin, max: rp.temperatureMax };
    }
    if (type === 'air_humidity' && rp.humidityMin != null && rp.humidityMax != null) {
      return { min: rp.humidityMin, max: rp.humidityMax };
    }
    if (type === 'medium_moisture' && rp.moistureMin != null && rp.moistureMax != null) {
      return { min: rp.moistureMin, max: rp.moistureMax };
    }
  }

  return null;
}

export function DashboardPage() {
  const { user } = useAuth();
  const displayName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Grower';

  // Core Data States
  const [gardens, setGardens] = useState<GardenWithStats[]>([]);
  const [plants, setPlants] = useState<PlantWithDetails[]>([]);
  const [tasks, setTasks] = useState<CareTaskWithDetails[]>([]);
  const [readings, setReadings] = useState<SensorReadingWithDetails[]>([]);
  const [latestReadings, setLatestReadings] = useState<
    Record<MeasurementType, SensorReadingWithDetails | null>
  >({
    air_temperature: null,
    air_humidity: null,
    medium_moisture: null,
  });
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Recommendations State
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recSummary, setRecSummary] = useState<RecommendationsResponse['summary'] | null>(null);

  // Loading and Error States
  const [loadingData, setLoadingData] = useState(true);
  const [loadingRecommendations, setLoadingRecommendations] = useState(true);
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);

  // Interaction States
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [checkingReminders, setCheckingReminders] = useState(false);
  const [actionBanner, setActionBanner] = useState<{ message: string; type: 'success' | 'info' } | null>(null);
  const [taskFilter, setTaskFilter] = useState<'pending' | 'overdue' | 'today' | 'upcoming'>('pending');

  // Load all dashboard components using resilient Promise.allSettled
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    Promise.allSettled([
      fetchGardens(controller.signal),
      fetchPlants({ signal: controller.signal }),
      fetchTasks({ signal: controller.signal }),
      fetchNotifications({ limit: 6, signal: controller.signal }),
      fetchSensorReadings({ limit: 60, signal: controller.signal }),
      fetchLatestSensorReadings({ signal: controller.signal }),
      fetchRecommendations({ signal: controller.signal }),
    ]).then(([gardensRes, plantsRes, tasksRes, notifsRes, readingsRes, latestRes, recsRes]) => {
      if (!isMounted) return;

      if (gardensRes.status === 'fulfilled') {
        setGardens(gardensRes.value.gardens);
      }

      if (plantsRes.status === 'fulfilled') {
        setPlants(plantsRes.value.plants);
      }

      if (tasksRes.status === 'fulfilled') {
        setTasks(tasksRes.value.tasks);
      }

      if (notifsRes.status === 'fulfilled') {
        setNotifications(notifsRes.value.notifications);
        setUnreadCount(notifsRes.value.unreadCount);
      }

      if (readingsRes.status === 'fulfilled') {
        setReadings(readingsRes.value.readings);
      }

      if (latestRes.status === 'fulfilled' && latestRes.value?.latest) {
        setLatestReadings(latestRes.value.latest);
      } else if (readingsRes.status === 'fulfilled') {
        // Fallback: extract latest reading per measurement from readings array
        const map: Record<MeasurementType, SensorReadingWithDetails | null> = {
          air_temperature: null,
          air_humidity: null,
          medium_moisture: null,
        };
        for (const r of readingsRes.value.readings) {
          if (!map[r.measurementType]) {
            map[r.measurementType] = r;
          }
        }
        setLatestReadings(map);
      }

      if (recsRes.status === 'fulfilled') {
        setRecommendations(recsRes.value.recommendations);
        setRecSummary(recsRes.value.summary);
        setRecommendationsError(null);
      } else {
        setRecommendationsError('Unable to evaluate plant recommendations.');
      }

      setLoadingData(false);
      setLoadingRecommendations(false);
    });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [refreshIndex]);

  const reloadData = () => {
    setLoadingData(true);
    setLoadingRecommendations(true);
    setRefreshIndex((k) => k + 1);
  };

  const handleToggleTaskStatus = async (task: CareTaskWithDetails) => {
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    setTogglingTaskId(task.id);
    try {
      const res = await updateTask(task.id, { status: newStatus });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...res.task } : t)));
      // Refresh recommendations smoothly to reflect task resolution
      fetchRecommendations()
        .then((recsRes) => {
          setRecommendations(recsRes.recommendations);
          setRecSummary(recsRes.summary);
        })
        .catch(() => {});
    } catch {
      // Handled silently
    } finally {
      setTogglingTaskId(null);
    }
  };

  const handleMarkNotificationRead = async (notifId: string) => {
    try {
      await markNotificationRead(notifId, true);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notifId ? { ...n, isRead: true, readAt: new Date().toISOString() } : n)),
      );
      setUnreadCount((c) => Math.max(c - 1, 0));
    } catch {
      // Handled silently
    }
  };

  const handleCheckReminders = async () => {
    try {
      setCheckingReminders(true);
      const res = await generateNotifications();
      if (res.generatedCount > 0) {
        setActionBanner({
          message: `Evaluated garden conditions: ${res.generatedCount} fresh reminder${res.generatedCount === 1 ? '' : 's'} added.`,
          type: 'success',
        });
      } else {
        setActionBanner({
          message: 'All care tasks and telemetry are up-to-date. No new alerts required.',
          type: 'info',
        });
      }
      setTimeout(() => setActionBanner(null), 6000);
      reloadData();
    } catch {
      setActionBanner({
        message: 'Could not refresh reminders. Please verify network connection.',
        type: 'info',
      });
      setTimeout(() => setActionBanner(null), 5000);
    } finally {
      setCheckingReminders(false);
    }
  };

  // Metrics Calculations
  const now = useMemo(() => new Date(), []);

  const activePlants = useMemo(() => plants.filter((p) => p.status === 'active'), [plants]);
  const activePlantsCount = activePlants.length;

  const pendingTasks = useMemo(() => tasks.filter((t) => t.status === 'pending'), [tasks]);
  const overdueTasks = useMemo(
    () => pendingTasks.filter((t) => getTaskDueClassification(t.dueAt, now) === 'overdue'),
    [pendingTasks, now],
  );
  const dueTodayTasks = useMemo(
    () => pendingTasks.filter((t) => getTaskDueClassification(t.dueAt, now) === 'today'),
    [pendingTasks, now],
  );
  const upcomingTasks = useMemo(
    () => pendingTasks.filter((t) => getTaskDueClassification(t.dueAt, now) === 'upcoming'),
    [pendingTasks, now],
  );

  const completedTodayCount = useMemo(() => {
    const todayStr = now.toISOString().split('T')[0];
    return tasks.filter(
      (t) =>
        t.status === 'completed' &&
        ((t.completedAt && t.completedAt.split('T')[0] === todayStr) ||
          (t.dueAt && t.dueAt.split('T')[0] === todayStr)),
    ).length;
  }, [tasks, now]);

  const todayTotalCount = dueTodayTasks.length + completedTodayCount;
  const todayCompletionPercent =
    todayTotalCount > 0 ? Math.round((completedTodayCount / todayTotalCount) * 100) : 100;

  const filteredTasks = useMemo(() => {
    if (taskFilter === 'overdue') return overdueTasks;
    if (taskFilter === 'today') return dueTodayTasks;
    if (taskFilter === 'upcoming') return upcomingTasks;
    return pendingTasks;
  }, [taskFilter, pendingTasks, overdueTasks, dueTodayTasks, upcomingTasks]);

  // Chart series data points
  const chartData = useMemo(() => {
    if (readings.length === 0) return [];
    const sorted = [...readings].sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
    );
    const points: ChartPoint[] = [];
    for (const r of sorted) {
      const date = new Date(r.recordedAt);
      const timeLabel = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);

      points.push({
        timestamp: r.recordedAt,
        timeLabel,
        [r.measurementType]: r.value,
        source: r.source,
      });
    }
    return points;
  }, [readings]);

  // Primary Telemetry summary
  const latestMoistureText = latestReadings.medium_moisture
    ? formatMeasurementValue(
        'medium_moisture',
        latestReadings.medium_moisture.value,
        latestReadings.medium_moisture.unit,
      )
    : null;
  const latestTempText = latestReadings.air_temperature
    ? formatMeasurementValue(
        'air_temperature',
        latestReadings.air_temperature.value,
        latestReadings.air_temperature.unit,
      )
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow="Overview"
        title={`Welcome back, ${displayName}`}
        description="Unified command center for your gardens, crop intelligence, and environmental telemetry."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Sparkles className="h-4 w-4 text-warning" aria-hidden="true" />}
              loading={checkingReminders}
              onClick={handleCheckReminders}
              aria-label="Check care reminders and alerts"
            >
              Check Reminders
            </Button>
            <Link to="/dashboard/monitoring/new" className={buttonStyles('secondary', 'sm')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Reading
            </Link>
            <Link to="/dashboard/plants/new" className={buttonStyles('primary', 'sm')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Plant
            </Link>
          </div>
        }
      />

      {/* Action Banner */}
      {actionBanner ? (
        <div
          className={`flex items-center justify-between rounded-card border p-4 text-sm font-medium transition ${
            actionBanner.type === 'success'
              ? 'border-success/30 bg-success-surface/50 text-success'
              : 'border-info/30 bg-info-surface/50 text-ink'
          }`}
          role="status"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{actionBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            className="text-muted hover:text-ink transition"
            aria-label="Dismiss message"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* Email Verification Alert */}
      {user && !user.emailVerified ? (
        <div className="flex items-start gap-3 rounded-card border border-info/20 bg-info-surface/60 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-ink">Verify your email</p>
            <p className="mt-0.5 text-sm text-muted">
              A verification link was sent to {user.email}. Please verify your email to unlock all
              autonomous notifications and research capabilities.
            </p>
          </div>
        </div>
      ) : null}

      {/* Overdue Tasks Alert Banner */}
      {overdueTasks.length > 0 ? (
        <div className="flex items-center justify-between rounded-card border border-critical/30 bg-critical-surface/60 p-4 text-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-critical-surface text-critical">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold text-critical">
                {overdueTasks.length} {overdueTasks.length === 1 ? 'care task is' : 'care tasks are'} overdue
              </p>
              <p className="text-xs text-muted">
                Pending care tasks require timely attention to prevent plant stress and maintain optimal yields.
              </p>
            </div>
          </div>
          <Link to="/dashboard/tasks" className={buttonStyles('secondary', 'sm')}>
            Resolve Tasks
          </Link>
        </div>
      ) : null}

      {/* Unified Metrics Row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* Metric 1: Gardens & Active Crops */}
        <MetricCard
          label="Gardens & Crops"
          value={loadingData ? '—' : `${activePlantsCount} Active`}
          hint={
            loadingData
              ? 'Loading...'
              : gardens.length === 0
                ? 'No gardens configured yet'
                : `${gardens.length} ${gardens.length === 1 ? 'garden' : 'gardens'} configured`
          }
          icon={Sprout}
          to="/dashboard/plants"
        />

        {/* Metric 2: Environmental Telemetry */}
        <MetricCard
          label="Telemetry & Sensors"
          value={
            loadingData
              ? '—'
              : latestMoistureText
                ? `${latestMoistureText} · ${latestTempText || '—'}`
                : latestTempText || 'No readings'
          }
          hint={
            loadingData
              ? 'Loading...'
              : latestReadings.medium_moisture
                ? `${latestReadings.medium_moisture.source === 'simulated' ? 'Simulated' : 'Manual'} · ${formatDateTime(latestReadings.medium_moisture.recordedAt)}`
                : 'No sensor readings recorded yet'
          }
          icon={Droplets}
          to="/dashboard/monitoring"
        />

        {/* Metric 3: Care Tasks */}
        <MetricCard
          label="Care Tasks"
          value={loadingData ? '—' : `${pendingTasks.length} Pending`}
          hint={
            loadingData
              ? 'Loading...'
              : overdueTasks.length > 0
                ? `${overdueTasks.length} overdue · ${dueTodayTasks.length} due today`
                : dueTodayTasks.length > 0
                  ? `${dueTodayTasks.length} scheduled for today`
                  : pendingTasks.length === 0
                    ? 'All tasks up-to-date'
                    : `${pendingTasks.length} upcoming tasks`
          }
          icon={ListChecks}
          to="/dashboard/tasks"
          badge={
            overdueTasks.length > 0
              ? { text: `${overdueTasks.length} Overdue`, variant: 'critical' }
              : dueTodayTasks.length > 0
                ? { text: `${dueTodayTasks.length} Today`, variant: 'warning' }
                : undefined
          }
        />

        {/* Metric 4: In-App Notifications */}
        <MetricCard
          label="Notifications"
          value={loadingData ? '—' : `${unreadCount} Unread`}
          hint={
            loadingData
              ? 'Loading...'
              : unreadCount === 0
                ? 'All caught up'
                : `${unreadCount} unread alert${unreadCount === 1 ? '' : 's'}`
          }
          icon={Bell}
          to="/dashboard/notifications"
          badge={
            unreadCount > 0 ? { text: `${unreadCount} New`, variant: 'sage' } : undefined
          }
        />
      </div>

      {/* Middle Grid: Telemetry Trends & Plant Care Intelligence */}
      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        {/* Monitoring Trend Chart */}
        <Card className="flex flex-col">
          <CardHeader>
            <div>
              <CardTitle>Environmental Telemetry Trend</CardTitle>
              <p className="mt-1 text-sm text-muted">
                Observed readings across your gardens. Permanently labeled by data source.
              </p>
            </div>
            <Link to="/dashboard/monitoring" className={buttonStyles('secondary', 'sm')}>
              Open Monitoring
            </Link>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-between">
            {loadingData ? (
              <div className="space-y-3 py-6">
                <div className="h-48 animate-pulse rounded-card bg-soft-sage/40" />
              </div>
            ) : chartData.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted pb-1">
                  <span>Recent observations ({readings.length} readings)</span>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-amber-500" /> Temp (°C)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-600" /> Moisture (%)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-sky-500" /> Humidity (%)
                    </span>
                  </div>
                </div>

                <div className="h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                      <XAxis dataKey="timeLabel" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
                      <Tooltip content={<CustomChartTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="air_temperature"
                        name="Temp (°C)"
                        stroke="#d97706"
                        dot={{ r: 2.5 }}
                        strokeWidth={2}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="medium_moisture"
                        name="Moisture (%)"
                        stroke="#059669"
                        dot={{ r: 2.5 }}
                        strokeWidth={2}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="air_humidity"
                        name="Humidity (%)"
                        stroke="#0284c7"
                        dot={{ r: 2.5 }}
                        strokeWidth={2}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={Activity}
                title="No readings recorded yet"
                description="Add a manual observation or simulate demo telemetry. Empty data is preserved truthfully — never as invented zeros."
                className="border-0 bg-page/50 py-10"
                action={
                  <div className="flex items-center gap-2">
                    <Link to="/dashboard/monitoring/new" className={buttonStyles('primary', 'sm')}>
                      Add Reading
                    </Link>
                    <Link to="/dashboard/monitoring" className={buttonStyles('secondary', 'sm')}>
                      Setup Simulator
                    </Link>
                  </div>
                }
              />
            )}
          </CardContent>
        </Card>

        {/* Plant Care Intelligence */}
        <Card className="flex flex-col">
          <CardHeader>
            <div>
              <CardTitle>Plant Care Intelligence</CardTitle>
              <p className="mt-1 text-sm text-muted">
                Explainable guidance evaluated from your plants, readings, and care tasks.
              </p>
            </div>
            {loadingRecommendations ? null : recSummary ? (
              recSummary.criticalCount > 0 ? (
                <Badge variant="critical">{recSummary.criticalCount} Critical</Badge>
              ) : recSummary.warningCount > 0 ? (
                <Badge variant="warning">{recSummary.warningCount} Attention</Badge>
              ) : recommendations.length > 0 ? (
                <Badge variant="sage">{recommendations.length} Active</Badge>
              ) : (
                <Badge variant="success">All on track</Badge>
              )
            ) : null}
          </CardHeader>
          <CardContent className="flex-1">
            {loadingRecommendations ? (
              <div className="space-y-3 py-2">
                <div className="h-16 animate-pulse rounded-card bg-soft-sage/40" />
                <div className="h-16 animate-pulse rounded-card bg-soft-sage/40" />
              </div>
            ) : recommendationsError ? (
              <ErrorState
                title="Could not evaluate recommendations"
                message={recommendationsError}
                action={
                  <Button variant="secondary" size="sm" onClick={reloadData}>
                    Try again
                  </Button>
                }
              />
            ) : recommendations.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="All crops on track"
                description="No overdue care tasks or out-of-range sensor readings detected. Your garden is in balance!"
                className="border-0 bg-page/50 py-8"
              />
            ) : (
              <div className="space-y-3">
                {recSummary &&
                (recSummary.overdueTaskCount > 0 ||
                  recSummary.dueTodayTaskCount > 0 ||
                  recSummary.environmentalAlertCount > 0) ? (
                  <div className="flex flex-wrap items-center gap-2 pb-1 text-xs text-muted">
                    {recSummary.overdueTaskCount > 0 ? (
                      <span className="font-semibold text-critical">
                        {recSummary.overdueTaskCount} overdue{' '}
                        {recSummary.overdueTaskCount === 1 ? 'task' : 'tasks'}
                      </span>
                    ) : null}
                    {recSummary.dueTodayTaskCount > 0 ? (
                      <span className="font-semibold text-warning">
                        · {recSummary.dueTodayTaskCount} due today
                      </span>
                    ) : null}
                    {recSummary.environmentalAlertCount > 0 ? (
                      <span className="font-medium text-ink">
                        · {recSummary.environmentalAlertCount} environmental{' '}
                        {recSummary.environmentalAlertCount === 1 ? 'alert' : 'alerts'}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className="divide-y divide-line/60">
                  {recommendations.slice(0, 4).map((rec) => {
                    const badgeVariant =
                      rec.severity === 'critical'
                        ? 'critical'
                        : rec.severity === 'warning'
                          ? 'warning'
                          : 'sage';

                    return (
                      <div key={rec.id} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={badgeVariant}
                              className="text-[10px] uppercase font-bold tracking-wider"
                            >
                              {rec.severity}
                            </Badge>
                            <span className="text-sm font-semibold text-forest">{rec.title}</span>
                          </div>
                          {rec.source ? (
                            <DataSourceBadge source={rec.source} className="shrink-0 text-[10px]" />
                          ) : null}
                        </div>

                        <p className="text-xs text-muted leading-relaxed">{rec.condition}</p>
                        <p className="text-xs font-medium text-ink leading-relaxed">
                          {rec.suggestedAction}
                        </p>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                          {rec.plantName ? (
                            <span className="flex items-center gap-1 text-muted">
                              <Sprout className="h-3 w-3 text-sage" aria-hidden="true" />
                              {rec.plantName}
                            </span>
                          ) : (
                            <span />
                          )}

                          {rec.actionLink ? (
                            <Link
                              to={rec.actionLink}
                              className="inline-flex items-center gap-1 font-semibold text-sage hover:text-forest transition"
                            >
                              {rec.actionLabel || 'Take action'}
                              <ArrowRight className="h-3 w-3" aria-hidden="true" />
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Plant Intelligence Integration: Active Crops & Telemetry */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Sprout className="h-5 w-5 text-forest" aria-hidden="true" />
              <CardTitle>Active Crops & Telemetry Intelligence</CardTitle>
            </div>
            <p className="mt-1 text-sm text-muted">
              Live status, growth stages, recent readings, and reference ranges for your tracked plants.
            </p>
          </div>
          <Link to="/dashboard/plants" className={buttonStyles('ghost', 'sm')}>
            View all plants &rarr;
          </Link>
        </CardHeader>
        <CardContent>
          {loadingData ? (
            <div className="space-y-3 py-4">
              <div className="h-20 animate-pulse rounded bg-soft-sage/40" />
              <div className="h-20 animate-pulse rounded bg-soft-sage/40" />
            </div>
          ) : activePlants.length === 0 ? (
            <EmptyState
              icon={Sprout}
              title={plants.length === 0 ? 'No plants in your garden yet' : 'No active plants'}
              description={
                plants.length === 0
                  ? 'Add your first plant to start logging growth stages, tracking environment parameters, and receiving AI care guidance.'
                  : 'All your plants are currently archived or harvested.'
              }
              className="border-0 bg-page/50 py-8"
              action={
                <Link to="/dashboard/plants/new" className={buttonStyles('primary', 'sm')}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add First Plant
                </Link>
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {activePlants.slice(0, 6).map((plant) => {
                const displayName = plant.customName || plant.catalog?.commonName || 'Plant';
                const scientific = plant.catalog?.scientificName || plant.researchProfile?.scientificName;
                const stageLabel = GROWTH_STAGE_LABELS[plant.growthStage] ?? plant.growthStage;
                const stageVariant = GROWTH_STAGE_VARIANTS[plant.growthStage] ?? 'sage';

                // Find latest readings specifically relevant to this plant or its garden
                const plantReadings = readings.filter(
                  (r) => r.plantId === plant.id || (!r.plantId && r.gardenId === plant.gardenId),
                );

                const getLatestReading = (type: MeasurementType): SensorReadingWithDetails | null => {
                  return plantReadings.find((r) => r.measurementType === type) ?? null;
                };

                const plantTemp = getLatestReading('air_temperature');
                const plantMoisture = getLatestReading('medium_moisture');
                const plantHumidity = getLatestReading('air_humidity');

                const tempRange = getMeasurementRange(plant, 'air_temperature');
                const moistureRange = getMeasurementRange(plant, 'medium_moisture');
                const humidityRange = getMeasurementRange(plant, 'air_humidity');

                const plantPendingTasks = tasks.filter(
                  (t) => t.plantId === plant.id && t.status === 'pending',
                );

                return (
                  <div
                    key={plant.id}
                    className="flex flex-col justify-between rounded-card border border-line bg-page/40 p-4 transition hover:border-line-strong hover:bg-card hover:shadow-float"
                  >
                    <div className="space-y-3">
                      {/* Plant Identity */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Link
                            to={`/dashboard/plants/${plant.id}`}
                            className="font-semibold text-forest hover:underline text-base"
                          >
                            {displayName}
                          </Link>
                          {scientific ? (
                            <p className="text-xs italic text-muted">{scientific}</p>
                          ) : null}
                          {plant.gardenName ? (
                            <p className="flex items-center gap-1 text-xs text-muted mt-0.5">
                              <MapPin className="h-3 w-3 text-sage" aria-hidden="true" />
                              <span>{plant.gardenName}</span>
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant={stageVariant} className="text-xs">
                            {stageLabel}
                          </Badge>
                          {plant.researchProfile ? (
                            <Badge variant="sage" className="text-[10px] flex items-center gap-1">
                              <Sparkles className="h-2.5 w-2.5" />
                              AI Researched
                            </Badge>
                          ) : plant.catalog ? (
                            <Badge variant="outline" className="text-[10px]">
                              Catalog
                            </Badge>
                          ) : null}
                        </div>
                      </div>

                      {/* Plant Telemetry & Reference Comparison */}
                      <div className="space-y-2 rounded-control border border-line/70 bg-card p-2.5 text-xs">
                        {/* Moisture */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1 text-muted">
                            <Droplets className="h-3.5 w-3.5 text-info" aria-hidden="true" />
                            Moisture:
                          </span>
                          <div className="flex items-center gap-1.5 text-right">
                            {plantMoisture ? (
                              <>
                                <span className="font-semibold tabular-nums text-forest">
                                  {formatMeasurementValue('medium_moisture', plantMoisture.value, plantMoisture.unit)}
                                </span>
                                <DataSourceBadge source={plantMoisture.source} className="text-[9px] px-1 py-0" />
                                {moistureRange ? (
                                  plantMoisture.value < moistureRange.min ? (
                                    <span className="text-[10px] font-bold text-critical">Low</span>
                                  ) : plantMoisture.value > moistureRange.max ? (
                                    <span className="text-[10px] font-bold text-warning">High</span>
                                  ) : (
                                    <span className="text-[10px] font-semibold text-success">Optimal</span>
                                  )
                                ) : null}
                              </>
                            ) : (
                              <span className="text-muted/60 italic text-[11px]">No reading</span>
                            )}
                          </div>
                        </div>

                        {/* Temperature */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1 text-muted">
                            <Thermometer className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                            Temperature:
                          </span>
                          <div className="flex items-center gap-1.5 text-right">
                            {plantTemp ? (
                              <>
                                <span className="font-semibold tabular-nums text-forest">
                                  {formatMeasurementValue('air_temperature', plantTemp.value, plantTemp.unit)}
                                </span>
                                <DataSourceBadge source={plantTemp.source} className="text-[9px] px-1 py-0" />
                                {tempRange ? (
                                  plantTemp.value < tempRange.min ? (
                                    <span className="text-[10px] font-bold text-critical">Cold</span>
                                  ) : plantTemp.value > tempRange.max ? (
                                    <span className="text-[10px] font-bold text-warning">Warm</span>
                                  ) : (
                                    <span className="text-[10px] font-semibold text-success">Optimal</span>
                                  )
                                ) : null}
                              </>
                            ) : (
                              <span className="text-muted/60 italic text-[11px]">No reading</span>
                            )}
                          </div>
                        </div>

                        {/* Humidity */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1 text-muted">
                            <Wind className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
                            Humidity:
                          </span>
                          <div className="flex items-center gap-1.5 text-right">
                            {plantHumidity ? (
                              <>
                                <span className="font-semibold tabular-nums text-forest">
                                  {formatMeasurementValue('air_humidity', plantHumidity.value, plantHumidity.unit)}
                                </span>
                                <DataSourceBadge source={plantHumidity.source} className="text-[9px] px-1 py-0" />
                                {humidityRange ? (
                                  plantHumidity.value < humidityRange.min ? (
                                    <span className="text-[10px] font-bold text-critical">Dry</span>
                                  ) : plantHumidity.value > humidityRange.max ? (
                                    <span className="text-[10px] font-bold text-warning">Humid</span>
                                  ) : (
                                    <span className="text-[10px] font-semibold text-success">Optimal</span>
                                  )
                                ) : null}
                              </>
                            ) : (
                              <span className="text-muted/60 italic text-[11px]">No reading</span>
                            )}
                          </div>
                        </div>

                        {/* Staleness and Timestamp */}
                        {plantMoisture || plantTemp || plantHumidity ? (
                          <div className="border-t border-line/50 pt-1 text-[10px] text-muted flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3 text-sage" aria-hidden="true" />
                              {formatDateTime(
                                (plantMoisture ?? plantTemp ?? plantHumidity)?.recordedAt,
                              )}
                            </span>
                            {plantMoisture && isStale(plantMoisture.recordedAt, MEASUREMENTS.medium_moisture.staleAfterHours) ? (
                              <span className="font-semibold text-amber-700">Moisture Stale</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      {/* Pending Tasks or Reference Target note */}
                      {plantPendingTasks.length > 0 ? (
                        <p className="text-xs text-muted flex items-center gap-1">
                          <ListChecks className="h-3.5 w-3.5 text-sage" aria-hidden="true" />
                          <span>
                            {plantPendingTasks.length} pending{' '}
                            {plantPendingTasks.length === 1 ? 'care task' : 'care tasks'}
                          </span>
                        </p>
                      ) : null}
                    </div>

                    {/* Direct Links */}
                    <div className="flex items-center justify-between border-t border-line/60 pt-3 mt-3 text-xs">
                      <Link
                        to={`/dashboard/monitoring?plantId=${plant.id}`}
                        className="font-medium text-sage hover:text-forest flex items-center gap-1"
                      >
                        <Activity className="h-3 w-3" aria-hidden="true" />
                        Telemetry
                      </Link>
                      <Link
                        to={`/dashboard/plants/${plant.id}`}
                        className="font-medium text-forest hover:underline"
                      >
                        View Plant &rarr;
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom Grid: Care Tasks & Gardens / Notifications */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Actionable Care Tasks */}
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <CardTitle>Care Tasks</CardTitle>
                <div className="flex items-center gap-2">
                  <Link to="/dashboard/tasks/new" className={buttonStyles('ghost', 'sm')}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    New
                  </Link>
                  <Link to="/dashboard/calendar" className={buttonStyles('ghost', 'sm')}>
                    <Calendar className="h-4 w-4" aria-hidden="true" />
                    Calendar
                  </Link>
                  <Link to="/dashboard/tasks" className={buttonStyles('ghost', 'sm')}>
                    View all
                  </Link>
                </div>
              </div>
              <p className="text-sm text-muted">Active garden maintenance and scheduled chores.</p>

              {/* Today's Care Plan Progress */}
              {todayTotalCount > 0 ? (
                <div className="rounded-control border border-line bg-soft-sage/20 p-2.5 mt-1 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-ink">Today's Care Plan Progress</span>
                    <span className="font-bold text-forest tabular-nums">
                      {completedTodayCount} of {todayTotalCount} completed ({todayCompletionPercent}%)
                    </span>
                  </div>
                  <div className="w-full bg-soft-sage/60 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-forest h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${todayCompletionPercent}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {/* Task Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1.5 pt-2">
                <button
                  type="button"
                  onClick={() => setTaskFilter('pending')}
                  className={`rounded-control px-2.5 py-1 text-xs font-semibold transition ${
                    taskFilter === 'pending'
                      ? 'bg-forest text-white'
                      : 'bg-soft-sage/60 text-forest hover:bg-soft-sage'
                  }`}
                >
                  All Pending ({pendingTasks.length})
                </button>
                {overdueTasks.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setTaskFilter('overdue')}
                    className={`rounded-control px-2.5 py-1 text-xs font-semibold transition ${
                      taskFilter === 'overdue'
                        ? 'bg-critical text-white'
                        : 'bg-critical-surface text-critical hover:bg-critical-surface/80'
                    }`}
                  >
                    Overdue ({overdueTasks.length})
                  </button>
                ) : null}
                {dueTodayTasks.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setTaskFilter('today')}
                    className={`rounded-control px-2.5 py-1 text-xs font-semibold transition ${
                      taskFilter === 'today'
                        ? 'bg-warning text-white'
                        : 'bg-amber-100 text-amber-900 hover:bg-amber-200/80'
                    }`}
                  >
                    Due Today ({dueTodayTasks.length})
                  </button>
                ) : null}
                {upcomingTasks.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setTaskFilter('upcoming')}
                    className={`rounded-control px-2.5 py-1 text-xs font-semibold transition ${
                      taskFilter === 'upcoming'
                        ? 'bg-forest text-white'
                        : 'bg-soft-sage/40 text-forest hover:bg-soft-sage'
                    }`}
                  >
                    Upcoming ({upcomingTasks.length})
                  </button>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            {loadingData ? (
              <div className="space-y-2 py-4">
                <div className="h-10 animate-pulse rounded bg-soft-sage/60" />
                <div className="h-10 animate-pulse rounded bg-soft-sage/60" />
              </div>
            ) : filteredTasks.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title="All caught up"
                description={
                  taskFilter === 'overdue'
                    ? 'No overdue care tasks. Your crops are running on schedule!'
                    : taskFilter === 'today'
                      ? 'No tasks scheduled for today.'
                      : taskFilter === 'upcoming'
                        ? 'No upcoming tasks scheduled for later dates.'
                        : 'No pending care tasks. Enjoy your garden!'
                }
                className="border-0 bg-page/50 py-7"
                action={
                  <Link to="/dashboard/tasks/new" className={buttonStyles('primary', 'sm')}>
                    Create Task
                  </Link>
                }
              />
            ) : (
              <div className="divide-y divide-line/60">
                {filteredTasks.slice(0, 5).map((t) => {
                  const classification = getTaskDueClassification(t.dueAt, now);
                  const isOverdue = classification === 'overdue';
                  return (
                    <div
                      key={t.id}
                      className="flex items-center justify-between py-3 text-sm transition"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => handleToggleTaskStatus(t)}
                          disabled={togglingTaskId === t.id}
                          aria-label="Mark task complete"
                          className="mt-0.5 text-muted hover:text-forest transition shrink-0"
                        >
                          <Circle className="h-4 w-4 text-muted hover:text-sage" />
                        </button>
                        <div className="min-w-0">
                          <Link
                            to={`/dashboard/tasks/${t.id}`}
                            className={`font-medium hover:underline truncate block ${
                              isOverdue ? 'text-critical' : 'text-forest'
                            }`}
                          >
                            {t.title}
                          </Link>
                          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted mt-0.5">
                            {t.gardenName ? <span>{t.gardenName}</span> : null}
                            {t.plantName ? <span>· {t.plantName}</span> : null}
                            {t.dueAt ? (
                              <span
                                className={`flex items-center gap-1 font-medium ${
                                  isOverdue ? 'text-critical font-semibold' : ''
                                }`}
                              >
                                · <Clock className="h-3 w-3" aria-hidden="true" />
                                {formatDate(t.dueAt)}
                              </span>
                            ) : null}
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant={isOverdue ? 'critical' : t.priority === 'high' ? 'warning' : 'sage'}
                        className="text-xs shrink-0 ml-2"
                      >
                        {isOverdue ? 'Overdue' : t.priority}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Gardens and Unread Notifications */}
        <div className="space-y-4">
          {/* Your Gardens */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Your Gardens</CardTitle>
                  <p className="mt-1 text-sm text-muted">Configured growing spaces and zones.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link to="/dashboard/gardens/new" className={buttonStyles('ghost', 'sm')}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add
                  </Link>
                  <Link to="/dashboard/gardens" className={buttonStyles('ghost', 'sm')}>
                    View all
                  </Link>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingData ? (
                <div className="space-y-2 py-2">
                  <div className="h-10 animate-pulse rounded bg-soft-sage/60" />
                </div>
              ) : gardens.length === 0 ? (
                <EmptyState
                  icon={Sprout}
                  title="No gardens created yet"
                  description="Group plants, tasks, and telemetry under customized indoor or outdoor gardens."
                  className="border-0 bg-page/50 py-6"
                  action={
                    <Link to="/dashboard/gardens/new" className={buttonStyles('primary', 'sm')}>
                      Create Garden
                    </Link>
                  }
                />
              ) : (
                <div className="divide-y divide-line/60">
                  {gardens.slice(0, 3).map((g) => (
                    <Link
                      key={g.id}
                      to={`/dashboard/gardens/${g.id}`}
                      className="flex items-center justify-between py-2.5 text-sm transition hover:text-forest"
                    >
                      <div>
                        <p className="font-medium text-forest">{g.name}</p>
                        {g.locationLabel ? (
                          <p className="flex items-center gap-1 text-xs text-muted">
                            <MapPin className="h-3 w-3 text-sage" aria-hidden="true" />
                            <span>{g.locationLabel}</span>
                          </p>
                        ) : null}
                      </div>
                      <span className="flex items-center gap-1 text-xs font-semibold text-muted">
                        <Sprout className="h-3.5 w-3.5 text-sage" aria-hidden="true" />
                        {g.plantCount ?? 0}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Unread Notifications & Alerts */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle>In-App Alerts & Notifications</CardTitle>
                  {unreadCount > 0 ? (
                    <Badge variant="sage" className="text-xs">
                      {unreadCount} unread
                    </Badge>
                  ) : null}
                </div>
                <Link to="/dashboard/notifications" className={buttonStyles('ghost', 'sm')}>
                  View all
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {loadingData ? (
                <div className="space-y-2 py-2">
                  <div className="h-10 animate-pulse rounded bg-soft-sage/60" />
                </div>
              ) : notifications.length === 0 ? (
                <EmptyState
                  icon={Bell}
                  title="No notifications"
                  description="You are caught up! Automated care reminders and out-of-range environmental alerts appear here."
                  className="border-0 bg-page/50 py-6"
                />
              ) : (
                <div className="divide-y divide-line/60">
                  {notifications.slice(0, 3).map((n) => (
                    <div
                      key={n.id}
                      className="flex items-start justify-between py-2.5 gap-2 text-xs transition"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {!n.isRead ? (
                            <span className="h-2 w-2 rounded-full bg-forest shrink-0" />
                          ) : null}
                          <p className="font-semibold text-ink truncate">{n.title}</p>
                        </div>
                        <p className="text-muted line-clamp-1">{n.message}</p>
                        <span className="text-[10px] text-muted flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {formatDateTime(n.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {n.link ? (
                          <Link
                            to={n.link}
                            className="p-1 text-muted hover:text-forest transition"
                            aria-label={`Open link for ${n.title}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        ) : null}
                        {!n.isRead ? (
                          <button
                            type="button"
                            onClick={() => handleMarkNotificationRead(n.id)}
                            className="rounded-control bg-soft-sage px-2 py-1 text-[10px] font-semibold text-forest hover:bg-soft-sage/80 transition"
                            aria-label="Mark notification read"
                          >
                            Mark read
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
