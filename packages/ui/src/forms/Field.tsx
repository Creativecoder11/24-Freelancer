'use client';
import { forwardRef, useId, useState } from 'react';
import { cn } from '../utils/cn';
import { Icon, type IconName } from '../utils/icons';
import { FieldShell, describedBy, inputBoxClasses, type FieldBaseProps } from './FieldShell';

export interface FieldProps extends FieldBaseProps, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  leadingIcon?: IconName;
  trailing?: React.ReactNode;
  /** Read-only styling (subtle fill, subtle border). */
  readOnlyStyle?: boolean;
  /** Trim leading/trailing spaces on blur (text, email, tel, url). Default true. */
  trimOnBlur?: boolean;
  /** Extra classes for the outer wrapper. */
  wrapperClassName?: string;
}

const TRIM_TYPES = new Set(['text', 'email', 'tel', 'url', 'search', undefined]);

/** Labelled 48 px text field (Doc 02 §5.5). */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  {
    label,
    helper,
    error,
    optional,
    labelAction,
    counter,
    labelHidden,
    leadingIcon,
    trailing,
    readOnlyStyle,
    trimOnBlur = true,
    wrapperClassName,
    className,
    id: idProp,
    disabled,
    readOnly,
    onBlur,
    type,
    ...rest
  },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldShell
      id={id}
      label={label}
      helper={helper}
      error={error}
      optional={optional}
      labelAction={labelAction}
      counter={counter}
      labelHidden={labelHidden}
      disabled={disabled}
      className={wrapperClassName}
    >
      <div className={inputBoxClasses({ error: !!error, disabled, readOnly: readOnly || readOnlyStyle, className: 'h-12' })}>
        {leadingIcon ? (
          <Icon name={leadingIcon} size={20} className={cn('absolute left-3', disabled ? 'text-fg-disabled' : 'text-fg-tertiary')} />
        ) : null}
        <input
          ref={ref}
          id={id}
          type={type}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={error ? true : undefined}
          aria-required={optional ? undefined : rest.required ? true : undefined}
          aria-describedby={describedBy(id, { helper, error, counter })}
          onBlur={(e) => {
            if (trimOnBlur && TRIM_TYPES.has(type) && e.target.value !== e.target.value.trim()) {
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              setter?.call(e.target, e.target.value.trim());
              e.target.dispatchEvent(new Event('input', { bubbles: true }));
            }
            onBlur?.(e);
          }}
          className={cn(
            'h-full w-full min-w-0 rounded-[10px] bg-transparent text-body-md outline-none placeholder:text-fg-tertiary disabled:cursor-not-allowed disabled:placeholder:text-fg-disabled',
            leadingIcon ? 'pl-[42px]' : 'pl-3',
            trailing ? 'pr-[42px]' : 'pr-3',
            className,
          )}
          {...rest}
        />
        {trailing ? <span className="absolute right-1.5 flex items-center">{trailing}</span> : null}
      </div>
    </FieldShell>
  );
});

export interface PasswordFieldProps extends Omit<FieldProps, 'type' | 'trailing'> {
  showStrength?: boolean;
}

/** Password field with eye toggle (aria-pressed). Paste is never disabled. */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { showStrength, onChange, value, defaultValue, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const [inner, setInner] = useState(String(defaultValue ?? ''));
  const current = value !== undefined ? String(value) : inner;
  return (
    <div className="flex w-full flex-col gap-2">
      <Field
        ref={ref}
        {...rest}
        value={value}
        defaultValue={defaultValue}
        onChange={(e) => {
          setInner(e.target.value);
          onChange?.(e);
        }}
        type={visible ? 'text' : 'password'}
        trimOnBlur={false}
        trailing={
          <button
            type="button"
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
            disabled={rest.disabled}
            className="relative inline-flex size-8 items-center justify-center rounded-[8px] text-fg-secondary hover:bg-muted focus-visible:shadow-focus disabled:text-fg-disabled before:absolute before:-inset-1.5 before:content-['']"
          >
            <Icon name={visible ? 'eye-off' : 'eye'} size={16} />
          </button>
        }
      />
      {showStrength ? <PasswordStrengthMeter value={current} /> : null}
    </div>
  );
});

export interface PasswordStrengthMeterProps {
  value: string;
}

export function passwordScore(v: string): 0 | 1 | 2 | 3 | 4 {
  if (!v) return 0;
  let s = 0;
  if (v.length >= 8) s++;
  if (/\d/.test(v)) s++;
  if (/[^A-Za-z0-9]/.test(v)) s++;
  if (v.length >= 12 || (/[a-z]/.test(v) && /[A-Z]/.test(v))) s++;
  return Math.max(1, s) as 1 | 2 | 3 | 4;
}

const LEVELS = {
  1: { text: 'Weak — add a number or symbol', bar: 'bg-warning', fg: 'text-fg-warning' },
  2: { text: 'Fair — add a number or symbol', bar: 'bg-warning', fg: 'text-fg-warning' },
  3: { text: 'Strong', bar: 'bg-success-bright', fg: 'text-fg-success' },
  4: { text: 'Very strong', bar: 'bg-success-bright', fg: 'text-fg-success' },
} as const;

/** 4 bars 94×4 gap 8 + helper (Doc 02 §5.47.20). Advisory only. */
export function PasswordStrengthMeter({ value }: PasswordStrengthMeterProps) {
  const score = passwordScore(value);
  const lvl = score ? LEVELS[score] : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-4 gap-2" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn('h-1 rounded-full', lvl && i <= score ? lvl.bar : 'bg-muted')} />
        ))}
      </div>
      <p aria-live="polite" className={cn('min-h-4 text-body-xs', lvl ? lvl.fg : 'text-fg-tertiary')}>
        {lvl ? lvl.text : ''}
      </p>
    </div>
  );
}
