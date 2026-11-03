'use client';
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';
import { useDebouncedCallback, useMediaQuery } from '../utils/hooks';

export interface SearchProps {
  size?: 'L' | 'M';
  value: string;
  /** Fires after a 300 ms debounce. */
  onValueChange: (v: string) => void;
  /** Enter, no debounce. */
  onSubmit?: (v: string) => void;
  /** Visually hidden label. */
  label: string;
  placeholder: string;
  /** Registers "/" and shows the chip on non-touch. Default true. */
  shortcut?: boolean;
  disabled?: boolean;
  className?: string;
  debounceMs?: number;
}

function isTypingTarget(el: Element | null) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

/** Search (Doc 02 §5.8): L 52 / M 44, radius 12, "/" key-hint chip, clear button when filled. */
export const Search = forwardRef<HTMLInputElement, SearchProps>(function Search(
  { size = 'L', value, onValueChange, onSubmit, label, placeholder, shortcut = true, disabled, className, debounceMs = 300 },
  ref,
) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  const touch = useMediaQuery('(hover: none)');
  const [debounced, cancel] = useDebouncedCallback((v: string) => onValueChange(v), debounceMs);
  useEffect(() => setLocal(value), [value]);

  useEffect(() => {
    if (!shortcut || disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(document.activeElement)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcut, disabled]);

  const set = (v: string) => {
    setLocal(v);
    debounced(v);
  };

  return (
    <form
      role="search"
      className={cn('relative w-full', size === 'L' ? 'h-[52px]' : 'h-11', className)}
      onSubmit={(e) => {
        e.preventDefault();
        cancel();
        onValueChange(local);
        onSubmit?.(local);
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Icon name="search" size={20} className={cn('pointer-events-none absolute left-[15px] top-1/2 -translate-y-1/2', disabled ? 'text-fg-disabled' : 'text-fg-tertiary')} />
      <input
        ref={inputRef}
        id={id}
        type="search"
        role="searchbox"
        value={local}
        disabled={disabled}
        placeholder={placeholder}
        aria-keyshortcuts={shortcut ? '/' : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (local) {
              e.preventDefault();
              cancel();
              setLocal('');
              onValueChange('');
            } else inputRef.current?.blur();
          }
        }}
        className={cn(
          'h-full w-full appearance-none rounded-[12px] border bg-surface pl-[45px] pr-[51px] text-body-md text-fg outline-none transition-[border-color,box-shadow] duration-[120ms] placeholder:text-fg-tertiary',
          '[&::-webkit-search-cancel-button]:hidden',
          disabled
            ? 'cursor-not-allowed border-line bg-muted placeholder:text-fg-disabled'
            : 'border-line hover:border-line-strong focus:border-line-brand focus:shadow-[inset_0_0_0_0.5px_var(--fl-border-brand),var(--fl-shadow-focus)]',
        )}
      />
      {local ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            cancel();
            setLocal('');
            onValueChange('');
            inputRef.current?.focus();
          }}
          className="absolute right-2.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-[8px] text-fg-secondary hover:bg-muted focus-visible:shadow-focus"
        >
          <Icon name="x" size={16} />
        </button>
      ) : shortcut && !touch && !focused ? (
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-[15px] top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-[6px] bg-muted font-sans text-label-sm text-fg-tertiary"
        >
          /
        </kbd>
      ) : null}
    </form>
  );
});
