import type { ReadingSource } from '@growspace/shared';
import { READING_SOURCES } from '@growspace/shared';
import { Badge } from './badge';

interface DataSourceBadgeProps {
  source: ReadingSource;
  showDescription?: boolean;
  className?: string;
}

export function DataSourceBadge({ source, showDescription, className }: DataSourceBadgeProps) {
  const meta = READING_SOURCES[source];
  const variant = source === 'simulated' ? 'warning' : source === 'manual' ? 'info' : 'success';
  const label = source === 'simulated' ? 'SIMULATED / DATA DEMO' : meta.label;

  return (
    <span className={className}>
      <Badge variant={variant}>{label}</Badge>
      {showDescription ? <span className="mt-1 block text-xs text-muted">{meta.description}</span> : null}
    </span>
  );
}
