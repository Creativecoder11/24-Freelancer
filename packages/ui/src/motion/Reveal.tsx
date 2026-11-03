'use client';
import { useReveal, type RevealOptions } from './useReveal';

/** Wrapper form of useReveal. Mark children with `data-reveal` to stagger them. */
export function Reveal({ children, className, as: As = 'div', ...opts }: RevealOptions & { children: React.ReactNode; className?: string; as?: 'div' | 'section' | 'ul' }) {
  const ref = useReveal<HTMLDivElement>(opts);
  return (
    <As ref={ref as React.Ref<never>} className={className}>
      {children}
    </As>
  );
}
