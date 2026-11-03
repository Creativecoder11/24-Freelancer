'use client';
import { useEffect, useRef } from 'react';
import { Icon } from '../utils/icons';

export interface FormErrorSummaryProps {
  errors: { field: string; message: string }[];
  onFocusField: (field: string) => void;
  /** Title builder: common.form.error_summary. */
  title?: (n: number) => string;
}

/** Danger alert at the top of a form with ≥ 2 errors; focus moves here (Doc 02 §7.5). */
export function FormErrorSummary({ errors, onFocusField, title = (n) => `Fix ${n} things to continue` }: FormErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length) ref.current?.focus();
  }, [errors.length]);
  if (errors.length === 0) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="flex gap-3 rounded-[12px] border border-line-danger bg-danger-subtle p-4 outline-none focus-visible:shadow-focus">
      <Icon name="alert-circle" size={20} className="shrink-0 text-fg-danger" />
      <div>
        <p className="text-label-md text-fg">{title(errors.length)}</p>
        <ul className="mt-1 space-y-1">
          {errors.map((e) => (
            <li key={e.field}>
              <button type="button" onClick={() => onFocusField(e.field)} className="text-left text-body-sm text-fg-danger underline underline-offset-2">
                {e.message}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
