'use client';
import { useRef } from 'react';
import { gsap, useGSAP, MOTION_CONDITIONS } from './gsap';

export interface CountUpOptions {
  /** Final numeric value used only for animation geometry; display text comes from `format`. */
  to: number;
  from?: number;
  duration?: number;
  format: (n: number) => string;
  /** Start when scrolled into view instead of on mount. */
  onScroll?: boolean;
}

/**
 * Animates an element's text from `from` to `to`. The server-rendered text is the final
 * value, so nothing is lost without JS; reduced motion leaves it untouched.
 */
export function useCountUp<T extends HTMLElement = HTMLSpanElement>({ to, from = 0, duration = 0.8, format, onScroll = false }: CountUpOptions) {
  const ref = useRef<T>(null);
  const fmt = useRef(format);
  fmt.current = format;
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const finalText = fmt.current(to);
      const mm = gsap.matchMedia();
      mm.add(MOTION_CONDITIONS, (ctx) => {
        if (ctx.conditions?.reduce) {
          el.textContent = finalText;
          return;
        }
        const state = { v: from };
        gsap.to(state, {
          v: to,
          duration: Math.min(duration, 0.8),
          ease: 'power2.out',
          scrollTrigger: onScroll ? { trigger: el, start: 'top 90%', once: true } : undefined,
          onUpdate: () => {
            el.textContent = fmt.current(state.v);
          },
          onComplete: () => {
            el.textContent = finalText;
          },
        });
        return () => {
          el.textContent = finalText;
        };
      });
      return () => mm.revert();
    },
    { dependencies: [to, from, duration, onScroll], revertOnUpdate: true },
  );
  return ref;
}
