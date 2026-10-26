import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Clock,
  Filter,
  Sparkles,
} from 'lucide-react';
import {
  NOTIFICATION_TYPES,
  formatDateTime,
  type Notification,
  type NotificationType,
} from '@growspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { CardSkeleton } from '@/components/ui/loading';
import { PageHeader } from '@/components/ui/page-header';
import {
  fetchNotifications,
  generateNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api';

const TYPE_VARIANTS: Record<NotificationType, 'neutral' | 'sage' | 'warning' | 'info'> = {
  care_task: 'warning',
  environmental: 'info',
  lifecycle: 'sage',
  system: 'neutral',
};

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedType, setSelectedType] = useState<NotificationType | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchNotifications({
        unreadOnly,
        type: selectedType === 'all' ? undefined : selectedType,
        signal,
      });
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
      setTotal(res.total);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : 'Unable to load notifications.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    fetchNotifications({
      unreadOnly,
      type: selectedType === 'all' ? undefined : selectedType,
      signal: controller.signal,
    })
      .then((res) => {
        if (isMounted) {
          setNotifications(res.notifications);
          setUnreadCount(res.unreadCount);
          setTotal(res.total);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted && !controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Unable to load notifications.');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [unreadOnly, selectedType]);

  const handleToggleRead = async (notif: Notification) => {
    try {
      setActionInProgress(notif.id);
      const nextRead = !notif.isRead;
      const res = await markNotificationRead(notif.id, nextRead);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? res.notification : n)),
      );
      setUnreadCount((prev) => (nextRead ? Math.max(prev - 1, 0) : prev + 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update notification status.');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      setActionInProgress('all');
      await markAllNotificationsRead();
      setNotifications((prev) =>
        prev.map((n) => ({
          ...n,
          isRead: true,
          readAt: new Date().toISOString(),
        })),
      );
      setUnreadCount(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark all as read.');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleCheckReminders = async () => {
    try {
      setRefreshing(true);
      setError(null);
      await generateNotifications();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check reminders.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Alerts"
        title="Notification Center"
        description="Stay updated with scheduled care reminders, environmental alerts, and crop lifecycle updates."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Sparkles className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />}
              onClick={() => void handleCheckReminders()}
              disabled={refreshing || loading}
            >
              Check for Reminders
            </Button>
            {unreadCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<CheckCheck className="h-4 w-4" />}
                onClick={() => void handleMarkAllRead()}
                disabled={actionInProgress === 'all'}
              >
                Mark all as read
              </Button>
            ) : null}
          </div>
        }
      />

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-card/60 p-3.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Filters:</span>
        </div>

        {/* Unread / All Filter */}
        <div className="inline-flex rounded-control border border-line bg-card p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setUnreadOnly(false)}
            className={`rounded-control px-2.5 py-1 font-medium transition ${
              !unreadOnly ? 'bg-soft-sage font-semibold text-forest' : 'text-muted hover:text-ink'
            }`}
          >
            All ({total})
          </button>
          <button
            type="button"
            onClick={() => setUnreadOnly(true)}
            className={`rounded-control px-2.5 py-1 font-medium transition ${
              unreadOnly ? 'bg-soft-sage font-semibold text-forest' : 'text-muted hover:text-ink'
            }`}
          >
            Unread ({unreadCount})
          </button>
        </div>

        {/* Type Filter */}
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value as NotificationType | 'all')}
          className="rounded-control border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink focus:border-sage focus:outline-hidden"
          aria-label="Filter notifications by category"
        >
          <option value="all">All Categories</option>
          {(Object.keys(NOTIFICATION_TYPES) as NotificationType[]).map((t) => (
            <option key={t} value={t}>
              {NOTIFICATION_TYPES[t]}
            </option>
          ))}
        </select>

        {unreadOnly || selectedType !== 'all' ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 px-2"
            onClick={() => {
              setUnreadOnly(false);
              setSelectedType('all');
            }}
          >
            Reset filters
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <ErrorState
          title="Could not load notifications"
          message={error}
          action={
            <Button variant="secondary" size="sm" onClick={() => void loadData()}>
              Try again
            </Button>
          }
        />
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={unreadOnly ? BellOff : Bell}
          title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
          description={
            unreadOnly
              ? "You've read all your care reminders and environmental alerts. Great job staying on top of your garden!"
              : 'Your scheduled tasks, out-of-range sensor alerts, and harvest reminders will appear here.'
          }
          action={
            unreadOnly ? (
              <Button variant="secondary" size="sm" onClick={() => setUnreadOnly(false)}>
                Show all notifications
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                icon={<Sparkles className="h-4 w-4" />}
                onClick={() => void handleCheckReminders()}
                disabled={refreshing}
              >
                Scan for active care reminders
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {notifications.map((notif) => {
            const isUnread = !notif.isRead;
            const typeLabel = NOTIFICATION_TYPES[notif.type] ?? notif.type;
            const typeVariant = TYPE_VARIANTS[notif.type] ?? 'neutral';

            return (
              <Card
                key={notif.id}
                className={`transition hover:border-line-strong ${
                  isUnread
                    ? 'border-sage/40 bg-card shadow-xs'
                    : 'bg-page/40 opacity-80'
                }`}
              >
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {/* Unread indicator / status dot */}
                      <button
                        type="button"
                        onClick={() => void handleToggleRead(notif)}
                        disabled={actionInProgress === notif.id}
                        className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted transition hover:scale-110 focus:outline-hidden disabled:opacity-50 cursor-pointer"
                        aria-label={isUnread ? 'Mark notification as read' : 'Mark notification as unread'}
                        title={isUnread ? 'Mark as read' : 'Mark as unread'}
                      >
                        {isUnread ? (
                          <span className="h-2.5 w-2.5 rounded-full bg-forest ring-4 ring-soft-sage" />
                        ) : (
                          <Check className="h-3.5 w-3.5 text-muted hover:text-forest" />
                        )}
                      </button>

                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-sm ${
                              isUnread ? 'font-bold text-forest' : 'font-medium text-ink'
                            }`}
                          >
                            {notif.title}
                          </span>
                          <Badge variant={typeVariant} className="text-[10px]">
                            {typeLabel}
                          </Badge>
                          {isUnread ? (
                            <Badge variant="sage" className="text-[10px]">
                              New
                            </Badge>
                          ) : null}
                        </div>

                        <p className="text-xs text-muted leading-relaxed max-w-2xl">
                          {notif.message}
                        </p>

                        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-muted" aria-hidden="true" />
                            {formatDateTime(notif.createdAt)}
                          </span>

                          {notif.readAt ? (
                            <span className="text-[11px] text-muted">
                              Read {formatDateTime(notif.readAt)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {notif.link ? (
                        <Link
                          to={notif.link}
                          className={buttonStyles('secondary', 'sm', 'h-7 text-xs px-2.5')}
                        >
                          View
                          <ArrowRight className="h-3 w-3 ml-1" aria-hidden="true" />
                        </Link>
                      ) : null}
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
