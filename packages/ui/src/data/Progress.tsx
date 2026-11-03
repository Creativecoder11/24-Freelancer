import { cn } from '../utils/cn';
import type { WithClassName } from '../types';

export interface ProgressProps extends WithClassName {
  /** Filled count. */
  value: number;
  /** Total. */
  max: number;
  tone?: 'brand' | 'success';
  /** Required: "14 of 40 slots filled" → aria-valuetext. */
  valueText: string;
  /** Track height (6 default; 4 for upload rows). */
  size?: 4 | 6;
}

/** Exact percentage, clamped 0–100; a non-zero value renders at least 4 px (Doc 02 §5.19). */
export function progressPercent(value: number, max: number): number {
  if (!max || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

/** Nearest 10 % step — only for matching Figma instances; code renders the exact value. */
export function nearestTen(pct: number): number {
  return Math.min(100, Math.max(0, Math.round(pct / 10) * 10));
}

/** Linear progress (Doc 02 §5.19): track 6 px bg/muted r3; brand (slots) or success-bright (approval). */
export function Progress({ value, max, tone = 'brand', valueText, size = 6, className }: ProgressProps) {
  const pct = progressPercent(value, max);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      aria-valuetext={valueText}
      className={cn('relative w-full overflow-hidden bg-muted', size === 6 ? 'h-1.5 rounded-[3px]' : 'h-1 rounded-[2px]', className)}
    >
      <span
        className={cn('absolute inset-y-0 left-0 rounded-[3px] transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)]', tone === 'brand' ? 'bg-brand' : 'bg-success-bright')}
        style={{ width: pct > 0 ? `max(4px, ${pct}%)` : 0 }}
      />
    </div>
  );
}
