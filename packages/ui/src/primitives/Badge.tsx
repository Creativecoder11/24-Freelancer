import { cn } from '../utils/cn';
import type { Tone, WithClassName } from '../types';
import { badgeTone, type BadgeEnum } from './badge-map';

export const TONE_CLASSES: Record<Tone, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: 'bg-muted', fg: 'text-fg-secondary', dot: 'bg-fg-secondary' },
  brand: { bg: 'bg-brand-subtle', fg: 'text-fg-brand', dot: 'bg-fg-brand' },
  success: { bg: 'bg-success-subtle', fg: 'text-fg-success', dot: 'bg-fg-success' },
  warning: { bg: 'bg-warning-subtle', fg: 'text-fg-warning', dot: 'bg-fg-warning' },
  danger: { bg: 'bg-danger-subtle', fg: 'text-fg-danger', dot: 'bg-fg-danger' },
  info: { bg: 'bg-info-subtle', fg: 'text-fg-info', dot: 'bg-fg-info' },
  accent: { bg: 'bg-accent-subtle', fg: 'text-fg-accent', dot: 'bg-fg-accent' },
};

export interface StatusBadgeProps extends WithClassName {
  /** Preferred: label and tone from the single map. */
  enum?: BadgeEnum;
  code?: string;
  /** Flags that are not enums: "New", "Verified employer", count badges. */
  tone?: Tone;
  label?: string;
  showDot?: boolean;
}

/** Status badge (Doc 02 §5.18): 24 high pill, 6 px dot at x10, Label/SM Strong, right padding 10. */
export function StatusBadge({ enum: enumName, code, tone, label, showDot = true, className }: StatusBadgeProps) {
  let t: Tone = tone ?? 'neutral';
  let text = label ?? '';
  if (enumName && code) {
    const hit = badgeTone(enumName, code);
    t = tone ?? hit.tone;
    text = label ?? hit.label;
  }
  const c = TONE_CLASSES[t];
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full pr-2.5 text-label-sm font-semibold',
        showDot ? 'pl-2.5' : 'pl-2.5',
        c.bg,
        c.fg,
        className,
      )}
    >
      {showDot ? <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', c.dot)} /> : null}
      {text}
    </span>
  );
}

/** Alias kept short for app code. */
export const Badge = StatusBadge;

export interface CategoryTagProps extends WithClassName {
  style?: 'neutral' | 'brand' | 'outline';
  children: React.ReactNode;
}

/** Category / attribute tag (Doc 02 §5.15): 24 high, r6, padding 10/8. Non-interactive. */
export function CategoryTag({ style = 'neutral', children, className }: CategoryTagProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center whitespace-nowrap rounded-[6px] pl-2.5 pr-2 text-label-sm font-semibold',
        style === 'neutral' && 'bg-muted text-fg-secondary',
        style === 'brand' && 'bg-brand-subtle text-fg-brand',
        style === 'outline' && 'border border-line bg-surface text-fg-secondary',
        className,
      )}
    >
      {children}
    </span>
  );
}
