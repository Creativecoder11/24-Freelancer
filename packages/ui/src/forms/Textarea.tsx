'use client';
import { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { FieldShell, describedBy, inputBoxClasses, type FieldBaseProps } from './FieldShell';

export interface TextareaProps extends Omit<FieldBaseProps, 'counter'>, React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Soft limit: typing past is allowed; the counter turns red and the parent blocks submit. */
  softMax?: number;
  /** Grow to 240 px then scroll. Default true. */
  autoGrow?: boolean;
  wrapperClassName?: string;
}

const codePoints = (s: string) => [...s].length;

/** Multi-line input with counter (Doc 02 §5.6): 112 px min, radius 10, inset 13/11. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, helper, error, optional, labelAction, labelHidden, softMax, autoGrow = true, wrapperClassName, className, id: idProp, disabled, value, defaultValue, onChange, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const [len, setLen] = useState(codePoints(String(value ?? defaultValue ?? '')));
  useEffect(() => {
    if (value !== undefined) setLen(codePoints(String(value)));
  }, [value]);
  const grow = useCallback(() => {
    const el = inner.current;
    if (!el || !autoGrow) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 110), 240)}px`;
  }, [autoGrow]);
  useEffect(grow, [grow, value]);
  const counter = softMax ? { value: len, max: softMax } : undefined;
  const over = softMax ? len > softMax : false;
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
      className={wrapperClassName}
    >
      <div className={inputBoxClasses({ error: !!error || over, disabled })}>
        <textarea
          ref={(el) => {
            inner.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          id={id}
          disabled={disabled}
          value={value}
          defaultValue={defaultValue}
          aria-invalid={error || over ? true : undefined}
          aria-describedby={describedBy(id, { helper, error, counter })}
          onChange={(e) => {
            setLen(codePoints(e.target.value));
            grow();
            onChange?.(e);
          }}
          className={cn(
            'min-h-[110px] w-full resize-none rounded-[10px] bg-transparent px-3 pb-7 pt-2.5 text-body-md outline-none placeholder:text-fg-tertiary disabled:cursor-not-allowed',
            className,
          )}
          {...rest}
        />
        {counter ? (
          <p
            id={`${id}-counter`}
            aria-live={softMax && softMax - len <= 20 ? 'polite' : 'off'}
            className={cn('pointer-events-none absolute bottom-2 right-3 text-body-xs tabular-nums', over ? 'text-fg-danger' : 'text-fg-tertiary')}
          >
            {counter.value} / {counter.max}
          </p>
        ) : null}
      </div>
    </FieldShell>
  );
});
