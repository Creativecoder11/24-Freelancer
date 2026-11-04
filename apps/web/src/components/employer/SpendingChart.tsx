'use client';
import { useMemo, useRef, useState } from 'react';
import { EmptyState, Skeleton, cn, gsap, useGSAP, MOTION_OK } from '@24f/ui';
import { formatMoney } from '@24f/shared';
import { useSpending } from './api';

const RANGES = [
  { value: '7d', label: '7 days', title: 'last 7 days' },
  { value: '30d', label: '30 days', title: 'last 30 days' },
  { value: '90d', label: '90 days', title: 'last 90 days' },
] as const;
type Range = (typeof RANGES)[number]['value'];

/** Spending chart (Figma 32:695): bars grow with GSAP; tooltip "Thu · $3.10 · 17 tasks" on hover/focus. */
export function SpendingChart() {
  const [range, setRange] = useState<Range>('7d');
  const q = useSpending(range);
  const d = q.data;
  const title = RANGES.find((r) => r.value === range)!.title;
  return (
    <section aria-labelledby="spend-h" className="rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="spend-h" className="text-h5 text-fg tablet:text-h4">
            Spending · {title}
          </h2>
          <p className="mt-0.5 text-body-sm text-fg-secondary">
            {d ? `${formatMoney(d.total_usd)} approved · ${d.total_tasks} ${d.total_tasks === 1 ? 'task' : 'tasks'}` : ' '}
          </p>
        </div>
        <RangeToggle value={range} onChange={setRange} />
      </div>
      <div className="mt-6">
        {q.isLoading ? (
          <Skeleton height={232} radius={12} />
        ) : q.isError ? (
          <EmptyState compact icon="alert-circle" title="We couldn’t load this" body="Check your connection and try again." />
        ) : d && Number(d.total_usd) === 0 ? (
          <EmptyState compact icon="bar-chart" title="No spending in this period." />
        ) : d ? (
          <Bars data={d.bars} ticks={d.y_ticks_usd} max={Number(d.y_max_usd)} key={range} />
        ) : null}
      </div>
    </section>
  );
}

function Bars({ data, ticks, max }: { data: { label: string; date: string; amount_usd: string; tasks: number }[]; ticks: string[]; max: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const peak = useMemo(() => data.reduce((best, b, i) => (Number(b.amount_usd) > Number(data[best]!.amount_usd) ? i : best), 0), [data]);
  const [active, setActive] = useState<number | null>(null);
  const shown = active ?? peak;
  const dense = data.length > 14;
  const H = 180;

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from('[data-bar]', { scaleY: 0, transformOrigin: '50% 100%', duration: 0.6, ease: 'power3.out', stagger: Math.min(0.06, 0.5 / data.length) });
        gsap.from('[data-tip]', { autoAlpha: 0, y: 6, duration: 0.3, delay: 0.45 });
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [data] },
  );

  const b = data[shown];
  const pct = (v: number) => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);
  return (
    <div ref={ref} className="flex gap-3">
      <div className="relative flex w-12 shrink-0 flex-col-reverse justify-between pb-6 text-right text-body-xs tabular-nums text-fg-tertiary" style={{ height: H + 24 }} aria-hidden>
        {ticks.map((t) => (
          <span key={t} className="-translate-y-1/2 first:translate-y-0">
            {formatMoney(t)}
          </span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col-reverse justify-between" style={{ height: H }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="h-px bg-line-subtle" />
          ))}
        </div>
        <ul className={cn('relative flex items-end', dense ? 'gap-0.5' : 'gap-2 tablet:gap-4')} style={{ height: H }} onMouseLeave={() => setActive(null)} aria-label="Daily spending">
          {data.map((x, i) => {
            const v = Number(x.amount_usd);
            const hi = i === shown;
            const label = `${x.label} · ${formatMoney(x.amount_usd)} · ${x.tasks} ${x.tasks === 1 ? 'task' : 'tasks'}`;
            return (
              <li key={x.date} className="relative flex h-full flex-1 items-end justify-center">
                <button
                  type="button"
                  aria-label={label}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="group flex h-full w-full items-end justify-center rounded-[6px] outline-none focus-visible:shadow-focus"
                >
                  <span
                    data-bar
                    className={cn('block w-full rounded-t-[6px] transition-colors', dense ? 'max-w-3' : 'max-w-10', hi ? 'bg-brand' : 'bg-brand-100 group-hover:bg-brand-200')}
                    style={{ height: `${Math.max(v > 0 ? 3 : 1.5, pct(v) * 100)}%` }}
                  />
                </button>
              </li>
            );
          })}
        </ul>
        {b ? (
          <div
            data-tip
            role="status"
            className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-[8px] bg-inverse px-3 py-2 text-label-sm text-fg-inverse shadow-md"
            style={{
              left: `clamp(70px, ${((shown + 0.5) / data.length) * 100}%, calc(100% - 70px))`,
              bottom: `calc(${H}px * ${pct(Number(b.amount_usd))} + 10px + 24px)`,
            }}
          >
            {b.label} · {formatMoney(b.amount_usd)} · {b.tasks} {b.tasks === 1 ? 'task' : 'tasks'}
          </div>
        ) : null}
        <div className={cn('mt-2 flex text-center text-body-xs text-fg-tertiary', dense ? 'gap-0.5' : 'gap-2 tablet:gap-4')} aria-hidden>
          {data.map((x, i) => (
            <span key={x.date} className="flex-1 truncate">
              {!dense || i % Math.ceil(data.length / 6) === 0 ? x.label : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Compact range segmented control (Figma 32:695: 36 high track, 28 high segments). */
function RangeToggle({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = RANGES.findIndex((r) => r.value === value);
    const n = RANGES[(i + (e.key === 'ArrowRight' ? 1 : -1) + RANGES.length) % RANGES.length]!;
    onChange(n.value);
    (e.currentTarget.querySelector(`[data-v="${n.value}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Chart range" onKeyDown={onKey} className="inline-flex h-9 items-center gap-0.5 rounded-[10px] bg-muted p-1">
      {RANGES.map((r) => {
        const sel = r.value === value;
        return (
          <button
            key={r.value}
            data-v={r.value}
            type="button"
            role="radio"
            aria-checked={sel}
            tabIndex={sel ? 0 : -1}
            onClick={() => onChange(r.value)}
            className={cn(
              'relative inline-flex h-7 items-center rounded-[7px] px-3 text-body-sm whitespace-nowrap transition-colors focus-visible:shadow-focus focus-visible:outline-none',
              "before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']",
              sel ? 'bg-surface font-medium text-fg shadow-sm' : 'text-fg-secondary hover:text-fg',
            )}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
