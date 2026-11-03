'use client';
import { useRef } from 'react';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';

export interface FilterChipProps {
  label: string;
  count?: number;
  selected?: boolean;
  onClick: () => void;
  /** Accessible noun for the count: "Surveys, 24 jobs". */
  countNoun?: string;
  className?: string;
}

/** Filter chip with count (Doc 02 §5.13). Selected = inverse fill. Use inside FilterChipGroup (radiogroup). */
export function FilterChip({ label, count, selected = false, onClick, countNoun = 'jobs', className }: FilterChipProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={count !== undefined ? `${label}, ${count} ${countNoun}` : undefined}
      tabIndex={selected ? 0 : -1}
      onClick={onClick}
      className={cn(
        'relative inline-flex h-9 shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-full pl-4 text-label-md transition-colors duration-[120ms]',
        "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
        count !== undefined ? 'pr-2.5' : 'pr-4',
        'focus-visible:outline-none focus-visible:shadow-focus',
        selected ? 'bg-inverse text-fg-inverse' : 'border border-line bg-surface text-fg hover:border-line-strong',
      )}
    >
      {label}
      {count !== undefined ? (
        <span
          aria-hidden
          className={cn(
            'inline-flex h-5 min-w-7 items-center justify-center rounded-[10px] px-1.5 text-label-sm font-semibold tabular-nums',
            selected ? 'bg-inverse-raised text-fg-inverse' : 'bg-muted text-fg-secondary',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** Radiogroup wrapper with arrow-key roving and a mobile horizontal scroller (20 px inset, snap). */
export function FilterChipGroup({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
    items[next]?.click();
  };
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'flex snap-x gap-2 overflow-x-auto py-1 [scrollbar-width:none] max-tablet:-mx-5 max-tablet:px-5 [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface ActiveFilterPillProps {
  label: string;
  onRemove: () => void;
}

/** Removable active-filter pill (`20:602`). */
export function ActiveFilterPill({ label, onRemove }: ActiveFilterPillProps) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full bg-brand-subtle pl-3 pr-1 text-label-sm font-semibold text-fg-brand">
      {label}
      <button
        type="button"
        aria-label={`Remove filter ${label}`}
        onClick={onRemove}
        className="relative inline-flex size-5 items-center justify-center rounded-full hover:bg-brand-muted focus-visible:shadow-focus before:absolute before:-inset-3 before:content-['']"
      >
        <Icon name="x" size={14} />
      </button>
    </span>
  );
}

export interface ChoiceChipProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  mode?: 'single' | 'multi';
  disabled?: boolean;
}

/** Choice chip (Doc 02 §5.14): 36 high pill r18, padding 0 16; multi shows leading check when selected. */
export function ChoiceChip({ label, selected, onClick, mode = 'single', disabled }: ChoiceChipProps) {
  return (
    <button
      type="button"
      role={mode === 'single' ? 'radio' : undefined}
      aria-checked={mode === 'single' ? selected : undefined}
      aria-pressed={mode === 'multi' ? selected : undefined}
      tabIndex={mode === 'single' ? (selected ? 0 : -1) : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[18px] px-4 text-label-md transition-colors duration-[120ms]',
        "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
        'focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:bg-muted disabled:text-fg-disabled',
        selected ? 'bg-inverse text-fg-inverse' : 'border border-line bg-surface text-fg hover:border-line-strong',
      )}
    >
      {mode === 'multi' && selected ? <Icon name="check" size={16} /> : null}
      {label}
    </button>
  );
}

export interface ChoiceChipGroupProps<V extends string> {
  legend: string;
  mode: 'single' | 'multi';
  options: { value: V; label: string }[];
  value: V | V[] | null;
  onChange: (v: V | V[]) => void;
  error?: string;
  /** Visually hide the legend. */
  legendHidden?: boolean;
}

export function ChoiceChipGroup<V extends string>({ legend, mode, options, value, onChange, error, legendHidden }: ChoiceChipGroupProps<V>) {
  const ref = useRef<HTMLDivElement>(null);
  const selected = (v: V) => (Array.isArray(value) ? value.includes(v) : value === v);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (mode !== 'single' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const n = items[(i + d + items.length) % items.length];
    n?.focus();
    n?.click();
  };
  const hasSelection = options.some((o) => selected(o.value));
  const errId = `${legend.replace(/\W+/g, '-').toLowerCase()}-err`;
  return (
    <fieldset aria-describedby={error ? errId : undefined}>
      <legend className={cn('mb-2 text-label-md text-fg', legendHidden && 'sr-only')}>{legend}</legend>
      <div ref={ref} role={mode === 'single' ? 'radiogroup' : 'group'} aria-label={legend} onKeyDown={onKeyDown} className="flex flex-wrap gap-2">
        {options.map((o, idx) => (
          <span key={o.value} className="contents" data-first={idx === 0 && !hasSelection ? '' : undefined}>
            <ChoiceChip
              label={o.label}
              mode={mode}
              selected={selected(o.value)}
              onClick={() => {
                if (mode === 'single') onChange(o.value);
                else {
                  const arr = Array.isArray(value) ? value : [];
                  onChange(arr.includes(o.value) ? arr.filter((x) => x !== o.value) : [...arr, o.value]);
                }
              }}
            />
          </span>
        ))}
      </div>
      {error ? (
        <p id={errId} className="mt-1.5 flex items-center gap-1 text-body-xs text-fg-danger">
          <Icon name="alert-circle" size={14} />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
