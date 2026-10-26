import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckCircle2,
  Clock,
  Compass,
  Droplets,
  Filter,
  HelpCircle,
  Info,
  RefreshCw,
  Sparkles,
  Thermometer,
  Wind,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatDateTime,
  type AnalyticsSummaryResponse,
  type AnalyticsTimeRange,
  type Garden,
  type MeasurementStats,
  type MeasurementType,
  type PlantConditionInsight,
  type PlantConditionState,
  type ReadingSource,
} from '@growspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { DataSourceBadge } from '@/components/ui/data-source-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { FullPageLoader } from '@/components/ui/loading';
import { PageHeader } from '@/components/ui/page-header';
import {
  explainAnalytics,
  fetchAnalytics,
  fetchGardens,
  fetchPlants,
  type PlantWithDetails,
} from '@/lib/api';

const METRIC_CONFIG: Record<
  MeasurementType,
  {
    icon: typeof Thermometer;
    strokeColor: string;
    label: string;
    unit: string;
  }
> = {
  air_temperature: {
    icon: Thermometer,
    strokeColor: '#d97706',
    label: 'Air temperature',
    unit: '°C',
  },
  air_humidity: {
    icon: Wind,
    strokeColor: '#0284c7',
    label: 'Air humidity',
    unit: '%',
  },
  medium_moisture: {
    icon: Droplets,
    strokeColor: '#059669',
    label: 'Media moisture',
    unit: '%',
  },
};

interface ChartPoint {
  rawTimestamp: number;
  timeLabel: string;
  air_temperature?: number;
  air_humidity?: number;
  medium_moisture?: number;
  sources: Record<string, ReadingSource>;
}

export function AnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [summary, setSummary] = useState<AnalyticsSummaryResponse | null>(null);
  const [gardens, setGardens] = useState<Garden[]>([]);
  const [plants, setPlants] = useState<PlantWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AI Explanation State
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  // Active filters from query params or defaults
  const activeTimeRange = (searchParams.get('timeRange') as AnalyticsTimeRange) || '7d';
  const activeGardenId = searchParams.get('gardenId') || 'all';
  const activePlantId = searchParams.get('plantId') || 'all';
  const activeSource = (searchParams.get('source') as ReadingSource | 'all') || 'all';
  const activeMeasurementType =
    (searchParams.get('measurementType') as MeasurementType | 'all') || 'all';

  // Load gardens and plants for filter dropdowns
  useEffect(() => {
    let ignore = false;
    async function loadMetadata() {
      try {
        const [gardensRes, plantsRes] = await Promise.all([
          fetchGardens().catch(() => ({ gardens: [] })),
          fetchPlants().catch(() => ({ plants: [] })),
        ]);
        if (!ignore) {
          setGardens(gardensRes.gardens);
          setPlants(plantsRes.plants);
        }
      } catch {
        // Non-blocking for dropdowns
      }
    }
    loadMetadata();
    return () => {
      ignore = true;
    };
  }, []);

  // Filter plants based on selected garden
  const selectablePlants = useMemo(() => {
    if (activeGardenId === 'all') return plants;
    return plants.filter((p) => p.gardenId === activeGardenId);
  }, [plants, activeGardenId]);

  // Fetch summary data whenever filters or refreshIndex change
  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();

    fetchAnalytics({
      timeRange: activeTimeRange,
      gardenId: activeGardenId !== 'all' ? activeGardenId : undefined,
      plantId: activePlantId !== 'all' ? activePlantId : undefined,
      source: activeSource !== 'all' ? activeSource : undefined,
      measurementType: activeMeasurementType !== 'all' ? activeMeasurementType : undefined,
      signal: controller.signal,
    })
      .then((res) => {
        if (!ignore) {
          setSummary(res.data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!ignore && !controller.signal.aborted) {
          const msg = err instanceof Error ? err.message : 'Failed to load historical analytics.';
          setError(msg);
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [
    activeTimeRange,
    activeGardenId,
    activePlantId,
    activeSource,
    activeMeasurementType,
    refreshIndex,
  ]);

  const reloadAnalytics = () => {
    setLoading(true);
    setAiExplanation(null);
    setAiError(null);
    setRefreshIndex((prev) => prev + 1);
  };

  // Request AI Explanation
  const handleRequestAiExplanation = async () => {
    if (aiLoading) return;
    setAiLoading(true);
    setAiError(null);

    try {
      const res = await explainAnalytics({
        timeRange: activeTimeRange,
        gardenId: activeGardenId !== 'all' ? activeGardenId : undefined,
        plantId: activePlantId !== 'all' ? activePlantId : undefined,
        source: activeSource !== 'all' ? activeSource : undefined,
        measurementType: activeMeasurementType !== 'all' ? activeMeasurementType : undefined,
      });
      setAiExplanation(res.data.explanation);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI explanation could not be generated.';
      setAiError(msg);
    } finally {
      setAiLoading(false);
    }
  };

  // Update query params helper
  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'all' || !value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    // If garden changes, reset plant filter if it no longer belongs
    if (key === 'gardenId' && value !== 'all') {
      const currentPlant = plants.find((p) => p.id === activePlantId);
      if (currentPlant && currentPlant.gardenId !== value) {
        next.delete('plantId');
      }
    }
    setSearchParams(next, { replace: true });
  };

  // Prepare chart series from bounded chronological readings
  const chartData: ChartPoint[] = useMemo(() => {
    if (!summary || summary.readings.length === 0) return [];

    const points: ChartPoint[] = [];
    for (const r of summary.readings) {
      const d = new Date(r.recordedAt);
      const rawTimestamp = d.getTime();

      const timeLabel =
        activeTimeRange === '24h'
          ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : activeTimeRange === '7d'
            ? d.toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : d.toLocaleDateString([], { month: 'short', day: 'numeric' });

      points.push({
        rawTimestamp,
        timeLabel,
        [r.measurementType]: r.value,
        sources: { [r.measurementType]: r.source },
      });
    }

    return points;
  }, [summary, activeTimeRange]);

  if (loading && !summary) {
    return <FullPageLoader label="Analyzing cultivation telemetry and historical records..." />;
  }

  if (error && !summary) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <PageHeader
          title="Smart Insights & Analytics"
          description="Historical environmental trends, plant condition diagnostics, and crop intelligence."
        />
        <ErrorState
          title="Analytics data unavailable"
          message={error}
          action={
            <Button variant="secondary" size="sm" onClick={reloadAnalytics}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const supportedTypes: MeasurementType[] = [
    'air_temperature',
    'air_humidity',
    'medium_moisture',
  ];

  const visibleTypes =
    activeMeasurementType === 'all'
      ? supportedTypes
      : supportedTypes.filter((t) => t === activeMeasurementType);

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8">
      {/* Page Header */}
      <PageHeader
        title="Smart Insights & Analytics"
        description="Historical environmental trends, plant condition diagnostics, and crop intelligence."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={reloadAnalytics}
            className="flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {/* Filter Toolbar */}
      <Card className="border border-stone-200/80 bg-white/90 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm font-medium text-stone-700">
            <Filter className="h-4 w-4 text-emerald-700" />
            <span>Filters:</span>
          </div>

          {/* Time Range */}
          <div className="w-36">
            <select
              aria-label="Filter by time range"
              className="field-input py-1.5 text-sm"
              value={activeTimeRange}
              onChange={(e) => updateFilter('timeRange', e.target.value)}
            >
              <option value="24h">Past 24 Hours</option>
              <option value="7d">Past 7 Days</option>
              <option value="30d">Past 30 Days</option>
            </select>
          </div>

          {/* Garden Filter */}
          <div className="w-44">
            <select
              aria-label="Filter by garden"
              className="field-input py-1.5 text-sm"
              value={activeGardenId}
              onChange={(e) => updateFilter('gardenId', e.target.value)}
            >
              <option value="all">All Gardens</option>
              {gardens.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Plant Filter */}
          <div className="w-48">
            <select
              aria-label="Filter by plant"
              className="field-input py-1.5 text-sm"
              value={activePlantId}
              onChange={(e) => updateFilter('plantId', e.target.value)}
            >
              <option value="all">All Plants</option>
              {selectablePlants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.customName || p.catalog?.commonName || 'Plant'}
                </option>
              ))}
            </select>
          </div>

          {/* Measurement Type Filter */}
          <div className="w-44">
            <select
              aria-label="Filter by measurement metric"
              className="field-input py-1.5 text-sm"
              value={activeMeasurementType}
              onChange={(e) => updateFilter('measurementType', e.target.value)}
            >
              <option value="all">All Metrics</option>
              <option value="air_temperature">Temperature</option>
              <option value="air_humidity">Humidity</option>
              <option value="medium_moisture">Medium Moisture</option>
            </select>
          </div>

          {/* Source Filter */}
          <div className="w-40">
            <select
              aria-label="Filter by data provenance source"
              className="field-input py-1.5 text-sm"
              value={activeSource}
              onChange={(e) => updateFilter('source', e.target.value)}
            >
              <option value="all">All Sources</option>
              <option value="manual">Manual Entries</option>
              <option value="simulated">Simulated Demo</option>
              <option value="sensor">Physical Sensors</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Section 1: Period Environmental Stats Cards */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-stone-900">
            Environmental Summary ({activeTimeRange})
          </h2>
          <div className="flex items-center gap-2 text-xs text-stone-700">
            <Calendar className="h-3.5 w-3.5 text-stone-700" />
            <span>
              {summary
                ? `${formatDateTime(summary.period.from)} – ${formatDateTime(summary.period.to)}`
                : ''}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {visibleTypes.map((type) => {
            const stat: MeasurementStats | undefined = summary?.stats[type];
            const meta = METRIC_CONFIG[type];
            const Icon = meta.icon;

            const hasData = (stat?.count ?? 0) > 0;

            return (
              <Card key={type} className="border border-stone-200/80 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg bg-emerald-50 p-2 text-emerald-800">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-stone-700">
                        {meta.label}
                      </p>
                      <p className="text-2xl font-bold tracking-tight text-stone-900">
                        {hasData && stat?.avg != null
                          ? `${stat.avg.toFixed(1)}${meta.unit}`
                          : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Period delta indicator */}
                  {hasData && stat?.deltaAvg != null ? (
                    <div
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        stat.deltaAvg > 0
                          ? 'bg-amber-50 text-amber-800'
                          : stat.deltaAvg < 0
                            ? 'bg-sky-50 text-sky-800'
                            : 'bg-stone-100 text-stone-700'
                      }`}
                    >
                      {stat.deltaAvg > 0 ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : stat.deltaAvg < 0 ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : null}
                      <span>
                        {stat.deltaAvg > 0 ? `+${stat.deltaAvg}` : stat.deltaAvg}
                        {meta.unit} vs prior
                      </span>
                    </div>
                  ) : hasData ? (
                    <span className="text-[11px] text-stone-700">Prior data N/A</span>
                  ) : null}
                </div>

                {/* Sub-metrics: Min, Max, Reading count */}
                <div className="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-700">
                  {hasData && stat ? (
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <span className="text-stone-700">Min: </span>
                        <span className="font-semibold text-stone-900">
                          {stat.min != null ? `${stat.min}${meta.unit}` : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-stone-700">Max: </span>
                        <span className="font-semibold text-stone-900">
                          {stat.max != null ? `${stat.max}${meta.unit}` : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-stone-700">Readings: </span>
                        <span className="font-semibold text-stone-900">{stat.count}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="italic text-stone-700">No readings recorded in this timeframe.</p>
                  )}
                </div>

                {/* Provenance badges */}
                {hasData && stat && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                    <span className="text-stone-700">Sources:</span>
                    {stat.sourceBreakdown.manual > 0 && (
                      <span className="rounded bg-stone-100 px-1.5 py-0.5 font-medium text-stone-700">
                        {stat.sourceBreakdown.manual} manual
                      </span>
                    )}
                    {stat.sourceBreakdown.simulated > 0 && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">
                        {stat.sourceBreakdown.simulated} simulated
                      </span>
                    )}
                    {stat.sourceBreakdown.sensor > 0 && (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800">
                        {stat.sourceBreakdown.sensor} sensor
                      </span>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      {/* Section 2: Historical Trend Line Chart */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-stone-900">
              Historical Observation Trends
            </h2>
            <p className="text-xs text-stone-700">
              Bounded telemetry records in chronological order with units and observation provenance.
            </p>
          </div>
          {summary && summary.readings.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {summary.readings.length} data point{summary.readings.length === 1 ? '' : 's'}
            </Badge>
          )}
        </div>

        <Card className="border border-stone-200/80 bg-white p-5 shadow-sm">
          {chartData.length === 0 ? (
            <div className="py-12">
              <EmptyState
                icon={Activity}
                title="No telemetry in this period"
                description="There are no recorded readings matching your selected time window and filters. Add manual readings or run a simulation to see historical trends."
                action={
                  <Link to="/dashboard/monitoring">
                    <Button variant="secondary" size="sm">
                      Go to Monitoring
                    </Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0efe9" />
                  <XAxis
                    dataKey="timeLabel"
                    tick={{ fill: '#78716c', fontSize: 11 }}
                    tickLine={{ stroke: '#e7e5e4' }}
                  />
                  <YAxis
                    tick={{ fill: '#78716c', fontSize: 11 }}
                    tickLine={{ stroke: '#e7e5e4' }}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      return (
                        <div className="rounded-lg border border-stone-200 bg-white/95 p-3 shadow-md backdrop-blur">
                          <p className="mb-1.5 text-xs font-semibold text-stone-900">{label}</p>
                          <div className="space-y-1">
                            {payload.map((item) => {
                              const type = item.dataKey as MeasurementType;
                              const conf = METRIC_CONFIG[type];
                              if (!conf || item.value == null) return null;
                              return (
                                <div
                                  key={type}
                                  className="flex items-center justify-between gap-4 text-xs"
                                >
                                  <span className="font-medium" style={{ color: item.color }}>
                                    {conf.label}:
                                  </span>
                                  <span className="font-bold text-stone-800">
                                    {item.value}
                                    {conf.unit}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ paddingTop: 10, fontSize: 12 }} />

                  {visibleTypes.map((type) => {
                    const conf = METRIC_CONFIG[type];
                    return (
                      <Line
                        key={type}
                        type="monotone"
                        dataKey={type}
                        name={conf.label}
                        stroke={conf.strokeColor}
                        strokeWidth={2}
                        dot={{ r: 3, fill: conf.strokeColor }}
                        activeDot={{ r: 5 }}
                        connectNulls
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </section>

      {/* Section 3: Plant Condition Insights */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-stone-900">
            Plant Condition Diagnostics
          </h2>
          <p className="text-xs text-stone-700">
            Deterministic evaluations comparing verified observations against plant-specific
            reference ranges.
          </p>
        </div>

        {summary?.plantInsights && summary.plantInsights.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {summary.plantInsights.map((insight) => (
              <PlantConditionCard key={insight.id} insight={insight} />
            ))}
          </div>
        ) : (
          <Card className="border border-stone-200/80 bg-white p-6">
            <EmptyState
              icon={Compass}
              title="No plant condition evaluations"
              description="No active crops found for the selected filter. Add plants to your garden to receive plant-specific condition insights."
              action={
                <Link to="/dashboard/plants">
                  <Button variant="secondary" size="sm">
                    Manage Plants
                  </Button>
                </Link>
              }
            />
          </Card>
        )}
      </section>

      {/* Section 4: Smart Analytics Summary & AI Explanation */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-stone-900">
              Crop Analytics Synthesis
            </h2>
            <p className="text-xs text-stone-700">
              Factual synthesis of environmental metrics, condition alerts, and operational tasks.
            </p>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={handleRequestAiExplanation}
            disabled={aiLoading}
            className="flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {aiLoading ? 'Synthesizing...' : aiExplanation ? 'Re-explain with AI' : 'Explain with AI'}
          </Button>
        </div>

        <Card className="border border-stone-200/80 bg-white p-6 shadow-sm">
          {aiExplanation ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <div className="flex items-center gap-2">
                  <Badge variant="sage" className="flex items-center gap-1.5 text-xs">
                    <Sparkles className="h-3 w-3" />
                    AI Agricultural Explanation
                  </Badge>
                  <span className="text-xs text-stone-700">
                    Grounded strictly in computed telemetry &amp; task records
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAiExplanation(null)}
                  className="text-xs text-stone-700 hover:text-stone-700"
                >
                  View Deterministic Summary
                </Button>
              </div>

              <div className="prose-sm max-w-none text-stone-800 leading-relaxed space-y-3 whitespace-pre-line">
                {aiExplanation}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-stone-100 pb-3">
                <Badge variant="outline" className="text-xs">
                  Deterministic System Summary
                </Badge>
                <span className="text-xs text-stone-700">Rule-based factual compilation</span>
              </div>

              {aiError && (
                <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-800 border border-amber-200">
                  {aiError} Displaying deterministic compilation instead.
                </div>
              )}

              <div className="prose-sm max-w-none text-stone-800 leading-relaxed space-y-3 whitespace-pre-line">
                {summary?.deterministicSummary || 'No summary available.'}
              </div>
            </div>
          )}
        </Card>
      </section>

      {/* Section 5: Tasks & Activity Context */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-stone-900">
            Care Activity &amp; Journal Correlation
          </h2>
          <p className="text-xs text-stone-700">
            Operational care tasks and growth journal observations recorded for this timeframe.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Care Tasks Breakdown */}
          <Card className="border border-stone-200/80 bg-white p-5 shadow-sm">
            <CardHeader className="p-0 pb-3">
              <CardTitle className="text-sm font-semibold text-stone-900">
                Care Schedule Status
              </CardTitle>
            </CardHeader>
            <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
              <div className="rounded-lg bg-stone-50 p-3 border border-stone-100">
                <p className="text-2xl font-bold text-red-600">
                  {summary?.taskSummary.overdueCount ?? 0}
                </p>
                <p className="text-xs text-stone-700">Overdue</p>
              </div>
              <div className="rounded-lg bg-stone-50 p-3 border border-stone-100">
                <p className="text-2xl font-bold text-amber-600">
                  {summary?.taskSummary.dueTodayCount ?? 0}
                </p>
                <p className="text-xs text-stone-700">Due Today</p>
              </div>
              <div className="rounded-lg bg-stone-50 p-3 border border-stone-100">
                <p className="text-2xl font-bold text-sky-600">
                  {summary?.taskSummary.upcomingCount ?? 0}
                </p>
                <p className="text-xs text-stone-700">Upcoming</p>
              </div>
              <div className="rounded-lg bg-stone-50 p-3 border border-stone-100">
                <p className="text-2xl font-bold text-emerald-600">
                  {summary?.taskSummary.completedCount ?? 0}
                </p>
                <p className="text-xs text-stone-700">Completed</p>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Link to="/dashboard/tasks">
                <Button variant="secondary" size="sm" className="text-xs">
                  Manage Care Tasks
                </Button>
              </Link>
            </div>
          </Card>

          {/* Growth Log Activity */}
          <Card className="border border-stone-200/80 bg-white p-5 shadow-sm">
            <CardHeader className="p-0 pb-3">
              <CardTitle className="text-sm font-semibold text-stone-900">
                Recent Journal Notes ({summary?.recentLogs.length ?? 0})
              </CardTitle>
            </CardHeader>
            {summary?.recentLogs && summary.recentLogs.length > 0 ? (
              <div className="max-h-44 space-y-2.5 overflow-y-auto pr-1">
                {summary.recentLogs.slice(0, 5).map((log) => (
                  <div
                    key={log.id}
                    className="rounded-lg border border-stone-100 bg-stone-50/70 p-2.5 text-xs text-stone-700"
                  >
                    <div className="flex items-center justify-between font-medium text-stone-800">
                      <span className="capitalize">{log.logType} Note</span>
                      <span className="text-[11px] text-stone-700">
                        {formatDateTime(log.loggedAt)}
                      </span>
                    </div>
                    {log.title && <p className="mt-0.5 font-semibold text-stone-900">{log.title}</p>}
                    <p className="mt-1 line-clamp-2 text-stone-700">{log.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-stone-700">
                No growth journal entries logged during this period.
              </div>
            )}
          </Card>
        </div>

        {/* Causal Disclaimer */}
        <div className="rounded-lg border border-stone-200 bg-stone-50/80 p-3 text-xs text-stone-700">
          <p className="flex items-center gap-1.5 font-medium text-stone-700">
            <Info className="h-4 w-4 shrink-0" />
            <span>Operational Telemetry Notice</span>
          </p>
          <p className="mt-1">
            Environmental metrics and task completions are shown for operational tracking and
            routine management. They do not demonstrate direct causation without controlled
            agricultural conditions.
          </p>
        </div>
      </section>
    </div>
  );
}

/**
 * PlantConditionCard: Renders one plant condition insight card with explainable state
 */
function PlantConditionCard({ insight }: { insight: PlantConditionInsight }) {
  const meta = METRIC_CONFIG[insight.measurementType];
  const Icon = meta.icon;

  const stateBadges: Record<
    PlantConditionState,
    { label: string; className: string; icon: typeof CheckCircle2 }
  > = {
    optimal: {
      label: 'Optimal Range',
      className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      icon: CheckCircle2,
    },
    low: {
      label: 'Below Target',
      className: 'bg-amber-50 text-amber-800 border-amber-200',
      icon: ArrowDown,
    },
    high: {
      label: 'Above Target',
      className: 'bg-amber-50 text-amber-800 border-amber-200',
      icon: ArrowUp,
    },
    stale_data: {
      label: 'Stale Telemetry',
      className: 'bg-stone-100 text-stone-700 border-stone-200',
      icon: Clock,
    },
    insufficient_data: {
      label: 'No Data',
      className: 'bg-stone-100 text-stone-700 border-stone-200',
      icon: HelpCircle,
    },
    unconfigured_range: {
      label: 'No Range Set',
      className: 'bg-stone-100 text-stone-700 border-stone-200',
      icon: Info,
    },
  };

  const badgeConfig = stateBadges[insight.state] ?? stateBadges.unconfigured_range;
  const StateIcon = badgeConfig.icon;

  return (
    <Card className="flex flex-col justify-between border border-stone-200/80 bg-white p-4 shadow-sm">
      <div className="space-y-3">
        {/* Header: Plant name, measurement type, and state badge */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <Link
              to={`/dashboard/plants/${insight.plantId}`}
              className="text-sm font-semibold text-stone-900 hover:text-emerald-700 hover:underline"
            >
              {insight.plantName}
            </Link>
            <div className="flex items-center gap-1.5 text-xs text-stone-700">
              <Icon className="h-3.5 w-3.5" />
              <span>{meta.label}</span>
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badgeConfig.className}`}
          >
            <StateIcon className="h-3 w-3" />
            {badgeConfig.label}
          </span>
        </div>

        {/* Observed Value & Target Range */}
        <div className="rounded-lg bg-stone-50 p-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-stone-700">Observed:</span>
            <span className="font-semibold text-stone-900">
              {insight.observedValue != null
                ? `${insight.observedValue}${insight.unit}`
                : 'No reading'}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-stone-200/60 pt-1">
            <span className="text-stone-700">Reference:</span>
            <span className="font-medium text-stone-700">
              {insight.referenceRange
                ? `${insight.referenceRange.min}–${insight.referenceRange.max}${insight.unit}`
                : 'Not configured'}
            </span>
          </div>
        </div>

        {/* Explainable Reason */}
        <p className="text-xs text-stone-700 leading-relaxed">{insight.reason}</p>

        {/* Profile Origin & Confidence */}
        {insight.isCustomResearched && (
          <div className="flex items-center gap-1 text-[11px] text-stone-700">
            <Sparkles className="h-3 w-3 text-emerald-600" />
            <span>AI Cultivation Profile ({insight.confidence ?? 'moderate'} confidence)</span>
          </div>
        )}

        {/* Observation Provenance & Timestamp */}
        {insight.source && insight.recordedAt && (
          <div className="flex items-center justify-between text-[11px] text-stone-700">
            <DataSourceBadge source={insight.source} />
            <span>{formatDateTime(insight.recordedAt)}</span>
          </div>
        )}
      </div>

      {/* Action link */}
      <div className="mt-4 border-t border-stone-100 pt-3">
        <Link to={insight.actionLink}>
          <Button variant="secondary" size="sm" className="w-full text-xs">
            {insight.actionLabel}
          </Button>
        </Link>
      </div>
    </Card>
  );
}
