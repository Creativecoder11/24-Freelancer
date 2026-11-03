import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';

export interface FieldBaseProps {
  label: string;
  helper?: string;
  /** Sets aria-invalid, red helper with alert-circle. */
  error?: string;
  /** Renders "(optional)". Required is the default. */
  optional?: boolean;
  /** Right-aligned label action, e.g. "Forgot password?". */
  labelAction?: React.ReactNode;
  counter?: { value: number; max: number; suffix?: string };
  /** Visually hide the label (it stays the accessible name). */
  labelHidden?: boolean;
}

export function describedBy(id: string, p: { helper?: string; error?: string; counter?: unknown }) {
  return cn(p.error ? `${id}-error` : p.helper ? `${id}-helper` : null, p.counter ? `${id}-counter` : null) || undefined;
}

/** Shared box classes for 48 px inputs (Doc 02 §5.5). */
export function inputBoxClasses({
  error,
  disabled,
  readOnly,
  className,
}: {
  error?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}) {
  return cn(
    'relative flex w-full items-center rounded-[10px] border transition-[border-color,box-shadow] duration-[120ms]',
    disabled
      ? 'border-line bg-muted text-fg-disabled'
      : readOnly
        ? 'border-line-subtle bg-subtle text-fg'
        : cn(
            'bg-surface text-fg',
            error ? 'border-line-danger' : 'border-line hover:border-line-strong',
            'focus-within:shadow-[inset_0_0_0_0.5px_var(--fl-border-brand),var(--fl-shadow-focus)]',
            error ? 'focus-within:border-line-danger focus-within:shadow-[inset_0_0_0_0.5px_var(--fl-border-danger),var(--fl-shadow-focus)]' : 'focus-within:border-line-brand',
          ),
    className,
  );
}

export function FieldShell({
  id,
  label,
  helper,
  error,
  optional,
  labelAction,
  counter,
  labelHidden,
  disabled,
  children,
  className,
  counterLive,
}: FieldBaseProps & {
  id: string;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  /** Polite live region for the counter (Textarea: within 20 of the limit). */
  counterLive?: boolean;
}) {
  const over = counter ? counter.value > counter.max : false;
  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      <div className={cn('flex items-baseline justify-between gap-3', labelHidden && 'sr-only')}>
        <label htmlFor={id} className={cn('text-label-md', disabled ? 'text-fg-disabled' : 'text-fg')}>
          {label}
          {optional ? <span className="font-normal text-fg-tertiary"> (optional)</span> : null}
        </label>
        {labelAction ? <span className="text-label-md">{labelAction}</span> : null}
      </div>
      {children}
      {error || helper || counter ? (
        <div className="flex items-start justify-between gap-3 text-body-xs">
          {error ? (
            <p id={`${id}-error`} className="flex items-start gap-1 text-fg-danger">
              <Icon name="alert-circle" size={14} className="mt-px shrink-0" />
              <span>{error}</span>
            </p>
          ) : helper ? (
            <p id={`${id}-helper`} className={disabled ? 'text-fg-disabled' : 'text-fg-tertiary'}>
              {helper}
            </p>
          ) : (
            <span />
          )}
          {counter ? (
            <p
              id={`${id}-counter`}
              aria-live={counterLive ? 'polite' : 'off'}
              className={cn('shrink-0 tabular-nums', over ? 'text-fg-danger' : 'text-fg-tertiary')}
            >
              {counter.value} / {counter.max}
              {counter.suffix ? ` ${counter.suffix}` : ''}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
