import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Filter,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  Sprout,
} from 'lucide-react';
import {
  formatDate,
  getCalendarMonthDays,
  getCalendarWeekDays,
  getTaskDueClassification,
  TASK_TYPES,
  type TaskStatus,
} from '@growspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import {
  fetchGardens,
  fetchTasks,
  updateTask,
  type CareTaskWithDetails,
  type GardenWithStats,
} from '@/lib/api';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CareCalendarPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Navigation and date state
  const today = useMemo(() => new Date(), []);
  const [currentYear, setCurrentYear] = useState<number>(() => today.getUTCFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(() => today.getUTCMonth());
  const [selectedWeekDate, setSelectedWeekDate] = useState<Date>(() => today);

  // View state: month, week, or list
  const initialView = (searchParams.get('view') as 'month' | 'week' | 'list') || 'month';
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'list'>(initialView);

  // Data & filter state
  const [tasks, setTasks] = useState<CareTaskWithDetails[]>([]);
  const [gardens, setGardens] = useState<GardenWithStats[]>([]);
  const [selectedGardenId, setSelectedGardenId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);

  // Sync viewMode to search params
  const handleViewChange = (mode: 'month' | 'week' | 'list') => {
    setViewMode(mode);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('view', mode);
      return next;
    });
  };

  // Compute month / week calendar days
  const monthDays = useMemo(
    () => getCalendarMonthDays(currentYear, currentMonth, today),
    [currentYear, currentMonth, today],
  );

  const weekDays = useMemo(
    () => getCalendarWeekDays(selectedWeekDate, today),
    [selectedWeekDate, today],
  );

  // Date range for current view
  const currentRange = useMemo(() => {
    if (viewMode === 'month') {
      const first = monthDays[0]?.dateStr;
      const last = monthDays[monthDays.length - 1]?.dateStr;
      return { from: first ? `${first}T00:00:00.000Z` : undefined, to: last ? `${last}T23:59:59.999Z` : undefined };
    }
    if (viewMode === 'week') {
      const first = weekDays[0]?.dateStr;
      const last = weekDays[weekDays.length - 1]?.dateStr;
      return { from: first ? `${first}T00:00:00.000Z` : undefined, to: last ? `${last}T23:59:59.999Z` : undefined };
    }
    return { from: undefined, to: undefined };
  }, [viewMode, monthDays, weekDays]);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    Promise.all([
      fetchTasks({
        gardenId: selectedGardenId || undefined,
        status: selectedStatus === 'all' ? undefined : selectedStatus,
        search: searchQuery.trim() || undefined,
        from: currentRange.from,
        to: currentRange.to,
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
          setError(err instanceof Error ? err.message : 'Unable to load calendar tasks.');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [
    currentYear,
    currentMonth,
    selectedWeekDate,
    viewMode,
    selectedGardenId,
    selectedStatus,
    searchQuery,
    currentRange,
    refreshKey,
  ]);

  const loadData = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  // Navigate dates
  const handlePrev = () => {
    if (viewMode === 'month') {
      if (currentMonth === 0) {
        setCurrentMonth(11);
        setCurrentYear((y) => y - 1);
      } else {
        setCurrentMonth((m) => m - 1);
      }
    } else {
      const prev = new Date(selectedWeekDate.getTime());
      prev.setUTCDate(prev.getUTCDate() - 7);
      setSelectedWeekDate(prev);
    }
  };

  const handleNext = () => {
    if (viewMode === 'month') {
      if (currentMonth === 11) {
        setCurrentMonth(0);
        setCurrentYear((y) => y + 1);
      } else {
        setCurrentMonth((m) => m + 1);
      }
    } else {
      const next = new Date(selectedWeekDate.getTime());
      next.setUTCDate(next.getUTCDate() + 7);
      setSelectedWeekDate(next);
    }
  };

  const handleToday = () => {
    const now = new Date();
    setCurrentYear(now.getUTCFullYear());
    setCurrentMonth(now.getUTCMonth());
    setSelectedWeekDate(now);
  };

  // Toggle task completion
  const handleToggleTask = async (task: CareTaskWithDetails, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      setTogglingTaskId(task.id);
      const nextStatus: TaskStatus = task.status === 'completed' ? 'pending' : 'completed';
      const res = await updateTask(task.id, { status: nextStatus });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? res.task : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task state.');
    } finally {
      setTogglingTaskId(null);
    }
  };

  // Group tasks by date string (YYYY-MM-DD)
  const tasksByDate = useMemo(() => {
    const map = new Map<string, CareTaskWithDetails[]>();
    for (const task of tasks) {
      if (!task.dueAt) continue;
      const dateKey = task.dueAt.split('T')[0]!;
      const list = map.get(dateKey) || [];
      list.push(task);
      map.set(dateKey, list);
    }
    return map;
  }, [tasks]);

  // Filter tasks matching search query
  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const q = searchQuery.toLowerCase().trim();
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.description && t.description.toLowerCase().includes(q)) ||
        (t.plantName && t.plantName.toLowerCase().includes(q)),
    );
  }, [tasks, searchQuery]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Schedule"
        title="Care Calendar"
        description="Plan, visualize, and track watering, fertilizing, pruning, and harvesting activities."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />}
              onClick={() => void loadData()}
              disabled={loading}
              aria-label="Refresh calendar"
            >
              Refresh
            </Button>
            <Link to="/dashboard/tasks" className={buttonStyles('secondary')}>
              <ListChecks className="h-4 w-4" aria-hidden="true" />
              Task List
            </Link>
            <Link to="/dashboard/tasks/new" className={buttonStyles('primary')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create Task
            </Link>
          </div>
        }
      />

      {/* Control bar: Month/Week Navigation & View Switcher */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-card border border-line bg-card/60 p-3.5">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handlePrev} aria-label="Previous period">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={handleToday} className="text-xs">
            Today
          </Button>
          <Button variant="ghost" size="sm" onClick={handleNext} aria-label="Next period">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="text-base sm:text-lg font-semibold text-ink ml-1 tabular-nums">
            {viewMode === 'month'
              ? `${MONTH_NAMES[currentMonth]} ${currentYear}`
              : viewMode === 'week'
                ? `Week of ${formatDate(weekDays[0]?.dateStr)}`
                : 'All Scheduled Tasks'}
          </h2>
        </div>

        <div className="flex items-center gap-1.5 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => handleViewChange('month')}
            className={`px-3 py-1.5 text-xs font-medium rounded-control transition-colors ${
              viewMode === 'month' ? 'bg-forest text-white' : 'bg-muted/10 text-muted hover:bg-muted/20'
            }`}
          >
            Month
          </button>
          <button
            type="button"
            onClick={() => handleViewChange('week')}
            className={`px-3 py-1.5 text-xs font-medium rounded-control transition-colors ${
              viewMode === 'week' ? 'bg-forest text-white' : 'bg-muted/10 text-muted hover:bg-muted/20'
            }`}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => handleViewChange('list')}
            className={`px-3 py-1.5 text-xs font-medium rounded-control transition-colors ${
              viewMode === 'list' ? 'bg-forest text-white' : 'bg-muted/10 text-muted hover:bg-muted/20'
            }`}
          >
            List
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
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
          aria-label="Filter calendar by garden"
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
          aria-label="Filter calendar by status"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        {/* Search input */}
        <div className="relative flex-1 min-w-[160px] max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-2.5 py-1 text-xs rounded-control border border-line bg-card text-ink placeholder:text-muted focus:border-sage focus:outline-hidden"
            aria-label="Search tasks by title"
          />
        </div>

        {selectedGardenId || selectedStatus !== 'all' || searchQuery ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 px-2"
            onClick={() => {
              setSelectedGardenId('');
              setSelectedStatus('all');
              setSearchQuery('');
            }}
          >
            Reset
          </Button>
        ) : null}
      </div>

      {error ? (
        <ErrorState
          title="Calendar Error"
          message={error}
          action={
            <Button variant="secondary" size="sm" onClick={() => void loadData()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {/* MONTH VIEW */}
      {viewMode === 'month' && !error ? (
        <div className="overflow-x-auto rounded-card border border-line bg-card shadow-xs">
          <div className="min-w-[700px]">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b border-line bg-soft-sage/30 text-center text-xs font-semibold text-muted py-2">
              {WEEKDAY_NAMES.map((name) => (
                <div key={name} className="py-0.5">
                  {name}
                </div>
              ))}
            </div>

            {/* 42-day calendar grid */}
            <div className="grid grid-cols-7 divide-x divide-y divide-line">
              {monthDays.map((day) => {
                const dayTasks = tasksByDate.get(day.dateStr) || [];
                return (
                  <div
                    key={day.dateStr}
                    className={`min-h-[110px] p-2 flex flex-col transition-colors ${
                      !day.isCurrentMonth
                        ? 'bg-muted/5 text-muted/60'
                        : day.isToday
                          ? 'bg-soft-sage/20'
                          : 'bg-card hover:bg-soft-sage/10'
                    }`}
                  >
                    {/* Day Header with quick add */}
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className={`text-xs font-bold flex items-center justify-center h-6 w-6 rounded-full tabular-nums ${
                          day.isToday
                            ? 'bg-forest text-white'
                            : day.isCurrentMonth
                              ? 'text-ink'
                              : 'text-muted'
                        }`}
                      >
                        {day.dayOfMonth}
                      </span>
                      <Link
                        to={`/dashboard/tasks/new?date=${day.dateStr}`}
                        title={`Add task for ${day.dateStr}`}
                        className="opacity-40 hover:opacity-100 p-0.5 text-muted hover:text-forest transition-opacity"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Link>
                    </div>

                    {/* Day Task Pills */}
                    <div className="space-y-1 flex-1 overflow-y-auto max-h-[100px]">
                      {dayTasks.map((t) => {
                        const classification = getTaskDueClassification(t.dueAt, today);
                        const isDone = t.status === 'completed';
                        const isToggling = togglingTaskId === t.id;

                        let badgeColor: string;
                        if (isDone) {
                          badgeColor = 'bg-emerald-50 text-emerald-800 border-emerald-200 line-through opacity-75';
                        } else if (classification === 'overdue') {
                          badgeColor = 'bg-rose-50 text-rose-800 border-rose-200';
                        } else if (classification === 'today') {
                          badgeColor = 'bg-amber-50 text-amber-800 border-amber-200 font-semibold';
                        } else {
                          badgeColor = 'bg-teal-50 text-teal-800 border-teal-200';
                        }

                        return (
                          <div
                            key={t.id}
                            onClick={() => navigate(`/dashboard/tasks/${t.id}`)}
                            className={`group cursor-pointer flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded border transition-all hover:shadow-xs ${badgeColor}`}
                            title={`${t.title} (${t.status})`}
                          >
                            <button
                              type="button"
                              onClick={(e) => void handleToggleTask(t, e)}
                              disabled={isToggling}
                              aria-label={isDone ? 'Reopen task' : 'Mark task completed'}
                              className="focus:outline-hidden"
                            >
                              {isDone ? (
                                <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                              ) : (
                                <Circle className="h-3 w-3 text-muted/60 group-hover:text-forest shrink-0" />
                              )}
                            </button>
                            <span className="truncate flex-1">{t.title}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* WEEK VIEW */}
      {viewMode === 'week' && !error ? (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          {weekDays.map((day) => {
            const dayTasks = tasksByDate.get(day.dateStr) || [];
            return (
              <Card
                key={day.dateStr}
                className={`flex flex-col border ${day.isToday ? 'border-forest ring-1 ring-forest/30' : 'border-line'}`}
              >
                <div className={`p-3 border-b border-line flex items-center justify-between ${day.isToday ? 'bg-soft-sage/30' : 'bg-muted/5'}`}>
                  <div>
                    <div className="text-[11px] font-medium text-muted uppercase tracking-wider">
                      {new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(day.date)}
                    </div>
                    <div className="text-base font-bold text-ink tabular-nums">
                      {formatDate(day.dateStr)}
                    </div>
                  </div>
                  <Link
                    to={`/dashboard/tasks/new?date=${day.dateStr}`}
                    className="p-1 rounded-control text-muted hover:text-forest hover:bg-soft-sage transition-colors"
                    title={`Add task on ${day.dateStr}`}
                  >
                    <Plus className="h-4 w-4" />
                  </Link>
                </div>

                <CardContent className="p-3 flex-1 space-y-2">
                  {dayTasks.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted">No care tasks scheduled</div>
                  ) : (
                    dayTasks.map((t) => {
                      const classification = getTaskDueClassification(t.dueAt, today);
                      const isDone = t.status === 'completed';
                      return (
                        <div
                          key={t.id}
                          onClick={() => navigate(`/dashboard/tasks/${t.id}`)}
                          className="p-2 rounded-control border border-line bg-card hover:border-sage hover:shadow-xs transition-all cursor-pointer space-y-1.5"
                        >
                          <div className="flex items-start gap-2">
                            <button
                              type="button"
                              onClick={(e) => void handleToggleTask(t, e)}
                              className="mt-0.5 text-muted hover:text-forest focus:outline-hidden"
                            >
                              {isDone ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              ) : (
                                <Circle className="h-4 w-4" />
                              )}
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-semibold text-ink leading-tight truncate ${isDone ? 'line-through text-muted' : ''}`}>
                                {t.title}
                              </p>
                              {t.plantName ? (
                                <p className="text-[10px] text-muted truncate mt-0.5 flex items-center gap-1">
                                  <Sprout className="h-3 w-3" />
                                  <span>{t.plantName}</span>
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 text-[10px]">
                            <Badge variant={isDone ? 'success' : classification === 'overdue' ? 'critical' : classification === 'today' ? 'warning' : 'sage'}>
                              {isDone ? 'Completed' : classification === 'overdue' ? 'Overdue' : classification === 'today' ? 'Today' : 'Upcoming'}
                            </Badge>
                            <span className="text-muted uppercase text-[9px] font-semibold tracking-wider">
                              {TASK_TYPES[t.taskType] || t.taskType}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* ACCESSIBLE LIST VIEW */}
      {viewMode === 'list' && !error ? (
        <div className="space-y-4">
          {filteredTasks.length === 0 ? (
            <EmptyState
              icon={CalendarIcon}
              title="No tasks scheduled"
              description="There are no care tasks scheduled for this selection."
              action={
                <Link to="/dashboard/tasks/new" className={buttonStyles('primary')}>
                  <Plus className="h-4 w-4" />
                  Schedule Care Task
                </Link>
              }
            />
          ) : (
            <div className="divide-y divide-line rounded-card border border-line bg-card shadow-xs">
              {filteredTasks.map((t) => {
                const classification = getTaskDueClassification(t.dueAt, today);
                const isDone = t.status === 'completed';
                return (
                  <div
                    key={t.id}
                    className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-soft-sage/15 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() => void handleToggleTask(t)}
                        className="mt-0.5 text-muted hover:text-forest focus:outline-hidden"
                        aria-label={isDone ? 'Reopen task' : 'Mark task completed'}
                      >
                        {isDone ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        ) : (
                          <Circle className="h-5 w-5" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <Link
                          to={`/dashboard/tasks/${t.id}`}
                          className={`text-sm font-semibold text-ink hover:text-forest transition-colors truncate block ${
                            isDone ? 'line-through text-muted' : ''
                          }`}
                        >
                          {t.title}
                        </Link>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted mt-1">
                          {t.dueAt ? (
                            <span className="flex items-center gap-1 tabular-nums">
                              <Clock className="h-3.5 w-3.5" />
                              {formatDate(t.dueAt)}
                            </span>
                          ) : null}
                          {t.gardenName ? <span>• {t.gardenName}</span> : null}
                          {t.plantName ? <span>• Plant: {t.plantName}</span> : null}
                          {t.scheduleTitle ? (
                            <span className="text-forest font-medium">• Recurring: {t.scheduleTitle}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      <Badge
                        variant={
                          isDone
                            ? 'success'
                            : classification === 'overdue'
                              ? 'critical'
                              : classification === 'today'
                                ? 'warning'
                                : 'sage'
                        }
                      >
                        {isDone ? 'Completed' : classification === 'overdue' ? 'Overdue' : classification === 'today' ? 'Due Today' : 'Upcoming'}
                      </Badge>
                      <Link to={`/dashboard/tasks/${t.id}`} className={buttonStyles('ghost', 'sm')}>
                        View Details
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
