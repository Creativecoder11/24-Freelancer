'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';

export interface OtpInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Fires at 6 digits. */
  onComplete?: (v: string) => void;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  length?: 6;
  label?: string;
}

/**
 * OTP input (Doc 02 §5.16): one hidden one-time-code input drives six 52×60 boxes
 * (44×56 below 768). SMS autofill and whole-code paste work natively; non-digits dropped.
 */
export function OtpInput({ value, onChange, onComplete, error, disabled, autoFocus, length = 6, label = '6-digit code' }: OtpInputProps) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const digits = value.replace(/\D/g, '').slice(0, length);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const update = (raw: string) => {
    const next = raw.replace(/\D/g, '').slice(0, length);
    onChange(next);
    setCaret(Math.min(next.length, length - 1));
    if (next.length === length && next !== digits) onComplete?.(next);
  };

  const active = Math.min(digits.length, length - 1);
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={label}
        className="relative flex gap-1.5 tablet:gap-2"
        onClick={() => ref.current?.focus()}
      >
        <input
          ref={ref}
          id={id}
          value={digits}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={length}
          pattern="\d{6}"
          disabled={disabled}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => update(e.target.value)}
          onKeyUp={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? caret)}
          className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0 disabled:cursor-not-allowed"
          style={{ caretColor: 'transparent', fontSize: 16 }}
        />
        {Array.from({ length }, (_, i) => {
          const d = digits[i];
          const isActive = focused && i === active && !disabled;
          return (
            <span
              key={i}
              aria-hidden
              className={cn(
                'relative flex h-14 w-11 items-center justify-center rounded-[12px] border font-display text-num-lg tabular-nums tablet:h-[60px] tablet:w-[52px]',
                disabled
                  ? 'border-line bg-muted text-fg-disabled'
                  : error
                    ? 'border-line-danger bg-surface text-fg'
                    : isActive
                      ? 'border-line-brand bg-surface text-fg shadow-[inset_0_0_0_0.5px_var(--fl-border-brand),var(--fl-shadow-focus)]'
                      : d
                        ? 'border-line-strong bg-surface text-fg'
                        : 'border-line bg-surface text-fg',
              )}
            >
              {d ?? ''}
              {isActive && !d ? <span className="h-6 w-0.5 animate-pulse bg-fg-brand motion-reduce:animate-none" /> : null}
            </span>
          );
        })}
      </div>
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1 text-body-xs text-fg-danger">
          <Icon name="alert-circle" size={14} />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Static OTP digit box for docs/gallery (Empty · Focus · Filled). */
export function OtpDigit({ state, digit }: { state: 'empty' | 'focus' | 'filled' | 'error'; digit?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-[60px] w-[52px] items-center justify-center rounded-[12px] border bg-surface font-display text-num-lg text-fg',
        state === 'empty' && 'border-line',
        state === 'focus' && 'border-line-brand shadow-[inset_0_0_0_0.5px_var(--fl-border-brand),var(--fl-shadow-focus)]',
        state === 'filled' && 'border-line-strong',
        state === 'error' && 'border-line-danger',
      )}
    >
      {state === 'focus' ? <span className="h-6 w-0.5 bg-fg-brand" /> : digit}
    </span>
  );
}
