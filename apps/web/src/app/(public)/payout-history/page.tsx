import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Icon } from '@24f/ui';
import { formatMoney, formatRelative, type PublicConfig, type RecentPayout } from '@24f/shared';
import { ApiRequestError, apiGet, apiTry } from '@/lib/api/server';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Recent payouts',
  description: 'The latest paid withdrawals on 24 Freelancing. Names are partly hidden for privacy.',
};

/** API rows carry `paid_at`; the shared type also allows a preformatted `paid_at_relative`. */
type Row = RecentPayout & { paid_at?: string };

async function getPayouts(): Promise<Row[] | null> {
  try {
    return (await apiGet<Row[]>('/public/payouts/recent', 60)).data;
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) notFound();
    return null;
  }
}

/** SCR-PUB-ND6 Recent payouts (D-19). Disabled by config → 404. */
export default async function PayoutHistoryPage() {
  const config = await apiTry<PublicConfig>('/public/config', 300);
  if (config && !config.data.features.public_payout_history_enabled) notFound();
  const rows = await getPayouts();
  const now = Date.now();
  const when = (r: Row) => r.paid_at_relative ?? (r.paid_at ? formatRelative(r.paid_at, now) : '—');

  return (
    <MarketingMotion>
      <div className="mx-auto mb-24 max-w-container px-5 pt-12 tablet:px-8 desktop:px-0 desktop:pt-16">
        <header data-reveal>
          <p className="text-overline uppercase text-fg-brand">Payout history</p>
          <h1 className="mt-3 font-display text-[36px] font-extrabold leading-[44px] tracking-[-1.2px] text-fg tablet:text-display-xl">Recent payouts</h1>
          <p className="mt-3 text-body-md text-fg-secondary">The latest paid withdrawals. Names are partly hidden for privacy.</p>
        </header>

        {rows === null ? (
          <div role="alert" className="mt-10 rounded-xl border border-line bg-surface px-6 py-10 text-center">
            <p className="text-h5 text-fg">We couldn’t load this</p>
            <p className="mt-1 text-body-sm text-fg-secondary">Check your connection and try again.</p>
          </div>
        ) : rows.length === 0 ? (
          <div data-reveal className="mt-10 flex flex-col items-center rounded-xl border border-line bg-surface px-6 py-16 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-fg-tertiary">
              <Icon name="banknote" size={24} />
            </span>
            <p className="mt-4 text-body-md text-fg-secondary">No payouts to show yet.</p>
          </div>
        ) : (
          <>
            {/* Desktop / tablet table */}
            <div data-reveal className="mt-10 hidden overflow-hidden rounded-xl border border-line bg-surface shadow-xs tablet:block">
              <table className="w-full text-left">
                <caption className="sr-only">Recent paid withdrawals</caption>
                <thead className="bg-subtle">
                  <tr className="text-overline uppercase text-fg-tertiary">
                    <th scope="col" className="px-6 py-3 font-semibold">Name</th>
                    <th scope="col" className="px-6 py-3 font-semibold">Method</th>
                    <th scope="col" className="px-6 py-3 text-right font-semibold">Amount</th>
                    <th scope="col" className="px-6 py-3 text-right font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody data-reveal-group className="divide-y divide-line-subtle">
                  {rows.map((r, i) => (
                    <tr data-reveal-item key={i} className="text-body-sm hover:bg-subtle">
                      <td className="px-6 py-4 font-medium text-fg">{r.name_masked}</td>
                      <td className="px-6 py-4 text-fg-secondary">{r.method_label}</td>
                      <td className="px-6 py-4 text-right font-display text-num-sm tabular-nums text-fg-success">{formatMoney(r.amount_usd)}</td>
                      <td className="px-6 py-4 text-right text-fg-tertiary">{when(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <ul data-reveal-group className="mt-8 space-y-3 tablet:hidden">
              {rows.map((r, i) => (
                <li data-reveal-item key={i} className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-4">
                  <div className="min-w-0">
                    <p className="text-label-md text-fg">{r.name_masked}</p>
                    <p className="mt-0.5 text-body-xs text-fg-tertiary">
                      {r.method_label} · {when(r)}
                    </p>
                  </div>
                  <p className="font-display text-num-md tabular-nums text-fg-success">{formatMoney(r.amount_usd)}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </MarketingMotion>
  );
}
