'use client';
/** Shared wallet building blocks: transaction list (table → cards), bar chart, money cells. */
import NextLink from 'next/link';
import { useRef, useState } from 'react';
import { formatDateTime, formatMoney } from '@24f/shared';
import { EmptyState, StatusBadge, VisuallyHidden, cn, gsap, useGSAP, MOTION_CONDITIONS } from '@24f/ui';
import type { WalletTx } from './api';

export function Amount({ tx }: { tx: Pick<WalletTx, 'amount_label' | 'amount_style'> }) {
  return <span className={cn('font-semibold tabular-nums', tx.amount_style === 'credit' ? 'text-fg-success' : 'text-fg')}>{tx.amount_label}</span>;
}

export function TxStatus({ tx }: { tx: Pick<WalletTx, 'display_status' | 'status_tone'> }) {
  return <StatusBadge tone={tx.status_tone} label={tx.display_status} />;
}

/** "Recent transactions" / full ledger rows. Desktop table, mobile cards (Doc 02 §12). */
export function TxList({ rows, showBalance, empty, caption }: { rows: WalletTx[]; showBalance?: boolean; empty: React.ReactNode; caption: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_CONDITIONS, (ctx) => {
        if (ctx.conditions?.reduce || !ref.current) return;
        gsap.from(ref.current.querySelectorAll('[data-row]'), { autoAlpha: 0, y: 8, duration: 0.35, stagger: 0.04, ease: 'power2.out', clearProps: 'transform,opacity,visibility' });
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [rows.map((r) => r.ref).join(',')], revertOnUpdate: true },
  );
  if (!rows.length) return <>{empty}</>;
  const detail = (r: WalletTx) =>
    r.link_path ? (
      <NextLink href={r.link_path} className="rounded-[4px] hover:text-fg-brand hover:underline focus-visible:shadow-focus focus-visible:outline-none">
        {r.detail}
      </NextLink>
    ) : (
      r.detail
    );
  return (
    <div ref={ref} className="overflow-hidden rounded-card border border-line bg-surface shadow-xs">
      <table className="hidden w-full text-left tablet:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line-subtle bg-subtle">
            {['Date', 'Type', 'Detail', 'Amount', ...(showBalance ? ['Balance'] : []), 'Status'].map((h) => (
              <th key={h} scope="col" className={cn('px-6 py-4 text-overline uppercase text-fg-tertiary', (h === 'Amount' || h === 'Balance') && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {rows.map((r) => (
            <tr key={`${r.ref}-${r.type}`} data-row className="h-16 text-body-md text-fg">
              <td className="whitespace-nowrap px-6 text-fg-secondary tabular-nums">{formatDateTime(r.occurred_at)}</td>
              <td className="whitespace-nowrap px-6 text-label-md">{r.type_label}</td>
              <td className="max-w-[420px] truncate px-6 text-fg-secondary">{detail(r)}</td>
              <td className="whitespace-nowrap px-6 text-right">
                <Amount tx={r} />
              </td>
              {showBalance ? <td className="whitespace-nowrap px-6 text-right tabular-nums text-fg-secondary">{r.balance_after_usd ? formatMoney(r.balance_after_usd) : '—'}</td> : null}
              <td className="whitespace-nowrap px-6">
                <TxStatus tx={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-line-subtle tablet:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={`${r.ref}-${r.type}`} data-row className="flex items-start justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-label-md text-fg">{r.type_label}</p>
              <p className="mt-0.5 truncate text-body-sm text-fg-secondary">{detail(r)}</p>
              <p className="mt-0.5 text-body-xs text-fg-tertiary tabular-nums">{formatDateTime(r.occurred_at)}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Amount tx={r} />
              <TxStatus tx={r} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TxEmpty({ action }: { action?: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface">
      <EmptyState icon="inbox" title="No transactions yet" body="Your rewards and payouts will be listed here." action={action} />
    </div>
  );
}

const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Bar chart (Doc 02 §5.47.19): light green bars, the highlighted (today / current) bar bright green.
 * GSAP grows bars from the baseline (scaleY, transform only); reduced motion shows them at rest.
 */
export function BarChart({
  bars,
  height = 150,
  label,
  showValues,
  barWidth = 28,
  emptyText,
}: {
  bars: { key: string; label: string; value: number; tooltip: string; highlight: boolean; axis?: string }[];
  height?: number;
  label: string;
  showValues?: boolean;
  barWidth?: number;
  emptyText?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...bars.map((b) => b.value), 0);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_CONDITIONS, (ctx) => {
        if (ctx.conditions?.reduce || !ref.current) return;
        gsap.from(ref.current.querySelectorAll('[data-bar]'), { scaleY: 0, transformOrigin: '50% 100%', duration: 0.6, stagger: 0.04, ease: 'power3.out', clearProps: 'transform' });
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [bars.map((b) => b.value).join(',')], revertOnUpdate: true },
  );
  return (
    <figure ref={ref} className="relative">
      <div className="relative" style={{ height }} aria-hidden>
        {[0, 0.5, 1].map((g) => (
          <span key={g} className="absolute inset-x-0 border-t border-line-subtle" style={{ bottom: `${g * 100}%` }} />
        ))}
        <div className="absolute inset-0 flex items-end justify-between gap-1.5 px-1">
          {bars.map((b, i) => {
            const h = max > 0 ? Math.max(b.value > 0 ? 6 : 2, (b.value / max) * (height - (showValues ? 24 : 4))) : 2;
            return (
              <div key={b.key} className="relative flex h-full flex-1 flex-col items-center justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {showValues ? <span className="mb-1 text-body-xs tabular-nums text-fg-secondary">{formatMoney(String(b.value))}</span> : null}
                <span
                  data-bar
                  className={cn('block w-full rounded-t-[6px] transition-colors', b.highlight || hover === i ? 'bg-success-bright' : 'bg-success-subtle')}
                  style={{ height: h, maxWidth: barWidth }}
                />
                {hover === i ? (
                  <span className="pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-[8px] bg-inverse px-2.5 py-1.5 text-body-xs text-fg-inverse shadow-md">{b.tooltip}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {bars.some((b) => b.axis) ? (
        <div className="mt-2 flex justify-between gap-1.5 px-1" aria-hidden>
          {bars.map((b) => (
            <span key={b.key} className="flex-1 text-center text-body-xs text-fg-tertiary">
              {b.axis}
            </span>
          ))}
        </div>
      ) : null}
      {max === 0 && emptyText ? <figcaption className="mt-3 text-body-sm text-fg-tertiary">{emptyText}</figcaption> : null}
      <VisuallyHidden as="div">
        <table>
          <caption>{label}</caption>
          <tbody>
            {bars.map((b) => (
              <tr key={b.key}>
                <th scope="row">{b.label}</th>
                <td>{b.tooltip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </VisuallyHidden>
    </figure>
  );
}

export function dayLabel(date: string) {
  return DAY.format(new Date(`${date}T00:00:00Z`));
}
