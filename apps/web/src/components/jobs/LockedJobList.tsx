import { Button, Icon, cn } from '@24f/ui';

/**
 * Guest view of a job list: rows are blurred, hidden from assistive tech and not focusable
 * or clickable, behind a log in / create account prompt. `next` is where auth returns the user.
 * Used by /jobs and the homepage live job board.
 */
export function LockedJobList({
  children,
  next,
  className,
  listClassName,
}: {
  children: React.ReactNode;
  next: string;
  className?: string;
  listClassName?: string;
}) {
  const qs = `?next=${encodeURIComponent(next)}`;
  return (
    <div className={cn('relative min-h-[420px]', className)}>
      <ul
        aria-hidden
        inert
        className={cn(
          'pointer-events-none select-none divide-y divide-line-subtle overflow-hidden rounded-card border border-line bg-surface shadow-xs blur-[6px]',
          listClassName,
        )}
      >
        {children}
      </ul>
      <div className="absolute inset-0 flex items-center justify-center bg-linear-to-b from-surface/10 via-surface/60 to-surface px-4">
        <div className="w-full max-w-[460px] rounded-card border border-line bg-surface p-6 text-center shadow-lg tablet:p-8">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-subtle text-fg-brand">
            <Icon name="lock" size={24} />
          </span>
          <h2 className="mt-4 font-display text-h3 text-fg">Log in to see open jobs</h2>
          <p className="mt-2 text-body-md text-fg-secondary">
            Create a free account or log in to view every job, its reward and the proof it needs.
          </p>
          <div className="mt-6 flex flex-col-reverse gap-3 tablet:flex-row tablet:justify-center">
            <Button href={`/login${qs}`} variant="secondary" size="L">
              Log in
            </Button>
            <Button href={`/signup${qs}`} size="L">
              Create account
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
