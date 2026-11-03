'use client';
import { useId } from 'react';
import { cn } from '../utils/cn';
import { FieldShell, inputBoxClasses, type FieldBaseProps } from './FieldShell';

export interface CurrencyInputProps extends Omit<FieldBaseProps, 'counter'> {
  /** Always a string: "10.00". Never converted to a number. */
  value: string;
  onChange: (v: string) => void;
  decimals: 2 | 3;
  /** L = 64 px tall (withdraw / deposit). */
  size?: 'M' | 'L';
  suffix?: string;
  /** "≈ ৳1,215" right-aligned inside the box. */
  inlineSecondary?: string;
  disabled?: boolean;
  name?: string;
  placeholder?: string;
  className?: string;
  id?: string;
}

/** Keeps digits and one dot; blocks extra decimals. Pure string ops (no floats, A-03). */
export function sanitizeAmount(raw: string, decimals: number): string {
  let s = raw.replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  const [int = '', frac] = s.split('.');
  const intClean = int.replace(/^0+(?=\d)/, '');
  return frac !== undefined ? `${intClean || '0'}.${frac.slice(0, decimals)}` : intClean;
}

/** Currency input (Doc 02 §5.5): "$" prefix Numeric/LG, value Numeric/LG, "USD" suffix Label/SM. */
export function CurrencyInput({
  label,
  helper,
  error,
  optional,
  labelAction,
  labelHidden,
  value,
  onChange,
  decimals,
  size = 'M',
  suffix = 'USD',
  inlineSecondary,
  disabled,
  name,
  placeholder = decimals === 3 ? '0.000' : '0.00',
  className,
  id: idProp,
}: CurrencyInputProps) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldShell id={id} label={label} helper={helper} error={error} optional={optional} labelAction={labelAction} labelHidden={labelHidden} disabled={disabled} className={className}>
      <div className={inputBoxClasses({ error: !!error, disabled, className: cn(size === 'L' ? 'h-16 rounded-[12px]' : 'h-12', 'gap-1 px-3') })}>
        <span aria-hidden className={cn('font-display text-fg-secondary', size === 'L' ? 'text-num-xl' : 'text-num-lg', disabled && 'text-fg-disabled')}>
          $
        </span>
        <input
          id={id}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : helper ? `${id}-helper` : undefined}
          onChange={(e) => onChange(sanitizeAmount(e.target.value, decimals))}
          className={cn(
            'h-full min-w-0 flex-1 bg-transparent font-display tabular-nums text-fg outline-none placeholder:text-fg-disabled disabled:cursor-not-allowed',
            size === 'L' ? 'text-num-xl' : 'text-num-lg',
          )}
        />
        {inlineSecondary ? <span className="shrink-0 text-body-sm text-fg-tertiary">{inlineSecondary}</span> : null}
        {suffix ? <span className="shrink-0 text-label-sm text-fg-tertiary">{suffix}</span> : null}
      </div>
    </FieldShell>
  );
}

export interface AmountInputProps extends CurrencyInputProps {
  /** "$5.00", "$10.00", "All · $12.48". */
  chips: { label: string; value: string }[];
  /** "Available: $12.48". */
  availableLabel?: string;
}

/** Large amount input with quick chips (Doc 02 §5.47.9). Chips are a radiogroup; typing deselects. */
export function AmountInput({ chips, availableLabel, ...props }: AmountInputProps) {
  return (
    <div className={cn('flex w-full flex-col gap-3', props.className)}>
      <CurrencyInput {...props} className={undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Quick amounts" className="flex flex-wrap gap-2">
          {chips.map((c) => {
            const sel = c.value === props.value;
            return (
              <button
                key={c.label}
                type="button"
                role="radio"
                aria-checked={sel}
                disabled={props.disabled}
                onClick={() => props.onChange(c.value)}
                className={cn(
                  'inline-flex h-9 items-center rounded-[18px] px-4 text-label-md transition-colors duration-[120ms] focus-visible:shadow-focus',
                  sel ? 'bg-inverse text-fg-inverse' : 'border border-line bg-surface text-fg hover:border-line-strong',
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        {availableLabel ? <span className="ml-auto text-body-sm text-fg-tertiary">{availableLabel}</span> : null}
      </div>
    </div>
  );
}
