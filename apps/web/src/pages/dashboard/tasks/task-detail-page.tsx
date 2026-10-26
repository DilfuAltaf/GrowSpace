import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Circle,
  Edit2,
  ExternalLink,
  MapPin,
  Sprout,
  Trash2,
  X,
} from 'lucide-react';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from '@growspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { FullPageLoader } from '@/components/ui/loading';
import { PageHeader } from '@/components/ui/page-header';
import {
  ApiClientError,
  deleteTask,
  fetchPlants,
  fetchTask,
  updateTask,
  type CareTaskWithDetails,
  type PlantWithDetails,
} from '@/lib/api';

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

export function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();

  const [task, setTask] = useState<CareTaskWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Status toggle in-flight
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Edit Mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editTaskType, setEditTaskType] = useState<TaskType>('other');
  const [editPriority, setEditPriority] = useState<TaskPriority>('normal');
  const [editStatus, setEditStatus] = useState<TaskStatus>('pending');
  const [editDueAt, setEditDueAt] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPlantId, setEditPlantId] = useState('');
  const [gardenPlants, setGardenPlants] = useState<PlantWithDetails[]>([]);

  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string[]>>({});

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) return;
    let isMounted = true;
    const controller = new AbortController();

    fetchTask(taskId, controller.signal)
      .then((res) => {
        if (isMounted) {
          setTask(res.task);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted && !controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Could not load task.');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [taskId]);

  // When opening edit mode, fetch plants in this garden
  const startEditing = () => {
    if (!task) return;
    setEditTitle(task.title);
    setEditTaskType(task.taskType);
    setEditPriority(task.priority);
    setEditStatus(task.status);
    setEditDescription(task.description || '');
    setEditPlantId(task.plantId || '');

    // Format ISO dueAt to YYYY-MM-DDTHH:mm for datetime-local input
    if (task.dueAt) {
      try {
        const d = new Date(task.dueAt);
        const pad = (n: number) => String(n).padStart(2, '0');
        const formatted = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        setEditDueAt(formatted);
      } catch {
        setEditDueAt('');
      }
    } else {
      setEditDueAt('');
    }

    setEditError(null);
    setEditFieldErrors({});
    setIsEditing(true);

    if (task.gardenId) {
      fetchPlants({ gardenId: task.gardenId })
        .then((res) => setGardenPlants(res.plants))
        .catch(() => setGardenPlants([]));
    }
  };

  const handleQuickStatusToggle = async () => {
    if (!task) return;
    const newStatus: TaskStatus = task.status === 'completed' ? 'pending' : 'completed';
    setUpdatingStatus(true);
    try {
      const res = await updateTask(task.id, { status: newStatus });
      setTask((prev) => (prev ? { ...prev, ...res.task } : res.task));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!task) return;

    setEditError(null);
    setEditFieldErrors({});

    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle) {
      setEditFieldErrors({ title: ['Task title is required'] });
      return;
    }

    let isoDueAt: string | null = null;
    if (editDueAt.trim()) {
      try {
        const parsed = new Date(editDueAt);
        if (Number.isNaN(parsed.getTime())) {
          setEditFieldErrors({ dueAt: ['Invalid date format'] });
          return;
        }
        isoDueAt = parsed.toISOString();
      } catch {
        setEditFieldErrors({ dueAt: ['Invalid date format'] });
        return;
      }
    }

    setSavingEdit(true);
    try {
      const res = await updateTask(task.id, {
        title: trimmedTitle,
        taskType: editTaskType,
        priority: editPriority,
        status: editStatus,
        dueAt: isoDueAt,
        plantId: editPlantId || null,
        description: editDescription.trim() || null,
      });

      setTask((prev) => (prev ? { ...prev, ...res.task } : res.task));
      setIsEditing(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.fieldErrors) {
          setEditFieldErrors(err.fieldErrors);
        }
        setEditError(err.message);
      } else {
        setEditError(err instanceof Error ? err.message : 'Failed to save changes.');
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteTask(task.id);
      navigate('/dashboard/tasks');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete task.');
      setDeleting(false);
    }
  };

  if (loading) {
    return <FullPageLoader label="Loading task..." />;
  }

  if (error || !task) {
    return (
      <div className="space-y-4">
        <Link
          to="/dashboard/tasks"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-forest"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to tasks
        </Link>
        <ErrorState
          title="Task not found"
          message={error || 'This care task record could not be found.'}
          action={
            <Link to="/dashboard/tasks" className={buttonStyles('secondary', 'sm')}>
              Return to tasks
            </Link>
          }
        />
      </div>
    );
  }

  const isCompleted = task.status === 'completed';

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
        eyebrow="Care Task"
        title={task.title}
        description={
          task.gardenName
            ? `Assigned to ${task.gardenName}${task.plantName ? ` · ${task.plantName}` : ''}`
            : 'Care task'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={isCompleted ? 'secondary' : 'primary'}
              size="sm"
              loading={updatingStatus}
              icon={isCompleted ? <Circle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              onClick={handleQuickStatusToggle}
            >
              {isCompleted ? 'Reopen Task' : 'Mark Completed'}
            </Button>

            {!isEditing ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<Edit2 className="h-4 w-4" />}
                onClick={startEditing}
              >
                Edit
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                icon={<X className="h-4 w-4" />}
                onClick={() => setIsEditing(false)}
              >
                Cancel Edit
              </Button>
            )}

            <Button
              variant="destructive"
              size="sm"
              icon={<Trash2 className="h-4 w-4" />}
              onClick={() => {
                setShowDeleteModal(true);
                setDeleteError(null);
              }}
              aria-label="Delete task"
            >
              Delete
            </Button>
          </div>
        }
      />

      {isEditing ? (
        /* Edit Form */
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Edit Task Details</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveEdit} className="space-y-5">
              {editError ? (
                <div
                  className="rounded-control border border-critical/30 bg-critical-surface p-3 text-sm text-critical"
                  role="alert"
                >
                  {editError}
                </div>
              ) : null}

              <TextField
                label="Task Title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                error={editFieldErrors.title?.[0]}
                maxLength={120}
                required
              />

              <div className="grid gap-4 sm:grid-cols-3">
                <SelectField
                  label="Task Type"
                  value={editTaskType}
                  onChange={(e) => setEditTaskType(e.target.value as TaskType)}
                  error={editFieldErrors.taskType?.[0]}
                >
                  {(Object.keys(TASK_TYPES) as TaskType[]).map((t) => (
                    <option key={t} value={t}>
                      {TASK_TYPES[t]}
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label="Priority"
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value as TaskPriority)}
                  error={editFieldErrors.priority?.[0]}
                >
                  {(Object.keys(TASK_PRIORITIES) as TaskPriority[]).map((p) => (
                    <option key={p} value={p}>
                      {TASK_PRIORITIES[p]}
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label="Status"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as TaskStatus)}
                  error={editFieldErrors.status?.[0]}
                >
                  {(Object.keys(TASK_STATUSES) as TaskStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {TASK_STATUSES[s]}
                    </option>
                  ))}
                </SelectField>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  type="datetime-local"
                  label="Due Date & Time"
                  value={editDueAt}
                  onChange={(e) => setEditDueAt(e.target.value)}
                  error={editFieldErrors.dueAt?.[0]}
                />

                <SelectField
                  label="Target Plant"
                  value={editPlantId}
                  onChange={(e) => setEditPlantId(e.target.value)}
                  error={editFieldErrors.plantId?.[0]}
                >
                  <option value="">Entire garden (no plant)</option>
                  {gardenPlants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.customName || p.catalog?.commonName || 'Plant'}
                    </option>
                  ))}
                </SelectField>
              </div>

              <TextAreaField
                label="Instructions / Notes"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                error={editFieldErrors.description?.[0]}
                rows={4}
                maxLength={1000}
              />

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsEditing(false)}
                  disabled={savingEdit}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={savingEdit}>
                  Save Changes
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        /* View Mode */
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Task Information</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={isCompleted ? 'success' : task.status === 'cancelled' ? 'neutral' : 'warning'}>
                    {TASK_STATUSES[task.status] || task.status}
                  </Badge>
                  <Badge variant={TASK_TYPE_VARIANTS[task.taskType] ?? 'neutral'}>
                    {TASK_TYPES[task.taskType] || task.taskType}
                  </Badge>
                  <Badge variant={PRIORITY_VARIANTS[task.priority] ?? 'neutral'}>
                    {TASK_PRIORITIES[task.priority] || task.priority} Priority
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {task.scheduleTitle || task.scheduleId ? (
                  <div className="rounded-control border border-line bg-soft-sage/20 p-3 flex items-center justify-between text-xs">
                    <span className="font-semibold text-forest">
                      Recurring Schedule: {task.scheduleTitle || 'Active recurring rule'}
                    </span>
                    <Badge variant="sage" className="text-[10px]">
                      Auto-repeating
                    </Badge>
                  </div>
                ) : null}

                {task.description ? (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Instructions & Notes
                    </h4>
                    <p className="mt-2 text-sm text-ink/90 whitespace-pre-wrap">{task.description}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted italic">No instructions or notes provided.</p>
                )}

                <div className="border-t border-line/60 pt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <span className="text-xs text-muted block">Scheduled / Due Date</span>
                    {task.dueAt ? (
                      <span className="flex items-center gap-1.5 text-sm font-medium text-ink mt-0.5">
                        <Calendar className="h-4 w-4 text-sage" aria-hidden="true" />
                        {new Date(task.dueAt).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    ) : (
                      <span className="text-sm text-muted mt-0.5 block">No deadline set</span>
                    )}
                  </div>

                  <div>
                    <span className="text-xs text-muted block">Completion Record</span>
                    {task.completedAt ? (
                      <span className="flex items-center gap-1.5 text-sm font-medium text-forest mt-0.5">
                        <CheckCircle2 className="h-4 w-4 text-forest" aria-hidden="true" />
                        Completed on{' '}
                        {new Date(task.completedAt).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    ) : (
                      <span className="text-sm text-muted mt-0.5 block">Pending completion</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Context Sidebar: Garden and Plant links */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted">Associated Space</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Link
                  to={`/dashboard/gardens/${task.gardenId}`}
                  className="flex items-center justify-between rounded-control border border-line bg-page/50 p-3 text-sm font-medium text-forest hover:bg-card hover:border-line-strong transition"
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-sage" aria-hidden="true" />
                    <span>{task.gardenName || 'Garden'}</span>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                </Link>

                {task.plantId ? (
                  <Link
                    to={`/dashboard/plants/${task.plantId}`}
                    className="flex items-center justify-between rounded-control border border-line bg-page/50 p-3 text-sm font-medium text-forest hover:bg-card hover:border-line-strong transition"
                  >
                    <div className="flex items-center gap-2">
                      <Sprout className="h-4 w-4 text-sage" aria-hidden="true" />
                      <span>{task.plantName || 'Plant'}</span>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                  </Link>
                ) : (
                  <div className="rounded-control border border-line/60 bg-page/30 p-3 text-xs text-muted flex items-center gap-2">
                    <Sprout className="h-4 w-4 text-muted/60" aria-hidden="true" />
                    <span>Applies to the entire garden</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted">Timestamps</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted">
                <div className="flex items-center justify-between">
                  <span>Created</span>
                  <span className="font-medium text-ink">
                    {new Date(task.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Last updated</span>
                  <span className="font-medium text-ink">
                    {new Date(task.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-task-title"
        >
          <div className="w-full max-w-md rounded-card border border-line bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-critical-surface text-critical">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 id="delete-task-title" className="text-lg font-semibold text-ink">
                  Delete Care Task?
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Are you sure you want to delete "{task.title}"? This action cannot be undone.
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
                Delete Task
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
