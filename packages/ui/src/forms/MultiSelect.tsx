'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';
import { useIsMobile } from '../utils/hooks';
import { Popover } from '../overlays/Popover';
import { BottomSheet } from '../overlays/BottomSheet';
import { FieldShell, inputBoxClasses, type FieldBaseProps } from './FieldShell';
import type { SelectOption } from './Select';

export interface MultiSelectProps<V extends string = string> extends Omit<FieldBaseProps, 'counter'> {
  options: SelectOption<V>[];
  value: V[];
  onChange: (v: V[]) => void;
  searchPlaceholder?: string;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
  noMatchesText?: (q: string) => string;
  /** Hide the removable pills under the trigger. */
  hidePills?: boolean;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * Searchable multi-select dropdown. Same trigger, menu and option rows as `Select`, but picking an
 * option toggles it and keeps the menu open. Selected values show as removable pills below.
 */
export function MultiSelect<V extends string = string>({
  label,
  helper,
  error,
  optional,
  labelAction,
  labelHidden,
  options,
  value,
  onChange,
  searchPlaceholder = 'Search',
  placeholder = 'Select',
  disabled,
  name,
  id: idProp,
  className,
  noMatchesText = (q) => `No matches for “${q}”`,
  hidePills,
}: MultiSelectProps<V>) {
  const auto = useId();
  const id = idProp ?? auto;
  const listId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const isMobile = useIsMobile();

  const filtered = useMemo(() => (query.trim() ? options.filter((o) => norm(o.label).includes(norm(query.trim()))) : options), [options, query]);
  const chosen = new Set(value);
  const selected = options.filter((o) => chosen.has(o.value));

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    setActive(0);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const toggle = (o: SelectOption<V> | undefined) => {
    if (!o || o.disabled) return;
    onChange(chosen.has(o.value) ? value.filter((v) => v !== o.value) : [...value, o.value]);
  };
  const move = (d: number) => {
    if (!filtered.length) return;
    let i = active;
    for (let n = 0; n < filtered.length; n++) {
      i = (i + d + filtered.length) % filtered.length;
      if (!filtered[i]?.disabled) break;
    }
    setActive(i);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Enter':
        e.preventDefault();
        toggle(filtered[active]);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  const optionId = (i: number) => `${id}-opt-${i}`;
  const list = (
    <ul ref={listRef} id={listId} role="listbox" aria-multiselectable aria-label={label} className={cn('overflow-y-auto', isMobile ? '' : 'max-h-[260px]')}>
      {filtered.length === 0 ? (
        <li role="presentation" className="flex h-10 items-center px-3 text-body-sm text-fg-tertiary">
          {noMatchesText(query.trim())}
        </li>
      ) : (
        filtered.map((o, i) => {
          const isSel = chosen.has(o.value);
          return (
            <li
              key={o.value}
              id={optionId(i)}
              data-index={i}
              role="option"
              aria-selected={isSel}
              aria-disabled={o.disabled || undefined}
              onPointerMove={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggle(o)}
              className={cn(
                'flex min-h-10 cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-body-sm',
                isMobile && 'min-h-12 text-body-md',
                o.disabled && 'cursor-not-allowed text-fg-disabled',
                isSel ? 'bg-brand-subtle font-semibold text-fg-brand' : i === active ? 'bg-muted text-fg' : 'text-fg hover:bg-subtle',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'grid size-[18px] shrink-0 place-items-center rounded-[5px] border',
                  isSel ? 'border-line-brand bg-brand text-fg-on-brand' : 'border-line-strong bg-surface',
                )}
              >
                {isSel ? <Icon name="check" size={12} strokeWidth={3} /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{o.label}</span>
                {o.description ? <span className="block text-body-xs font-normal text-fg-tertiary">{o.description}</span> : null}
              </span>
            </li>
          );
        })
      )}
    </ul>
  );

  const toolbar = (
    <div className="mb-1.5 flex items-center gap-2">
      <div className="relative flex h-10 flex-1 items-center rounded-[8px] border border-line bg-subtle focus-within:border-line-brand">
        <Icon name="search" size={16} className="absolute left-3 text-fg-tertiary" />
        <input
          ref={searchRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && filtered[active] ? optionId(active) : undefined}
          aria-label={searchPlaceholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          placeholder={searchPlaceholder}
          className="h-full w-full bg-transparent pl-9 pr-3 text-body-sm outline-none placeholder:text-fg-tertiary max-tablet:text-body-md"
        />
      </div>
      {value.length ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange([])}
          className="h-10 shrink-0 rounded-[8px] px-2 text-label-md text-fg-brand hover:bg-subtle focus-visible:shadow-focus focus-visible:outline-none"
        >
          Clear
        </button>
      ) : null}
    </div>
  );

  const summary = selected.length
    ? selected.length <= 2
      ? selected.map((o) => o.label).join(', ')
      : `${selected[0]!.label}, ${selected[1]!.label} +${selected.length - 2} more`
    : placeholder;

  const trigger = (
    <button
      ref={triggerRef}
      id={id}
      type="button"
      role="combobox"
      name={name}
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : helper ? `${id}-helper` : undefined}
      onClick={() => setOpen((o) => !o)}
      onKeyDown={onKey}
      className={cn(
        inputBoxClasses({ error: !!error, disabled }),
        'h-12 pl-3 pr-[44px] text-left text-body-md outline-none',
        open && !disabled && !error && 'border-line-brand shadow-[inset_0_0_0_0.5px_var(--fl-border-brand)]',
        'focus-visible:shadow-[inset_0_0_0_0.5px_var(--fl-border-brand),var(--fl-shadow-focus)] focus-visible:border-line-brand',
        disabled && 'cursor-not-allowed',
      )}
    >
      <span className={cn('truncate', !selected.length && 'text-fg-tertiary', disabled && 'text-fg-disabled')}>{summary}</span>
      <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} className={cn('absolute right-3', disabled ? 'text-fg-disabled' : 'text-fg-secondary')} />
    </button>
  );

  const menu = isMobile ? (
    <BottomSheet open={open} onOpenChange={setOpen} title={label}>
      {toolbar}
      {list}
    </BottomSheet>
  ) : (
    <Popover open={open} onOpenChange={setOpen} anchorRef={triggerRef} matchWidth offset={8} className="max-h-[320px] overflow-hidden p-[6px]" returnFocus>
      {toolbar}
      {list}
    </Popover>
  );

  return (
    <FieldShell
      id={id}
      label={label}
      helper={helper}
      error={error}
      optional={optional}
      labelAction={labelAction}
      labelHidden={labelHidden}
      disabled={disabled}
      className={className}
    >
      {trigger}
      {menu}
      {!hidePills && selected.length ? (
        <ul aria-label={`${label}: selected`} className="mt-1 flex flex-wrap gap-2">
          {selected.map((o) => (
            <li key={o.value} className="inline-flex h-7 items-center gap-1 rounded-full bg-brand-subtle pl-3 pr-1 text-label-sm font-semibold text-fg-brand">
              {o.label}
              {disabled ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${o.label}`}
                  onClick={() => onChange(value.filter((v) => v !== o.value))}
                  className="relative inline-flex size-5 items-center justify-center rounded-full hover:bg-brand-muted focus-visible:shadow-focus before:absolute before:-inset-3 before:content-['']"
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </FieldShell>
  );
}
