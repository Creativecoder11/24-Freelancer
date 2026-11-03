import NextLink from 'next/link';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';
import { StatusBadge } from '../primitives/Badge';
import { buttonClasses } from '../primitives/button-classes';

export interface TaskRowData {
  ref: string;
  title: string;
  employer: string;
  submittedLabel: string;
  rewardLabel: string;
  status: 'in_review' | 'approved' | 'needs_fix' | 'rejected';
  /** "Review due in 18 h" / "Paid to balance" */
  meta?: string;
  reason?: string;
  /** "Resubmit by Oct 27, 18:00" */
  deadline?: string;
}

/** Submitted-task list item (Figma 13:534). Needs fix shows the reason inline + Fix & resubmit. */
export function TaskRow({ task, href, fixHref, className }: { task: TaskRowData; href: string; fixHref?: string; className?: string }) {
  const problem = task.status === 'needs_fix' || task.status === 'rejected';
  return (
    <li className={cn('group relative px-5 py-4 transition-colors hover:bg-subtle desktop:px-6', className)}>
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 tablet:grid-cols-[1fr_96px_120px_auto]">
        <div className="min-w-0">
          <p className="truncate text-label-md text-fg">
            <NextLink href={href} className="after:absolute after:inset-0 focus-visible:outline-none group-focus-within:after:shadow-focus">
              {task.title}
            </NextLink>
          </p>
          <p className="truncate text-body-xs text-fg-tertiary">
            {task.employer} · {task.submittedLabel}
          </p>
        </div>
        <p className="text-right font-display text-num-sm tabular-nums text-fg tablet:text-left">{task.rewardLabel}</p>
        <div className="col-start-1 tablet:col-start-auto">
          <StatusBadge enum="submission_status" code={task.status} />
        </div>
        <div className="relative z-[1] col-start-2 row-start-2 text-right tablet:col-start-auto tablet:row-start-auto">
          {task.status === 'needs_fix' && fixHref ? (
            <NextLink href={fixHref} className={buttonClasses({ variant: 'secondary', size: 'S' })}>
              Fix &amp; resubmit
            </NextLink>
          ) : task.meta ? (
            <span className="text-body-xs text-fg-tertiary">{task.meta}</span>
          ) : null}
        </div>
      </div>
      {problem && task.reason ? (
        <div className="mt-3 flex gap-2 rounded-[10px] bg-danger-subtle px-3 py-2.5 text-body-sm text-fg-secondary">
          <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0 text-fg-danger" />
          <p>
            Reason from employer: {task.reason}
            {task.deadline ? ` ${task.deadline}.` : ''}
          </p>
        </div>
      ) : null}
    </li>
  );
}
