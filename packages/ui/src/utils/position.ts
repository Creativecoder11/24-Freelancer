'use client';
import { useCallback, useState } from 'react';
import { useIsoLayoutEffect } from './hooks';

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';

export interface Placement {
  top: number;
  left: number;
  side: Side;
  /** Arrow offset along the cross axis, relative to the panel. */
  arrow: number;
}

const MARGIN = 8;

export function computePlacement(t: DOMRect, pw: number, ph: number, side: Side, align: Align, offset: number): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let s = side;
  // Flip when there is no room.
  if (s === 'bottom' && t.bottom + offset + ph > vh - MARGIN && t.top - offset - ph > MARGIN) s = 'top';
  else if (s === 'top' && t.top - offset - ph < MARGIN && t.bottom + offset + ph < vh - MARGIN) s = 'bottom';
  else if (s === 'right' && t.right + offset + pw > vw - MARGIN) s = 'left';
  else if (s === 'left' && t.left - offset - pw < MARGIN) s = 'right';

  let top = 0;
  let left = 0;
  if (s === 'top' || s === 'bottom') {
    top = s === 'bottom' ? t.bottom + offset : t.top - offset - ph;
    left = align === 'start' ? t.left : align === 'end' ? t.right - pw : t.left + t.width / 2 - pw / 2;
    left = Math.max(MARGIN, Math.min(left, vw - pw - MARGIN));
  } else {
    left = s === 'right' ? t.right + offset : t.left - offset - pw;
    top = align === 'start' ? t.top : align === 'end' ? t.bottom - ph : t.top + t.height / 2 - ph / 2;
    top = Math.max(MARGIN, Math.min(top, vh - ph - MARGIN));
  }
  const arrow = s === 'top' || s === 'bottom' ? t.left + t.width / 2 - left : t.top + t.height / 2 - top;
  return { top, left, side: s, arrow };
}

/** Positions a fixed panel next to a trigger and keeps it there on scroll/resize. */
export function useAnchoredPosition(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  panelRef: React.RefObject<HTMLElement | null>,
  { side = 'bottom', align = 'start', offset = 8 }: { side?: Side; align?: Align; offset?: number } = {},
) {
  const [pos, setPos] = useState<Placement | null>(null);
  const update = useCallback(() => {
    const t = triggerRef.current;
    const p = panelRef.current;
    if (!t || !p) return;
    setPos(computePlacement(t.getBoundingClientRect(), p.offsetWidth, p.offsetHeight, side, align, offset));
  }, [triggerRef, panelRef, side, align, offset]);

  useIsoLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    update();
    const raf = requestAnimationFrame(update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, update]);

  return pos;
}
