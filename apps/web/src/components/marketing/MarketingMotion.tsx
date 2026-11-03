'use client';
import { useRef } from 'react';
import { gsap, ScrollTrigger, useGSAP, MOTION_OK, MOTION_REDUCE } from '@24f/ui';

/**
 * Page-level GSAP for marketing pages.
 * - [data-reveal]            fade-up when scrolled into view
 * - [data-reveal-group] > [data-reveal-item]   staggered children
 * - [data-count="12.48"] [data-prefix] [data-decimals]   count-up when visible
 * - [data-parallax="0.15"]   gentle scroll parallax
 * - [data-draw]              SVG stroke draw-in
 * Reduced motion: everything is shown in its final state.
 */
export function MarketingMotion({ children }: { children: React.ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = scope.current!;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        ScrollTrigger.batch(root.querySelectorAll('[data-reveal]'), {
          start: 'top 88%',
          once: true,
          onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out' }),
        });
        root.querySelectorAll<HTMLElement>('[data-reveal-group]').forEach((group) => {
          const items = group.querySelectorAll('[data-reveal-item]');
          gsap.fromTo(
            items,
            { opacity: 0, y: 24, scale: 0.98 },
            { opacity: 1, y: 0, scale: 1, duration: 0.6, stagger: 0.07, ease: 'power3.out', scrollTrigger: { trigger: group, start: 'top 85%', once: true } },
          );
        });
        root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
          const to = Number(el.dataset.count);
          const decimals = Number(el.dataset.decimals ?? 0);
          const prefix = el.dataset.prefix ?? '';
          const obj = { v: 0 };
          gsap.to(obj, {
            v: to,
            duration: 1.1,
            ease: 'power2.out',
            scrollTrigger: { trigger: el, start: 'top 90%', once: true },
            onUpdate: () => {
              el.textContent = `${prefix}${obj.v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
            },
          });
        });
        root.querySelectorAll<HTMLElement>('[data-parallax]').forEach((el) => {
          const amt = Number(el.dataset.parallax ?? 0.12);
          gsap.to(el, { yPercent: -amt * 100, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 0.6 } });
        });
        root.querySelectorAll<SVGPathElement>('[data-draw] path').forEach((p) => {
          const len = p.getTotalLength();
          gsap.fromTo(p, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1, ease: 'power2.inOut', scrollTrigger: { trigger: p, start: 'top 90%', once: true } });
        });
      });
      mm.add(MOTION_REDUCE, () => {
        gsap.set(root.querySelectorAll('[data-reveal],[data-reveal-item],[data-hero]'), { opacity: 1 });
      });
      document.documentElement.classList.add('motion-ready');
      return () => mm.revert();
    },
    { scope },
  );

  return <div ref={scope}>{children}</div>;
}
