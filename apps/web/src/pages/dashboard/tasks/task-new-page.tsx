import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Calendar, ListChecks, Plus } from 'lucide-react';
import {
  TASK_PRIORITIES,
  TASK_TYPES,
  type RecurrenceUnit,
  type TaskPriority,
  type TaskType,
} from '@growspace/shared';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { FullPageLoader } from '@/components/ui/loading';
import { PageHeader } from '@/components/ui/page-header';
import {
  ApiClientError,
  createCareSchedule,
  createTask,
  fetchGardens,
  fetchPlants,
  type GardenWithStats,
  type PlantWithDetails,
} from '@/lib/api';

export function TaskNewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialGardenParam = searchParams.get('gardenId')?.trim() || '';
  const initialPlantParam = searchParams.get('plantId')?.trim() || '';
  const initialDateParam = searchParams.get('date')?.trim() || '';
  const defaultDueAt = initialDateParam ? `${initialDateParam}T09:00` : '';

  const [gardens, setGardens] = useState<GardenWithStats[]>([]);
  const [plants, setPlants] = useState<PlantWithDetails[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingPlants, setLoadingPlants] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form State
  const [gardenId, setGardenId] = useState(initialGardenParam);
  const [plantId, setPlantId] = useState(initialPlantParam);
  const [title, setTitle] = useState('');
  const [taskType, setTaskType] = useState<TaskType>('watering');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [dueAt, setDueAt] = useState(defaultDueAt);
  const [description, setDescription] = useState('');

  // Recurrence State
  const [isRecurring, setIsRecurring] = useState(false);
  const [intervalValue, setIntervalValue] = useState(7);
  const [intervalUnit, setIntervalUnit] = useState<RecurrenceUnit>('days');

  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Load user's gardens on mount
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    fetchGardens(controller.signal)
      .then((res) => {
        if (!isMounted) return;
        setGardens(res.gardens);
        if (res.gardens.length > 0) {
          const selectedGarden =
            initialGardenParam && res.gardens.some((g) => g.id === initialGardenParam)
              ? initialGardenParam
              : res.gardens[0]!.id;
          setGardenId(selectedGarden);
        }
        setLoadingInitial(false);
      })
      .catch((err: unknown) => {
        if (!isMounted || controller.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : 'Unable to load gardens.');
        setLoadingInitial(false);
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [initialGardenParam]);

  // Load plants whenever gardenId changes
  useEffect(() => {
    if (!gardenId) return;

    let isMounted = true;
    const controller = new AbortController();

    fetchPlants({ gardenId, signal: controller.signal })
      .then((res) => {
        if (!isMounted) return;
        setPlants(res.plants);
        // If initialPlantParam belongs to this garden, keep it; otherwise reset
        if (initialPlantParam && res.plants.some((p) => p.id === initialPlantParam)) {
          setPlantId(initialPlantParam);
        } else {
          setPlantId('');
        }
        setLoadingPlants(false);
      })
      .catch(() => {
        if (!isMounted || controller.signal.aborted) return;
        setPlants([]);
        setLoadingPlants(false);
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [gardenId, initialPlantParam]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFieldErrors({ title: ['Task title is required'] });
      return;
    }

    if (!gardenId) {
      setFieldErrors({ gardenId: ['Please select a garden'] });
      return;
    }

    // Convert local datetime-local string to ISO string if provided
    let isoDueAt: string | null = null;
    if (dueAt.trim()) {
      try {
        const parsed = new Date(dueAt);
        if (Number.isNaN(parsed.getTime())) {
          setFieldErrors({ dueAt: ['Invalid date format'] });
          return;
        }
        isoDueAt = parsed.toISOString();
      } catch {
        setFieldErrors({ dueAt: ['Invalid date format'] });
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isRecurring) {
        await createCareSchedule({
          gardenId,
          plantId: plantId || null,
          title: trimmedTitle,
          taskType,
          priority,
          intervalValue,
          intervalUnit,
          startDate: isoDueAt,
          description: description.trim() || null,
        });
      } else {
        await createTask({
          gardenId,
          plantId: plantId || null,
          title: trimmedTitle,
          taskType,
          priority,
          dueAt: isoDueAt,
          description: description.trim() || null,
        });
      }

      navigate('/dashboard/tasks');
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.fieldErrors) {
          setFieldErrors(err.fieldErrors);
        }
        setGeneralError(err.message);
      } else {
        setGeneralError(
          err instanceof Error ? err.message : 'Failed to create task. Please try again.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingInitial) {
    return <FullPageLoader label="Loading task options..." />;
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link
          to="/dashboard/tasks"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-forest"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to tasks
        </Link>
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-sm text-critical">{loadError}</p>
            <div className="mt-4">
              <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gardens.length === 0) {
    return (
      <div className="space-y-6">
        <Link
          to="/dashboard/tasks"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-forest"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to tasks
        </Link>
        <EmptyState
          icon={ListChecks}
          title="Garden required to create a task"
          description="Care tasks are organized around gardens and their plants. Create your first garden space before scheduling care."
          action={
            <Link to="/dashboard/gardens/new" className={buttonStyles('primary')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create a Garden
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/dashboard/tasks"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-forest"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to tasks
      </Link>

      <PageHeader
        eyebrow="Care Management"
        title="Create Care Task"
        description="Schedule routine care, watering, fertilization, or inspections for your garden or specific crop."
      />

      <div className="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardContent className="space-y-5 p-6">
              {generalError ? (
                <div
                  className="rounded-control border border-critical/30 bg-critical-surface p-3 text-sm text-critical"
                  role="alert"
                >
                  {generalError}
                </div>
              ) : null}

              {/* Target Garden & Optional Plant */}
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Garden Space"
                  value={gardenId}
                  onChange={(e) => setGardenId(e.target.value)}
                  error={fieldErrors.gardenId?.[0]}
                  hint="The garden where care is required."
                  required
                >
                  {gardens.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label="Target Plant (Optional)"
                  value={plantId}
                  onChange={(e) => setPlantId(e.target.value)}
                  error={fieldErrors.plantId?.[0]}
                  hint={
                    loadingPlants
                      ? 'Loading plants for this garden...'
                      : plants.length === 0
                        ? 'No active plants in this garden.'
                        : 'Optionally associate with a specific plant.'
                  }
                  disabled={loadingPlants}
                >
                  <option value="">Entire garden (no specific plant)</option>
                  {plants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.customName || p.catalog?.commonName || 'Plant'}
                    </option>
                  ))}
                </SelectField>
              </div>

              {/* Task Title */}
              <TextField
                label="Task Title"
                placeholder="e.g. Water basil seedlings, check moisture, add fertilizer"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                error={fieldErrors.title?.[0]}
                maxLength={120}
                required
              />

              {/* Task Type & Priority */}
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Task Type"
                  value={taskType}
                  onChange={(e) => setTaskType(e.target.value as TaskType)}
                  error={fieldErrors.taskType?.[0]}
                >
                  {(Object.keys(TASK_TYPES) as TaskType[]).map((t) => (
                    <option key={t} value={t}>
                      {TASK_TYPES[t]}
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label="Priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  error={fieldErrors.priority?.[0]}
                >
                  {(Object.keys(TASK_PRIORITIES) as TaskPriority[]).map((p) => (
                    <option key={p} value={p}>
                      {TASK_PRIORITIES[p]}
                    </option>
                  ))}
                </SelectField>
              </div>

              {/* Due Date & Time */}
              <TextField
                type="datetime-local"
                label={isRecurring ? "First Occurrence Date & Time" : "Due Date & Time"}
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                error={fieldErrors.dueAt?.[0]}
                hint={isRecurring ? "When the first occurrence should be scheduled." : "Optional deadline or scheduled time for this task."}
              />

              {/* Recurring Schedule Switch */}
              <div className="rounded-control border border-line bg-soft-sage/20 p-4 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isRecurring}
                    onChange={(e) => setIsRecurring(e.target.checked)}
                    className="rounded border-line text-forest focus:ring-sage h-4 w-4"
                  />
                  <span className="text-sm font-semibold text-ink">
                    Make this a recurring care schedule
                  </span>
                </label>
                <p className="text-xs text-muted">
                  Recurring schedules automatically schedule the next occurrence after completion, ensuring steady watering, feeding, or pruning.
                </p>

                {isRecurring ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-line/60">
                    <div>
                      <label className="block text-xs font-semibold text-ink mb-1">
                        Repeat Every
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={intervalValue}
                        onChange={(e) => setIntervalValue(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink focus:border-sage focus:outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-ink mb-1">
                        Time Unit
                      </label>
                      <select
                        value={intervalUnit}
                        onChange={(e) => setIntervalUnit(e.target.value as RecurrenceUnit)}
                        className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink focus:border-sage focus:outline-hidden"
                      >
                        <option value="days">Days</option>
                        <option value="weeks">Weeks</option>
                        <option value="months">Months</option>
                      </select>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Description */}
              <TextAreaField
                label="Instructions / Notes (Optional)"
                placeholder="Add any specific dosage instructions, observation details, or notes..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                error={fieldErrors.description?.[0]}
                rows={4}
                maxLength={1000}
              />
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-3">
            <Link to="/dashboard/tasks" className={buttonStyles('ghost')}>
              Cancel
            </Link>
            <Button type="submit" variant="primary" loading={submitting}>
              <Calendar className="h-4 w-4" aria-hidden="true" />
              Schedule Task
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
