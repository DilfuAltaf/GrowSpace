import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Sprout,
} from 'lucide-react';
import {
  PLANT_CATALOG,
  findCatalogEntry,
  findCatalogEntryById,
  type Difficulty,
  type GrowthStage,
  type PlantCatalogEntry,
  type PlantResearchProfile,
} from '@growspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonStyles } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { FullPageLoader } from '@/components/ui/loading';
import { PageHeader } from '@/components/ui/page-header';
import {
  ApiClientError,
  createPlant,
  fetchGardens,
  researchPlant,
  type GardenWithStats,
} from '@/lib/api';

type PlantSourceMode = 'catalog' | 'research' | 'custom';

export function PlantNewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialCatalogParam = searchParams.get('catalog')?.trim() || '';
  const initialGardenParam = searchParams.get('gardenId')?.trim() || '';

  const [gardens, setGardens] = useState<GardenWithStats[]>([]);
  const [loadingGardens, setLoadingGardens] = useState(true);
  const [gardenLoadError, setGardenLoadError] = useState<string | null>(null);

  const initialEntry = initialCatalogParam
    ? (findCatalogEntry(initialCatalogParam) ?? findCatalogEntryById(initialCatalogParam))
    : undefined;

  // Form state
  const [gardenId, setGardenId] = useState(initialGardenParam);
  const [plantSource, setPlantSource] = useState<PlantSourceMode>(
    initialEntry ? 'catalog' : 'catalog',
  );
  const [catalogId, setCatalogId] = useState(() => initialEntry?.id ?? '');
  const [customName, setCustomName] = useState('');
  const [plantingDate, setPlantingDate] = useState(() => {
    return new Date().toISOString().split('T')[0] ?? '';
  });
  const [growthStage, setGrowthStage] = useState<GrowthStage>('seedling');
  const [expectedHarvestDate, setExpectedHarvestDate] = useState(() => {
    if (initialEntry?.harvestDaysMin) {
      const d = new Date();
      d.setDate(d.getDate() + initialEntry.harvestDaysMin);
      return d.toISOString().split('T')[0] ?? '';
    }
    return '';
  });
  const [notes, setNotes] = useState('');

  // AI Research Agent State
  const [researchQuery, setResearchQuery] = useState('');
  const [researching, setResearching] = useState(false);
  const [researchStep, setResearchStep] = useState(1);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchErrorCode, setResearchErrorCode] = useState<string | null>(null);
  const [matchedCatalogAlert, setMatchedCatalogAlert] = useState<PlantCatalogEntry | null>(null);
  const [activeResearchId, setActiveResearchId] = useState<string | null>(null);

  // Editable Profile Draft State (from AI Research)
  const [researchedProfile, setResearchedProfile] = useState<PlantResearchProfile | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Load user gardens
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    fetchGardens(controller.signal)
      .then((res) => {
        if (isMounted) {
          setGardens(res.gardens);
          if (res.gardens.length > 0) {
            if (initialGardenParam && res.gardens.some((g) => g.id === initialGardenParam)) {
              setGardenId(initialGardenParam);
            } else {
              setGardenId(res.gardens[0]?.id ?? '');
            }
          }
          setLoadingGardens(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted && !controller.signal.aborted) {
          setGardenLoadError(
            err instanceof Error ? err.message : 'Unable to load gardens.',
          );
          setLoadingGardens(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [initialGardenParam]);

  // When catalog plant changes, update estimated harvest date
  const handleCatalogChange = (newCatalogId: string) => {
    setCatalogId(newCatalogId);
    if (newCatalogId) {
      const entry = findCatalogEntryById(newCatalogId);
      if (entry?.harvestDaysMin && plantingDate) {
        const d = new Date(plantingDate);
        d.setDate(d.getDate() + entry.harvestDaysMin);
        setExpectedHarvestDate(d.toISOString().split('T')[0] ?? '');
      }
    }
  };

  // Perform AI Research
  const handleStartResearch = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const query = researchQuery.trim();
    if (!query) return;

    setResearching(true);
    setResearchError(null);
    setResearchErrorCode(null);
    setMatchedCatalogAlert(null);
    setResearchStep(1);

    // Simulate progress steps while awaiting response
    const stepInterval = setInterval(() => {
      setResearchStep((prev) => (prev < 3 ? prev + 1 : prev));
    }, 1200);

    try {
      const res = await researchPlant(query);
      clearInterval(stepInterval);

      if (res.matchedCatalogEntry) {
        setMatchedCatalogAlert(res.matchedCatalogEntry);
        setResearching(false);
        return;
      }

      if (res.profile) {
        setResearchedProfile(res.profile);
        setCustomName(res.profile.plantName);
        if (res.researchRecord?.id) {
          setActiveResearchId(res.researchRecord.id);
        }
        if (res.profile.harvestDaysMin && plantingDate) {
          const d = new Date(plantingDate);
          d.setDate(d.getDate() + res.profile.harvestDaysMin);
          setExpectedHarvestDate(d.toISOString().split('T')[0] ?? '');
        }
      }
    } catch (err) {
      clearInterval(stepInterval);
      if (err instanceof ApiClientError) {
        setResearchError(err.message);
        setResearchErrorCode(err.code);
      } else {
        setResearchError('AI Research failed. Please check network connection and try again.');
      }
    } finally {
      setResearching(false);
    }
  };

  const handleApplyMatchedCatalog = (entry: PlantCatalogEntry) => {
    setPlantSource('catalog');
    setCatalogId(entry.id);
    setMatchedCatalogAlert(null);
    if (entry.harvestDaysMin && plantingDate) {
      const d = new Date(plantingDate);
      d.setDate(d.getDate() + entry.harvestDaysMin);
      setExpectedHarvestDate(d.toISOString().split('T')[0] ?? '');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    if (!gardenId) {
      setFieldErrors({ gardenId: ['Please select a destination garden.'] });
      return;
    }

    if (plantSource === 'catalog' && !catalogId) {
      setFieldErrors({ catalogId: ['Please select a plant from the library.'] });
      return;
    }

    const effectiveCustomName =
      plantSource === 'research'
        ? (researchedProfile?.plantName || customName).trim()
        : customName.trim();

    if (plantSource !== 'catalog' && !effectiveCustomName) {
      setFieldErrors({ customName: ['Please enter a plant name.'] });
      return;
    }

    try {
      setSubmitting(true);
      const res = await createPlant({
        gardenId,
        catalogId: plantSource === 'catalog' ? catalogId : null,
        customName: plantSource === 'catalog' ? (customName.trim() || null) : effectiveCustomName,
        plantingDate: plantingDate || null,
        growthStage,
        status: 'active',
        expectedHarvestDate: expectedHarvestDate || null,
        notes: notes.trim() || null,
        researchRecordId: plantSource === 'research' && activeResearchId ? activeResearchId : undefined,
        reviewedProfile: plantSource === 'research' && researchedProfile ? researchedProfile : undefined,
      });

      navigate(`/dashboard/plants/${res.plant.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.fieldErrors) {
          setFieldErrors(err.fieldErrors);
        } else {
          setGeneralError(err.message);
        }
      } else {
        setGeneralError('Failed to add plant. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingGardens) {
    return <FullPageLoader label="Checking garden spaces..." />;
  }

  if (gardenLoadError) {
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
          title="Could not load garden spaces"
          message={gardenLoadError}
          action={
            <Link to="/dashboard/gardens" className={buttonStyles('secondary', 'sm')}>
              Go to Gardens
            </Link>
          }
        />
      </div>
    );
  }

  if (gardens.length === 0) {
    return (
      <div className="max-w-xl space-y-6">
        <Link
          to="/dashboard/plants"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-forest"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to plants
        </Link>

        <PageHeader
          eyebrow="Cultivation"
          title="Add Plant"
          description="A garden space is required before you can plant and track crops."
        />

        <EmptyState
          icon={Sprout}
          title="No gardens created yet"
          description="Every plant in GrowSpace belongs to a garden space (such as a balcony, windowsill, or greenhouse). Create your first garden to get started!"
          action={
            <Link
              to={`/dashboard/gardens/new${initialCatalogParam ? `?returnTo=/dashboard/plants/new?catalog=${encodeURIComponent(initialCatalogParam)}` : ''}`}
              className={buttonStyles('primary')}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create your first garden
            </Link>
          }
        />
      </div>
    );
  }

  const selectedCatalogEntry = catalogId ? findCatalogEntryById(catalogId) : null;

  return (
    <div className="max-w-2xl space-y-6">
      <Link
        to="/dashboard/plants"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-forest"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to plants
      </Link>

      <PageHeader
        eyebrow="Cultivation"
        title="Add Plant"
        description="Choose a reference from our botanical library, research any unlisted crop with AI, or enter a custom variety."
      />

      {generalError ? (
        <ErrorState title="Unable to add plant" message={generalError} />
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* Destination Garden Picker */}
            <SelectField
              label="Destination garden"
              required
              value={gardenId}
              onChange={(e) => setGardenId(e.target.value)}
              hint="The garden space where this plant will grow."
              error={fieldErrors.gardenId?.[0]}
              disabled={submitting || researching}
            >
              {gardens.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} {g.locationLabel ? `(${g.locationLabel})` : ''}
                </option>
              ))}
            </SelectField>

            {/* Plant Source Tabs */}
            <div>
              <label className="field-label">Plant source</label>
              <div className="flex rounded-control border border-line bg-page/50 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setPlantSource('catalog');
                    setGeneralError(null);
                  }}
                  className={`flex-1 rounded-control py-1.5 text-xs font-semibold transition ${
                    plantSource === 'catalog'
                      ? 'bg-card text-forest shadow-xs'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  Reference Library ({PLANT_CATALOG.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlantSource('research');
                    setGeneralError(null);
                  }}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-control py-1.5 text-xs font-semibold transition ${
                    plantSource === 'research'
                      ? 'bg-card text-forest shadow-xs'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                  AI Plant Research
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlantSource('custom');
                    setGeneralError(null);
                  }}
                  className={`flex-1 rounded-control py-1.5 text-xs font-semibold transition ${
                    plantSource === 'custom'
                      ? 'bg-card text-forest shadow-xs'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  Manual Entry
                </button>
              </div>
            </div>

            {/* TAB 1: Catalog Selector */}
            {plantSource === 'catalog' ? (
              <div className="space-y-3">
                <SelectField
                  label="Select plant from library"
                  required
                  value={catalogId}
                  onChange={(e) => handleCatalogChange(e.target.value)}
                  hint="Includes target temperature, humidity, and harvesting guidance."
                  error={fieldErrors.catalogId?.[0]}
                  disabled={submitting}
                >
                  <option value="">Choose a plant...</option>
                  {PLANT_CATALOG.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.commonName} ({entry.category}
                      {entry.scientificName ? ` - ${entry.scientificName}` : ''})
                    </option>
                  ))}
                </SelectField>

                {selectedCatalogEntry ? (
                  <div className="rounded-control border border-line bg-page/60 p-3.5 space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-3.5 w-3.5 text-sage" aria-hidden="true" />
                      <span className="font-semibold text-forest">
                        {selectedCatalogEntry.commonName}
                      </span>
                      <Badge variant="sage" className="text-[10px]">
                        {selectedCatalogEntry.category}
                      </Badge>
                      {selectedCatalogEntry.harvestDaysMin ? (
                        <span className="text-muted">
                          Harvest in ~{selectedCatalogEntry.harvestDaysMin}–
                          {selectedCatalogEntry.harvestDaysMax} days
                        </span>
                      ) : null}
                    </div>
                    {selectedCatalogEntry.lightGuidance ? (
                      <p className="text-muted">{selectedCatalogEntry.lightGuidance}</p>
                    ) : null}
                  </div>
                ) : null}

                <TextField
                  label="Custom nickname / variety tag"
                  optional
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g. Heirloom San Marzano, Pot #3"
                  hint="Optional label to distinguish multiple plants of the same variety."
                  error={fieldErrors.customName?.[0]}
                  disabled={submitting}
                />
              </div>
            ) : null}

            {/* TAB 2: AI Research Agent */}
            {plantSource === 'research' ? (
              <div className="space-y-4">
                {!researchedProfile ? (
                  <div className="rounded-card border border-sage/20 bg-sage-surface/30 p-4 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <Sparkles className="h-5 w-5 text-sage shrink-0 mt-0.5" aria-hidden="true" />
                      <div>
                        <h4 className="text-sm font-semibold text-forest">
                          AI Cultivation Research Agent
                        </h4>
                        <p className="text-xs text-muted mt-0.5">
                          Enter any plant, herb, fruit, or vegetable not found in our library.
                          GrowSpace will research agricultural extensions and botanical databases using Groq to build a care profile.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-1">
                      <input
                        type="text"
                        value={researchQuery}
                        onChange={(e) => setResearchQuery(e.target.value)}
                        placeholder="e.g. Dragon Fruit, Wasabi, Thai Basil, Romanesco"
                        disabled={researching}
                        className="flex-1 rounded-control border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-forest focus:outline-hidden"
                      />
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => handleStartResearch()}
                        disabled={!researchQuery.trim() || researching}
                        loading={researching}
                        icon={<Search className="h-4 w-4" />}
                      >
                        Research
                      </Button>
                    </div>

                    {/* Progress indicator */}
                    {researching ? (
                      <div className="rounded-control border border-line bg-card p-3 space-y-2 text-xs">
                        <div className="flex items-center gap-2 font-medium text-forest">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-sage" />
                          <span>
                            {researchStep === 1
                              ? 'Searching agricultural extensions & botanical databases...'
                              : researchStep === 2
                                ? 'Analyzing cultivation parameters with Groq LLM...'
                                : 'Synthesizing care profile & verifying source citations...'}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                          <div
                            className="h-full bg-forest transition-all duration-500"
                            style={{ width: `${(researchStep / 3) * 100}%` }}
                          />
                        </div>
                      </div>
                    ) : null}

                    {/* Matched Catalog Entry Banner */}
                    {matchedCatalogAlert ? (
                      <div className="rounded-control border border-success/30 bg-success-surface p-3.5 space-y-2 text-xs">
                        <div className="flex items-center gap-2 font-semibold text-forest">
                          <CheckCircle2 className="h-4 w-4 text-forest" />
                          <span>
                            "{matchedCatalogAlert.commonName}" is already in the Reference Library!
                          </span>
                        </div>
                        <p className="text-muted">
                          You don't need to research this crop with AI. Our verified botanical library already includes complete reference ranges.
                        </p>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleApplyMatchedCatalog(matchedCatalogAlert)}
                        >
                          Use Library Entry ({matchedCatalogAlert.commonName})
                        </Button>
                      </div>
                    ) : null}

                    {/* Setup Required State */}
                    {researchErrorCode === 'setup_required' ? (
                      <div className="rounded-control border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3.5 space-y-2 text-xs text-amber-900 dark:text-amber-200">
                        <div className="flex items-center gap-2 font-semibold">
                          <AlertTriangle className="h-4 w-4 text-amber-600" />
                          <span>Server Configuration Required</span>
                        </div>
                        <p className="text-amber-800 dark:text-amber-300">
                          {researchError}
                        </p>
                        <div className="flex gap-2 pt-1">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => handleStartResearch()}
                          >
                            Retry Research
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setCustomName(researchQuery.trim());
                              setPlantSource('custom');
                            }}
                          >
                            Switch to Manual Entry
                          </Button>
                        </div>
                      </div>
                    ) : researchError ? (
                      <div className="rounded-control border border-critical/30 bg-critical-surface p-3 text-xs text-critical">
                        <p>{researchError}</p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-2 text-xs"
                          onClick={() => handleStartResearch()}
                        >
                          Retry
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  /* REVIEW & EDIT DRAFT PROFILE */
                  <div className="space-y-4">
                    <div className="rounded-control border border-sage/30 bg-sage-surface/40 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-sage" />
                          <span className="font-semibold text-sm text-forest">
                            AI-Assisted Cultivation Profile (Draft)
                          </span>
                          <Badge variant="sage" className="text-[10px]">
                            AI-Assisted
                          </Badge>
                          <Badge
                            variant={
                              researchedProfile.confidence === 'high'
                                ? 'success'
                                : researchedProfile.confidence === 'moderate'
                                  ? 'sage'
                                  : 'warning'
                            }
                            className="text-[10px] capitalize"
                          >
                            {researchedProfile.confidence} Confidence
                          </Badge>
                        </div>
                        <p className="text-xs text-muted">
                          Synthesized from agricultural references. Review and customize fields before saving.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setResearchedProfile(null);
                          setActiveResearchId(null);
                        }}
                      >
                        Research Another
                      </Button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField
                        label="Plant common name"
                        required
                        value={researchedProfile.plantName}
                        onChange={(e) =>
                          setResearchedProfile({ ...researchedProfile, plantName: e.target.value })
                        }
                        error={fieldErrors.customName?.[0]}
                      />

                      <TextField
                        label="Botanical / Scientific name"
                        optional
                        value={researchedProfile.scientificName || ''}
                        onChange={(e) =>
                          setResearchedProfile({
                            ...researchedProfile,
                            scientificName: e.target.value || null,
                          })
                        }
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField
                        label="Category"
                        value={researchedProfile.category}
                        onChange={(e) =>
                          setResearchedProfile({ ...researchedProfile, category: e.target.value })
                        }
                      />

                      <SelectField
                        label="Estimated difficulty"
                        value={researchedProfile.difficulty || 'moderate'}
                        onChange={(e) =>
                          setResearchedProfile({
                            ...researchedProfile,
                            difficulty: e.target.value as Difficulty,
                          })
                        }
                      >
                        <option value="easy">Easy</option>
                        <option value="moderate">Moderate</option>
                        <option value="advanced">Advanced</option>
                      </SelectField>
                    </div>

                    {/* Researched Environmental Ranges */}
                    <div className="rounded-control border border-line bg-page/40 p-3 space-y-3">
                      <h5 className="text-xs font-semibold text-forest uppercase tracking-wider">
                        Researched Target Ranges
                      </h5>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="text-[11px] font-medium text-muted block mb-1">
                            Temperature (°C)
                          </label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              placeholder="Min"
                              value={researchedProfile.temperatureMin ?? ''}
                              onChange={(e) =>
                                setResearchedProfile({
                                  ...researchedProfile,
                                  temperatureMin: e.target.value ? Number(e.target.value) : null,
                                })
                              }
                              className="w-full rounded-control border border-line bg-card px-2 py-1 text-xs"
                            />
                            <span className="text-muted text-xs">–</span>
                            <input
                              type="number"
                              placeholder="Max"
                              value={researchedProfile.temperatureMax ?? ''}
                              onChange={(e) =>
                                setResearchedProfile({
                                  ...researchedProfile,
                                  temperatureMax: e.target.value ? Number(e.target.value) : null,
                                })
                              }
                              className="w-full rounded-control border border-line bg-card px-2 py-1 text-xs"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[11px] font-medium text-muted block mb-1">
                            Air Humidity (%)
                          </label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              placeholder="Min"
                              value={researchedProfile.humidityMin ?? ''}
                              onChange={(e) =>
                                setResearchedProfile({
                                  ...researchedProfile,
                                  humidityMin: e.target.value ? Number(e.target.value) : null,
                                })
                              }
                              className="w-full rounded-control border border-line bg-card px-2 py-1 text-xs"
                            />
                            <span className="text-muted text-xs">–</span>
                            <input
                              type="number"
                              placeholder="Max"
                              value={researchedProfile.humidityMax ?? ''}
                              onChange={(e) =>
                                setResearchedProfile({
                                  ...researchedProfile,
                                  humidityMax: e.target.value ? Number(e.target.value) : null,
                                })
                              }
                              className="w-full rounded-control border border-line bg-card px-2 py-1 text-xs"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[11px] font-medium text-muted block mb-1">
                            Soil Moisture (%)
                          </label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              placeholder="Min"
                              value={researchedProfile.moistureMin ?? ''}
                              onChange={(e) =>
                                setResearchedProfile({
                                  ...researchedProfile,
                                  moistureMin: e.target.value ? Number(e.target.value) : null,
                                })
                              }
                              className="w-full rounded-control border border-line bg-card px-2 py-1 text-xs"
                            />
                            <span className="text-muted text-xs">–</span>
                            <input
                              type="number"
                              placeholder="Max"
                              value={researchedProfile.moistureMax ?? ''}
                              onChange={(e) =>
                                setResearchedProfile({
                                  ...researchedProfile,
                                  moistureMax: e.target.value ? Number(e.target.value) : null,
                                })
                              }
                              className="w-full rounded-control border border-line bg-card px-2 py-1 text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <TextField
                      label="Growing medium & substrate"
                      optional
                      value={researchedProfile.growingMedium || ''}
                      onChange={(e) =>
                        setResearchedProfile({
                          ...researchedProfile,
                          growingMedium: e.target.value || null,
                        })
                      }
                      placeholder="e.g. Well-draining cactus mix, rich loamy potting soil"
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextAreaField
                        label="Light requirements"
                        optional
                        rows={2}
                        value={researchedProfile.lightGuidance || ''}
                        onChange={(e) =>
                          setResearchedProfile({
                            ...researchedProfile,
                            lightGuidance: e.target.value || null,
                          })
                        }
                      />

                      <TextAreaField
                        label="Watering guidance"
                        optional
                        rows={2}
                        value={researchedProfile.wateringGuidance || ''}
                        onChange={(e) =>
                          setResearchedProfile({
                            ...researchedProfile,
                            wateringGuidance: e.target.value || null,
                          })
                        }
                      />
                    </div>

                    <TextAreaField
                      label="Cultivation notes & advice"
                      optional
                      rows={2}
                      value={researchedProfile.cultivationNotes || ''}
                      onChange={(e) =>
                        setResearchedProfile({
                          ...researchedProfile,
                          cultivationNotes: e.target.value || null,
                        })
                      }
                    />

                    {researchedProfile.safetyNotes ? (
                      <div className="rounded-control border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-2.5 flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold">Safety & Handling: </span>
                          <span>{researchedProfile.safetyNotes}</span>
                        </div>
                      </div>
                    ) : null}

                    {/* Cited Source References */}
                    {researchedProfile.sources.length > 0 ? (
                      <div className="rounded-control border border-line bg-page/40 p-3 space-y-2">
                        <h5 className="text-xs font-semibold text-forest flex items-center gap-1.5">
                          <BookOpen className="h-3.5 w-3.5 text-sage" />
                          Cited Agricultural References ({researchedProfile.sources.length})
                        </h5>
                        <div className="space-y-1.5 divide-y divide-line/40">
                          {researchedProfile.sources.map((src, idx) => (
                            <div key={idx} className="pt-1.5 first:pt-0 text-xs">
                              <a
                                href={src.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-forest hover:text-sage inline-flex items-center gap-1"
                              >
                                {src.title}
                                <ExternalLink className="h-3 w-3 text-muted" />
                              </a>
                              {src.publisher ? (
                                <span className="text-[11px] text-muted ml-2">
                                  ({src.publisher})
                                </span>
                              ) : null}
                              {src.relevantFinding ? (
                                <p className="text-[11px] text-muted mt-0.5">
                                  {src.relevantFinding}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            {/* TAB 3: Manual Custom Variety Entry */}
            {plantSource === 'custom' ? (
              <TextField
                label="Custom plant name"
                required
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Thai Bird Chili, Dragon Fruit Seedling"
                hint="Between 1 and 80 characters."
                error={fieldErrors.customName?.[0]}
                disabled={submitting}
              />
            ) : null}

            {/* Common Planting Parameters */}
            {(plantSource !== 'research' || researchedProfile) ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Planting date"
                    optional
                    type="date"
                    value={plantingDate}
                    onChange={(e) => setPlantingDate(e.target.value)}
                    hint="When seeds or seedlings were planted."
                    error={fieldErrors.plantingDate?.[0]}
                    disabled={submitting}
                  />

                  <SelectField
                    label="Growth stage"
                    value={growthStage}
                    onChange={(e) => setGrowthStage(e.target.value as GrowthStage)}
                    hint="Current lifecycle stage."
                    error={fieldErrors.growthStage?.[0]}
                    disabled={submitting}
                  >
                    <option value="seedling">Seedling</option>
                    <option value="vegetative">Vegetative</option>
                    <option value="flowering">Flowering</option>
                    <option value="fruiting">Fruiting</option>
                    <option value="harvested">Harvested</option>
                  </SelectField>
                </div>

                <TextField
                  label="Estimated harvest date"
                  optional
                  type="date"
                  value={expectedHarvestDate}
                  onChange={(e) => setExpectedHarvestDate(e.target.value)}
                  hint="Estimated date for planning purposes (not a guarantee)."
                  error={fieldErrors.expectedHarvestDate?.[0]}
                  disabled={submitting}
                />

                <TextAreaField
                  label="Personal notes"
                  optional
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Seed brand, initial health, soil mix..."
                  hint="Optional personal notes up to 1000 characters."
                  error={fieldErrors.notes?.[0]}
                  disabled={submitting}
                />

                <div className="flex items-center justify-end gap-3 pt-3">
                  <Link
                    to="/dashboard/plants"
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
                    {plantSource === 'research' ? 'Save Custom Plant' : 'Add Plant'}
                  </Button>
                </div>
              </>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
