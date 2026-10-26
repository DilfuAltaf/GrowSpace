import { ArrowRight, CheckCircle2, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { PageHeader } from './ui/page-header';
import { buttonStyles } from './ui/button';

interface FeaturePlaceholderProps {
  title: string;
  description: string;
  phase: string;
  planned: string[];
  backTo?: { to: string; label: string };
}

export function FeaturePlaceholder({
  title,
  description,
  phase,
  planned,
  backTo = { to: '/dashboard', label: 'Back to overview' },
}: FeaturePlaceholderProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        eyebrow={`Scaffolded · ${phase}`}
        actions={
          <Link to={backTo.to} className={buttonStyles('secondary')}>
            {backTo.label}
          </Link>
        }
      />

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">
            <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
            Foundation ready
          </Badge>
          <Badge variant="outline">Data wiring pending</Badge>
        </div>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          The route, layout, and validation contracts for this area are in place. This screen does
          not pretend to save data yet; the capabilities below are the next implementation steps.
        </p>
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {planned.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-ink">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/dashboard/monitoring" className={buttonStyles('primary')}>
            View monitoring foundation
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link to="/plants" className={buttonStyles('secondary')}>
            Browse plant library
          </Link>
        </div>
      </Card>
    </div>
  );
}
