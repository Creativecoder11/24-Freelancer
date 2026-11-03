'use client';
import { useRef } from 'react';
import { Logo, gsap, useGSAP, MOTION_OK, MOTION_REDUCE } from '@24f/ui';

export interface BrandNote {
  title: string;
  body: string;
  amount?: string;
  /** Left offset inside the 720 panel (Figma: 80, or 120 for a staggered second card). */
  left?: number;
  /** Top offset inside the panel (Figma px). */
  top: number;
}

export interface BrandPanelContent {
  overline: string;
  headline: string;
  /** Supporting lines under the headline, each at a Figma top offset. */
  lines?: { text: string; top: number }[];
  /** Body/LG (18/28, Create account) or Body/MD (16/24, Forgot / OTP). */
  lineSize?: 'lg' | 'md';
  lineWidth?: number;
  notes?: BrandNote[];
}

/**
 * Navy brand panel of the auth shell (Doc 02 §6.1.3, Figma 26:486 etc.). Decorative and static.
 * GSAP: the overline, headline and lines rise in, note cards float in, then drift gently and
 * follow the pointer with a subtle parallax. Reduced motion shows the final state.
 */
export function BrandPanel({ content }: { content: BrandPanelContent }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      document.documentElement.classList.add('motion-ready');
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const text = el.querySelectorAll('[data-brand-text]');
        const notes = gsap.utils.toArray<HTMLElement>('[data-brand-note]', el);
        const badge = el.querySelector('[data-brand-badge]');
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        tl.fromTo(text, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.08 })
          .fromTo(
            notes,
            { opacity: 0, y: 48, rotate: (i) => (i % 2 ? 2.5 : -2.5) },
            { opacity: 1, y: 0, rotate: 0, duration: 0.8, stagger: 0.08, ease: 'back.out(1.4)' },
            '-=0.45',
          )
          .fromTo(badge, { opacity: 0, scale: 0.85, rotate: -12 }, { opacity: 1, scale: 1, rotate: 0, duration: 0.7 }, '-=0.6');

        // Idle drift on the inner card so the pointer parallax (outer wrapper) composes with it.
        notes.forEach((n, i) => {
          const card = n.firstElementChild;
          if (card) gsap.to(card, { y: i % 2 ? 6 : -6, duration: 3.2 + i * 0.4, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1 + i * 0.3 });
        });

        // Pointer parallax: deeper layers move more.
        const layers = gsap.utils.toArray<HTMLElement>('[data-depth]', el).map((node) => ({
          depth: Number(node.dataset.depth ?? 0),
          x: gsap.quickTo(node, 'x', { duration: 0.9, ease: 'power3.out' }),
          y: gsap.quickTo(node, 'y', { duration: 0.9, ease: 'power3.out' }),
        }));
        const onMove = (e: PointerEvent) => {
          const r = el.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width - 0.5;
          const py = (e.clientY - r.top) / r.height - 0.5;
          layers.forEach((l) => {
            l.x(px * l.depth);
            l.y(py * l.depth);
          });
        };
        const onLeave = () => layers.forEach((l) => (l.x(0), l.y(0)));
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerleave', onLeave);
        return () => {
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerleave', onLeave);
        };
      });
      mm.add(MOTION_REDUCE, () => {
        gsap.set(el.querySelectorAll('[data-hero]'), { opacity: 1 });
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [content.headline] },
  );

  const lineCls = content.lineSize === 'lg' ? 'text-body-lg' : 'text-body-md';
  return (
    <div ref={root} className="relative h-full w-full overflow-hidden bg-brand" aria-hidden="true">
      <div data-depth="10" className="absolute inset-0">
        <p data-hero data-brand-text className="absolute left-20 top-[248px] text-overline uppercase text-fg-brand-inverse">
          {content.overline}
        </p>
        <p
          data-hero
          data-brand-text
          className="absolute left-20 top-[276px] w-[520px] max-w-[calc(100%-120px)] font-display text-display-xl text-fg-on-brand"
        >
          {content.headline}
        </p>
        {content.lines?.map((l) => (
          <p
            key={l.text}
            data-hero
            data-brand-text
            className={`absolute left-20 ${lineCls} text-fg-on-brand`}
            style={{ top: l.top, width: content.lineWidth ?? 500, maxWidth: 'calc(100% - 120px)' }}
          >
            {l.text}
          </p>
        ))}
      </div>
      {content.notes?.map((n, i) => (
        <div
          key={n.title}
          data-hero
          data-brand-note
          data-depth={String(22 + i * 14)}
          className="absolute w-[480px] max-w-[calc(100%-120px)]"
          style={{ left: n.left ?? 80, top: n.top }}
        >
          <div className="relative h-20 rounded-[18px] bg-surface px-4 shadow-lg">
            <p className="absolute left-4 top-[18px] text-label-md text-fg">{n.title}</p>
            <p className="absolute left-4 top-10 text-body-sm text-fg-tertiary">{n.body}</p>
            {n.amount ? (
              <p className="absolute right-5 top-[26px] font-display text-num-md text-fg-success tabular-nums">{n.amount}</p>
            ) : null}
          </div>
        </div>
      ))}
      <div data-hero data-brand-badge className="absolute bottom-[45px] right-[81px] [@media(max-height:959px)]:hidden">
        <div data-depth="-14">
          <Logo type="badge" theme="inverse" decorative height={149} />
        </div>
      </div>
    </div>
  );
}
