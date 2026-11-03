'use client';
import NextLink from 'next/link';
import { useRef } from 'react';
import { cn } from '../utils/cn';

export interface SegmentedControlProps<V extends string> {
  label: string;
  /** tabs = view switch (tablist); radio = single-select input (radiogroup). */
  kind: 'tabs' | 'radio';
  options: { value: V; label: string; controls?: string }[];
  value: V;
  onChange: (v: V) => void;
  fullWidth?: boolean;
  className?: string;
}

export const segmentTrack = 'inline-flex h-11 items-center gap-1 rounded-[10px] bg-muted p-1';
export function segmentItem(selected: boolean, fullWidth?: boolean) {
  return cn(
    'inline-flex h-9 min-w-0 items-center justify-center rounded-[8px] px-4 text-label-md whitespace-nowrap transition-colors duration-[120ms] focus-visible:outline-none focus-visible:shadow-focus',
    fullWidth ? 'flex-1' : 'min-w-[106px]',
    selected ? 'bg-surface text-fg shadow-sm' : 'text-fg-secondary hover:text-fg',
  );
}

/** Segmented control (Doc 02 §5.12): track bg/muted r10, 4 px inset, 44 high; segment 36 r8. */
export function SegmentedControl<V extends string>({ label, kind, options, value, onChange, fullWidth, className }: SegmentedControlProps<V>) {
  const ref = useRef<HTMLDivElement>(null);
  const itemRole = kind === 'tabs' ? 'tab' : 'radio';
  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    onChange(options[n]!.value);
    requestAnimationFrame(() => ref.current?.querySelectorAll<HTMLElement>(`[role="${itemRole}"]`)[n]?.focus());
  };
  return (
    <div
      ref={ref}
      role={kind === 'tabs' ? 'tablist' : 'radiogroup'}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(segmentTrack, fullWidth && 'flex w-full', className)}
    >
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={itemRole}
            aria-selected={kind === 'tabs' ? sel : undefined}
            aria-checked={kind === 'radio' ? sel : undefined}
            aria-controls={kind === 'tabs' ? o.controls : undefined}
            tabIndex={sel ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={segmentItem(sel, fullWidth)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export interface ModeSwitchProps {
  mode: 'worker' | 'employer';
  workerHref: string;
  employerHref: string;
  labels?: { worker: string; employer: string; group: string };
  className?: string;
}

/** Role switch: two links styled as segments inside a group labelled "Mode" (Doc 02 §5.35). */
export function ModeSwitch({ mode, workerHref, employerHref, labels = { worker: 'Worker', employer: 'Employer', group: 'Mode' }, className }: ModeSwitchProps) {
  return (
    <div role="group" aria-label={labels.group} className={cn(segmentTrack, 'flex w-full', className)}>
      <NextLink href={workerHref} aria-current={mode === 'worker' ? 'page' : undefined} className={segmentItem(mode === 'worker', true)}>
        {labels.worker}
      </NextLink>
      <NextLink href={employerHref} aria-current={mode === 'employer' ? 'page' : undefined} className={segmentItem(mode === 'employer', true)}>
        {labels.employer}
      </NextLink>
    </div>
  );
}
