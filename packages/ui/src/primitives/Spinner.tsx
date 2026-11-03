import { LoaderCircle } from 'lucide-react';
import { cn } from '../utils/cn';

export interface SpinnerProps {
  size?: 16 | 20 | 24;
  className?: string;
  /** Visible to screen readers when set; otherwise decorative. */
  label?: string;
}

/** LoaderCircle spinning 0.8 s linear (Doc 02 §5.53). Static under reduced motion. */
export function Spinner({ size = 20, className, label }: SpinnerProps) {
  return (
    <span role={label ? 'status' : undefined} className={cn('inline-flex', className)}>
      <LoaderCircle size={size} strokeWidth={2} aria-hidden className="animate-[spin_0.8s_linear_infinite] motion-reduce:animate-none" />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
