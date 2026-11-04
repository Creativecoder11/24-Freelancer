'use client';
/**
 * Settings layout (Doc 02 §5.47.17): desktop 240 px sticky sub-nav with anchor scroll-spy (updates
 * the URL hash), mobile horizontal chip row; sections stacked. Scrolls to the hash on load and
 * briefly highlights the section.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon, cn, gsap, MOTION_OK, type IconName } from '@24f/ui';

export interface SettingsNavItem {
  id: string;
  label: string;
  icon: IconName;
}

export function SettingsShell({ items, children }: { items: SettingsNavItem[]; children: React.ReactNode }) {
  const [active, setActive] = useState(items[0]!.id);
  const lock = useRef(0);
  const chips = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((x): x is HTMLElement => !!x);
    const onScroll = () => {
      if (Date.now() < lock.current) return;
      const line = 140;
      let cur = els[0]?.id ?? items[0]!.id;
      for (const el of els) if (el.getBoundingClientRect().top - line <= 0) cur = el.id;
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = els[els.length - 1]?.id ?? cur;
      setActive((prev) => {
        if (prev !== cur && window.location.hash !== `#${cur}`) history.replaceState(null, '', `#${cur}`);
        return cur;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    // Initial hash: scroll there and flash the section.
    const hash = window.location.hash.slice(1);
    if (hash && items.some((i) => i.id === hash)) {
      setTimeout(() => go(hash, false), 120);
    }
    return () => window.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chips.current?.querySelector<HTMLElement>(`[data-id="${active}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  const go = (id: string, smooth = true) => {
    const el = document.getElementById(id);
    if (!el) return;
    lock.current = Date.now() + 700;
    setActive(id);
    history.replaceState(null, '', `#${id}`);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: smooth && !reduce ? 'smooth' : 'auto' });
    el.focus({ preventScroll: true });
    if (window.matchMedia(MOTION_OK).matches) gsap.fromTo(el, { boxShadow: '0 0 0 4px var(--fl-border-focus)' }, { boxShadow: '0 0 0 0px transparent', duration: 1.2, delay: 0.3, clearProps: 'boxShadow' });
  };

  return (
    <div className="mx-auto w-full max-w-[1104px] desktop:grid desktop:grid-cols-[240px_minmax(0,1fr)] desktop:gap-6">
      <nav aria-label="Settings sections" className="desktop:sticky desktop:top-[100px] desktop:h-fit">
        <div ref={chips} className="sticky top-[60px] z-[5] -mx-5 mb-5 flex gap-2 overflow-x-auto bg-canvas px-5 py-2 [scrollbar-width:none] tablet:-mx-8 tablet:px-8 desktop:hidden [&::-webkit-scrollbar]:hidden">
          {items.map((i) => (
            <a
              key={i.id}
              data-id={i.id}
              href={`#${i.id}`}
              aria-current={active === i.id ? 'location' : undefined}
              onClick={(e) => (e.preventDefault(), go(i.id))}
              className={cn('inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[22px] px-4 text-label-md transition-colors', active === i.id ? 'bg-inverse text-fg-inverse' : 'border border-line bg-surface text-fg-secondary')}
            >
              {i.label}
            </a>
          ))}
        </div>
        <ul className="hidden rounded-card border border-line bg-surface p-2 shadow-xs desktop:block">
          {items.map((i) => (
            <li key={i.id}>
              <a
                href={`#${i.id}`}
                aria-current={active === i.id ? 'location' : undefined}
                onClick={(e) => (e.preventDefault(), go(i.id))}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-[10px] px-3 text-label-md outline-none transition-colors focus-visible:shadow-focus',
                  active === i.id ? 'bg-brand-subtle text-fg-brand' : 'text-fg-secondary hover:bg-subtle hover:text-fg',
                )}
              >
                <Icon name={i.icon} size={20} />
                {i.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
    </div>
  );
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
