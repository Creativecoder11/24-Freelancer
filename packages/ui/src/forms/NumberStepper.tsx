'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';
import { ChoiceChip } from '../primitives/Chip';
import { FieldShell, type FieldBaseProps } from './FieldShell';

export interface NumberStepperProps extends Omit<FieldBaseProps, 'counter'> {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  /** Preset chips: 20, 40, 100, 200. */
  presets?: number[];
  disabled?: boolean;
  className?: string;
}

/** − / value / + stepper (Doc 02 §5.47.10): 44 px square buttons, value Numeric/MD in a 96×44 input. Long-press repeats. */
export function NumberStepper({ label, helper, error, optional, labelHidden, value, onChange, min, max, presets, disabled, className }: NumberStepperProps) {
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const valRef = useRef(value);
  valRef.current = value;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const start = (d: number) => {
    const tick = (delay: number) => {
      const next = clamp(valRef.current + d);
      if (next === valRef.current) return stop();
      onChange(next);
      timer.current = setTimeout(() => tick(Math.max(50, delay * 0.8)), delay);
    };
    tick(400);
  };
  useEffect(() => stop, []);

  const btn = (d: -1 | 1) => {
    const atLimit = d < 0 ? value <= min : value >= max;
    return (
      <button
        type="button"
        aria-label={d < 0 ? 'Decrease' : 'Increase'}
        aria-controls={id}
        disabled={disabled || atLimit}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          start(d);
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onChange(clamp(value + d));
          }
        }}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface text-fg-secondary shadow-xs hover:border-line-strong hover:bg-subtle focus-visible:shadow-focus disabled:cursor-not-allowed disabled:bg-muted disabled:text-fg-disabled disabled:shadow-none"
      >
        <Icon name={d < 0 ? 'minus' : 'plus'} size={20} />
      </button>
    );
  };

  return (
    <FieldShell id={id} label={label} helper={helper} error={error} optional={optional} labelHidden={labelHidden} disabled={disabled} className={className}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          {btn(-1)}
          <input
            id={id}
            inputMode="numeric"
            value={text}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : helper ? `${id}-helper` : undefined}
            onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
            onBlur={() => {
              const n = clamp(parseInt(text || String(min), 10));
              setText(String(n));
              onChange(n);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') (e.preventDefault(), onChange(clamp(value + 1)));
              if (e.key === 'ArrowDown') (e.preventDefault(), onChange(clamp(value - 1)));
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className={cn(
              'h-11 w-24 rounded-[10px] border bg-surface text-center font-display text-num-md tabular-nums text-fg outline-none focus:border-line-brand focus:shadow-focus disabled:bg-muted disabled:text-fg-disabled',
              error ? 'border-line-danger' : 'border-line',
            )}
          />
          {btn(1)}
        </div>
        {presets?.length ? (
          <div role="radiogroup" aria-label="Presets" className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <ChoiceChip key={p} label={String(p)} selected={value === p} onClick={() => onChange(clamp(p))} disabled={disabled} />
            ))}
          </div>
        ) : null}
      </div>
    </FieldShell>
  );
}

/** Alias matching the brief ("Stepper (−/+)"). */
export const QuantityStepper = NumberStepper;
