'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';
import { useIsMobile } from '../utils/hooks';
import { Popover } from '../overlays/Popover';
import { BottomSheet } from '../overlays/BottomSheet';
import { FieldShell, inputBoxClasses, type FieldBaseProps } from './FieldShell';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> extends Omit<FieldBaseProps, 'counter'> {
  options: SelectOption<V>[];
  value: V | null;
  onChange: (v: V) => void;
  /** Auto true above 7 options. */
  searchable?: boolean;
  searchPlaceholder?: string;
  placeholder?: string;
  /** Toolbar variant: inline "Sort:" label, no label above. */
  compact?: { inlineLabel: string };
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
  /** Empty-search copy builder. */
  noMatchesText?: (q: string) => string;
  /** Force the menu open (gallery). */
  defaultOpen?: boolean;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Select and searchable combobox (Doc 02 §5.7). Bottom sheet below 768 px. */
export function Select<V extends string = string>({
  label,
  helper,
  error,
  optional,
  labelAction,
  labelHidden,
  options,
  value,
  onChange,
  searchable: searchableProp,
  searchPlaceholder = 'Search',
  placeholder = 'Select',
  compact,
  disabled,
  name,
  id: idProp,
  className,
  noMatchesText = (q) => `No matches for “${q}”`,
  defaultOpen = false,
}: SelectProps<V>) {
  const auto = useId();
  const id = idProp ?? auto;
  const listId = `${id}-listbox`;
  const searchable = searchableProp ?? options.length > 7;
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const isMobile = useIsMobile();
  const typed = useRef({ s: '', t: 0 });

  const filtered = useMemo(
    () => (searchable && query.trim() ? options.filter((o) => norm(o.label).includes(norm(query.trim()))) : options),
    [options, query, searchable],
  );
  const selected = options.find((o) => o.value === value) ?? null;

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const idx = filtered.findIndex((o) => o.value === value);
    setActive(idx >= 0 ? idx : 0);
    if (searchable) requestAnimationFrame(() => searchRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const commit = (o: SelectOption<V> | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
    triggerRef.current?.focus();
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
      case 'Home':
        if (!searchable) (e.preventDefault(), setActive(0));
        break;
      case 'End':
        if (!searchable) (e.preventDefault(), setActive(filtered.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        commit(filtered[active]);
        break;
      case ' ':
        if (!searchable) (e.preventDefault(), commit(filtered[active]));
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        if (!searchable && e.key.length === 1) {
          const now = Date.now();
          typed.current.s = now - typed.current.t > 600 ? e.key.toLowerCase() : typed.current.s + e.key.toLowerCase();
          typed.current.t = now;
          const hit = filtered.findIndex((o) => norm(o.label).startsWith(typed.current.s));
          if (hit >= 0) setActive(hit);
        }
    }
  };

  const optionId = (i: number) => `${id}-opt-${i}`;
  const list = (
    <ul ref={listRef} id={listId} role="listbox" aria-label={label} className={cn('overflow-y-auto', isMobile ? '' : 'max-h-[260px]')}>
      {filtered.length === 0 ? (
        <li role="presentation" className="flex h-10 items-center px-3 text-body-sm text-fg-tertiary">
          {noMatchesText(query.trim())}
        </li>
      ) : (
        filtered.map((o, i) => {
          const isSel = o.value === value;
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
              onClick={() => commit(o)}
              className={cn(
                'flex min-h-10 cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-body-sm',
                isMobile && 'min-h-12 text-body-md',
                o.disabled && 'cursor-not-allowed text-fg-disabled',
                isSel ? 'bg-brand-subtle font-semibold text-fg-brand' : i === active ? 'bg-muted text-fg' : 'text-fg hover:bg-subtle',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{o.label}</span>
                {o.description ? <span className="block text-body-xs font-normal text-fg-tertiary">{o.description}</span> : null}
              </span>
              {isSel ? <Icon name="check" size={16} className="shrink-0" /> : null}
            </li>
          );
        })
      )}
    </ul>
  );

  const searchBox = searchable ? (
    <div className="relative mb-1.5 flex h-10 items-center rounded-[8px] border border-line bg-subtle focus-within:border-line-brand">
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
  ) : null;

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
      aria-activedescendant={open && !searchable && active >= 0 ? optionId(active) : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : helper ? `${id}-helper` : undefined}
      aria-label={compact ? `${compact.inlineLabel} ${selected?.label ?? ''}`.trim() : undefined}
      onClick={() => setOpen((o) => !o)}
      onKeyDown={onKey}
      className={cn(
        inputBoxClasses({ error: !!error, disabled }),
        'pl-3 pr-[44px] text-left text-body-md outline-none',
        compact ? 'h-[52px] rounded-[12px]' : 'h-12',
        open && !disabled && !error && 'border-line-brand shadow-[inset_0_0_0_0.5px_var(--fl-border-brand)]',
        'focus-visible:shadow-[inset_0_0_0_0.5px_var(--fl-border-brand),var(--fl-shadow-focus)] focus-visible:border-line-brand',
        disabled && 'cursor-not-allowed',
      )}
    >
      {compact ? <span className="mr-1.5 text-fg-tertiary">{compact.inlineLabel}</span> : null}
      <span className={cn('truncate', !selected && 'text-fg-tertiary', disabled && 'text-fg-disabled')}>{selected?.label ?? placeholder}</span>
      <Icon
        name={open ? 'chevron-up' : 'chevron-down'}
        size={20}
        className={cn('absolute right-3', disabled ? 'text-fg-disabled' : 'text-fg-secondary')}
      />
    </button>
  );

  const menu = isMobile ? (
    <BottomSheet open={open} onOpenChange={setOpen} title={compact?.inlineLabel.replace(/:$/, '') || label}>
      {searchBox}
      {list}
    </BottomSheet>
  ) : (
    <Popover
      open={open}
      onOpenChange={setOpen}
      anchorRef={triggerRef}
      matchWidth
      offset={8}
      className="max-h-[320px] overflow-hidden p-[6px]"
      returnFocus
    >
      {searchBox}
      {list}
    </Popover>
  );

  if (compact) {
    return (
      <div className={cn('relative', className)}>
        {trigger}
        {menu}
      </div>
    );
  }
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
    </FieldShell>
  );
}

/** Searchable select (combobox) — same component with search forced on. */
export function Combobox<V extends string = string>(props: Omit<SelectProps<V>, 'searchable'>) {
  return <Select {...props} searchable />;
}
