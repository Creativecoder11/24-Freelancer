import NextLink from 'next/link';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';
import { StatusBadge } from '../primitives/Badge';
import { buttonClasses } from '../primitives/button-classes';
import { Progress } from '../data/Progress';

export interface JobCardData {
  publicId: string;
  category: string;
  title: string;
  /** "≈ 6 min" */
  durationLabel: string;
  /** "Sheet link", "Screenshot + text" */
  proofLabel: string;
  slotsFilled: number;
  slotsTotal: number;
  /** "posted 2 min ago" */
  postedLabel: string;
  /** "$0.180" */
  rewardLabel: string;
  isNew?: boolean;
}

export interface JobCardProps {
  job: JobCardData;
  href: string;
  ctaLabel?: string;
  className?: string;
}

/**
 * Job card (Figma 13:404): 352–384 × 256, radius 16, Shadow/XS. Layers: category overline,
 * New badge, 2-line title, duration · proof, slots line, counter + progress, price, CTA.
 */
export function JobCard({ job, href, ctaLabel = 'View job', className }: JobCardProps) {
  const left = Math.max(0, job.slotsTotal - job.slotsFilled);
  return (
    <article
      className={cn(
        'group relative flex h-full min-h-[256px] flex-col rounded-card border border-line bg-surface p-6 shadow-xs transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-overline uppercase text-fg-brand">{job.category}</p>
        {job.isNew ? <StatusBadge tone="brand" label="New" /> : null}
      </div>
      <h3 className="mt-2 line-clamp-2 text-h5 text-fg">
        <NextLink href={href} className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none group-focus-within:after:shadow-focus">
          {job.title}
        </NextLink>
      </h3>
      <p className="mt-2 flex items-center gap-3 text-body-xs text-fg-tertiary">
        <span className="inline-flex items-center gap-1">
          <Icon name="clock" size={14} />
          {job.durationLabel}
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon name="image" size={14} />
          {job.proofLabel}
        </span>
      </p>
      <div className="mt-auto pt-4">
        <div className="flex items-center justify-between text-body-xs">
          <span className="text-fg-secondary">
            {left} slots left · {job.postedLabel}
          </span>
          <span className="tabular-nums text-fg-tertiary">
            {job.slotsFilled} / {job.slotsTotal}
          </span>
        </div>
        <Progress
          className="mt-2"
          value={job.slotsFilled}
          max={job.slotsTotal}
          valueText={`${job.slotsFilled} of ${job.slotsTotal} slots filled`}
        />
        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="font-display text-num-lg text-fg tabular-nums">{job.rewardLabel}</p>
            <p className="text-body-xs text-fg-tertiary">per approved task</p>
          </div>
          <span aria-hidden className={cn(buttonClasses({ size: 'S' }), 'pointer-events-none')}>
            {ctaLabel}
          </span>
        </div>
      </div>
    </article>
  );
}
