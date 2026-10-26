import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Droplets,
  Filter,
  Info,
  Plus,
  RefreshCw,
  Sparkles,
  Thermometer,
  Wind,
  X,
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
  MEASUREMENTS,
  formatDateTime,
  formatMeasurementValue,
  toLocalDateTimeInputValue,
  type MeasurementType,
  type ReadingSource,
  type SensorReadingWithDetails,
} from '@growspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { DataSourceBadge } from '@/components/ui/data-source-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { FullPageLoader } from '@/components/ui/loading';
import { PageHeader } from '@/components/ui/page-header';
import {
  ApiClientError,
  createSensorReading,
  fetchPlants,
  fetchSensorReadings,
  generateSimulatedReadings,
  type PlantWithDetails,
} from '@/lib/api';

const METRIC_CONFIG: Record<
  MeasurementType,
  {
    icon: typeof Thermometer;
    color: string;
    strokeColor: string;
    label: string;
    unit: string;
  }
> = {
  air_temperature: {
    icon: Thermometer,
    color: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
    strokeColor: '#d97706',
    label: 'Air temperature',
    unit: '°C',
  },
  air_humidity: {
    icon: Wind,
    color: 'text-sky-600 bg-sky-500/10 border-sky-500/20',
    strokeColor: '#0284c7',
    label: 'Air humidity',
    unit: '%',
  },
  medium_moisture: {
    icon: Droplets,
    color: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/20',
    strokeColor: '#059669',
    label: 'Media moisture',
    unit: '%',
  },
};

type TimeRangeOption = '24h' | '7d' | '30d' | 'all';

interface ChartPoint {
  timestamp: string;
  rawDate: number;
  timeLabel: string;
  air_temperature?: number;
  air_humidity?: number;
  medium_moisture?: number;
  sources: Record<string, ReadingSource>;
}

export function MonitoringPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPlantParam = searchParams.get('plantId')?.trim() || '';

  // Plants
  const [plants, setPlants] = useState<PlantWithDetails[]>([]);
  const [loadingPlants, setLoadingPlants] = useState(true);

  // Filters
  const [plantId, setPlantId] = useState(selectedPlantParam);
  const [timeRange, setTimeRange] = useState<TimeRangeOption>('7d');
  const [metricFilter, setMetricFilter] = useState<'all' | MeasurementType>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | ReadingSource>('all');

  // Readings Data
  const [readings, setReadings] = useState<SensorReadingWithDetails[]>([]);
  const [latestReadings, setLatestReadings] = useState<
    Record<MeasurementType, SensorReadingWithDetails | null>
  >({
    air_temperature: null,
    air_humidity: null,
    medium_moisture: null,
  });
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Add Reading Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [formPlantId, setFormPlantId] = useState('');
  const [formMeasurementType, setFormMeasurementType] =
    useState<MeasurementType>('air_temperature');
  const [formValue, setFormValue] = useState('');
  const [formRecordedAt, setFormRecordedAt] = useState(() => toLocalDateTimeInputValue());
  const [formNote, setFormNote] = useState('');
  const [submittingReading, setSubmittingReading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string[]>>({});

  // Simulation Modal State
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simulatePlantId, setSimulatePlantId] = useState('');
  const [simulateError, setSimulateError] = useState<string | null>(null);

  // Load plants on mount
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    fetchPlants({ signal: controller.signal })
      .then((res) => {
        if (!isMounted) return;
        setPlants(res.plants);
        if (res.plants.length > 0 && res.plants[0]) {
          const firstId = res.plants[0].id;
          setFormPlantId((prev) => prev || firstId);
          setSimulatePlantId((prev) => prev || firstId);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load plants.');
      })
      .finally(() => {
        if (isMounted) setLoadingPlants(false);
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  // Fetch readings when filters or refreshIndex change
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    let from: string | undefined;
    const now = Date.now();
    if (timeRange === '24h') {
      from = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    } else if (timeRange === '7d') {
      from = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (timeRange === '30d') {
      from = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    const measurementTypeParam = metricFilter !== 'all' ? metricFilter : undefined;
    const sourceParam = sourceFilter !== 'all' ? sourceFilter : undefined;
    const plantParam = plantId || undefined;

    fetchSensorReadings({
      plantId: plantParam,
      measurementType: measurementTypeParam,
      source: sourceParam,
      from,
      limit: 200,
      signal: controller.signal,
    })
      .then((res) => {
        if (!isMounted) return;
        setReadings(res.readings);
        // Compute latest readings from loaded dataset or query
        const latestMap: Record<MeasurementType, SensorReadingWithDetails | null> = {
          air_temperature: null,
          air_humidity: null,
          medium_moisture: null,
        };
        for (const r of res.readings) {
          if (!latestMap[r.measurementType]) {
            latestMap[r.measurementType] = r;
          }
        }
        setLatestReadings(latestMap);
        setLoadError(null);
      })
      .catch((err) => {
        if (!isMounted || controller.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load sensor readings.');
      })
      .finally(() => {
        if (isMounted) {
          setLoadingData(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [plantId, timeRange, metricFilter, sourceFilter, refreshIndex]);

  const reloadReadings = () => {
    setLoadingData(true);
    setRefreshIndex((prev) => prev + 1);
  };

  const handlePlantFilterChange = (newPlantId: string) => {
    setPlantId(newPlantId);
    if (newPlantId) {
      setSearchParams({ plantId: newPlantId });
    } else {
      setSearchParams({});
    }
  };

  const handleCreateReading = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormFieldErrors({});

    const targetPlant = plants.find((p) => p.id === formPlantId);
    if (!targetPlant) {
      setFormFieldErrors({ plantId: ['Please select an owned plant.'] });
      return;
    }

    const num = Number.parseFloat(formValue);
    if (Number.isNaN(num)) {
      setFormFieldErrors({ value: ['Enter a valid numeric value.'] });
      return;
    }

    const meta = MEASUREMENTS[formMeasurementType];
    if (num < meta.plausibleMin || num > meta.plausibleMax) {
      setFormFieldErrors({
        value: [`Value must be between ${meta.plausibleMin} and ${meta.plausibleMax} ${meta.unit}.`],
      });
      return;
    }

    setSubmittingReading(true);

    try {
      const iso = formRecordedAt ? new Date(formRecordedAt).toISOString() : new Date().toISOString();
      await createSensorReading({
        gardenId: targetPlant.gardenId,
        plantId: targetPlant.id,
        measurementType: formMeasurementType,
        value: num,
        unit: meta.unit,
        source: 'manual',
        recordedAt: iso,
        note: formNote.trim() || null,
      });

      setShowAddModal(false);
      setFormValue('');
      setFormNote('');
      setFormRecordedAt(toLocalDateTimeInputValue());
      setSuccessBanner(`Manual reading for ${meta.label.toLowerCase()} successfully recorded!`);
      setTimeout(() => setSuccessBanner(null), 5000);
      reloadReadings();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message);
        if (err.fieldErrors) {
          setFormFieldErrors(err.fieldErrors);
        }
      } else {
        setFormError('Failed to record reading. Please check connection and try again.');
      }
    } finally {
      setSubmittingReading(false);
    }
  };

  const handleGenerateSimulated = async () => {
    setSimulateError(null);
    const targetPlant = plants.find((p) => p.id === simulatePlantId);
    if (!targetPlant) {
      setSimulateError('Please choose a valid plant to seed simulated telemetry.');
      return;
    }

    setSimulating(true);

    try {
      const res = await generateSimulatedReadings({
        plantId: targetPlant.id,
        gardenId: targetPlant.gardenId,
      });

      setShowSimulateModal(false);
      setSuccessBanner(
        `Generated ${res.count} demonstration readings labeled permanently as SIMULATED / DATA DEMO.`,
      );
      setTimeout(() => setSuccessBanner(null), 6000);
      reloadReadings();
    } catch (err) {
      setSimulateError(
        err instanceof ApiClientError ? err.message : 'Failed to generate simulated readings.',
      );
    } finally {
      setSimulating(false);
    }
  };

  // Prepare chart series points grouped by approximate time
  const chartData = useMemo(() => {
    if (readings.length === 0) return [];

    // Chronological order for chart
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
        rawDate: date.getTime(),
        timeLabel,
        [r.measurementType]: r.value,
        sources: { [r.measurementType]: r.source },
      });
    }

    return points;
  }, [readings]);

  // Period summary metrics: Min, Max, Avg, Count for the selected window
  const periodStats = useMemo(() => {
    const stats: Record<
      MeasurementType,
      { count: number; min: number; max: number; avg: number; latest: SensorReadingWithDetails | null } | null
    > = {
      air_temperature: null,
      air_humidity: null,
      medium_moisture: null,
    };

    for (const type of ['air_temperature', 'air_humidity', 'medium_moisture'] as MeasurementType[]) {
      const typeReadings = readings.filter((r) => r.measurementType === type);
      if (typeReadings.length === 0) continue;
      const values = typeReadings.map((r) => r.value);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const sum = values.reduce((acc, v) => acc + v, 0);
      const avg = Number((sum / values.length).toFixed(1));
      stats[type] = {
        count: values.length,
        min,
        max,
        avg,
        latest: latestReadings[type] ?? null,
      };
    }

    return stats;
  }, [readings, latestReadings]);

  if (loadingPlants) {
    return <FullPageLoader label="Loading monitoring environment..." />;
  }

  const selectedFormMeta = MEASUREMENTS[formMeasurementType];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Monitoring"
        title="Readings & Environmental Telemetry"
        description="Track real-time observations and historical trends. Every reading carries a strict source classification, unit, and timestamp."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/dashboard/analytics">
              <Button
                variant="secondary"
                className="flex items-center gap-1.5 border-forest/30 text-forest bg-forest/5 hover:bg-forest/10"
              >
                <Sparkles className="h-4 w-4 text-forest" aria-hidden="true" />
                Smart Insights &amp; Analytics
              </Button>
            </Link>
            <Button
              variant="secondary"
              onClick={() => setShowSimulateModal(true)}
              disabled={plants.length === 0}
              className="border-warning/40 text-amber-900 bg-warning/10 hover:bg-warning/20"
            >
              <Sparkles className="h-4 w-4 text-warning" aria-hidden="true" />
              Generate Demo Data
            </Button>
            <Button
              variant="primary"
              onClick={() => setShowAddModal(true)}
              disabled={plants.length === 0}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add reading
            </Button>
          </div>
        }
      />

      {successBanner ? (
        <div className="flex items-center justify-between rounded-card border border-success/30 bg-success-surface/50 p-4 text-sm font-medium text-success">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{successBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessBanner(null)}
            className="text-muted hover:text-ink"
            aria-label="Dismiss banner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* Latest Readings Summary Cards */}
      <section aria-labelledby="latest-metrics-heading">
        <h2 id="latest-metrics-heading" className="sr-only">
          Latest environmental measurements
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {(['air_temperature', 'air_humidity', 'medium_moisture'] as MeasurementType[]).map(
            (type) => {
              const cfg = METRIC_CONFIG[type];
              const reading = latestReadings[type];
              const Icon = cfg.icon;

              return (
                <Card key={type} className="p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-muted">{cfg.label}</span>
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-control border ${cfg.color}`}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                    </div>

                    <div className="mt-3 flex items-baseline gap-2">
                      <span className="text-3xl font-semibold tabular-nums text-forest">
                        {reading ? formatMeasurementValue(type, reading.value, reading.unit) : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2 text-xs">
                    {reading ? (
                      <>
                        <span className="text-muted flex items-center gap-1">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          {formatDateTime(reading.recordedAt)}
                        </span>
                        <DataSourceBadge source={reading.source} />
                      </>
                    ) : (
                      <span className="text-muted italic">No measurements recorded yet</span>
                    )}
                  </div>
                </Card>
              );
            },
          )}
        </div>

        {/* Telemetry Schema notice regarding light intensity */}
        <div className="mt-3 flex items-center gap-2 text-xs text-muted">
          <Info className="h-3.5 w-3.5 text-muted shrink-0" aria-hidden="true" />
          <span>
            Supported telemetry metrics: Air Temperature (°C), Air Humidity (%), and Media Moisture (%). Light intensity telemetry is reserved and not currently in the database schema.
          </span>
        </div>
      </section>

      {/* Filters Bar */}
      <Card className="p-4 bg-surface">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted uppercase tracking-wider">
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            Filters:
          </div>

          <div className="w-full sm:w-auto min-w-44">
            <select
              aria-label="Filter by plant"
              className="field-input py-1.5 text-sm"
              value={plantId}
              onChange={(e) => handlePlantFilterChange(e.target.value)}
            >
              <option value="">All Plants</option>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.customName || p.catalog?.commonName || 'Unnamed Plant'}
                  {p.gardenName ? ` (${p.gardenName})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-auto">
            <select
              aria-label="Filter by metric"
              className="field-input py-1.5 text-sm"
              value={metricFilter}
              onChange={(e) => setMetricFilter(e.target.value as 'all' | MeasurementType)}
            >
              <option value="all">All Metrics</option>
              <option value="air_temperature">Air Temperature (°C)</option>
              <option value="air_humidity">Air Humidity (%)</option>
              <option value="medium_moisture">Media Moisture (%)</option>
            </select>
          </div>

          <div className="w-full sm:w-auto">
            <select
              aria-label="Filter by source provenance"
              className="field-input py-1.5 text-sm"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as 'all' | ReadingSource)}
            >
              <option value="all">All Sources</option>
              <option value="manual">Manual entries only</option>
              <option value="simulated">Simulated demo only</option>
            </select>
          </div>

          <div className="flex items-center gap-1 ml-auto">
            {(['24h', '7d', '30d', 'all'] as TimeRangeOption[]).map((range) => {
              const labels: Record<TimeRangeOption, string> = {
                '24h': '24h',
                '7d': '7 days',
                '30d': '30 days',
                all: 'All',
              };
              return (
                <button
                  key={range}
                  type="button"
                  onClick={() => setTimeRange(range)}
                  className={`rounded-control px-2.5 py-1 text-xs font-medium transition ${
                    timeRange === range
                      ? 'bg-forest text-page font-semibold'
                      : 'bg-page text-muted hover:text-ink'
                  }`}
                >
                  {labels[range]}
                </button>
              );
            })}

            <button
              type="button"
              onClick={reloadReadings}
              className="p-1.5 text-muted hover:text-forest transition rounded-control hover:bg-page"
              title="Refresh readings"
              aria-label="Refresh readings"
            >
              <RefreshCw className={`h-4 w-4 ${loadingData ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </Card>

      {/* Main Content: Chart or Empty/Error State */}
      {loadError ? (
        <ErrorState
          title="Could not load environmental readings"
          message={loadError}
          action={
            <Button variant="secondary" size="sm" onClick={() => reloadReadings()}>
              Retry
            </Button>
          }
        />
      ) : loadingData ? (
        <Card className="p-12 text-center">
          <RefreshCw className="h-6 w-6 animate-spin mx-auto text-sage" aria-hidden="true" />
          <p className="mt-3 text-sm text-muted">Retrieving environmental telemetry...</p>
        </Card>
      ) : readings.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            icon={Activity}
            title="No readings found"
            description={
              plantId
                ? 'No readings exist for this plant matching your selected filters. Record a manual reading or generate simulated data for demonstration.'
                : 'No sensor readings match your current filters. Add a manual observation or generate demo telemetry.'
            }
            action={
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button variant="primary" onClick={() => setShowAddModal(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Record manual reading
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowSimulateModal(true)}
                  className="border-warning/40 text-amber-900 bg-warning/10 hover:bg-warning/20"
                >
                  <Sparkles className="h-4 w-4 text-warning" aria-hidden="true" />
                  Generate demo readings
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Interactive Trend Chart */}
          <Card className="p-5 sm:p-6">
            <CardHeader className="px-0 pt-0 pb-4">
              <div>
                <CardTitle>Historical telemetry chart</CardTitle>
                <p className="mt-1 text-sm text-muted">
                  Time-series measurements across temperature, humidity, and soil moisture.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {readings.length} {readings.length === 1 ? 'record' : 'records'}
                </Badge>
              </div>
            </CardHeader>

            {/* Period Summary Bar */}
            <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {(['air_temperature', 'air_humidity', 'medium_moisture'] as MeasurementType[]).map((type) => {
                const s = periodStats[type];
                const cfg = METRIC_CONFIG[type];
                const Icon = cfg.icon;
                if (!s) return null;
                return (
                  <div
                    key={type}
                    className="flex items-center justify-between rounded-control border border-line bg-page/50 p-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <div className={`rounded p-1 ${cfg.color}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className="font-medium text-ink">{cfg.label}</span>
                    </div>
                    <div className="flex items-center gap-3 tabular-nums text-muted">
                      <span>Avg: <strong className="text-ink">{s.avg}{cfg.unit}</strong></span>
                      <span>Min: <strong className="text-ink">{s.min}</strong></span>
                      <span>Max: <strong className="text-ink">{s.max}</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="h-72 w-full mt-2" role="region" aria-label="Sensor Readings Time Chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis
                    dataKey="timeLabel"
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    stroke="#9ca3af"
                  />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#9ca3af" />
                  <Tooltip
                    content={({ active, payload }) => {
                      const first = payload?.[0];
                      if (!active || !first) return null;
                      const dataPoint = first.payload as ChartPoint;
                      return (
                        <div className="rounded-control border border-line bg-surface p-3 shadow-card text-xs">
                          <p className="font-semibold text-ink">{dataPoint.timeLabel}</p>
                          <div className="mt-2 space-y-1.5">
                            {payload.map((entry) => {
                              const key = entry.dataKey as MeasurementType;
                              const cfg = METRIC_CONFIG[key];
                              if (!cfg || entry.value === undefined) return null;
                              const source = dataPoint.sources?.[key] || 'manual';
                              return (
                                <div key={key} className="flex items-center justify-between gap-4">
                                  <span className="flex items-center gap-1.5 font-medium text-ink">
                                    <span
                                      className="h-2 w-2 rounded-full"
                                      style={{ backgroundColor: cfg.strokeColor }}
                                      aria-hidden="true"
                                    />
                                    {cfg.label}:
                                  </span>
                                  <span className="tabular-nums font-semibold text-forest">
                                    {entry.value}
                                    {cfg.unit}
                                  </span>
                                  <DataSourceBadge source={source} />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                  {(metricFilter === 'all' || metricFilter === 'air_temperature') && (
                    <Line
                      type="monotone"
                      dataKey="air_temperature"
                      name="Temperature (°C)"
                      stroke={METRIC_CONFIG.air_temperature.strokeColor}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  )}
                  {(metricFilter === 'all' || metricFilter === 'air_humidity') && (
                    <Line
                      type="monotone"
                      dataKey="air_humidity"
                      name="Air Humidity (%)"
                      stroke={METRIC_CONFIG.air_humidity.strokeColor}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  )}
                  {(metricFilter === 'all' || metricFilter === 'medium_moisture') && (
                    <Line
                      type="monotone"
                      dataKey="medium_moisture"
                      name="Media Moisture (%)"
                      stroke={METRIC_CONFIG.medium_moisture.strokeColor}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <p className="mt-3 text-xs text-muted text-right">
              * Missing values are preserved as null and never coerced to zero.
            </p>
          </Card>

          {/* Detailed Observations Log Table */}
          <Card className="overflow-hidden">
            <CardHeader className="p-5 border-b border-line">
              <CardTitle>Observation log</CardTitle>
              <p className="mt-1 text-sm text-muted">
                Audit trail of all recorded readings with provenance tags.
              </p>
            </CardHeader>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" aria-label="Detailed sensor readings table">
                <thead className="bg-page text-xs uppercase text-muted tracking-wider border-b border-line">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Recorded At
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Plant / Garden
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Metric
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Value
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Provenance
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Notes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {readings.map((r) => {
                    const cfg = METRIC_CONFIG[r.measurementType];
                    const Icon = cfg.icon;

                    return (
                      <tr key={r.id} className="hover:bg-page/40 transition">
                        <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">
                          {formatDateTime(r.recordedAt)}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {r.plantName ? (
                            <span className="font-medium text-ink">{r.plantName}</span>
                          ) : (
                            <span className="italic">Garden-wide</span>
                          )}
                          {r.gardenName ? (
                            <span className="block text-xs text-muted">{r.gardenName}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                            <Icon className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold tabular-nums text-forest whitespace-nowrap">
                          {formatMeasurementValue(r.measurementType, r.value, r.unit)}
                        </td>
                        <td className="px-4 py-3">
                          <DataSourceBadge source={r.source} />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted max-w-xs truncate">
                          {r.note || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Record Manual Reading Modal */}
      {showAddModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-reading-modal-title"
        >
          <div className="w-full max-w-lg rounded-card bg-surface p-6 shadow-float border border-line">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <h2 id="add-reading-modal-title" className="text-lg font-semibold text-forest">
                Record Manual Observation
              </h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-muted hover:text-ink p-1 rounded-control"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError ? (
              <div className="mt-4 flex items-center gap-2 rounded-card border border-critical/30 bg-critical-surface/40 p-3 text-xs font-medium text-critical">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {formError}
              </div>
            ) : null}

            <form onSubmit={handleCreateReading} className="mt-4 space-y-4" noValidate>
              <SelectField
                label="Target Plant"
                value={formPlantId}
                onChange={(e) => setFormPlantId(e.target.value)}
                error={formFieldErrors.plantId?.[0]}
              >
                {plants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.customName || p.catalog?.commonName || 'Unnamed Plant'}
                    {p.gardenName ? ` (${p.gardenName})` : ''}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Measurement Metric"
                value={formMeasurementType}
                onChange={(e) => {
                  setFormMeasurementType(e.target.value as MeasurementType);
                  setFormValue('');
                }}
                error={formFieldErrors.measurementType?.[0]}
              >
                <option value="air_temperature">Air Temperature (°C)</option>
                <option value="air_humidity">Air Humidity (%)</option>
                <option value="medium_moisture">Growing Media Moisture (%)</option>
              </SelectField>

              <TextField
                label={`Observed Value (${selectedFormMeta.unit})`}
                type="number"
                step="any"
                placeholder={`e.g. ${formMeasurementType === 'air_temperature' ? '23.5' : '65'}`}
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                error={formFieldErrors.value?.[0]}
                hint={`Plausible range: ${selectedFormMeta.plausibleMin} to ${selectedFormMeta.plausibleMax} ${selectedFormMeta.unit}`}
                required
              />

              <TextField
                label="Timestamp"
                type="datetime-local"
                value={formRecordedAt}
                onChange={(e) => setFormRecordedAt(e.target.value)}
                error={formFieldErrors.recordedAt?.[0]}
              />

              <TextAreaField
                label="Observation Note"
                placeholder="Optional context about weather or soil moisture."
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                error={formFieldErrors.note?.[0]}
                optional
                rows={2}
              />

              <div className="pt-3 border-t border-line flex items-center justify-end gap-3">
                <Button type="button" variant="ghost" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={submittingReading}>
                  {submittingReading ? 'Saving...' : 'Save Manual Reading'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Simulated Demo Generation Confirmation Modal */}
      {showSimulateModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="simulate-modal-title"
        >
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-float border border-line">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-warning" aria-hidden="true" />
                <h2 id="simulate-modal-title" className="text-base font-semibold text-forest">
                  Generate Demonstration Telemetry
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowSimulateModal(false)}
                className="text-muted hover:text-ink p-1 rounded-control"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 rounded-control border border-warning/40 bg-warning/10 p-3 text-xs text-amber-900 leading-relaxed">
              <strong className="font-semibold block mb-1">PROVENANCE NOTICE:</strong>
              Generated values will be permanently labeled as{' '}
              <Badge variant="warning" className="mx-1">
                SIMULATED / DATA DEMO
              </Badge>
              . GrowSpace strictly distinguishes demo telemetry from manual measurements.
            </div>

            {simulateError ? (
              <div className="mt-3 text-xs font-medium text-critical">{simulateError}</div>
            ) : null}

            <div className="mt-4 space-y-4">
              <SelectField
                label="Target Plant"
                value={simulatePlantId}
                onChange={(e) => setSimulatePlantId(e.target.value)}
              >
                {plants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.customName || p.catalog?.commonName || 'Unnamed Plant'}
                    {p.gardenName ? ` (${p.gardenName})` : ''}
                  </option>
                ))}
              </SelectField>

              <p className="text-xs text-muted">
                This will generate realistic readings across temperature, humidity, and soil moisture over the past 24 hours.
              </p>

              <div className="pt-3 border-t border-line flex items-center justify-end gap-3">
                <Button type="button" variant="ghost" onClick={() => setShowSimulateModal(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleGenerateSimulated}
                  disabled={simulating}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {simulating ? 'Generating...' : 'Confirm & Generate Demo Data'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
