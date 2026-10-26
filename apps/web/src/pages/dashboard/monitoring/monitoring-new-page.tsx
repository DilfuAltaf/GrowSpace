import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Droplets,
  Thermometer,
  Wind,
} from 'lucide-react';
import {
  MEASUREMENTS,
  toLocalDateTimeInputValue,
  type MeasurementType,
} from '@growspace/shared';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { FullPageLoader } from '@/components/ui/loading';
import { PageHeader } from '@/components/ui/page-header';
import {
  ApiClientError,
  createSensorReading,
  fetchPlants,
  type PlantWithDetails,
} from '@/lib/api';

const MEASUREMENT_ICONS: Record<MeasurementType, typeof Thermometer> = {
  air_temperature: Thermometer,
  air_humidity: Wind,
  medium_moisture: Droplets,
};

export function MonitoringNewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialPlantParam = searchParams.get('plantId')?.trim() || '';

  const [plants, setPlants] = useState<PlantWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [plantId, setPlantId] = useState(initialPlantParam);
  const [measurementType, setMeasurementType] = useState<MeasurementType>('air_temperature');
  const [value, setValue] = useState('');
  const [recordedAt, setRecordedAt] = useState(() => toLocalDateTimeInputValue());
  const [note, setNote] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    fetchPlants({ signal: controller.signal })
      .then((plantsRes) => {
        if (!isMounted) return;
        setPlants(plantsRes.plants);
        if (plantsRes.plants.length > 0 && plantsRes.plants[0]) {
          const firstId = plantsRes.plants[0].id;
          setPlantId((current) => current || firstId);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load garden and plant data.');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  const selectedMeta = MEASUREMENTS[measurementType];
  const Icon = MEASUREMENT_ICONS[measurementType];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    const selectedPlant = plants.find((p) => p.id === plantId);
    if (!selectedPlant) {
      setFieldErrors({ plantId: ['Please select a plant.'] });
      return;
    }

    const numValue = Number.parseFloat(value);
    if (Number.isNaN(numValue)) {
      setFieldErrors({ value: ['Enter a valid numeric measurement.'] });
      return;
    }

    if (numValue < selectedMeta.plausibleMin || numValue > selectedMeta.plausibleMax) {
      setFieldErrors({
        value: [
          `Value must be between ${selectedMeta.plausibleMin} and ${selectedMeta.plausibleMax} ${selectedMeta.unit}.`,
        ],
      });
      return;
    }

    setSubmitting(true);

    try {
      const isoTimestamp = recordedAt ? new Date(recordedAt).toISOString() : new Date().toISOString();

      await createSensorReading({
        gardenId: selectedPlant.gardenId,
        plantId: selectedPlant.id,
        measurementType,
        value: numValue,
        unit: selectedMeta.unit,
        source: 'manual',
        recordedAt: isoTimestamp,
        note: note.trim() || null,
      });

      setSuccess(true);
      setTimeout(() => {
        navigate(`/dashboard/monitoring?plantId=${selectedPlant.id}`);
      }, 1000);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setGeneralError(err.message);
        if (err.fieldErrors) {
          setFieldErrors(err.fieldErrors);
        }
      } else {
        setGeneralError('Failed to record reading. Please check your network connection.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <FullPageLoader label="Loading plants..." />;
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link to="/dashboard/monitoring" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-forest">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to monitoring
        </Link>
        <Card className="border-critical/30 bg-critical-surface/30 p-6 text-center">
          <p className="text-sm font-medium text-critical">{loadError}</p>
        </Card>
      </div>
    );
  }

  if (plants.length === 0) {
    return (
      <div className="space-y-6">
        <Link to="/dashboard/monitoring" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-forest">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to monitoring
        </Link>
        <Card className="p-8 text-center">
          <h2 className="text-lg font-semibold text-forest">No plants found</h2>
          <p className="mt-2 text-sm text-muted">
            You must have at least one plant to record environmental observations.
          </p>
          <div className="mt-5">
            <Link to="/dashboard/plants/new" className={buttonStyles('primary')}>
              Add a plant first
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          to="/dashboard/monitoring"
          className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-forest"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to monitoring
        </Link>
      </div>

      <PageHeader
        eyebrow="Manual Reading"
        title="Record environmental measurement"
        description="Record what you observed directly with your eyes or handheld tool. This reading will be permanently classified as a manual entry."
      />

      {success ? (
        <div className="flex items-center gap-2 rounded-card border border-success/30 bg-success-surface/40 p-4 text-sm font-medium text-success">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
          Reading recorded successfully! Redirecting to monitoring...
        </div>
      ) : null}

      {generalError ? (
        <div className="flex items-center gap-2 rounded-card border border-critical/30 bg-critical-surface/40 p-4 text-sm font-medium text-critical">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          {generalError}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <SelectField
              label="Plant"
              value={plantId}
              onChange={(e) => setPlantId(e.target.value)}
              error={fieldErrors.plantId?.[0]}
              hint="Readings are scoped to plants you own."
            >
              {plants.map((p) => {
                const name = p.customName || p.catalog?.commonName || 'Unnamed Plant';
                const gName = p.gardenName ? ` (${p.gardenName})` : '';
                return (
                  <option key={p.id} value={p.id}>
                    {name}
                    {gName}
                  </option>
                );
              })}
            </SelectField>

            <SelectField
              label="Measurement Metric"
              value={measurementType}
              onChange={(e) => {
                setMeasurementType(e.target.value as MeasurementType);
                setValue('');
              }}
              error={fieldErrors.measurementType?.[0]}
              hint={selectedMeta.helperText}
            >
              <option value="air_temperature">Air Temperature (°C)</option>
              <option value="air_humidity">Air Humidity (%)</option>
              <option value="medium_moisture">Growing Media Moisture (%)</option>
            </SelectField>

            <div className="relative">
              <TextField
                label={`Measurement Value (${selectedMeta.unit})`}
                type="number"
                step="any"
                placeholder={`e.g. ${measurementType === 'air_temperature' ? '22.5' : '60'}`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                error={fieldErrors.value?.[0]}
                hint={`Plausible range: ${selectedMeta.plausibleMin} to ${selectedMeta.plausibleMax} ${selectedMeta.unit}`}
                required
              />
            </div>

            <TextField
              label="Observation Timestamp"
              type="datetime-local"
              value={recordedAt}
              onChange={(e) => setRecordedAt(e.target.value)}
              error={fieldErrors.recordedAt?.[0]}
              hint="When this observation occurred."
            />

            <TextAreaField
              label="Observation Note"
              placeholder="e.g. Topsoil feels slightly dry, measured near the canopy window."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              error={fieldErrors.note?.[0]}
              hint="Optional contextual note (up to 500 characters)."
              optional
              rows={3}
            />

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-line">
              <Link to="/dashboard/monitoring" className={buttonStyles('ghost')}>
                Cancel
              </Link>
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? 'Recording...' : 'Record Reading'}
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="p-5 border-info/30 bg-info-surface/30">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-control bg-info/20 text-info">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ink">{selectedMeta.label}</h3>
                <p className="text-xs text-muted">Standard unit: {selectedMeta.unit}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted leading-relaxed">
              {selectedMeta.helperText} GrowSpace verifies that all manual measurements fall within plausible physical limits ({selectedMeta.plausibleMin} to {selectedMeta.plausibleMax} {selectedMeta.unit}).
            </p>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-forest">Data Provenance Guarantee</h3>
            <p className="mt-1 text-xs text-muted leading-relaxed">
              Every reading recorded here is tagged with <strong>manual</strong> provenance. GrowSpace never invents hardware device telemetry or misrepresents manual observations as live sensor signals.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
