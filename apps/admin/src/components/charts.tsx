'use client';
import { useId, useRef } from 'react';
import NextLink from 'next/link';
import { CountUp, cn, gsap, useGSAP, MOTION_OK } from '@24f/ui';

/** KPI card with GSAP count-up (Doc 02 §5.26 look; Doc 09 SCR-ADM-02). */
export function Kpi({ label, value, display, sub, href, tone, money }: { label: string; value: number; display?: string; sub?: React.ReactNode; href?: string; tone?: 'danger' | 'success'; money?: boolean }) {
  const fmt = (n: number) => (money ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : Math.round(n).toLocaleString('en-US'));
  const body = (
    <>
      <p className="text-body-sm text-fg-secondary">{label}</p>
      <p className={cn('mt-1 font-display text-num-xl tabular-nums', tone === 'danger' ? 'text-fg-danger' : tone === 'success' ? 'text-fg-success' : 'text-fg')}>
        {display ? display : <CountUp value={value} format={fmt} />}
      </p>
      <div className="mt-auto pt-2 text-body-xs text-fg-tertiary">{sub ?? (value === 0 && !money ? 'All clear' : ' ')}</div>
    </>
  );
  const cls = 'flex min-h-[128px] flex-col rounded-card border border-line bg-surface p-5 shadow-xs';
  return href ? (
    <NextLink href={href} className={cn(cls, 'transition-shadow hover:border-line-strong hover:shadow-sm focus-visible:shadow-focus')} data-reveal-item>
      {body}
    </NextLink>
  ) : (
    <section className={cls} data-reveal-item>
      {body}
    </section>
  );
}

/** Simple SVG trend line with an area fill; the path draws in with GSAP (transform/opacity only on the wrapper). */
export function TrendChart({ series, labels, title, money }: { series: { name: string; values: number[]; tone: 'brand' | 'success' | 'warning' | 'info' }[]; labels: string[]; title: string; money?: boolean }) {
  const id = useId().replace(/:/g, '');
  const ref = useRef<SVGSVGElement>(null);
  const W = 640;
  const H = 180;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, labels.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const color: Record<string, string> = { brand: 'var(--fl-bg-brand)', success: 'var(--fl-bg-success)', warning: 'var(--fl-bg-warning)', info: 'var(--fl-text-info)' };
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const paths = ref.current?.querySelectorAll<SVGPathElement>('[data-line]') ?? [];
        paths.forEach((p) => {
          const len = p.getTotalLength();
          gsap.fromTo(p, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 0.8, ease: 'power2.out' });
        });
        gsap.fromTo(ref.current?.querySelectorAll('[data-area]') ?? [], { opacity: 0 }, { opacity: 1, duration: 0.6, delay: 0.2 });
      });
      return () => mm.revert();
    },
    { dependencies: [JSON.stringify(series)], scope: ref },
  );
  const ticks = [0, 0.5, 1].map((f) => max * f);
  const fmt = (n: number) => (money ? `$${n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0)}` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
  return (
    <figure className="rounded-card border border-line bg-surface p-5 shadow-xs">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-label-md text-fg">{title}</span>
        <span className="flex gap-3">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5 text-body-xs text-fg-secondary">
              <span aria-hidden className="size-2 rounded-full" style={{ background: color[s.tone] }} />
              {s.name}
            </span>
          ))}
        </span>
      </figcaption>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}: ${series.map((s) => `${s.name} ${s.values.join(', ')}`).join('; ')}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--fl-border-subtle)" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--fl-text-tertiary)">{fmt(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % 2 === 0 || i === labels.length - 1 ? <text key={l} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--fl-text-tertiary)">{l.slice(5)}</text> : null))}
        {series.map((s, si) => {
          const line = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
          const area = `${line} L${x(s.values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
          return (
            <g key={s.name}>
              <defs>
                <linearGradient id={`g${id}${si}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={color[s.tone]} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={color[s.tone]} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path data-area d={area} fill={`url(#g${id}${si})`} />
              <path data-line d={line} fill="none" stroke={color[s.tone]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Staggered entrance for dashboard sections. */
export function useStagger(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(ref.current?.querySelectorAll('[data-reveal-item]') ?? [], { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.05, ease: 'power2.out' });
      });
      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(ref.current?.querySelectorAll('[data-reveal-item]') ?? [], { opacity: 1 });
      });
      document.documentElement.classList.add('motion-ready');
      return () => mm.revert();
    },
    { dependencies: [dep], scope: ref },
  );
  return ref;
}
