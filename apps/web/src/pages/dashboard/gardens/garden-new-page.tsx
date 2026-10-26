import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import type { GrowingMethod } from '@growspace/shared';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ApiClientError, createGarden } from '@/lib/api';

export function GardenNewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const [name, setName] = useState('');
  const [growingMethod, setGrowingMethod] = useState<GrowingMethod | ''>('');
  const [locationLabel, setLocationLabel] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
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
      const res = await createGarden({
        name: trimmedName,
        growingMethod: growingMethod ? (growingMethod as GrowingMethod) : null,
        locationLabel: locationLabel.trim() || null,
        description: description.trim() || null,
        imageUrl: imageUrl.trim() || null,
      });

      if (returnTo && returnTo.startsWith('/')) {
        const separator = returnTo.includes('?') ? '&' : '?';
        navigate(`${returnTo}${separator}gardenId=${res.garden.id}`);
      } else {
        navigate(`/dashboard/gardens/${res.garden.id}`);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.fieldErrors) {
          setFieldErrors(err.fieldErrors);
        } else {
          setGeneralError(err.message);
        }
      } else {
        setGeneralError('Failed to create garden. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Link
        to="/dashboard/gardens"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-forest"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to gardens
      </Link>

      <PageHeader
        eyebrow="Spaces"
        title="Create Garden"
        description="Add a new growing area to organize plants, track environmental conditions, and manage care."
      />

      {generalError ? (
        <ErrorState title="Unable to create garden" message={generalError} />
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
              placeholder="e.g. South Balcony, Indoor Grow Tent, Kitchen Herbs"
              hint="Between 1 and 80 characters."
              error={fieldErrors.name?.[0]}
              disabled={submitting}
            />

            <SelectField
              label="Growing method"
              optional
              value={growingMethod}
              onChange={(e) => setGrowingMethod(e.target.value as GrowingMethod | '')}
              hint="How plants are cultivated in this space."
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
              hint="A short note describing where this space is situated."
              error={fieldErrors.locationLabel?.[0]}
              disabled={submitting}
            />

            <TextAreaField
              label="Description"
              optional
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Sunlight hours, watering setup, microclimate notes..."
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
              placeholder="https://images.unsplash.com/..."
              hint="Must begin with https://"
              error={fieldErrors.imageUrl?.[0]}
              disabled={submitting}
            />

            <div className="flex items-center justify-end gap-3 pt-3">
              <Link
                to="/dashboard/gardens"
                className={buttonStyles('ghost', 'md', submitting ? 'pointer-events-none opacity-50' : '')}
              >
                Cancel
              </Link>
              <Button
                type="submit"
                variant="primary"
                loading={submitting}
                icon={<Plus className="h-4 w-4" />}
              >
                Create Garden
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
