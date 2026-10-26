import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import type { GrowingMethod } from '@growspace/shared';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { FullPageLoader } from '@/components/ui/loading';
import { PageHeader } from '@/components/ui/page-header';
import { ApiClientError, fetchGarden, updateGarden, type GardenWithStats } from '@/lib/api';

export function GardenEditPage() {
  const { gardenId } = useParams<{ gardenId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [garden, setGarden] = useState<GardenWithStats | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [growingMethod, setGrowingMethod] = useState<GrowingMethod | ''>('');
  const [locationLabel, setLocationLabel] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!gardenId) return;
    const controller = new AbortController();

    const load = async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const res = await fetchGarden(gardenId, controller.signal);
        setGarden(res.garden);
        setName(res.garden.name);
        setGrowingMethod(res.garden.growingMethod ?? '');
        setLocationLabel(res.garden.locationLabel ?? '');
        setDescription(res.garden.description ?? '');
        setImageUrl(res.garden.imageUrl ?? '');
      } catch (err) {
        if (controller.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : 'Could not load garden details.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    load();
    return () => controller.abort();
  }, [gardenId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!garden) return;

    setGeneralError(null);
    setFieldErrors({});

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFieldErrors({ name: ['Garden name is required.'] });
      return;
    }

    if (trimmedName.length > 80) {
      setFieldErrors({ name: ['Name must be 80 characters or fewer.'] });
      return;
    }

    try {
      setSubmitting(true);
      await updateGarden(garden.id, {
        name: trimmedName,
        growingMethod: growingMethod ? (growingMethod as GrowingMethod) : null,
        locationLabel: locationLabel.trim() || null,
        description: description.trim() || null,
        imageUrl: imageUrl.trim() || null,
      });

      navigate(`/dashboard/gardens/${garden.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.fieldErrors) {
          setFieldErrors(err.fieldErrors);
        } else {
          setGeneralError(err.message);
        }
      } else {
        setGeneralError('Failed to update garden. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <FullPageLoader label="Loading garden settings..." />;
  }

  if (loadError || !garden) {
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
          title="Could not find garden"
          message={loadError || 'The requested garden was not found.'}
          action={
            <Link to="/dashboard/gardens" className={buttonStyles('secondary', 'sm')}>
              Return to gardens
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Link
        to={`/dashboard/gardens/${garden.id}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-forest"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to garden details
      </Link>

      <PageHeader
        eyebrow="Settings"
        title={`Edit ${garden.name}`}
        description="Update your growing environment parameters and location notes."
      />

      {generalError ? (
        <ErrorState title="Unable to save changes" message={generalError} />
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <TextField
              label="Garden name"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              hint="Between 1 and 80 characters."
              error={fieldErrors.name?.[0]}
              disabled={submitting}
            />

            <SelectField
              label="Growing method"
              optional
              value={growingMethod}
              onChange={(e) => setGrowingMethod(e.target.value as GrowingMethod | '')}
              hint="Method used in this space."
              error={fieldErrors.growingMethod?.[0]}
              disabled={submitting}
            >
              <option value="">Select growing method...</option>
              <option value="soil">Soil / In-Ground</option>
              <option value="container">Container / Pot</option>
              <option value="raised_bed">Raised Bed</option>
              <option value="hydroponic">Hydroponic</option>
              <option value="other">Other Method</option>
            </SelectField>

            <TextField
              label="Location label"
              optional
              value={locationLabel}
              onChange={(e) => setLocationLabel(e.target.value)}
              placeholder="e.g. Backyard patio, 2nd floor windowsill"
              hint="Where this garden is physically situated."
              error={fieldErrors.locationLabel?.[0]}
              disabled={submitting}
            />

            <TextAreaField
              label="Description"
              optional
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              hint="Optional notes up to 500 characters."
              error={fieldErrors.description?.[0]}
              disabled={submitting}
            />

            <TextField
              label="Cover image URL"
              optional
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              hint="Must begin with https://"
              error={fieldErrors.imageUrl?.[0]}
              disabled={submitting}
            />

            <div className="flex items-center justify-end gap-3 pt-3">
              <Link
                to={`/dashboard/gardens/${garden.id}`}
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
