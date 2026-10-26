import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Edit2,
  MapPin,
  Plus,
  RefreshCw,
  Sprout,
  Trash2,
} from 'lucide-react';
import type { GrowingMethod } from '@growspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { FullPageLoader } from '@/components/ui/loading';
import { PageHeader } from '@/components/ui/page-header';
import { deleteGarden, fetchGarden, fetchPlants, type GardenWithStats, type PlantWithDetails } from '@/lib/api';

const GROWING_METHOD_LABELS: Record<GrowingMethod, string> = {
  soil: 'Soil / In-Ground',
  hydroponic: 'Hydroponic',
  container: 'Container / Pot',
  raised_bed: 'Raised Bed',
  other: 'Other Method',
};

export function GardenDetailPage() {
  const { gardenId } = useParams<{ gardenId: string }>();
  const navigate = useNavigate();

  const [garden, setGarden] = useState<GardenWithStats | null>(null);
  const [plants, setPlants] = useState<PlantWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Deletion modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [cascadeConfirmed, setCascadeConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!gardenId) return;

    let isMounted = true;
    const controller = new AbortController();

    Promise.all([
      fetchGarden(gardenId, controller.signal),
      fetchPlants({ gardenId, signal: controller.signal }),
    ])
      .then(([gardenRes, plantsRes]) => {
        if (isMounted) {
          setGarden(gardenRes.garden);
          setPlants(plantsRes.plants);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted && !controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : 'Could not load garden details. Please try again.',
          );
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [gardenId]);

  const handleRefresh = async () => {
    if (!gardenId) return;
    try {
      setLoading(true);
      setError(null);
      const [gardenRes, plantsRes] = await Promise.all([
        fetchGarden(gardenId),
        fetchPlants({ gardenId }),
      ]);
      setGarden(gardenRes.garden);
      setPlants(plantsRes.plants);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not load garden details. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!garden) return;
    try {
      setDeleting(true);
      setDeleteError(null);
      const hasPlants = (garden.plantCount ?? 0) > 0;
      await deleteGarden(garden.id, { cascade: hasPlants });
      navigate('/dashboard/gardens');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to delete garden. Please try again.';
      setDeleteError(message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <FullPageLoader label="Loading garden..." />;
  }

  if (error || !garden) {
    return (
      <div className="space-y-4">
        <Link
          to="/dashboard/gardens"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-forest"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to gardens
        </Link>
        <ErrorState
          title="Garden not found"
          message={error || 'This garden record could not be located.'}
          action={
            <Link to="/dashboard/gardens" className={buttonStyles('secondary', 'sm')}>
              Return to gardens
            </Link>
          }
        />
      </div>
    );
  }

  const plantCount = plants.length > 0 ? plants.length : (garden.plantCount ?? 0);
  const createdDate = new Date(garden.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="space-y-6">
      <Link
        to="/dashboard/gardens"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-forest"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to gardens
      </Link>

      <PageHeader
        eyebrow="Garden Detail"
        title={garden.name}
        description={garden.description || 'Dedicated growing space.'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />}
              onClick={() => void handleRefresh()}
              disabled={loading}
              aria-label="Refresh garden and plant data"
            >
              Refresh
            </Button>
            <Link
              to={`/dashboard/gardens/${garden.id}/edit`}
              className={buttonStyles('secondary', 'sm')}
            >
              <Edit2 className="h-4 w-4" aria-hidden="true" />
              Edit Garden
            </Link>
            <Link
              to={`/dashboard/plants/new?gardenId=${garden.id}`}
              className={buttonStyles('primary', 'sm')}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Plant
            </Link>
            <Button
              variant="destructive"
              size="sm"
              icon={<Trash2 className="h-4 w-4" />}
              onClick={() => {
                setShowDeleteModal(true);
                setCascadeConfirmed(false);
                setDeleteError(null);
              }}
              aria-label="Delete this garden"
            >
              Delete
            </Button>
          </div>
        }
      />

      {/* Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted">Growing Method</CardTitle>
          </CardHeader>
          <CardContent>
            {garden.growingMethod ? (
              <Badge variant="sage" className="text-sm py-1 px-3">
                {GROWING_METHOD_LABELS[garden.growingMethod] ?? garden.growingMethod}
              </Badge>
            ) : (
              <span className="text-sm text-muted">Unspecified</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted">Location</CardTitle>
          </CardHeader>
          <CardContent>
            {garden.locationLabel ? (
              <div className="flex items-center gap-1.5 text-sm font-semibold text-forest">
                <MapPin className="h-4 w-4 text-sage" aria-hidden="true" />
                <span>{garden.locationLabel}</span>
              </div>
            ) : (
              <span className="text-sm text-muted">No location specified</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted">Active Plants</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold tabular-nums text-forest">{plantCount}</span>
              <span className="text-xs text-muted">
                {plantCount === 1 ? 'plant tracked' : 'plants tracked'}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Plants Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Plants in this Garden</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Crops and flora currently growing in this environment.
            </p>
          </div>
          <Link
            to={`/dashboard/plants/new?gardenId=${garden.id}`}
            className={buttonStyles('secondary', 'sm')}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Plant
          </Link>
        </CardHeader>
        <CardContent>
          {plants.length === 0 ? (
            <EmptyState
              icon={Sprout}
              title="No plants in this garden yet"
              description="Add a plant from our curated reference catalog or add a custom specimen to start monitoring."
              action={
                <Link
                  to={`/dashboard/plants/new?gardenId=${garden.id}`}
                  className={buttonStyles('primary', 'sm')}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Plant to {garden.name}
                </Link>
              }
            />
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {plants.map((p) => {
                  const pName = p.customName || p.catalog?.commonName || 'Plant';
                  return (
                    <div
                      key={p.id}
                      className="flex flex-col justify-between rounded-control border border-line bg-page/40 p-3.5 transition hover:border-line-strong hover:bg-page"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-sm text-forest">{pName}</p>
                          <Badge variant="sage" className="text-[10px] capitalize">
                            {p.growthStage}
                          </Badge>
                        </div>
                        {p.catalog?.scientificName ? (
                          <p className="text-xs italic text-muted">{p.catalog.scientificName}</p>
                        ) : null}
                        {p.plantingDate ? (
                          <p className="text-xs text-muted">Planted: {p.plantingDate}</p>
                        ) : null}
                      </div>

                      <div className="mt-3 flex items-center justify-end gap-2 border-t border-line/40 pt-2">
                        <Link
                          to={`/dashboard/plants/${p.id}/edit`}
                          className={buttonStyles('ghost', 'sm', 'h-7 text-xs px-2')}
                        >
                          Edit
                        </Link>
                        <Link
                          to={`/dashboard/plants/${p.id}`}
                          className={buttonStyles('secondary', 'sm', 'h-7 text-xs px-2')}
                        >
                          View
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted">
                  Showing {plants.length} {plants.length === 1 ? 'plant' : 'plants'} in this space.
                </p>
                <Link
                  to="/dashboard/plants"
                  className="text-xs font-semibold text-sage hover:text-forest"
                >
                  View all in My Plants &rarr;
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metadata footer */}
      <div className="flex items-center gap-2 text-xs text-muted">
        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Created on {createdDate}</span>
      </div>

      {/* Safe Deletion Modal */}
      {showDeleteModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
        >
          <div className="w-full max-w-md rounded-card border border-line bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-critical-surface text-critical">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 id="delete-dialog-title" className="text-lg font-semibold text-ink">
                  Delete "{garden.name}"?
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Are you sure you want to delete this garden? This action cannot be undone.
                </p>
              </div>
            </div>

            {plantCount > 0 ? (
              <div className="rounded-control border border-critical/30 bg-critical-surface/60 p-3.5 text-xs text-critical space-y-2">
                <p className="font-semibold">
                  Safe Deletion Policy Warning:
                </p>
                <p>
                  This garden contains <strong className="font-bold">{plantCount} plant(s)</strong>.
                  Deleting the garden will permanently delete all associated plants, care schedules,
                  and sensor logs.
                </p>
                <label className="flex items-start gap-2 pt-1 font-medium text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-line text-sage focus:ring-sage"
                    checked={cascadeConfirmed}
                    onChange={(e) => setCascadeConfirmed(e.target.checked)}
                  />
                  <span>I understand and confirm cascade deletion of all {plantCount} plant(s).</span>
                </label>
              </div>
            ) : null}

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
                disabled={plantCount > 0 && !cascadeConfirmed}
                onClick={handleDelete}
              >
                Delete Garden
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
