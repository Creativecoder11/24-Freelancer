import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';

export type TrackerStepState = 'done' | 'current' | 'pending' | 'problem';
export interface TrackerStep {
  label: string;
  sub?: string;
  state: TrackerStepState;
}

/** Submission & payout timeline (Figma 10:382). Horizontal on ≥ tablet, vertical on mobile. */
export function StatusTracker({ steps, className, compact }: { steps: TrackerStep[]; className?: string; compact?: boolean }) {
  return (
    <ol className={cn('flex flex-col gap-4 tablet:flex-row tablet:gap-0', className)}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const dot =
          s.state === 'done'
            ? 'bg-brand text-fg-on-brand'
            : s.state === 'current'
              ? 'bg-surface border-2 border-brand text-fg-brand'
              : s.state === 'problem'
                ? 'bg-danger text-fg-inverse'
                : 'bg-surface border-2 border-line text-fg-disabled';
        return (
          <li key={s.label} className="relative flex flex-1 items-start gap-3 tablet:flex-col tablet:items-center tablet:text-center">
            {!last ? (
              <span
                aria-hidden
                className={cn(
                  'absolute left-[11px] top-7 h-[calc(100%-4px)] w-0.5 tablet:left-[calc(50%+16px)] tablet:top-[11px] tablet:h-0.5 tablet:w-[calc(100%-32px)]',
                  s.state === 'done' ? 'bg-brand' : 'bg-line',
                )}
              />
            ) : null}
            <span className={cn('relative z-[1] grid size-6 shrink-0 place-items-center rounded-full', dot)}>
              {s.state === 'done' ? <Icon name="check" size={14} /> : s.state === 'problem' ? <Icon name="rotate" size={12} /> : s.state === 'current' ? <span className="size-2 rounded-full bg-brand" /> : null}
            </span>
            <span className="min-w-0 tablet:mt-2">
              <span className={cn('block text-label-sm', s.state === 'pending' ? 'text-fg-tertiary' : s.state === 'problem' ? 'text-fg-danger' : 'text-fg')}>
                {s.label}
                <span className="sr-only"> — {s.state === 'done' ? 'done' : s.state === 'current' ? 'current step' : s.state === 'problem' ? 'action needed' : 'not yet'}</span>
              </span>
              {s.sub && !compact ? <span className="block text-body-xs text-fg-tertiary">{s.sub}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
