import { Sprout } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface BrandProps {
  to?: string;
  className?: string;
  showTagline?: boolean;
}

export function Brand({ to = '/', className, showTagline = false }: BrandProps) {
  const content = (
    <>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-forest text-white">
        <Sprout className="h-5 w-5" aria-hidden="true" />
      </span>
      <span>
        <span className="block text-base font-bold tracking-tight text-forest">GrowSpace</span>
        {showTagline ? (
          <span className="block text-[11px] font-medium text-muted">Grow smarter. Grow naturally.</span>
        ) : null}
      </span>
    </>
  );

  if (!to) {
    return <span className={cn('inline-flex items-center gap-2', className)}>{content}</span>;
  }

  return (
    <Link
      to={to}
      className={cn('inline-flex items-center gap-2 rounded-control', className)}
      aria-label="GrowSpace home"
    >
      {content}
    </Link>
  );
}
