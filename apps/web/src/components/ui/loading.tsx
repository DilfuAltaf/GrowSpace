import { cn } from '@/lib/utils';

export function FullPageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8" role="status">
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-sage border-t-transparent"
        aria-hidden="true"
      />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

export function LoadingSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-control bg-soft-sage/80', className)}
      aria-hidden="true"
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="card-surface space-y-3 p-5" role="status" aria-label="Loading content">
      <LoadingSkeleton className="h-4 w-1/3" />
      <LoadingSkeleton className="h-8 w-1/2" />
      <LoadingSkeleton className="h-3 w-2/3" />
    </div>
  );
}
