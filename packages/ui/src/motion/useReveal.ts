'use client';
import { useRef } from 'react';
import { gsap, useGSAP, MOTION_CONDITIONS } from './gsap';

export interface RevealOptions {
  /** Selector of the items to reveal inside the container. Default: `[data-reveal]`, else the container. */
  selector?: string;
  y?: number;
  duration?: number;
  /** Stagger between items, capped at 0.08 s (brief). */
  stagger?: number;
  delay?: number;
  /** ScrollTrigger start. */
  start?: string;
  /** Run without ScrollTrigger (above-the-fold content). */
  immediate?: boolean;
}

/**
 * Scroll reveal with stagger. Content is fully visible without JS: the hidden "from"
 * state is only applied by GSAP at runtime. Reduced motion → no animation at all.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(opts: RevealOptions = {}) {
  const ref = useRef<T>(null);
  const { selector = '[data-reveal]', y = 24, duration = 0.6, stagger = 0.08, delay = 0, start = 'top 85%', immediate = false } = opts;
  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_CONDITIONS, (ctx) => {
        if (ctx.conditions?.reduce) return;
        const found = root.querySelectorAll<HTMLElement>(selector);
        const targets: HTMLElement[] = found.length ? Array.from(found) : [root];
        gsap.from(targets, {
          autoAlpha: 0,
          y,
          duration: Math.min(duration, 0.8),
          stagger: Math.min(stagger, 0.08),
          delay,
          ease: 'power3.out',
          clearProps: 'transform,opacity,visibility',
          scrollTrigger: immediate ? undefined : { trigger: root, start, once: true },
        });
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [] },
  );
  return ref;
}
