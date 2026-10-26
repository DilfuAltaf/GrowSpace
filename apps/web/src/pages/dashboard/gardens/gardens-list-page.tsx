import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Plus, RefreshCw, Sprout } from 'lucide-react';
import type { GrowingMethod } from '@growspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { CardSkeleton } from '@/components/ui/loading';
import { PageHeader } from '@/components/ui/page-header';
import { fetchGardens, type GardenWithStats } from '@/lib/api';

const GROWING_METHOD_LABELS: Record<GrowingMethod, string> = {
  soil: 'Soil / In-Ground',
  hydroponic: 'Hydroponic',
  container: 'Container / Pot',
  raised_bed: 'Raised Bed',
  other: 'Other Method',
};

export function GardensListPage() {
  const [gardens, setGardens] = useState<GardenWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchGardens();
      setGardens(res.gardens);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load your gardens. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    fetchGardens(controller.signal)
      .then((res) => {
        if (isMounted) {
          setGardens(res.gardens);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted && !controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : 'Unable to load your gardens. Please try again.',
          );
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Spaces"
        title="Gardens"
        description="Organize your growing environments, track capacity, and group your plants."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />}
              onClick={() => {
                void refresh();
              }}
              disabled={loading}
              aria-label="Refresh gardens list"
            >
              Refresh
            </Button>
            <Link to="/dashboard/gardens/new" className={buttonStyles('primary')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create Garden
            </Link>
          </div>
        }
      />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <ErrorState
          title="Could not load gardens"
          message={error}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void refresh();
              }}
            >
              Try again
            </Button>
          }
        />
      ) : gardens.length === 0 ? (
        <EmptyState
          icon={Sprout}
          title="No gardens yet"
          description="Create your first garden space to organize your plants, logs, and sensor telemetry."
          action={
            <Link to="/dashboard/gardens/new" className={buttonStyles('primary')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create Garden
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {gardens.map((garden) => {
            const plantCount = garden.plantCount ?? 0;
            return (
              <Card
                key={garden.id}
                className="flex flex-col transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-float"
              >
                <CardHeader className="pb-3">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{garden.name}</CardTitle>
                      {garden.growingMethod ? (
                        <Badge variant="sage">
                          {GROWING_METHOD_LABELS[garden.growingMethod] ?? garden.growingMethod}
                        </Badge>
                      ) : null}
                    </div>

                    {garden.locationLabel ? (
                      <p className="flex items-center gap-1 text-xs text-muted">
                        <MapPin className="h-3 w-3 shrink-0 text-sage" aria-hidden="true" />
                        <span>{garden.locationLabel}</span>
                      </p>
                    ) : null}
                  </div>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col justify-between space-y-4">
                  <p className="text-sm text-muted line-clamp-2">
                    {garden.description || 'No description provided.'}
                  </p>

                  <div className="flex items-center justify-between border-t border-line/60 pt-3">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-forest">
                      <Sprout className="h-3.5 w-3.5 text-sage" aria-hidden="true" />
                      {plantCount} {plantCount === 1 ? 'plant' : 'plants'}
                    </span>

                    <div className="flex items-center gap-2">
                      <Link
                        to={`/dashboard/gardens/${garden.id}/edit`}
                        className={buttonStyles('ghost', 'sm')}
                      >
                        Edit
                      </Link>
                      <Link
                        to={`/dashboard/gardens/${garden.id}`}
                        className={buttonStyles('secondary', 'sm')}
                      >
                        View
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
