import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'neutral' | 'sage' | 'success' | 'warning' | 'critical' | 'info' | 'outline';

const styles: Record<BadgeVariant, string> = {
  neutral: 'bg-page text-muted border-line',
  sage: 'bg-soft-sage text-forest border-transparent',
  success: 'bg-success-surface text-success border-transparent',
  warning: 'bg-warning-surface text-warning border-transparent',
  critical: 'bg-critical-surface text-critical border-transparent',
  info: 'bg-info-surface text-info border-transparent',
  outline: 'border-line-strong text-muted bg-transparent',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}
