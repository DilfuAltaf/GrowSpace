import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  Filter,
  ListChecks,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Sprout,
  XCircle,
} from 'lucide-react';
import {
  getTaskDueClassification,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from '@growspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { CardSkeleton } from '@/components/ui/loading';
import { PageHeader } from '@/components/ui/page-header';
import {
  fetchGardens,
  fetchTasks,
  updateTask,
  type CareTaskWithDetails,
  type GardenWithStats,
} from '@/lib/api';

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  watering: 'Watering',
  fertilizing: 'Fertilizing',
  pruning: 'Pruning',
  inspect: 'Inspection',
  harvest: 'Harvest',
  other: 'Care / Other',
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

export function TasksListPage() {
  const [tasks, setTasks] = useState<CareTaskWithDetails[]>([]);
  const [gardens, setGardens] = useState<GardenWithStats[]>([]);
  const [selectedGardenId, setSelectedGardenId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus | 'all'>('all');
  const [selectedDue, setSelectedDue] = useState<'all' | 'overdue' | 'today' | 'upcoming'>('all');
  const [selectedPriority, setSelectedPriority] = useState<TaskPriority | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadData = async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);

      const [tasksRes, gardensRes] = await Promise.all([
        fetchTasks({
          gardenId: selectedGardenId || undefined,
          status: selectedStatus === 'all' ? undefined : selectedStatus,
          due: selectedDue === 'all' ? undefined : selectedDue,
          priority: selectedPriority === 'all' ? undefined : selectedPriority,
          search: searchQuery.trim() || undefined,
          signal,
        }),
        fetchGardens(signal),
      ]);

      setTasks(tasksRes.tasks);
      setGardens(gardensRes.gardens);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : 'Unable to load care tasks. Please try again.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    Promise.all([
      fetchTasks({
        gardenId: selectedGardenId || undefined,
        status: selectedStatus === 'all' ? undefined : selectedStatus,
        due: selectedDue === 'all' ? undefined : selectedDue,
        priority: selectedPriority === 'all' ? undefined : selectedPriority,
        search: searchQuery.trim() || undefined,
        signal: controller.signal,
      }),
      fetchGardens(controller.signal),
    ])
      .then(([tasksRes, gardensRes]) => {
        if (isMounted) {
          setTasks(tasksRes.tasks);
          setGardens(gardensRes.gardens);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted && !controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : 'Unable to load care tasks. Please try again.',
          );
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [selectedGardenId, selectedStatus, selectedDue, selectedPriority, searchQuery]);

  const handleToggleComplete = async (task: CareTaskWithDetails) => {
    try {
      setTogglingId(task.id);
      const nextStatus: TaskStatus = task.status === 'completed' ? 'pending' : 'completed';
      const res = await updateTask(task.id, { status: nextStatus });

      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? res.task : t)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task completion state.');
    } finally {
      setTogglingId(null);
    }
  };

  const handleCancelTask = async (task: CareTaskWithDetails) => {
    try {
      setTogglingId(task.id);
      const res = await updateTask(task.id, { status: 'cancelled' });
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? res.task : t)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel task.');
    } finally {
      setTogglingId(null);
    }
  };

  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const cancelledCount = tasks.filter((t) => t.status === 'cancelled').length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Schedule"
        title="Care Tasks"
        description="Plan and track watering, fertilizing, inspections, and harvests across your gardens."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />}
              onClick={() => void loadData()}
              disabled={loading}
              aria-label="Refresh care tasks"
            >
              Refresh
            </Button>
            <Link to="/dashboard/calendar" className={buttonStyles('secondary')}>
              <Calendar className="h-4 w-4" aria-hidden="true" />
              Care Calendar
            </Link>
            <Link to="/dashboard/tasks/new" className={buttonStyles('primary')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create Task
            </Link>
          </div>
        }
      />

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-card/60 p-3.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Filters:</span>
        </div>

        {/* Garden Filter */}
        <select
          value={selectedGardenId}
          onChange={(e) => setSelectedGardenId(e.target.value)}
          className="rounded-control border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink focus:border-sage focus:outline-hidden"
          aria-label="Filter tasks by garden"
        >
          <option value="">All Gardens ({gardens.length})</option>
          {gardens.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        {/* Status Filter */}
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value as TaskStatus | 'all')}
          className="rounded-control border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink focus:border-sage focus:outline-hidden"
          aria-label="Filter tasks by status"
        >
          <option value="all">All Statuses ({tasks.length})</option>
          <option value="pending">Pending ({pendingCount})</option>
          <option value="completed">Completed ({completedCount})</option>
          <option value="cancelled">Cancelled ({cancelledCount})</option>
        </select>

        {/* Due Filter */}
        <select
          value={selectedDue}
          onChange={(e) => setSelectedDue(e.target.value as 'all' | 'overdue' | 'today' | 'upcoming')}
          className="rounded-control border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink focus:border-sage focus:outline-hidden"
          aria-label="Filter tasks by due date"
        >
          <option value="all">All Due Dates</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due Today</option>
          <option value="upcoming">Upcoming</option>
        </select>

        {/* Priority Filter */}
        <select
          value={selectedPriority}
          onChange={(e) => setSelectedPriority(e.target.value as TaskPriority | 'all')}
          className="rounded-control border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink focus:border-sage focus:outline-hidden"
          aria-label="Filter tasks by priority"
        >
          <option value="all">All Priorities</option>
          <option value="high">High Priority</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>

        {/* Search input */}
        <div className="relative flex-1 min-w-[160px] max-w-[240px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search by title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-2.5 py-1 text-xs rounded-control border border-line bg-card text-ink placeholder:text-muted focus:border-sage focus:outline-hidden"
            aria-label="Search care tasks"
          />
        </div>

        {selectedGardenId || selectedStatus !== 'all' || selectedDue !== 'all' || selectedPriority !== 'all' || searchQuery ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 px-2"
            onClick={() => {
              setSelectedGardenId('');
              setSelectedStatus('all');
              setSelectedDue('all');
              setSelectedPriority('all');
              setSearchQuery('');
            }}
          >
            Reset filters
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <ErrorState
          title="Could not load care tasks"
          message={error}
          action={
            <Button variant="secondary" size="sm" onClick={() => void loadData()}>
              Try again
            </Button>
          }
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={
            selectedStatus !== 'all' || selectedGardenId || selectedDue !== 'all'
              ? 'No matching tasks'
              : 'No care tasks scheduled'
          }
          description={
            selectedStatus !== 'all' || selectedGardenId || selectedDue !== 'all'
              ? 'No tasks matched your current filter criteria. Clear filters to see all tasks.'
              : 'Keep your garden thriving by scheduling watering, fertilizer feeds, or pest inspections.'
          }
          action={
            selectedStatus !== 'all' || selectedGardenId || selectedDue !== 'all' ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSelectedGardenId('');
                  setSelectedStatus('all');
                  setSelectedDue('all');
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Link to="/dashboard/tasks/new" className={buttonStyles('primary')}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Schedule your first task
              </Link>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const isCompleted = task.status === 'completed';
            const isCancelled = task.status === 'cancelled';
            const typeLabel = TASK_TYPE_LABELS[task.taskType] ?? task.taskType;
            const typeVariant = TASK_TYPE_VARIANTS[task.taskType] ?? 'neutral';
            const priorityVariant = PRIORITY_VARIANTS[task.priority] ?? 'sage';

            const dueClassification = task.status === 'pending'
              ? getTaskDueClassification(task.dueAt)
              : 'none';

            let dueLabel: string | null = null;
            if (task.dueAt) {
              const d = new Date(task.dueAt);
              dueLabel = d.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              });
            }

            return (
              <Card
                key={task.id}
                className={`transition hover:border-line-strong ${
                  isCompleted
                    ? 'bg-page/40 opacity-80'
                    : isCancelled
                      ? 'bg-page/30 opacity-60'
                      : 'bg-card'
                }`}
              >
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => void handleToggleComplete(task)}
                        disabled={togglingId === task.id || isCancelled}
                        className="mt-0.5 rounded-full text-muted hover:text-sage focus:outline-hidden disabled:opacity-50 cursor-pointer"
                        aria-label={
                          isCompleted
                            ? 'Mark task as pending'
                            : isCancelled
                              ? 'Task is cancelled'
                              : 'Mark task as completed'
                        }
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="h-5 w-5 text-success" />
                        ) : isCancelled ? (
                          <XCircle className="h-5 w-5 text-muted" />
                        ) : (
                          <Circle className="h-5 w-5" />
                        )}
                      </button>

                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/dashboard/tasks/${task.id}`}
                            className={`text-base font-semibold transition hover:text-sage ${
                              isCompleted || isCancelled
                                ? 'line-through text-muted'
                                : 'text-forest'
                            }`}
                          >
                            {task.title}
                          </Link>
                          <Badge variant={typeVariant} className="text-[10px]">
                            {typeLabel}
                          </Badge>
                          {task.priority !== 'normal' ? (
                            <Badge variant={priorityVariant} className="text-[10px] capitalize">
                              {task.priority} Priority
                            </Badge>
                          ) : null}

                          {/* Due Classification Badges */}
                          {dueClassification === 'overdue' ? (
                            <Badge variant="critical" className="text-[10px]">
                              Overdue
                            </Badge>
                          ) : dueClassification === 'today' ? (
                            <Badge variant="warning" className="text-[10px]">
                              Due Today
                            </Badge>
                          ) : dueClassification === 'upcoming' ? (
                            <Badge variant="sage" className="text-[10px]">
                              Upcoming
                            </Badge>
                          ) : null}

                          {isCancelled ? (
                            <Badge variant="neutral" className="text-[10px]">
                              Cancelled
                            </Badge>
                          ) : null}

                          {task.scheduleTitle || task.scheduleId ? (
                            <Badge variant="sage" className="text-[10px]">
                              Recurring
                            </Badge>
                          ) : null}
                        </div>

                        {task.description ? (
                          <p className="text-xs text-muted line-clamp-2">{task.description}</p>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted">
                          {task.gardenName ? (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3 text-sage" aria-hidden="true" />
                              {task.gardenName}
                            </span>
                          ) : null}

                          {task.plantName ? (
                            <span className="flex items-center gap-1 font-medium text-ink">
                              <Sprout className="h-3 w-3 text-sage" aria-hidden="true" />
                              {task.plantName}
                            </span>
                          ) : null}

                          {dueLabel ? (
                            <span
                              className={`flex items-center gap-1 ${
                                dueClassification === 'overdue'
                                  ? 'font-medium text-critical'
                                  : dueClassification === 'today'
                                    ? 'font-medium text-warning'
                                    : ''
                              }`}
                            >
                              <Calendar className="h-3 w-3" aria-hidden="true" />
                              Due: {dueLabel}
                            </span>
                          ) : null}

                          {task.completedAt ? (
                            <span className="flex items-center gap-1 text-success">
                              <Clock className="h-3 w-3" aria-hidden="true" />
                              Completed {new Date(task.completedAt).toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {task.status === 'pending' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2 text-muted hover:text-critical"
                          onClick={() => void handleCancelTask(task)}
                          disabled={togglingId === task.id}
                        >
                          Cancel
                        </Button>
                      ) : null}
                      <Link
                        to={`/dashboard/tasks/${task.id}`}
                        className={buttonStyles('secondary', 'sm', 'h-7 text-xs px-2.5')}
                      >
                        Details
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

