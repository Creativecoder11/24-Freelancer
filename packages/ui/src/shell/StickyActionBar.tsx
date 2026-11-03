import { cn } from '../utils/cn';

/** Mobile/tablet sticky action bar for flow screens (Figma mobile frames): primary actions pinned at the bottom. */
export function StickyActionBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('fixed inset-x-0 bottom-0 z-[var(--fl-z-actionbar)] border-t border-line-subtle bg-surface px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-lg desktop:static desktop:z-auto desktop:border-0 desktop:bg-transparent desktop:p-0 desktop:shadow-none', className)}>
      <div className="flex items-center gap-3 desktop:justify-end">{children}</div>
    </div>
  );
}
