'use client';
import { useId, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';
import { gsap, useGSAP, prefersReducedMotion } from '../motion/gsap';

export interface AccordionItem {
  q: string;
  a: React.ReactNode;
}

function Row({ item, open, onToggle, variant }: { item: AccordionItem; open: boolean; onToggle: () => void; variant: 'divided' | 'cards' }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const el = panel.current;
      if (!el) return;
      if (prefersReducedMotion()) {
        gsap.set(el, { height: open ? 'auto' : 0, opacity: open ? 1 : 0 });
        return;
      }
      gsap.to(el, { height: open ? 'auto' : 0, opacity: open ? 1 : 0, duration: 0.32, ease: 'power3.out' });
    },
    { dependencies: [open] },
  );
  return (
    <div className={cn(variant === 'cards' ? 'rounded-lg border border-line bg-surface px-5' : 'border-b border-line-subtle')}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="flex min-h-16 w-full items-center justify-between gap-4 py-4 text-left text-label-lg text-fg focus-visible:outline-none focus-visible:shadow-focus"
        >
          {item.q}
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-full transition-colors', open ? 'bg-brand-subtle text-fg-brand' : 'text-fg-tertiary')}>
            <Icon name="chevron-down" size={20} className={cn('transition-transform duration-300', open && 'rotate-180')} />
          </span>
        </button>
      </h3>
      <div id={id} ref={panel} role="region" className="overflow-hidden" style={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}>
        <div className="pb-5 pr-12 text-body-md text-fg-secondary">{item.a}</div>
      </div>
    </div>
  );
}

/** FAQ accordion (homepage 19:876, help 23:1389). GSAP height tween; first item open by default. */
export function Accordion({ items, defaultOpen = 0, variant = 'divided', className }: { items: AccordionItem[]; defaultOpen?: number | null; variant?: 'divided' | 'cards'; className?: string }) {
  const [open, setOpen] = useState<number | null>(defaultOpen);
  return (
    <div className={cn(variant === 'cards' ? 'space-y-3' : '', className)}>
      {items.map((it, i) => (
        <Row key={it.q} item={it} variant={variant} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
      ))}
    </div>
  );
}
