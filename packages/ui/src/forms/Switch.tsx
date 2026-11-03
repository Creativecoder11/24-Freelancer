'use client';
import { useId } from 'react';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';
import { Tooltip } from '../primitives/Tooltip';

export interface SwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  /** On + disabled + lock icon + tooltip (C-11, C-25). */
  locked?: boolean;
  lockedReason?: string;
  labelHidden?: boolean;
  className?: string;
}

/** Switch (Doc 02 §5.11): track 40×24, knob 20. `<button role="switch">`. */
export function Switch({ label, description, checked, onCheckedChange, disabled, locked, lockedReason, labelHidden, className }: SwitchProps) {
  const id = useId();
  const on = locked ? true : checked;
  const off = disabled || locked;
  const control = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={off || undefined}
      aria-labelledby={`${id}-label`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onClick={() => !off && onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-[120ms] focus-visible:shadow-focus focus-visible:outline-none',
        "before:absolute before:-inset-y-2.5 before:-inset-x-1 before:content-['']",
        off ? (on ? 'cursor-not-allowed bg-brand-300' : 'cursor-not-allowed bg-muted') : on ? 'bg-brand hover:bg-brand-hover' : 'bg-line-strong',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-0.5 size-5 rounded-full bg-surface shadow-sm transition-transform duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
          on ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <div className={cn('min-w-0 flex-1', labelHidden && 'sr-only')}>
        <span id={`${id}-label`} className={cn('flex items-center gap-1.5 text-label-md', disabled ? 'text-fg-disabled' : 'text-fg')}>
          <label htmlFor={id}>{label}</label>
          {locked ? <Icon name="lock" size={12} className="text-fg-tertiary" /> : null}
        </span>
        {description ? (
          <span id={`${id}-desc`} className="mt-0.5 block text-body-sm text-fg-secondary">
            {description}
            {locked && lockedReason ? <span className="sr-only"> {lockedReason}</span> : null}
          </span>
        ) : null}
      </div>
      {locked && lockedReason ? <Tooltip content={lockedReason}>{control}</Tooltip> : control}
    </div>
  );
}

/** Toggle row (Doc 02 §5.47.18): title + description left, switch right, divider between rows. */
export function ToggleRow(props: SwitchProps) {
  return <Switch {...props} className={cn('border-b border-line-subtle py-4 last:border-b-0', props.className)} />;
}
