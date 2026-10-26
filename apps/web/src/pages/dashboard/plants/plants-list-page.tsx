import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Filter, MapPin, Plus, RefreshCw, Sprout } from 'lucide-react';
import type { GrowthStage, PlantStatus } from '@growspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { CardSkeleton } from '@/components/ui/loading';
import { PageHeader } from '@/components/ui/page-header';
import { fetchGardens, fetchPlants, type GardenWithStats, type PlantWithDetails } from '@/lib/api';

const GROWTH_STAGE_LABELS: Record<GrowthStage, string> = {
  seedling: 'Seedling',
  vegetative: 'Vegetative',
  flowering: 'Flowering',
  fruiting: 'Fruiting',
  harvested: 'Harvested',
};

const GROWTH_STAGE_VARIANTS: Record<GrowthStage, 'neutral' | 'sage' | 'success' | 'warning' | 'info'> = {
  seedling: 'info',
  vegetative: 'sage',
  flowering: 'warning',
  fruiting: 'success',
  harvested: 'neutral',
};

export function PlantsListPage() {
  const [plants, setPlants] = useState<PlantWithDetails[]>([]);
  const [gardens, setGardens] = useState<GardenWithStats[]>([]);
  const [selectedGardenId, setSelectedGardenId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<PlantStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);

      const [plantsRes, gardensRes] = await Promise.all([
        fetchPlants({ gardenId: selectedGardenId || undefined, signal }),
        fetchGardens(signal),
      ]);

      setPlants(plantsRes.plants);
      setGardens(gardensRes.gardens);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : 'Unable to load plants. Please try again.');
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
      fetchPlants({ gardenId: selectedGardenId || undefined, signal: controller.signal }),
      fetchGardens(controller.signal),
    ])
      .then(([plantsRes, gardensRes]) => {
        if (isMounted) {
          setPlants(plantsRes.plants);
          setGardens(gardensRes.gardens);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted && !controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Unable to load plants.');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [selectedGardenId]);

  const filteredPlants = plants.filter((plant) => {
    if (selectedStatus !== 'all' && plant.status !== selectedStatus) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cultivation"
        title="My Plants"
        description="Track active crops, growth stages, planting dates, and garden locations."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />}
              onClick={() => {
                void loadData();
              }}
              disabled={loading}
              aria-label="Refresh plants list"
            >
              Refresh
            </Button>
            <Link to="/dashboard/plants/new" className={buttonStyles('primary')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Plant
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
          aria-label="Filter plants by garden"
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
          onChange={(e) => setSelectedStatus(e.target.value as PlantStatus | 'all')}
          className="rounded-control border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink focus:border-sage focus:outline-hidden"
          aria-label="Filter plants by operational status"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="harvested">Harvested</option>
          <option value="archived">Archived</option>
        </select>

        {selectedGardenId || selectedStatus !== 'all' ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 px-2"
            onClick={() => {
              setSelectedGardenId('');
              setSelectedStatus('all');
            }}
          >
            Reset filters
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <ErrorState
          title="Could not load plants"
          message={error}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void loadData();
              }}
            >
              Try again
            </Button>
          }
        />
      ) : filteredPlants.length === 0 ? (
        <EmptyState
          icon={Sprout}
          title={plants.length === 0 ? 'No plants added yet' : 'No matching plants'}
          description={
            plants.length === 0
              ? 'Add a plant from our curated reference catalog or register a custom home-grown specimen.'
              : 'No plants matched your selected garden or status filter.'
          }
          action={
            plants.length === 0 ? (
              <Link to="/dashboard/plants/new" className={buttonStyles('primary')}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Plant
              </Link>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSelectedGardenId('');
                  setSelectedStatus('all');
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPlants.map((plant) => {
            const displayName =
              plant.customName || plant.catalog?.commonName || 'Unnamed Plant';
            const scientificName = plant.catalog?.scientificName;
            const stageVariant =
              GROWTH_STAGE_VARIANTS[plant.growthStage] ?? 'sage';
            const stageLabel =
              GROWTH_STAGE_LABELS[plant.growthStage] ?? plant.growthStage;

            return (
              <Card
                key={plant.id}
                className="flex flex-col transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-float"
              >
                <CardHeader className="pb-3">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{displayName}</CardTitle>
                      <Badge variant={stageVariant}>{stageLabel}</Badge>
                      {plant.status !== 'active' ? (
                        <Badge variant="outline" className="text-xs capitalize">
                          {plant.status}
                        </Badge>
                      ) : null}
                    </div>

                    {scientificName ? (
                      <p className="text-xs italic text-muted">{scientificName}</p>
                    ) : null}

                    {plant.gardenName ? (
                      <p className="flex items-center gap-1 text-xs text-muted">
                        <MapPin className="h-3 w-3 shrink-0 text-sage" aria-hidden="true" />
                        <span>{plant.gardenName}</span>
                      </p>
                    ) : null}
                  </div>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col justify-between space-y-4">
                  <div className="space-y-2 text-xs text-muted">
                    {plant.plantingDate ? (
                      <p className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-sage" aria-hidden="true" />
                        <span>Planted: {plant.plantingDate}</span>
                      </p>
                    ) : (
                      <p className="flex items-center gap-1.5 text-muted/70">
                        <Calendar className="h-3.5 w-3.5 text-muted/50" aria-hidden="true" />
                        <span>Planted date not set</span>
                      </p>
                    )}

                    {plant.notes ? (
                      <p className="line-clamp-2 text-ink/80 italic pt-1 border-t border-line/40">
                        "{plant.notes}"
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-end gap-2 border-t border-line/60 pt-3">
                    <Link
                      to={`/dashboard/plants/${plant.id}/edit`}
                      className={buttonStyles('ghost', 'sm')}
                    >
                      Edit
                    </Link>
                    <Link
                      to={`/dashboard/plants/${plant.id}`}
                      className={buttonStyles('secondary', 'sm')}
                    >
                      View
                    </Link>
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
