import { cn } from '../utils/cn';
import { Icon, type IconName } from '../utils/icons';
import type { AlertTone } from '../types';

const TONE: Record<AlertTone, { box: string; icon: IconName; fg: string }> = {
  info: { box: 'bg-info-subtle', icon: 'info', fg: 'text-fg-info' },
  success: { box: 'bg-success-subtle', icon: 'check-circle', fg: 'text-fg-success' },
  warning: { box: 'bg-warning-subtle', icon: 'alert-triangle', fg: 'text-fg-warning' },
  danger: { box: 'bg-danger-subtle', icon: 'alert-circle', fg: 'text-fg-danger' },
};

export interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** brand-subtle tip style (e.g. "Tip: jobs you start reserve a slot…"). */
  brand?: boolean;
  /** Shows a dismiss (×) button in the top-right corner. */
  onDismiss?: () => void;
  dismissLabel?: string;
}

/** Inline alert / banner (Figma 14:419). role=alert only for danger. */
/** Phone: the action sits under the text so the text keeps the full width. Tablet+: text left, action right. */
export function Alert({ tone = 'info', title, children, action, className, brand, onDismiss, dismissLabel = 'Dismiss' }: AlertProps) {
  const t = TONE[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-[12px] px-4 py-3', brand ? 'bg-brand-subtle' : t.box, className)}
    >
      <Icon name={t.icon} size={20} className={cn('mt-0.5 shrink-0', brand ? 'text-fg-brand' : t.fg)} />
      <div className="flex min-w-0 flex-1 flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between tablet:gap-4">
        <div className="min-w-0 text-body-sm text-fg-secondary">
          {title ? <p className="text-label-md text-fg">{title}</p> : null}
          {children}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="-my-1.5 -mr-2 grid size-9 shrink-0 place-items-center rounded-[8px] text-fg-tertiary hover:bg-surface hover:text-fg-secondary focus-visible:shadow-focus focus-visible:outline-none"
        >
          <Icon name="x" size={16} />
        </button>
      ) : null}
    </div>
  );
}
