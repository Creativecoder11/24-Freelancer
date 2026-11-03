import NextLink from 'next/link';
import { cn } from '../utils/cn';
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
}

/** Job row (Figma 13:405): 76 tall list item; stacks on mobile. */
export function JobRow({ job, href, className }: { job: JobRowData; href: string; className?: string }) {
  return (
    <li
      className={cn(
        'group relative grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 px-5 py-4 transition-colors hover:bg-subtle desktop:grid-cols-[1fr_220px_120px_72px] desktop:px-6',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-label-md text-fg">
          <NextLink href={href} className="after:absolute after:inset-0 focus-visible:outline-none group-focus-within:after:shadow-focus">
            {job.title}
          </NextLink>
        </p>
        <p className="mt-0.5 truncate text-body-xs text-fg-tertiary">
          {job.category} · {job.employer} · {job.ageLabel}
        </p>
      </div>
      <div className="col-span-2 row-start-2 desktop:col-span-1 desktop:row-start-auto">
        <p className="text-body-xs text-fg-tertiary">
          {job.slotsFilled} of {job.slotsTotal} slots filled
        </p>
        <Progress className="mt-1.5" value={job.slotsFilled} max={job.slotsTotal} valueText={`${job.slotsFilled} of ${job.slotsTotal} slots filled`} />
      </div>
      <p className="text-right font-display text-num-md tabular-nums text-fg">{job.rewardLabel}</p>
      <span aria-hidden className="hidden desktop:block">
        <span className={cn(buttonClasses({ variant: 'secondary', size: 'S' }), 'min-w-0')}>View</span>
      </span>
    </li>
  );
}
