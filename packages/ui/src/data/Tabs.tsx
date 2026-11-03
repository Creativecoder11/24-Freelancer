'use client';
import NextLink from 'next/link';
import { useEffect, useRef } from 'react';
import { cn } from '../utils/cn';

export interface TabsProps<V extends string> {
  label: string;
  tabs: { value: V; label: string; count?: number }[];
  value: V;
  /** URL-agnostic: give hrefFor for link tabs (parent syncs ?tab=), or onChange for local state. */
  hrefFor?: (v: V) => string;
  onChange?: (v: V) => void;
  panelId: string;
  className?: string;
}

/** Underline tabs with counts (Doc 02 §5.20): 44 high, Label/MD, padding 12, 2 px indicator. */
export function Tabs<V extends string>({ label, tabs, value, hrefFor, onChange, panelId, className }: TabsProps<V>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Keep the active tab scrolled into view on mobile scrollers.
    const el = ref.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    items[n]?.focus();
    if (!hrefFor) onChange?.(tabs[n]!.value);
  };

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'flex gap-2 overflow-x-auto shadow-[inset_0_-1px_0_var(--fl-border-default)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {tabs.map((t) => {
        const sel = t.value === value;
        const cls = cn(
          'group/tab relative inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-label-md outline-none transition-colors duration-[120ms]',
          'focus-visible:rounded-[8px] focus-visible:shadow-focus',
          sel ? 'text-fg' : 'text-fg-tertiary hover:text-fg-secondary',
        );
        const inner = (
          <>
            {t.label}
            {t.count !== undefined ? (
              <span
                className={cn(
                  'inline-flex h-5 min-w-[26px] items-center justify-center rounded-[10px] px-1.5 text-label-sm font-semibold tabular-nums',
                  sel ? 'bg-brand text-fg-on-brand' : 'bg-muted text-fg-secondary',
                )}
              >
                {t.count}
              </span>
            ) : null}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-0 bottom-0 h-0.5 rounded-[1px]',
                sel ? 'bg-brand' : 'bg-transparent group-hover/tab:bg-line',
              )}
            />
          </>
        );
        const common = {
          role: 'tab',
          'aria-selected': sel,
          'aria-controls': panelId,
          tabIndex: sel ? 0 : -1,
          'aria-label': t.count !== undefined ? `${t.label}, ${t.count}` : undefined,
          className: cls,
        } as const;
        return hrefFor ? (
          <NextLink key={t.value} href={hrefFor(t.value)} replace scroll={false} {...common} onClick={() => onChange?.(t.value)}>
            {inner}
          </NextLink>
        ) : (
          <button key={t.value} type="button" {...common} onClick={() => onChange?.(t.value)}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  return (
    <div id={id} role="tabpanel" tabIndex={0} className={cn('outline-none', className)}>
      {children}
    </div>
  );
}
