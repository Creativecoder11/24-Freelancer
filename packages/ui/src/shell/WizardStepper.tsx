import NextLink from 'next/link';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';

/** Multi-step progress (Post a job 4 steps; Submit proof 3 steps). Completed steps may link back. */
export function WizardStepper({ steps, current, hrefFor, className }: { steps: string[]; current: number; hrefFor?: (i: number) => string; className?: string }) {
  return (
    <ol className={cn('flex items-center gap-2', className)} aria-label="Progress">
      {steps.map((label, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'current' : 'todo';
        const dot = (
          <span
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-full text-label-sm',
              state === 'done' ? 'bg-success-bright text-fg-inverse' : state === 'current' ? 'bg-brand text-fg-on-brand' : 'bg-muted text-fg-tertiary',
            )}
          >
            {state === 'done' ? <Icon name="check" size={14} /> : n}
          </span>
        );
        const text = <span className={cn('hidden text-label-md tablet:inline', state === 'todo' ? 'text-fg-tertiary' : 'text-fg')}>{label}</span>;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            {state === 'done' && hrefFor ? (
              <NextLink href={hrefFor(n)} className="flex items-center gap-2 rounded-md focus-visible:shadow-focus">
                {dot}
                {text}
              </NextLink>
            ) : (
              <span className="flex items-center gap-2">
                {dot}
                {text}
              </span>
            )}
            <span className="sr-only">{state === 'done' ? ' (done)' : state === 'current' ? ' (current)' : ''}</span>
            {n < steps.length ? <span aria-hidden className={cn('h-0.5 flex-1 rounded-full', state === 'done' ? 'bg-success-bright' : 'bg-line')} /> : null}
          </li>
        );
      })}
    </ol>
  );
}
