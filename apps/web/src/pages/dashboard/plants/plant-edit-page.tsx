import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import type { GrowthStage, PlantStatus } from '@growspace/shared';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { FullPageLoader } from '@/components/ui/loading';
import { PageHeader } from '@/components/ui/page-header';
import {
  ApiClientError,
  fetchGardens,
  fetchPlant,
  updatePlant,
  type GardenWithStats,
  type PlantWithDetails,
} from '@/lib/api';

export function PlantEditPage() {
  const { plantId } = useParams<{ plantId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [plant, setPlant] = useState<PlantWithDetails | null>(null);
  const [gardens, setGardens] = useState<GardenWithStats[]>([]);

  // Form fields
  const [gardenId, setGardenId] = useState('');
  const [customName, setCustomName] = useState('');
  const [growthStage, setGrowthStage] = useState<GrowthStage>('seedling');
  const [status, setStatus] = useState<PlantStatus>('active');
  const [plantingDate, setPlantingDate] = useState('');
  const [expectedHarvestDate, setExpectedHarvestDate] = useState('');
  const [actualHarvestDate, setActualHarvestDate] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!plantId) return;

    let isMounted = true;
    const controller = new AbortController();

    Promise.all([
      fetchPlant(plantId, controller.signal),
      fetchGardens(controller.signal),
    ])
      .then(([plantRes, gardensRes]) => {
        if (isMounted) {
          const p = plantRes.plant;
          setPlant(p);
          setGardens(gardensRes.gardens);

          setGardenId(p.gardenId);
          setCustomName(p.customName || '');
          setGrowthStage(p.growthStage);
          setStatus(p.status);
          setPlantingDate(p.plantingDate || '');
          setExpectedHarvestDate(p.expectedHarvestDate || '');
          setActualHarvestDate(p.actualHarvestDate || '');
          setNotes(p.notes || '');

          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted && !controller.signal.aborted) {
          setLoadError(
            err instanceof Error ? err.message : 'Could not load plant details.',
          );
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [plantId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!plant) return;

    setGeneralError(null);
    setFieldErrors({});

    try {
      setSubmitting(true);
      await updatePlant(plant.id, {
        gardenId,
        customName: customName.trim() || null,
        growthStage,
        status,
        plantingDate: plantingDate || null,
        expectedHarvestDate: expectedHarvestDate || null,
        actualHarvestDate: actualHarvestDate || null,
        notes: notes.trim() || null,
      });

      navigate(`/dashboard/plants/${plant.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.fieldErrors) {
          setFieldErrors(err.fieldErrors);
        } else {
          setGeneralError(err.message);
        }
      } else {
        setGeneralError('Failed to update plant. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <FullPageLoader label="Loading plant settings..." />;
  }

  if (loadError || !plant) {
    return (
      <div className="space-y-4">
        <Link
          to="/dashboard/plants"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-forest"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to plants
        </Link>
        <ErrorState
          title="Could not find plant"
          message={loadError || 'The requested plant was not found.'}
          action={
            <Link to="/dashboard/plants" className={buttonStyles('secondary', 'sm')}>
              Return to plants
            </Link>
          }
        />
      </div>
    );
  }

  const titleName = plant.customName || plant.catalog?.commonName || 'Plant';

  return (
    <div className="max-w-2xl space-y-6">
      <Link
        to={`/dashboard/plants/${plant.id}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-forest"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to plant detail
      </Link>

      <PageHeader
        eyebrow="Settings"
        title={`Edit ${titleName}`}
        description="Update growth stage, garden assignment, and lifecycle records."
      />

      {generalError ? (
        <ErrorState title="Unable to save changes" message={generalError} />
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* Garden assignment */}
            <SelectField
              label="Garden space"
              value={gardenId}
              onChange={(e) => setGardenId(e.target.value)}
              hint="You can move this plant to another one of your gardens."
              error={fieldErrors.gardenId?.[0]}
              disabled={submitting}
            >
              {gardens.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </SelectField>

            <TextField
              label="Custom plant name / nickname"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g. San Marzano Tomato #1"
              hint="Name or label to identify this plant."
              error={fieldErrors.customName?.[0]}
              disabled={submitting}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Growth stage"
                value={growthStage}
                onChange={(e) => setGrowthStage(e.target.value as GrowthStage)}
                error={fieldErrors.growthStage?.[0]}
                disabled={submitting}
              >
                <option value="seedling">Seedling</option>
                <option value="vegetative">Vegetative</option>
                <option value="flowering">Flowering</option>
                <option value="fruiting">Fruiting</option>
                <option value="harvested">Harvested</option>
              </SelectField>

              <SelectField
                label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value as PlantStatus)}
                error={fieldErrors.status?.[0]}
                disabled={submitting}
              >
                <option value="active">Active</option>
                <option value="harvested">Harvested</option>
                <option value="archived">Archived</option>
              </SelectField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Planting date"
                type="date"
                optional
                value={plantingDate}
                onChange={(e) => setPlantingDate(e.target.value)}
                error={fieldErrors.plantingDate?.[0]}
                disabled={submitting}
              />

              <TextField
                label="Estimated harvest date"
                type="date"
                optional
                value={expectedHarvestDate}
                onChange={(e) => setExpectedHarvestDate(e.target.value)}
                error={fieldErrors.expectedHarvestDate?.[0]}
                disabled={submitting}
              />
            </div>

            {status === 'harvested' ? (
              <TextField
                label="Actual harvest date"
                type="date"
                optional
                value={actualHarvestDate}
                onChange={(e) => setActualHarvestDate(e.target.value)}
                hint="When this crop was harvested."
                error={fieldErrors.actualHarvestDate?.[0]}
                disabled={submitting}
              />
            ) : null}

            <TextAreaField
              label="Notes"
              optional
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              hint="Observation logs and notes up to 1000 characters."
              error={fieldErrors.notes?.[0]}
              disabled={submitting}
            />

            <div className="flex items-center justify-end gap-3 pt-3">
              <Link
                to={`/dashboard/plants/${plant.id}`}
                className={buttonStyles('ghost', 'md', submitting ? 'pointer-events-none opacity-50' : '')}
              >
                Cancel
              </Link>
              <Button
                type="submit"
                variant="primary"
                loading={submitting}
                icon={<Save className="h-4 w-4" />}
              >
                Save Changes
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
