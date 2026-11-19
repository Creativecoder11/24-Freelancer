import NextLink from 'next/link';
import { cn } from '../utils/cn';
import { StatusBadge } from '../primitives/Badge';
import { buttonClasses } from '../primitives/button-classes';
import { Progress } from '../data/Progress';

export interface JobRowData {
  publicId: string;
  title: string;
  category: string;
  employer: string;
  ageLabel: string;
  slotsFilled: number;
  slotsTotal: number;
  rewardLabel: string;
  isNew?: boolean;
  /** Paid boost running: shown as "Top job". */
  isBoosted?: boolean;
}

export interface JobRowProps {
  job: JobRowData;
  href: string;
  /** Button text on wide rows ("View", "Continue", "View task"). */
  ctaLabel?: string;
  className?: string;
}

/**
 * Job row (Figma 13:405): list item for job lists. Layout follows the row's own width
 * (container query), so it works in a full-width list and in a narrow column alike.
 * Narrow: title + reward, slots bar below. Wide (≥ 760px): title · slots · reward · button.
 */
export function JobRow({ job, href, ctaLabel = 'View', className }: JobRowProps) {
  return (
    <li className={cn('group relative @container transition-colors hover:bg-subtle', className)}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 px-5 py-4 @min-[760px]:grid-cols-[minmax(0,1fr)_200px_100px_96px] @min-[760px]:px-6">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-label-md text-fg">
              {/* ::after stretches the link over the whole row; z-[1] keeps it above the
                  positioned View button and progress bar so clicks anywhere navigate. */}
              <NextLink href={href} className="after:absolute after:inset-0 after:z-[1] focus-visible:outline-none group-focus-within:after:shadow-focus">
                {job.title}
              </NextLink>
            </p>
            {job.isBoosted ? <StatusBadge tone="success" label="Top job" className="shrink-0" /> : null}
            {job.isNew ? <StatusBadge tone="brand" label="New" className="shrink-0" /> : null}
          </div>
          <p className="mt-0.5 truncate text-body-xs text-fg-tertiary">
            {job.category} · {job.employer} · {job.ageLabel}
          </p>
        </div>
        <div className="col-span-2 row-start-2 @min-[760px]:col-span-1 @min-[760px]:row-start-auto">
          <p className="text-body-xs tabular-nums text-fg-tertiary">
            {job.slotsFilled} of {job.slotsTotal} slots filled
          </p>
          <Progress className="mt-1.5" value={job.slotsFilled} max={job.slotsTotal} valueText={`${job.slotsFilled} of ${job.slotsTotal} slots filled`} />
        </div>
        <p className="text-right font-display text-num-md tabular-nums text-fg">{job.rewardLabel}</p>
        <span aria-hidden className="hidden justify-self-end @min-[760px]:block">
          <span className={cn(buttonClasses({ variant: 'secondary', size: 'S' }), 'min-w-0 whitespace-nowrap group-hover:border-line-strong')}>{ctaLabel}</span>
        </span>
      </div>
    </li>
  );
}
