'use client';
import { useRef } from 'react';
import { gsap, useGSAP, MOTION_CONDITIONS } from './gsap';

/**
 * Subtle list stagger for app surfaces (Doc brief: dashboards get subtle motion).
 * Re-runs when `deps` change (e.g. a new page of results). Targets direct children or `selector`.
 */
export function useStaggerIn<T extends HTMLElement = HTMLDivElement>(
  deps: unknown[] = [],
  opts: { selector?: string; y?: number; stagger?: number; duration?: number } = {},
) {
  const ref = useRef<T>(null);
  const { selector, y = 12, stagger = 0.05, duration = 0.4 } = opts;
  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_CONDITIONS, (ctx) => {
        if (ctx.conditions?.reduce) return;
        const targets = selector ? root.querySelectorAll(selector) : root.children;
        if (!targets.length) return;
        gsap.from(targets, {
          autoAlpha: 0,
          y,
          duration: Math.min(duration, 0.8),
          stagger: Math.min(stagger, 0.08),
          ease: 'power2.out',
          clearProps: 'transform,opacity,visibility',
        });
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: deps, revertOnUpdate: true },
  );
  return ref;
}
