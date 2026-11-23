'use client';
/**
 * Profile page layout (Doc 02 §5.47.17, sub-nav removed): sections stacked full width.
 * Deep links like `#payout-methods` still scroll to that section on load and briefly highlight it.
 */
import { useEffect } from 'react';
import { cn, gsap, MOTION_OK, type IconName } from '@24f/ui';

export interface SettingsNavItem {
  id: string;
  label: string;
  icon: IconName;
}

export function SettingsShell({ items, children }: { items: SettingsNavItem[]; children: React.ReactNode }) {
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash || !items.some((i) => i.id === hash)) return;
    const t = setTimeout(() => {
      const el = document.getElementById(hash);
      if (!el) return;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: 'auto' });
      el.focus({ preventScroll: true });
      if (window.matchMedia(MOTION_OK).matches) gsap.fromTo(el, { boxShadow: '0 0 0 4px var(--fl-border-focus)' }, { boxShadow: '0 0 0 0px transparent', duration: 1.2, delay: 0.3, clearProps: 'boxShadow' });
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="flex w-full min-w-0 flex-col gap-6">{children}</div>;
}

/** Section card (Figma 44:911…): radius 16, padding 32 desktop, title H4 + subtitle. */
export function Section({ id, title, subtitle, action, children, className }: { id: string; title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} tabIndex={-1} aria-labelledby={`${id}-title`} className={cn('scroll-mt-[100px] rounded-card border border-line bg-surface p-5 shadow-xs outline-none tablet:p-8', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="font-display text-h4 text-fg">
            {title}
          </h2>
          {subtitle ? <p className="mt-1 max-w-[560px] text-body-md text-fg-secondary">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function SectionSkeleton({ id, title }: { id: string; title: string }) {
  return (
    <Section id={id} title={title}>
      <div aria-busy="true" className="space-y-3">
        <span className="block h-12 animate-pulse rounded-[10px] bg-muted motion-reduce:animate-none" />
        <span className="block h-12 animate-pulse rounded-[10px] bg-muted motion-reduce:animate-none" />
      </div>
    </Section>
  );
}

/** Toggle / action row: title + description left, control right, dividers between rows. */
export function SettingRow({ title, description, control }: { title: React.ReactNode; description?: React.ReactNode; control?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line-subtle py-4 first:pt-0 last:border-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-label-md text-fg">{title}</p>
        {description ? <div className="mt-0.5 text-body-sm text-fg-secondary">{description}</div> : null}
      </div>
      {control ? <div className="shrink-0">{control}</div> : null}
    </div>
  );
}
