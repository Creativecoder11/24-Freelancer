import { cn } from '../utils/cn';
import { Icon, type IconName } from '../utils/icons';

/** Empty / filtered-zero / error state (G-01). Calm icon tile, one line of guidance, one action. */
export function EmptyState({ icon = 'inbox', title, body, action, className, compact }: { icon?: IconName; title: string; body?: string; action?: React.ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'px-6 py-8' : 'px-6 py-14', className)}>
      <span className="grid size-12 place-items-center rounded-[14px] bg-brand-subtle text-fg-brand">
        <Icon name={icon} size={24} />
      </span>
      <p className="mt-4 text-h5 text-fg">{title}</p>
      {body ? <p className="mt-1 max-w-[420px] text-body-sm text-fg-secondary">{body}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
