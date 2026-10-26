import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Droplets,
  Info,
  Leaf,
  Plus,
  Sprout,
  Sun,
  Thermometer,
  Wind,
  X,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  DIFFICULTIES,
  MEASUREMENTS,
  findCatalogEntry,
  type MeasurementType,
} from '@growspace/shared';
import { useAuth } from '@/features/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { SelectField, TextField } from '@/components/ui/field';
import {
  ApiClientError,
  createPlant,
  fetchGardens,
  type GardenWithStats,
} from '@/lib/api';

const measurementIcons: Record<MeasurementType, typeof Sun> = {
  air_temperature: Thermometer,
  air_humidity: Wind,
  medium_moisture: Droplets,
};

const categoryGradients: Record<string, string> = {
  Vegetables: 'from-[#DCE9D8] via-[#EDF3E8] to-[#C7DCC0]',
  Herbs: 'from-[#E7EFDF] via-[#F2F6EA] to-[#CDE0C5]',
  Fruits: 'from-[#F3E7DE] via-[#F8F1EA] to-[#E8D3C2]',
};

export function PlantDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { status } = useAuth();
  const entry = slug ? findCatalogEntry(slug) : undefined;

  // Add to Garden modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [gardens, setGardens] = useState<GardenWithStats[]>([]);
  const [loadingGardens, setLoadingGardens] = useState(false);
  const [gardenLoadError, setGardenLoadError] = useState<string | null>(null);
  const [selectedGardenId, setSelectedGardenId] = useState('');
  const [customName, setCustomName] = useState('');
  const [plantingDate, setPlantingDate] = useState(() => {
    return new Date().toISOString().split('T')[0] ?? '';
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Close modal on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalOpen && !submitting) {
        setModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalOpen, submitting]);

  const loadGardens = async () => {
    try {
      setLoadingGardens(true);
      setGardenLoadError(null);
      const res = await fetchGardens();
      setGardens(res.gardens);
      if (res.gardens.length > 0) {
        setSelectedGardenId(res.gardens[0]?.id ?? '');
      }
    } catch (err) {
      setGardenLoadError(
        err instanceof Error ? err.message : 'Unable to load gardens. Please try again.',
      );
    } finally {
      setLoadingGardens(false);
    }
  };

  const handleOpenAddModal = () => {
    setModalOpen(true);
    setSubmitError(null);
    setSuccessMessage(null);
    void loadGardens();
  };

  const handleAddSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!entry) return;
    if (!selectedGardenId) {
      setSubmitError('Please select a destination garden.');
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);
      const res = await createPlant({
        gardenId: selectedGardenId,
        catalogId: entry.id,
        customName: customName.trim() || null,
        plantingDate: plantingDate || null,
        growthStage: 'seedling',
        status: 'active',
      });

      setSuccessMessage(`Added ${entry.commonName} to your garden!`);
      setTimeout(() => {
        navigate(`/dashboard/plants/${res.plant.id}`);
      }, 500);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Failed to add plant to garden. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!entry) {
    return (
      <div className="container-page py-16">
        <EmptyState
          icon={Leaf}
          title="Plant reference not found"
          description="This reference may have moved or is not published."
          action={
            <Link to="/plants" className={buttonStyles('primary')}>
              Back to Plant Library
            </Link>
          }
        />
      </div>
    );
  }

  const gradient = categoryGradients[entry.category] ?? categoryGradients.Vegetables;

  return (
    <div className="container-page py-8 sm:py-12">
      <Link
        to="/plants"
        className="inline-flex items-center gap-1.5 rounded-control text-sm font-medium text-muted hover:text-forest"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Plant Library
      </Link>

      <div
        className={`mt-5 overflow-hidden rounded-card border border-line bg-gradient-to-br ${gradient} p-6 sm:p-10`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="sage">{entry.category}</Badge>
              {entry.difficulty ? <Badge variant="outline">{DIFFICULTIES[entry.difficulty]}</Badge> : null}
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-forest sm:text-4xl">{entry.commonName}</h1>
            {entry.scientificName ? (
              <p className="mt-1 text-sm text-forest/60 italic">{entry.scientificName}</p>
            ) : null}
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            {status === 'authenticated' ? (
              <Button
                variant="primary"
                onClick={handleOpenAddModal}
                icon={<Plus className="h-4 w-4" />}
              >
                Add to My Garden
              </Button>
            ) : (
              <Link to="/register" className={buttonStyles('primary')}>
                Create an account to add
              </Link>
            )}
            <p className="text-xs text-forest/60">Plant references are general guidance, not advice.</p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Card className="p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-forest">Care reference</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-control border border-line bg-page/60 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-forest">
                  <Sun className="h-4 w-4 text-sage" aria-hidden="true" />
                  Light
                </div>
                <p className="mt-1.5 text-sm text-muted">{entry.lightGuidance ?? 'Not specified.'}</p>
              </div>
              <div className="rounded-control border border-line bg-page/60 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-forest">
                  <Droplets className="h-4 w-4 text-info" aria-hidden="true" />
                  Watering
                </div>
                <p className="mt-1.5 text-sm text-muted">
                  {entry.wateringGuidance ?? 'Not specified.'}
                </p>
              </div>
              <div className="rounded-control border border-line bg-page/60 p-4 sm:col-span-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-forest">
                  <Leaf className="h-4 w-4 text-sage" aria-hidden="true" />
                  Growing method notes
                </div>
                <p className="mt-1.5 text-sm text-muted">
                  {entry.growingMethodNotes ?? 'Not specified.'}
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-forest">Reference ranges</h2>
              <Badge variant="outline">For guidance only</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">
              Ranges vary by variety, climate, and growing method. Use them to guide observation,
              not to make automatic changes.
            </p>

            {Object.keys(entry.referenceRanges).length > 0 ? (
              <div className="mt-4 space-y-2">
                {(Object.keys(entry.referenceRanges) as MeasurementType[]).map((type) => {
                  const range = entry.referenceRanges[type];
                  if (!range) return null;
                  const meta = MEASUREMENTS[type];
                  const Icon = measurementIcons[type];
                  return (
                    <div
                      key={type}
                      className="flex items-center justify-between gap-3 rounded-control border border-line px-4 py-3"
                    >
                      <span className="flex items-center gap-2 text-sm text-ink">
                        <Icon className="h-4 w-4 text-muted" aria-hidden="true" />
                        {meta.label}
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-forest">
                        {range.min}–{range.max}
                        {meta.unit}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted">
                No reference ranges are configured. Recommendations will ask you to check conditions
                instead of asserting a diagnosis.
              </p>
            )}

            {entry.referenceNotes ? (
              <p className="mt-4 rounded-control bg-info-surface/50 p-3 text-xs text-muted">
                {entry.referenceNotes}
              </p>
            ) : null}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-forest">
              <CalendarDays className="h-4 w-4 text-sage" aria-hidden="true" />
              Harvest estimate
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-forest">
              {entry.harvestDaysMin && entry.harvestDaysMax
                ? `${entry.harvestDaysMin}–${entry.harvestDaysMax} days`
                : 'Varies'}
            </p>
            <p className="mt-1 text-sm text-muted">
              Estimated from planting date. This is not a guarantee — record the actual harvest when
              it happens.
            </p>
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-forest">
              <Info className="h-4 w-4 text-info" aria-hidden="true" />
              How this reference is used
            </div>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li>Recommendations explain the reading, source, and suggested check.</li>
              <li>Simulated data stays labeled in every recommendation context.</li>
              <li>Stale or insufficient data produces a neutral “check conditions” response.</li>
            </ul>
          </Card>

          <div className="rounded-card border border-line bg-soft-sage/50 p-5">
            <p className="text-sm font-semibold text-forest">Hardware-optional</p>
            <p className="mt-1 text-sm text-muted">
              Start with manual readings. A sensor label only appears after a verified integration.
            </p>
          </div>
        </div>
      </div>

      {/* Add to Garden Dialog */}
      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-modal-title"
        >
          <div className="w-full max-w-lg rounded-card border border-line bg-card p-6 shadow-xl space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Plant Library</p>
                <h3 id="add-modal-title" className="text-xl font-semibold text-forest">
                  Add {entry.commonName} to My Garden
                </h3>
              </div>
              <button
                type="button"
                onClick={() => !submitting && setModalOpen(false)}
                className="rounded-control p-1 text-muted hover:bg-page hover:text-ink cursor-pointer"
                aria-label="Close dialog"
                disabled={submitting}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {loadingGardens ? (
              <div className="flex flex-col items-center justify-center py-10 space-y-3">
                <span
                  className="h-7 w-7 animate-spin rounded-full border-2 border-sage border-t-transparent"
                  aria-hidden="true"
                />
                <p className="text-sm text-muted">Checking your garden spaces...</p>
              </div>
            ) : gardenLoadError ? (
              <ErrorState
                title="Could not load garden spaces"
                message={gardenLoadError}
                action={
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => void loadGardens()}>
                      Try again
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                }
              />
            ) : gardens.length === 0 ? (
              <EmptyState
                icon={Sprout}
                title="No gardens created yet"
                description="Every plant in GrowSpace belongs to a garden space (e.g. Balcony, Windowsill, Raised Bed). Create your first garden to get started!"
                action={
                  <div className="flex items-center gap-3">
                    <Link
                      to={`/dashboard/gardens/new?returnTo=/dashboard/plants/new?catalog=${encodeURIComponent(entry.slug)}`}
                      className={buttonStyles('primary')}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Create your first garden
                    </Link>
                    <Button variant="ghost" onClick={() => setModalOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                }
              />
            ) : (
              <form onSubmit={handleAddSubmit} className="space-y-4">
                {submitError ? (
                  <div className="flex items-start gap-2.5 rounded-control border border-critical/30 bg-critical-surface p-3 text-xs text-critical">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{submitError}</span>
                  </div>
                ) : null}

                {successMessage ? (
                  <div className="flex items-center gap-2.5 rounded-control border border-success/30 bg-success-surface p-3 text-xs text-success">
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="font-medium">{successMessage}</span>
                  </div>
                ) : null}

                <SelectField
                  label="Destination garden"
                  required
                  value={selectedGardenId}
                  onChange={(e) => setSelectedGardenId(e.target.value)}
                  hint="Select which of your gardens will host this plant."
                  disabled={submitting || !!successMessage}
                >
                  {gardens.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} {g.locationLabel ? `(${g.locationLabel})` : ''}
                    </option>
                  ))}
                </SelectField>

                <TextField
                  label="Custom nickname / variety tag"
                  optional
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g. San Marzano, Pot #2, Heirloom"
                  hint="Optional name to distinguish multiple crops."
                  disabled={submitting || !!successMessage}
                />

                <TextField
                  label="Planting date"
                  type="date"
                  optional
                  value={plantingDate}
                  onChange={(e) => setPlantingDate(e.target.value)}
                  hint="When seeds or seedlings were planted (defaults to today)."
                  disabled={submitting || !!successMessage}
                />

                <div className="flex items-center justify-between pt-2 border-t border-line/60">
                  <Link
                    to={`/dashboard/plants/new?catalog=${encodeURIComponent(entry.slug)}`}
                    className="text-xs text-muted hover:text-forest"
                  >
                    Open advanced form &rarr;
                  </Link>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setModalOpen(false)}
                      disabled={submitting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      loading={submitting}
                      disabled={submitting || !!successMessage}
                      icon={<Plus className="h-4 w-4" />}
                    >
                      Add Plant
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
