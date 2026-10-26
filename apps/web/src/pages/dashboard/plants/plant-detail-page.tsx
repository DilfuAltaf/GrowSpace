import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  Droplets,
  Edit2,
  ExternalLink,
  Leaf,
  ListChecks,
  MapPin,
  Plus,
  Sparkles,
  Sun,
  Thermometer,
  Trash2,
  Wind,
  X,
} from 'lucide-react';
import {
  LOG_TYPES,
  MEASUREMENTS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  type GrowthStage,
  type LogType,
  type MeasurementType,
  type PlantLog,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from '@growspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { FullPageLoader } from '@/components/ui/loading';
import { PageHeader } from '@/components/ui/page-header';
import {
  ApiClientError,
  createPlantLog,
  deletePlant,
  deletePlantLog,
  fetchPlant,
  fetchPlantLogs,
  fetchTasks,
  updateTask,
  type CareTaskWithDetails,
  type PlantWithDetails,
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

const LOG_TYPE_VARIANTS: Record<LogType, 'neutral' | 'sage' | 'success' | 'warning' | 'info'> = {
  growth: 'sage',
  care: 'info',
  harvest: 'success',
  note: 'neutral',
};

const TASK_TYPE_VARIANTS: Record<TaskType, 'neutral' | 'sage' | 'success' | 'warning' | 'info'> = {
  watering: 'info',
  fertilizing: 'warning',
  pruning: 'sage',
  inspect: 'sage',
  harvest: 'success',
  other: 'neutral',
};

const PRIORITY_VARIANTS: Record<TaskPriority, 'neutral' | 'sage' | 'warning' | 'critical'> = {
  low: 'neutral',
  normal: 'sage',
  high: 'critical',
};

const measurementIcons: Record<MeasurementType, typeof Sun> = {
  air_temperature: Thermometer,
  air_humidity: Wind,
  medium_moisture: Droplets,
};

export function PlantDetailDashboardPage() {
  const { plantId } = useParams<{ plantId: string }>();
  const navigate = useNavigate();

  const [plant, setPlant] = useState<PlantWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Plant Growth Logs state
  const [logs, setLogs] = useState<PlantLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [showAddLog, setShowAddLog] = useState(false);
  const [newLogType, setNewLogType] = useState<LogType>('growth');
  const [newLogTitle, setNewLogTitle] = useState('');
  const [newLogContent, setNewLogContent] = useState('');
  const [newLogLoggedAt, setNewLogLoggedAt] = useState('');
  const [submittingLog, setSubmittingLog] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logFieldErrors, setLogFieldErrors] = useState<Record<string, string[]>>({});
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);

  // Plant Care Tasks state
  const [tasks, setTasks] = useState<CareTaskWithDetails[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  // Plant deletion state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!plantId) return;

    let isMounted = true;
    const controller = new AbortController();

    // Fetch plant details
    fetchPlant(plantId, controller.signal)
      .then((res) => {
        if (isMounted) {
          setPlant(res.plant);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted && !controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : 'Could not load plant details. Please try again.',
          );
          setLoading(false);
        }
      });

    // Fetch plant growth logs
    fetchPlantLogs(plantId, controller.signal)
      .then((res) => {
        if (isMounted) {
          setLogs(res.logs);
          setLoadingLogs(false);
        }
      })
      .catch(() => {
        if (isMounted && !controller.signal.aborted) {
          setLoadingLogs(false);
        }
      });

    // Fetch tasks associated with this plant
    fetchTasks({ plantId, signal: controller.signal })
      .then((res) => {
        if (isMounted) {
          setTasks(res.tasks);
          setLoadingTasks(false);
        }
      })
      .catch(() => {
        if (isMounted && !controller.signal.aborted) {
          setLoadingTasks(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [plantId]);

  const handleDelete = async () => {
    if (!plant) return;
    try {
      setDeleting(true);
      setDeleteError(null);
      await deletePlant(plant.id);
      navigate(plant.gardenId ? `/dashboard/gardens/${plant.gardenId}` : '/dashboard/plants');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to remove plant. Please try again.';
      setDeleteError(message);
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateLog = async (e: FormEvent) => {
    e.preventDefault();
    if (!plant) return;

    setLogError(null);
    setLogFieldErrors({});

    const trimmedContent = newLogContent.trim();
    if (!trimmedContent) {
      setLogFieldErrors({ content: ['Log content is required'] });
      return;
    }

    let isoLoggedAt: string | null = null;
    if (newLogLoggedAt.trim()) {
      try {
        const parsed = new Date(newLogLoggedAt);
        if (Number.isNaN(parsed.getTime())) {
          setLogFieldErrors({ loggedAt: ['Invalid date format'] });
          return;
        }
        isoLoggedAt = parsed.toISOString();
      } catch {
        setLogFieldErrors({ loggedAt: ['Invalid date format'] });
        return;
      }
    }

    setSubmittingLog(true);
    try {
      const res = await createPlantLog(plant.id, {
        logType: newLogType,
        title: newLogTitle.trim() || null,
        content: trimmedContent,
        loggedAt: isoDueDateTime(isoLoggedAt),
      });

      // Insert new log at the beginning of the list
      setLogs((prev) => [res.log, ...prev]);
      // Reset form
      setNewLogTitle('');
      setNewLogContent('');
      setNewLogLoggedAt('');
      setNewLogType('growth');
      setShowAddLog(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.fieldErrors) {
          setLogFieldErrors(err.fieldErrors);
        }
        setLogError(err.message);
      } else {
        setLogError(err instanceof Error ? err.message : 'Failed to save growth log.');
      }
    } finally {
      setSubmittingLog(false);
    }
  };

  const handleDeleteLog = async (logId: string) => {
    if (!plant) return;
    setDeletingLogId(logId);
    try {
      await deletePlantLog(plant.id, logId);
      setLogs((prev) => prev.filter((l) => l.id !== logId));
    } catch {
      // Failed to delete log
    } finally {
      setDeletingLogId(null);
    }
  };

  const handleToggleTaskStatus = async (targetTask: CareTaskWithDetails) => {
    const newStatus: TaskStatus = targetTask.status === 'completed' ? 'pending' : 'completed';
    setUpdatingTaskId(targetTask.id);
    try {
      const res = await updateTask(targetTask.id, { status: newStatus });
      setTasks((prev) =>
        prev.map((t) => (t.id === targetTask.id ? { ...t, ...res.task } : t)),
      );
    } catch {
      // Handled silently
    } finally {
      setUpdatingTaskId(null);
    }
  };

  function isoDueDateTime(iso: string | null) {
    return iso ?? undefined;
  }

  if (loading) {
    return <FullPageLoader label="Loading plant details..." />;
  }

  if (error || !plant) {
    return (
      <div className="space-y-4">
        <Link
          to="/dashboard/plants"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-forest"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to plants
        </Link>
        <ErrorState
          title="Plant not found"
          message={error || 'This plant record could not be located.'}
          action={
            <Link to="/dashboard/plants" className={buttonStyles('secondary', 'sm')}>
              Return to plants
            </Link>
          }
        />
      </div>
    );
  }

  const displayName = plant.customName || plant.catalog?.commonName || 'Plant';
  const stageVariant = GROWTH_STAGE_VARIANTS[plant.growthStage] ?? 'sage';
  const stageLabel = GROWTH_STAGE_LABELS[plant.growthStage] ?? plant.growthStage;

  // Days since planting calculation
  let daysGrowing: number | null = null;
  if (plant.plantingDate) {
    const planted = new Date(plant.plantingDate);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - planted.getTime());
    daysGrowing = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  return (
    <div className="space-y-6">
      <Link
        to={plant.gardenId ? `/dashboard/gardens/${plant.gardenId}` : '/dashboard/plants'}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-forest"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to {plant.gardenName || 'plants'}
      </Link>

      <PageHeader
        eyebrow="Plant Detail"
        title={displayName}
        description={
          plant.catalog?.scientificName
            ? `${plant.catalog.scientificName} · Growing in ${plant.gardenName || 'Garden'}`
            : `Growing in ${plant.gardenName || 'Garden'}`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/dashboard/plants/${plant.id}/edit`}
              className={buttonStyles('secondary', 'sm')}
            >
              <Edit2 className="h-4 w-4" aria-hidden="true" />
              Edit Plant
            </Link>
            <Button
              variant="destructive"
              size="sm"
              icon={<Trash2 className="h-4 w-4" />}
              onClick={() => {
                setShowDeleteModal(true);
                setDeleteError(null);
              }}
              aria-label="Remove plant from garden"
            >
              Remove
            </Button>
          </div>
        }
      />

      {/* Primary Metrics Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Garden */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted">Garden Space</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              to={`/dashboard/gardens/${plant.gardenId}`}
              className="flex items-center gap-1.5 text-sm font-semibold text-forest hover:text-sage"
            >
              <MapPin className="h-4 w-4 text-sage" aria-hidden="true" />
              <span>{plant.gardenName || 'View Garden'}</span>
              <ExternalLink className="h-3 w-3 text-muted" aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>

        {/* Growth Stage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted">Lifecycle Stage</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={stageVariant} className="text-xs py-1 px-2.5">
              {stageLabel}
            </Badge>
          </CardContent>
        </Card>

        {/* Planting Date & Age */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted">Age & Planting</CardTitle>
          </CardHeader>
          <CardContent>
            {plant.plantingDate ? (
              <div>
                <p className="text-sm font-bold text-forest">
                  {daysGrowing !== null ? `${daysGrowing} days` : '—'}
                </p>
                <p className="text-xs text-muted">Planted on {plant.plantingDate}</p>
              </div>
            ) : (
              <span className="text-sm text-muted">Date not recorded</span>
            )}
          </CardContent>
        </Card>

        {/* Expected Harvest */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted">Harvest Estimate</CardTitle>
          </CardHeader>
          <CardContent>
            {plant.expectedHarvestDate ? (
              <div className="flex items-center gap-1.5 text-sm font-semibold text-forest">
                <Calendar className="h-4 w-4 text-sage" aria-hidden="true" />
                <span>{plant.expectedHarvestDate}</span>
              </div>
            ) : (
              <span className="text-sm text-muted">No estimate set</span>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Growth Journal & Observations Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-forest" aria-hidden="true" />
              Growth Journal & Observations
            </CardTitle>
            <p className="mt-1 text-sm text-muted">
              Chronological log of milestones, health checks, feeding events, and observations.
            </p>
          </div>
          <Button
            variant={showAddLog ? 'ghost' : 'secondary'}
            size="sm"
            icon={showAddLog ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            onClick={() => setShowAddLog((prev) => !prev)}
          >
            {showAddLog ? 'Cancel' : 'Add Entry'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Add Log Entry Form */}
          {showAddLog ? (
            <div className="rounded-card border border-line bg-page/50 p-4 space-y-4">
              <h4 className="text-sm font-semibold text-forest">New Growth Journal Entry</h4>

              {logError ? (
                <div
                  className="rounded-control border border-critical/30 bg-critical-surface p-3 text-xs text-critical"
                  role="alert"
                >
                  {logError}
                </div>
              ) : null}

              <form onSubmit={handleCreateLog} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <SelectField
                    label="Log Category"
                    value={newLogType}
                    onChange={(e) => setNewLogType(e.target.value as LogType)}
                    error={logFieldErrors.logType?.[0]}
                  >
                    {(Object.keys(LOG_TYPES) as LogType[]).map((t) => (
                      <option key={t} value={t}>
                        {LOG_TYPES[t]}
                      </option>
                    ))}
                  </SelectField>

                  <TextField
                    label="Entry Title (Optional)"
                    placeholder="e.g. New shoots appearing"
                    value={newLogTitle}
                    onChange={(e) => setNewLogTitle(e.target.value)}
                    error={logFieldErrors.title?.[0]}
                    maxLength={120}
                  />

                  <TextField
                    type="datetime-local"
                    label="Recorded Date & Time"
                    value={newLogLoggedAt}
                    onChange={(e) => setNewLogLoggedAt(e.target.value)}
                    error={logFieldErrors.loggedAt?.[0]}
                    hint="Leave blank for current time"
                  />
                </div>

                <TextAreaField
                  label="Observations / Notes"
                  placeholder="Record growth details, leaf color, watering response, flowering notes..."
                  value={newLogContent}
                  onChange={(e) => setNewLogContent(e.target.value)}
                  error={logFieldErrors.content?.[0]}
                  rows={3}
                  maxLength={2000}
                  required
                />

                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAddLog(false)}
                    disabled={submittingLog}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" size="sm" loading={submittingLog}>
                    Save Entry
                  </Button>
                </div>
              </form>
            </div>
          ) : null}

          {/* Logs List */}
          {loadingLogs ? (
            <div className="space-y-3 py-2">
              <div className="h-14 animate-pulse rounded bg-soft-sage/40" />
              <div className="h-14 animate-pulse rounded bg-soft-sage/40" />
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No growth entries yet"
              description="Keep a rich history of this plant's development, treatments, pruning, and growth milestones."
              className="border-0 bg-page/40 py-8"
              action={
                !showAddLog ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Plus className="h-4 w-4" />}
                    onClick={() => setShowAddLog(true)}
                  >
                    Add First Entry
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="relative border-l-2 border-line/70 pl-4 ml-2 space-y-6">
              {logs.map((log) => (
                <div key={log.id} className="relative group">
                  {/* Timeline dot */}
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-forest ring-2 ring-page" />

                  <div className="rounded-card border border-line bg-card p-4 transition hover:border-line-strong hover:shadow-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={LOG_TYPE_VARIANTS[log.logType] ?? 'neutral'} className="text-xs">
                          {LOG_TYPES[log.logType] || log.logType}
                        </Badge>
                        {log.title ? (
                          <h4 className="text-sm font-semibold text-ink">{log.title}</h4>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted">
                          {new Date(log.loggedAt || log.createdAt).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted hover:text-critical"
                          loading={deletingLogId === log.id}
                          onClick={() => handleDeleteLog(log.id)}
                          aria-label="Delete entry"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <p className="mt-2 text-sm text-ink/90 whitespace-pre-wrap leading-relaxed">
                      {log.content}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plant Care Tasks Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-forest" aria-hidden="true" />
              Plant Care Tasks
            </CardTitle>
            <p className="mt-1 text-sm text-muted">
              Scheduled maintenance, watering, nutrient feeds, and checks for this plant.
            </p>
          </div>
          <Link
            to={`/dashboard/tasks/new?gardenId=${plant.gardenId}&plantId=${plant.id}`}
            className={buttonStyles('secondary', 'sm')}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Schedule Task
          </Link>
        </CardHeader>
        <CardContent>
          {loadingTasks ? (
            <div className="space-y-2 py-2">
              <div className="h-10 animate-pulse rounded bg-soft-sage/40" />
              <div className="h-10 animate-pulse rounded bg-soft-sage/40" />
            </div>
          ) : tasks.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No tasks scheduled for this plant"
              description="Schedule a task for watering, fertilizing, inspecting, or harvesting this crop."
              className="border-0 bg-page/40 py-8"
              action={
                <Link
                  to={`/dashboard/tasks/new?gardenId=${plant.gardenId}&plantId=${plant.id}`}
                  className={buttonStyles('primary', 'sm')}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Schedule First Task
                </Link>
              }
            />
          ) : (
            <div className="divide-y divide-line/60">
              {tasks.map((task) => {
                const isCompleted = task.status === 'completed';
                return (
                  <div
                    key={task.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2"
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => handleToggleTaskStatus(task)}
                        disabled={updatingTaskId === task.id}
                        aria-label={isCompleted ? 'Mark incomplete' : 'Mark complete'}
                        className="mt-0.5 text-muted hover:text-forest transition shrink-0"
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="h-5 w-5 text-forest" />
                        ) : (
                          <Circle className="h-5 w-5 text-muted hover:text-sage" />
                        )}
                      </button>

                      <div>
                        <Link
                          to={`/dashboard/tasks/${task.id}`}
                          className={`text-sm font-medium transition hover:text-forest ${
                            isCompleted ? 'line-through text-muted' : 'text-ink'
                          }`}
                        >
                          {task.title}
                        </Link>
                        {task.dueAt ? (
                          <p className="flex items-center gap-1 text-xs text-muted mt-0.5">
                            <Clock className="h-3 w-3 text-sage" aria-hidden="true" />
                            <span>
                              Due {new Date(task.dueAt).toLocaleString(undefined, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pl-8 sm:pl-0">
                      <Badge variant={TASK_TYPE_VARIANTS[task.taskType] ?? 'neutral'} className="text-xs">
                        {TASK_TYPES[task.taskType] || task.taskType}
                      </Badge>
                      <Badge variant={PRIORITY_VARIANTS[task.priority] ?? 'neutral'} className="text-xs">
                        {TASK_PRIORITIES[task.priority] || task.priority}
                      </Badge>
                      <Badge variant={isCompleted ? 'success' : 'neutral'} className="text-xs">
                        {TASK_STATUSES[task.status] || task.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Catalog Guidance & Reference Ranges */}
      {plant.catalog ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Care Guidelines */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Care Guidance</CardTitle>
                <p className="mt-1 text-sm text-muted">
                  Botanical reference standards for {plant.catalog.commonName}.
                </p>
              </div>
              <Link
                to={`/plants/${plant.catalog.slug}`}
                className={buttonStyles('ghost', 'sm')}
              >
                Catalog page &rarr;
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-control border border-line bg-page/50 p-3.5 space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-forest">
                  <Sun className="h-4 w-4 text-sage" aria-hidden="true" />
                  <span>Light Requirement</span>
                </div>
                <p className="text-xs text-muted">
                  {plant.catalog.lightGuidance || 'Standard daylight.'}
                </p>
              </div>

              <div className="rounded-control border border-line bg-page/50 p-3.5 space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-forest">
                  <Droplets className="h-4 w-4 text-info" aria-hidden="true" />
                  <span>Watering Guidance</span>
                </div>
                <p className="text-xs text-muted">
                  {plant.catalog.wateringGuidance || 'Monitor moisture before watering.'}
                </p>
              </div>

              {plant.catalog.growingMethodNotes ? (
                <div className="rounded-control border border-line bg-page/50 p-3.5 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-forest">
                    <Leaf className="h-4 w-4 text-sage" aria-hidden="true" />
                    <span>Cultivation Notes</span>
                  </div>
                  <p className="text-xs text-muted">
                    {plant.catalog.growingMethodNotes}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Reference Ranges */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Target Environment</CardTitle>
                <p className="mt-1 text-sm text-muted">
                  Recommended parameters for healthy development.
                </p>
              </div>
              <Badge variant="outline">Reference Ranges</Badge>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {(
                Object.keys(plant.catalog.referenceRanges) as MeasurementType[]
              ).map((type) => {
                const range = plant.catalog?.referenceRanges[type];
                if (!range) return null;
                const meta = MEASUREMENTS[type];
                const Icon = measurementIcons[type];
                return (
                  <div
                    key={type}
                    className="flex items-center justify-between rounded-control border border-line bg-page/50 px-4 py-2.5 text-xs"
                  >
                    <span className="flex items-center gap-2 font-medium text-ink">
                      <Icon className="h-4 w-4 text-muted" aria-hidden="true" />
                      {meta.label}
                    </span>
                    <span className="font-semibold tabular-nums text-forest">
                      {range.min}–{range.max} {meta.unit}
                    </span>
                  </div>
                );
              })}

              <div className="pt-2 text-xs text-muted">
                <p className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                  <span>
                    Typical harvest: {plant.catalog.harvestDaysMin || '—'} to{' '}
                    {plant.catalog.harvestDaysMax || '—'} days
                  </span>
                </p>
              </div>

              <div className="pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2">
                <Link
                  to={`/dashboard/monitoring?plantId=${plant.id}`}
                  className="text-xs font-semibold text-forest hover:underline flex items-center gap-1"
                >
                  <Activity className="h-3.5 w-3.5 text-sage" aria-hidden="true" />
                  View Plant Telemetry & Trends &rarr;
                </Link>
                <Link
                  to={`/dashboard/monitoring/new?plantId=${plant.id}`}
                  className={buttonStyles('secondary', 'sm')}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add Reading
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : plant.researchProfile ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* AI Care Guidance */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-sage" />
                  <CardTitle>AI Care Guidance</CardTitle>
                </div>
                <p className="mt-1 text-sm text-muted">
                  Researched parameters for {displayName}
                  {plant.researchProfile.scientificName ? ` (${plant.researchProfile.scientificName})` : ''}.
                </p>
              </div>
              <Badge variant="sage" className="text-xs">
                AI-Assisted
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {plant.researchProfile.lightGuidance ? (
                <div className="rounded-control border border-line bg-page/50 p-3.5 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-forest">
                    <Sun className="h-4 w-4 text-sage" aria-hidden="true" />
                    <span>Light Requirement</span>
                  </div>
                  <p className="text-xs text-muted">
                    {plant.researchProfile.lightGuidance}
                  </p>
                </div>
              ) : null}

              {plant.researchProfile.wateringGuidance ? (
                <div className="rounded-control border border-line bg-page/50 p-3.5 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-forest">
                    <Droplets className="h-4 w-4 text-info" aria-hidden="true" />
                    <span>Watering Guidance</span>
                  </div>
                  <p className="text-xs text-muted">
                    {plant.researchProfile.wateringGuidance}
                  </p>
                </div>
              ) : null}

              {plant.researchProfile.growingMedium ? (
                <div className="rounded-control border border-line bg-page/50 p-3.5 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-forest">
                    <Leaf className="h-4 w-4 text-sage" aria-hidden="true" />
                    <span>Growing Medium</span>
                  </div>
                  <p className="text-xs text-muted">
                    {plant.researchProfile.growingMedium}
                  </p>
                </div>
              ) : null}

              {plant.researchProfile.cultivationNotes ? (
                <div className="rounded-control border border-line bg-page/50 p-3.5 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-forest">
                    <BookOpen className="h-4 w-4 text-muted" aria-hidden="true" />
                    <span>Cultivation Notes</span>
                  </div>
                  <p className="text-xs text-muted">
                    {plant.researchProfile.cultivationNotes}
                  </p>
                </div>
              ) : null}

              {plant.researchProfile.safetyNotes ? (
                <div className="rounded-control border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-1 text-xs text-amber-900 dark:text-amber-200">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    <span>Safety & Handling</span>
                  </div>
                  <p>{plant.researchProfile.safetyNotes}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* AI Target Environment */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle>Target Environment</CardTitle>
                <p className="mt-1 text-sm text-muted">
                  Synthesized target conditions from agricultural references.
                </p>
              </div>
              <Badge
                variant={
                  plant.researchProfile.confidence === 'high'
                    ? 'success'
                    : plant.researchProfile.confidence === 'moderate'
                      ? 'sage'
                      : 'warning'
                }
                className="text-xs capitalize"
              >
                {plant.researchProfile.confidence} Confidence
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {plant.researchProfile.temperatureMin != null && plant.researchProfile.temperatureMax != null ? (
                <div className="flex items-center justify-between rounded-control border border-line bg-page/50 px-4 py-2.5 text-xs">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    <Thermometer className="h-4 w-4 text-muted" aria-hidden="true" />
                    Air Temperature
                  </span>
                  <span className="font-semibold tabular-nums text-forest">
                    {plant.researchProfile.temperatureMin}–{plant.researchProfile.temperatureMax} °C
                  </span>
                </div>
              ) : null}

              {plant.researchProfile.humidityMin != null && plant.researchProfile.humidityMax != null ? (
                <div className="flex items-center justify-between rounded-control border border-line bg-page/50 px-4 py-2.5 text-xs">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    <Wind className="h-4 w-4 text-muted" aria-hidden="true" />
                    Air Humidity
                  </span>
                  <span className="font-semibold tabular-nums text-forest">
                    {plant.researchProfile.humidityMin}–{plant.researchProfile.humidityMax} %
                  </span>
                </div>
              ) : null}

              {plant.researchProfile.moistureMin != null && plant.researchProfile.moistureMax != null ? (
                <div className="flex items-center justify-between rounded-control border border-line bg-page/50 px-4 py-2.5 text-xs">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    <Droplets className="h-4 w-4 text-muted" aria-hidden="true" />
                    Medium Moisture
                  </span>
                  <span className="font-semibold tabular-nums text-forest">
                    {plant.researchProfile.moistureMin}–{plant.researchProfile.moistureMax} %
                  </span>
                </div>
              ) : null}

              {plant.researchProfile.harvestDaysMin ? (
                <div className="pt-2 text-xs text-muted">
                  <p className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                    <span>
                      Typical harvest: ~{plant.researchProfile.harvestDaysMin}
                      {plant.researchProfile.harvestDaysMax ? `–${plant.researchProfile.harvestDaysMax}` : ''} days
                    </span>
                  </p>
                </div>
              ) : null}

              {plant.researchProfile.sources && plant.researchProfile.sources.length > 0 ? (
                <div className="pt-3 border-t border-line space-y-1.5">
                  <h6 className="text-[11px] font-semibold text-forest flex items-center gap-1">
                    <BookOpen className="h-3.5 w-3.5 text-sage" />
                    Cited Agricultural References
                  </h6>
                  <div className="space-y-1">
                    {plant.researchProfile.sources.map((src, idx) => (
                      <div key={idx} className="text-xs">
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-forest hover:text-sage inline-flex items-center gap-1"
                        >
                          {src.title}
                          <ExternalLink className="h-3 w-3 text-muted" />
                        </a>
                        {src.publisher ? (
                          <span className="text-[11px] text-muted ml-1.5">({src.publisher})</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2">
                <Link
                  to={`/dashboard/monitoring?plantId=${plant.id}`}
                  className="text-xs font-semibold text-forest hover:underline flex items-center gap-1"
                >
                  <Activity className="h-3.5 w-3.5 text-sage" aria-hidden="true" />
                  View Plant Telemetry & Trends &rarr;
                </Link>
                <Link
                  to={`/dashboard/monitoring/new?plantId=${plant.id}`}
                  className={buttonStyles('secondary', 'sm')}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add Reading
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Notes */}
      {plant.notes ? (
        <Card>
          <CardHeader>
            <CardTitle>Grower Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-ink/90 whitespace-pre-wrap">{plant.notes}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Delete Confirmation Modal */}
      {showDeleteModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-plant-title"
        >
          <div className="w-full max-w-md rounded-card border border-line bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-critical-surface text-critical">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 id="delete-plant-title" className="text-lg font-semibold text-ink">
                  Remove "{displayName}"?
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Are you sure you want to remove this plant from {plant.gardenName || 'your garden'}?
                  This action cannot be undone.
                </p>
              </div>
            </div>

            {deleteError ? (
              <p className="text-xs text-critical font-medium" role="alert">
                {deleteError}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                loading={deleting}
                onClick={handleDelete}
              >
                Remove Plant
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
