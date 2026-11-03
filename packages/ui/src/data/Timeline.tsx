import { cn } from '../utils/cn';

/** Vertical timeline / activity log ("What happens next", activity log, withdrawal timeline). */
export function Timeline({ items, className }: { items: { title: string; body?: string; time?: string; state?: 'done' | 'current' | 'todo' }[]; className?: string }) {
  return (
    <ol className={cn('relative space-y-5', className)}>
      {items.map((it, i) => (
        <li key={`${it.title}${i}`} className="relative flex gap-3">
          {i < items.length - 1 ? <span aria-hidden className="absolute left-[7px] top-5 h-[calc(100%+4px)] w-0.5 bg-line" /> : null}
          <span
            className={cn(
              'relative mt-1 size-4 shrink-0 rounded-full border-2',
              it.state === 'done' ? 'border-success-bright bg-success-bright' : it.state === 'current' ? 'border-brand bg-surface' : 'border-line bg-surface',
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="text-label-md text-fg">{it.title}</p>
              {it.time ? <p className="shrink-0 text-body-xs text-fg-tertiary">{it.time}</p> : null}
            </div>
            {it.body ? <p className="mt-0.5 text-body-sm text-fg-secondary">{it.body}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
