import { ArrowUpRight, Droplets, Sun } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { PlantCatalogEntry } from '@growspace/shared';
import { DIFFICULTIES } from '@growspace/shared';
import { Badge } from './ui/badge';

const categoryGradients: Record<string, string> = {
  Vegetables: 'from-[#DCE9D8] via-[#EDF3E8] to-[#C7DCC0]',
  Herbs: 'from-[#E7EFDF] via-[#F2F6EA] to-[#CDE0C5]',
  Fruits: 'from-[#F3E7DE] via-[#F8F1EA] to-[#E8D3C2]',
};

export function PlantCard({ entry }: { entry: PlantCatalogEntry }) {
  const gradient = categoryGradients[entry.category] ?? categoryGradients.Vegetables;
  const harvest =
    entry.harvestDaysMin && entry.harvestDaysMax
      ? `${entry.harvestDaysMin}–${entry.harvestDaysMax} days`
      : 'Varies';

  return (
    <Link
      to={`/plants/${entry.slug}`}
      className="group card-surface flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-float"
    >
      <div
        className={`relative flex h-40 items-end bg-gradient-to-br ${gradient} p-5`}
        aria-hidden="true"
      >
        <span className="text-5xl font-bold text-forest/20">
          {entry.commonName.charAt(0).toUpperCase()}
        </span>
        <Badge variant="sage" className="absolute top-4 left-4">
          {entry.category}
        </Badge>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-forest">{entry.commonName}</h3>
            {entry.scientificName ? (
              <p className="text-xs text-muted italic">{entry.scientificName}</p>
            ) : null}
          </div>
          <ArrowUpRight
            className="h-4 w-4 text-muted transition group-hover:text-sage"
            aria-hidden="true"
          />
        </div>

        <div className="mt-4 space-y-2 text-sm text-muted">
          <p className="flex items-center gap-2">
            <Sun className="h-4 w-4 shrink-0 text-sage" aria-hidden="true" />
            <span className="line-clamp-1">{entry.lightGuidance ?? 'Light guidance pending'}</span>
          </p>
          <p className="flex items-center gap-2">
            <Droplets className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />
            <span className="line-clamp-1">{entry.wateringGuidance ?? 'Watering guidance pending'}</span>
          </p>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
          {entry.difficulty ? (
            <Badge variant="outline">{DIFFICULTIES[entry.difficulty]}</Badge>
          ) : null}
          <span className="text-xs text-muted">Est. harvest: {harvest}</span>
        </div>
      </div>
    </Link>
  );
}
