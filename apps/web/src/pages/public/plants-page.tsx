import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PLANT_CATALOG, PLANT_CATEGORIES } from '@growspace/shared';
import { PlantCard } from '@/components/plant-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

export function PlantsPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return PLANT_CATALOG.filter((entry) => {
      if (!entry.isPublished) return false;
      if (category !== 'All' && entry.category !== category) return false;
      if (!normalizedQuery) return true;
      return (
        entry.commonName.toLowerCase().includes(normalizedQuery) ||
        (entry.scientificName?.toLowerCase().includes(normalizedQuery) ?? false) ||
        entry.category.toLowerCase().includes(normalizedQuery)
      );
    }).sort((a, b) => a.commonName.localeCompare(b.commonName));
  }, [query, category]);

  return (
    <div className="container-page py-10 sm:py-14">
      <div className="max-w-2xl">
        <p className="eyebrow">Plant Library</p>
        <h1 className="mt-2 text-3xl font-semibold text-forest sm:text-4xl">
          Reference guidance for small gardens.
        </h1>
        <p className="mt-3 text-muted">
          Browse general care references, planting expectations, and growing-method notes. Ranges
          are starting points — local climate, variety, and your own observations matter.
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full max-w-md">
          <label htmlFor="plant-search" className="sr-only">
            Search plants
          </label>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            id="plant-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or category"
            className="field-input pl-9"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-soft-sage hover:text-forest"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          {['All', ...PLANT_CATEGORIES].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              aria-pressed={category === item}
              className={cn(
                'min-h-9 rounded-full border px-3 text-sm font-medium transition-colors',
                category === item
                  ? 'border-forest bg-forest text-white'
                  : 'border-line-strong bg-card text-muted hover:border-sage hover:text-forest',
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <p className="text-sm text-muted" aria-live="polite">
          {filtered.length} {filtered.length === 1 ? 'reference' : 'references'}
          {query ? ` for “${query}”` : ''}
        </p>
        <Badge variant="outline">Reference content · not a diagnosis</Badge>
      </div>

      {filtered.length > 0 ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((entry) => (
            <PlantCard key={entry.id} entry={entry} />
          ))}
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState
            icon={Search}
            title="No plants match your search"
            description={
              query
                ? `No reference matched “${query}”${category !== 'All' ? ` in ${category}` : ''}. Try a different term or clear the filters.`
                : 'No references are available for this category yet.'
            }
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery('');
                  setCategory('All');
                }}
              >
                Clear filters
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}
