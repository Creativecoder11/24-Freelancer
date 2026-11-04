'use client';
import { Button, EmptyState } from '@24f/ui';
import { formatDate } from '@24f/shared';

/** common.error.load (Doc 02 §11). */
export function ErrorPanel({ onRetry, className }: { onRetry?: () => void; className?: string }) {
  return (
    <div className={className ?? 'rounded-card border border-line bg-surface'}>
      <EmptyState
        icon="alert-circle"
        title="We couldn’t load this"
        body="Check your connection and try again."
        action={onRetry ? <Button variant="secondary" leadingIcon="refresh" onClick={onRetry}>Try again</Button> : undefined}
      />
    </div>
  );
}

const DAY = 86_400_000;

/** "Ends in 5 days" / "Ends today" / "Ended Oct 19". */
export function endsLabel(endsAt: string | null, prefix = 'Ends'): string {
  if (!endsAt) return '—';
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return `Ended ${formatDate(endsAt)}`;
  const days = Math.ceil(ms / DAY);
  if (ms < DAY) return `${prefix} in ${Math.max(1, Math.ceil(ms / 3_600_000))} h`;
  return `${prefix} in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** "in 5 days" for the My jobs ENDS column. */
export function endsShort(endsAt: string | null): string {
  if (!endsAt) return '—';
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return `Ended ${formatDate(endsAt)}`;
  if (ms < DAY) return `in ${Math.max(1, Math.ceil(ms / 3_600_000))} h`;
  const d = Math.ceil(ms / DAY);
  return `in ${d} ${d === 1 ? 'day' : 'days'}`;
}

/** Paused footer: "Paused by you · Oct 25", emp.pause.low_deposit, emp.pause.admin. */
export function pausedLabel(reason: string | null, pausedAt: string | null, status?: string): string {
  if (status === 'suspended' || reason === 'admin') return 'Suspended by admin. Contact support.';
  if (reason === 'low_deposit') return 'Paused · low deposit. Add funds to resume.';
  return `Paused by you${pausedAt ? ` · ${formatDate(pausedAt)}` : ''}`;
}

export const TIME_OPTIONS = [
  { value: 'about_2', label: 'About 2 minutes', minutes: 2 },
  { value: 'about_5', label: 'About 5 minutes', minutes: 5 },
  { value: 'about_10', label: 'About 10 minutes', minutes: 10 },
  { value: 'about_15', label: 'About 15 minutes', minutes: 15 },
  { value: 'about_30', label: 'About 30 minutes', minutes: 30 },
  { value: 'about_60', label: 'About 1 hour', minutes: 60 },
] as const;

export function timeLabel(v: string) {
  return TIME_OPTIONS.find((t) => t.value === v)?.label ?? v;
}
