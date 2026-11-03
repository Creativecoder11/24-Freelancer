'use client';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { toast } from '@24f/ui';
import { ApiError } from '@/lib/api/client';

export type ErrorAction<T extends FieldValues> = (err: ApiError, form: UseFormReturn<T>) => void;

/** Applies a Doc 06 error to a form (Doc 03 §6.1): custom map → field errors → root alert. */
export function applyServerError<T extends FieldValues>(
  err: unknown,
  form: UseFormReturn<T>,
  map: Partial<Record<string, ErrorAction<T>>> = {},
): void {
  if (!(err instanceof ApiError)) {
    toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Your changes are still here. Try again.' });
    return;
  }
  const custom = map[err.code];
  if (custom) return custom(err, form);

  const entries = Object.entries(err.fields ?? {});
  const known = entries.filter(([k]) => k !== '_' && k in form.getValues());
  if (known.length) {
    known.forEach(([path, msgs], i) => form.setError(path as Path<T>, { type: 'server', message: msgs[0] }, { shouldFocus: i === 0 }));
    return;
  }
  const message =
    err.code === 'RATE_LIMITED'
      ? err.message.includes('codes')
        ? err.message
        : 'Too many requests. Try again in a few minutes.'
      : err.code === 'NETWORK_ERROR'
        ? "You're offline. Check your connection and try again."
        : err.message;
  form.setError('root.server' as Path<T>, { type: err.code, message });
}
