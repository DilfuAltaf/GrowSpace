import {
  Activity,
  BarChart3,
  Bell,
  Calendar,
  LayoutDashboard,
  Leaf,
  ListChecks,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  Sprout,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { Brand } from '@/components/brand';
import { cn, getInitials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { fetchNotifications } from '@/lib/api';

const navigation = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/dashboard/gardens', label: 'Gardens', icon: Sprout },
  { to: '/dashboard/plants', label: 'My Plants', icon: Leaf },
  { to: '/dashboard/assistant', label: 'AI Assistant', icon: Sparkles },
  { to: '/dashboard/monitoring', label: 'Monitoring', icon: Activity },
  { to: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/dashboard/tasks', label: 'Care Tasks', icon: ListChecks },
  { to: '/dashboard/calendar', label: 'Care Calendar', icon: Calendar },
  { to: '/dashboard/notifications', label: 'Notifications', icon: Bell },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings },
];

const mobileNavigation = navigation.filter((item) =>
  ['/dashboard', '/dashboard/gardens', '/dashboard/monitoring', '/dashboard/tasks'].includes(item.to),
);

function NavItems({
  onNavigate,
  unreadCount = 0,
}: {
  onNavigate?: () => void;
  unreadCount?: number;
}) {
  return (
    <nav className="space-y-1" aria-label="Dashboard navigation">
      {navigation.map((item) => {
        const isNotifications = item.to === '/dashboard/notifications';
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-soft-sage text-forest'
                  : 'text-muted hover:bg-soft-sage/50 hover:text-forest',
              )
            }
          >
            <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
            <span className="flex-1">{item.label}</span>
            {isNotifications && unreadCount > 0 ? (
              <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-forest px-1.5 text-[10px] font-bold text-white tabular-nums">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            ) : null}
          </NavLink>
        );
      })}
    </nav>
  );
}

export function DashboardLayout() {
  const { user, signOutUser } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const displayName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Grower';
  const today = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    fetchNotifications({ limit: 1, signal: controller.signal })
      .then((res) => {
        if (isMounted) {
          setUnreadCount(res.unreadCount);
        }
      })
      .catch(() => {
        // Silently handled in layout
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  async function handleSignOut() {
    await signOutUser();
    navigate('/', { replace: true });
  }

  return (
    <div className="min-h-screen bg-page">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-card lg:flex">
        <div className="flex h-[72px] items-center border-b border-line px-5">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavItems unreadCount={unreadCount} />
        </div>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-control px-2 py-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-forest text-xs font-semibold text-white">
              {getInitials(displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{displayName}</p>
              <p className="truncate text-xs text-muted">{user?.email}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start"
            icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
            onClick={handleSignOut}
          >
            Sign out
          </Button>
        </div>
      </aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between gap-3 border-b border-line bg-page/90 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-control border border-line-strong bg-card text-forest lg:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="lg:hidden">
              <Brand />
            </div>
            <p className="hidden text-sm text-muted sm:block">{today}</p>
          </div>

          <div className="flex items-center gap-3">
            {/* Header Notification Bell */}
            <Link
              to="/dashboard/notifications"
              className="relative flex h-10 w-10 items-center justify-center rounded-control border border-line bg-card text-forest transition hover:bg-soft-sage/50"
              aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
              title="Notifications"
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unreadCount > 0 ? (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-forest px-1 text-[9px] font-bold text-white shadow-xs">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              ) : null}
            </Link>

            <span className="hidden max-w-[180px] truncate text-sm font-medium text-ink sm:block">
              {displayName}
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-forest text-xs font-semibold text-white">
              {getInitials(displayName)}
            </span>
          </div>
        </header>

        <main className="container-page max-w-[1200px] px-4 py-6 pb-28 sm:px-6 sm:py-8 lg:px-8 lg:pb-10">
          <Outlet />
        </main>
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-forest/40"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation overlay"
          />
          <div
            className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col bg-card shadow-float"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="flex h-[72px] items-center justify-between border-b border-line px-5">
              <Brand />
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-control text-muted hover:bg-soft-sage"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <NavItems
                unreadCount={unreadCount}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
            <div className="border-t border-line p-3">
              <Button
                variant="ghost"
                className="w-full justify-start"
                icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
                onClick={handleSignOut}
              >
                Sign out
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Primary mobile navigation"
      >
        <div className="grid grid-cols-4">
          {mobileNavigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[60px] flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium',
                  isActive ? 'text-forest' : 'text-muted',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={cn('h-5 w-5', isActive && 'text-sage')}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
