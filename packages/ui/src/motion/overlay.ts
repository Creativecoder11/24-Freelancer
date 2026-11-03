'use client';
import { useEffect, useState } from 'react';
import { gsap, DURATION, prefersReducedMotion } from './gsap';
import { useIsoLayoutEffect } from '../utils/hooks';

export type OverlayVariant = 'dialog' | 'drawer-right' | 'drawer-left' | 'sheet' | 'popover' | 'toast-up' | 'toast-down';

const PANEL_FROM: Record<OverlayVariant, gsap.TweenVars> = {
  dialog: { autoAlpha: 0, y: 8 },
  'drawer-right': { xPercent: 100 },
  'drawer-left': { xPercent: -100 },
  sheet: { yPercent: 100 },
  popover: { autoAlpha: 0, y: -4 },
  'toast-up': { autoAlpha: 0, y: 16 },
  'toast-down': { autoAlpha: 0, y: -16 },
};
const PANEL_TO: Record<OverlayVariant, gsap.TweenVars> = {
  dialog: { autoAlpha: 1, y: 0 },
  'drawer-right': { xPercent: 0 },
  'drawer-left': { xPercent: 0 },
  sheet: { yPercent: 0 },
  popover: { autoAlpha: 1, y: 0 },
  'toast-up': { autoAlpha: 1, y: 0 },
  'toast-down': { autoAlpha: 1, y: 0 },
};
const ENTER: Record<OverlayVariant, number> = {
  dialog: DURATION.base,
  'drawer-right': DURATION.slow,
  'drawer-left': DURATION.slow,
  sheet: DURATION.slow,
  popover: DURATION.fast,
  'toast-up': DURATION.base,
  'toast-down': DURATION.base,
};

/**
 * Keeps an overlay mounted through its GSAP exit and plays enter/exit
 * (Doc 02 §7.1: fade + 8 px rise 200 ms, exit 120 ms; §7.2 slide 280 ms).
 * Reduced motion: instant (opacity only, 0 ms).
 */
export function useOverlayTransition(
  open: boolean,
  panelRef: React.RefObject<HTMLElement | null>,
  scrimRef: React.RefObject<HTMLElement | null> | null,
  variant: OverlayVariant,
  onExited?: () => void,
) {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) setPresent(true);
  }, [open]);

  useIsoLayoutEffect(() => {
    if (!present) return;
    const panel = panelRef.current;
    const scrim = scrimRef?.current ?? null;
    if (!panel) return;
    const reduce = prefersReducedMotion();
    gsap.killTweensOf([panel, scrim].filter(Boolean));
    if (open) {
      const d = reduce ? 0 : ENTER[variant];
      if (scrim) gsap.fromTo(scrim, { autoAlpha: 0 }, { autoAlpha: 1, duration: d, ease: 'power2.out' });
      gsap.fromTo(panel, reduce ? { autoAlpha: 0 } : PANEL_FROM[variant], {
        ...(reduce ? { autoAlpha: 1 } : PANEL_TO[variant]),
        duration: d,
        ease: 'power3.out',
      });
    } else {
      const d = reduce ? 0 : variant.startsWith('drawer') || variant === 'sheet' ? 0.2 : DURATION.fast;
      if (scrim) gsap.to(scrim, { autoAlpha: 0, duration: d, ease: 'power2.in' });
      gsap.to(panel, {
        ...(reduce ? { autoAlpha: 0 } : PANEL_FROM[variant]),
        duration: d,
        ease: 'power2.in',
        onComplete: () => {
          setPresent(false);
          onExited?.();
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, present]);

  return present;
}
