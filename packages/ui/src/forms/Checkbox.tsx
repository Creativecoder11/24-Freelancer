'use client';
import { forwardRef, useEffect, useId, useImperativeHandle, useRef } from 'react';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: React.ReactNode;
  indeterminate?: boolean;
  error?: string;
  /** Right-aligned facet count. */
  count?: number;
  description?: React.ReactNode;
  wrapperClassName?: string;
}

/** Checkbox (Doc 02 §5.9): 20×20 r6, label Body/SM at x30. Whole row clickable, min 44 px row on touch. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, indeterminate = false, error, count, description, wrapperClassName, className, id: idProp, disabled, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  const inner = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLInputElement);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <div className={cn('flex flex-col', wrapperClassName)}>
      <label
        htmlFor={id}
        className={cn(
          'group/cb relative flex min-h-11 items-start gap-2.5 py-3 tablet:min-h-0 tablet:py-0',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          className,
        )}
      >
        <input
          ref={inner}
          id={id}
          type="checkbox"
          disabled={disabled}
          aria-checked={indeterminate ? 'mixed' : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="peer sr-only"
          {...rest}
        />
        <span
          aria-hidden
          className={cn(
            'mt-0 inline-flex size-5 shrink-0 items-center justify-center rounded-[6px] border-[1.5px] text-fg-on-brand transition-colors duration-[120ms]',
            'peer-focus-visible:shadow-focus',
            disabled
              ? 'border-line bg-muted peer-checked:border-line peer-checked:bg-muted peer-checked:text-fg-disabled'
              : cn(
                  error ? 'border-line-danger' : 'border-line-strong group-hover/cb:border-line-brand',
                  'bg-surface peer-checked:border-brand peer-checked:bg-brand group-hover/cb:peer-checked:bg-brand-hover',
                  indeterminate && 'border-brand bg-brand group-hover/cb:bg-brand-hover',
                ),
            '[&>svg]:hidden peer-checked:[&>svg]:block',
          )}
        >
          {indeterminate ? <span className="block h-0.5 w-2.5 rounded-[1px] bg-current" /> : <Icon name="check" size={14} strokeWidth={3} />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('text-body-sm', disabled ? 'text-fg-disabled' : 'text-fg')}>{label}</span>
          {description ? <span className="text-body-xs text-fg-tertiary">{description}</span> : null}
        </span>
        {count !== undefined ? <span className="text-label-sm text-fg-tertiary tabular-nums">{count}</span> : null}
      </label>
      {error ? (
        <p id={`${id}-error`} className="ml-[30px] flex items-center gap-1 text-body-xs text-fg-danger">
          <Icon name="alert-circle" size={14} />
          {error}
        </p>
      ) : null}
    </div>
  );
});

export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  label: React.ReactNode;
  description?: React.ReactNode;
}

/** Radio (Doc 02 §5.10): 20 px circle, 1.5 px ring, 8 px brand dot when selected. */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio({ label, description, className, id: idProp, disabled, ...rest }, ref) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <label
      htmlFor={id}
      className={cn('group/rd flex min-h-11 items-start gap-2.5 py-3 tablet:min-h-0 tablet:py-0', disabled ? 'cursor-not-allowed' : 'cursor-pointer', className)}
    >
      <input ref={ref} id={id} type="radio" disabled={disabled} className="peer sr-only" {...rest} />
      <span
        aria-hidden
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-[120ms] peer-focus-visible:shadow-focus',
          '[&>span]:scale-0 peer-checked:[&>span]:scale-100',
          disabled ? 'border-line bg-muted' : 'border-line-strong bg-surface group-hover/rd:border-line-brand peer-checked:border-line-brand',
        )}
      >
        <span className={cn('size-2 rounded-full transition-transform duration-[120ms]', disabled ? 'bg-fg-disabled' : 'bg-brand')} />
      </span>
      <span className="flex flex-col">
        <span className={cn('text-body-sm', disabled ? 'text-fg-disabled' : 'text-fg')}>{label}</span>
        {description ? <span className="text-body-xs text-fg-tertiary">{description}</span> : null}
      </span>
    </label>
  );
});

export interface RadioGroupProps<V extends string> {
  legend: string;
  value: V;
  onChange: (v: V) => void;
  name: string;
  options: { value: V; label: string; description?: string; disabled?: boolean }[];
  error?: string;
  legendHidden?: boolean;
  orientation?: 'vertical' | 'horizontal';
}

/** Native radios in a fieldset; arrow keys move selection natively. */
export function RadioGroup<V extends string>({ legend, value, onChange, name, options, error, legendHidden, orientation = 'vertical' }: RadioGroupProps<V>) {
  const errId = useId();
  return (
    <fieldset aria-describedby={error ? errId : undefined} aria-invalid={error ? true : undefined}>
      <legend className={cn('mb-3 text-label-md text-fg', legendHidden && 'sr-only')}>{legend}</legend>
      <div className={cn('flex', orientation === 'vertical' ? 'flex-col gap-0 tablet:gap-3' : 'flex-wrap gap-x-6 gap-y-2')}>
        {options.map((o) => (
          <Radio
            key={o.value}
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
            label={o.label}
            description={o.description}
          />
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
