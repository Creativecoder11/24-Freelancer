'use client';
import { useCountUp } from './useCountUp';

export interface CountUpProps {
  value: number;
  format: (n: number) => string;
  className?: string;
  onScroll?: boolean;
}

/** Text that counts up to `value` (final text is server-rendered). */
export function CountUp({ value, format, className, onScroll }: CountUpProps) {
  const ref = useCountUp<HTMLSpanElement>({ to: value, format, onScroll });
  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
