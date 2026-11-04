'use client';
/** SCR-WAL-01 Earnings wallet (Figma 41:477). */
import NextLink from 'next/link';
import { useState } from 'react';
import { formatDate, formatMoney } from '@24f/shared';
import { Button, EmptyState, Link, Skeleton, StatCard, StatusBadge } from '@24f/ui';
import { useWorkerHeader } from '@/components/worker/shell';
import { LoadError } from '@/components/worker/ui';
import { useEarningsChart, useWallet, type WalletSummary } from './api';
import { BarChart, TxEmpty, TxList, dayLabel } from './parts';
import { AddPayoutMethodDialog } from './PayoutMethodDialogs';

const HEADER = { title: 'Wallet', subtitle: 'Your balance, payouts and every transaction in one place.' };

function inFlightCaption(w: WalletSummary) {
  if (!w.in_flight_count || !w.in_flight_latest) return 'No withdrawals in progress';
  if (w.in_flight_count > 1) return `${w.in_flight_count} requests · oldest ${formatDate(w.in_flight_latest.oldest_requested_at)}`;
  return `Requested ${formatDate(w.in_flight_latest.requested_at)} · ${w.in_flight_latest.status}`;
}

export function WalletPage() {
  useWorkerHeader(HEADER);
  const wallet = useWallet();
  const [adding, setAdding] = useState(false);
  const w = wallet.data;

  return (
    <div className="mx-auto flex w-full max-w-[1104px] flex-col gap-6">
      <h2 className="sr-only">Balances</h2>
      {wallet.isError ? (
        <LoadError error={wallet.error} onRetry={() => wallet.refetch()} />
      ) : !w ? (
        <div className="grid gap-4 tablet:grid-cols-3 desktop:gap-6">
          {[0, 1, 2].map((i) => (
            <Skeleton.StatCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 tablet:grid-cols-3 desktop:gap-6">
          <StatCard
            type="balance"
            label="Available to withdraw"
            value={formatMoney(w.available_usd)}
            countUp
            action={{ label: 'Withdraw', href: '/worker/wallet/withdraw' }}
            meta={w.available_bdt_label ? `${w.available_bdt_label} at today’s rate` : undefined}
          />
          <StatCard
            type="default"
            label="Pending review"
            value={formatMoney(w.pending_review_usd)}
            countUp
            badge={w.pending_review_tasks ? { label: `${w.pending_review_tasks} ${w.pending_review_tasks === 1 ? 'task' : 'tasks'}`, tone: 'warning' } : undefined}
            meta="Moves to available when approved"
          />
          <StatCard
            type="default"
            label="Withdrawals on the way"
            value={formatMoney(w.in_flight_usd)}
            countUp
            badge={w.in_flight_count ? { label: `${w.in_flight_count} sent`, tone: 'info' } : undefined}
            meta={inFlightCaption(w)}
          />
        </div>
      )}

      <div className="grid gap-6 desktop:grid-cols-[minmax(0,1fr)_352px]">
        <EarningsCard />
        <MethodsCard wallet={w} loading={wallet.isPending} onAdd={() => setAdding(true)} />
      </div>

      <section aria-labelledby="recent-tx" className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 id="recent-tx" className="font-display text-h4 text-fg">
            Recent transactions
          </h2>
          <Link href="/worker/wallet/transactions">View all</Link>
        </div>
        {wallet.isError ? null : !w ? (
          <div className="rounded-card border border-line bg-surface p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton.TableRow key={i} columns={5} />
            ))}
          </div>
        ) : (
          <TxList
            rows={w.recent_transactions}
            caption="Recent transactions"
            empty={
              <TxEmpty
                action={
                  <Button size="M" href="/worker/jobs">
                    Find jobs
                  </Button>
                }
              />
            }
          />
        )}
      </section>
      <AddPayoutMethodDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function EarningsCard() {
  const chart = useEarningsChart();
  const c = chart.data;
  return (
    <section aria-labelledby="earn-chart" className="min-w-0 rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6">
      <h2 id="earn-chart" className="text-label-lg text-fg">
        Earnings · last 14 days
      </h2>
      {chart.isError ? (
        <p className="mt-4 text-body-sm text-fg-tertiary">
          We couldn’t load this.{' '}
          <button type="button" className="font-semibold text-fg-brand hover:underline" onClick={() => chart.refetch()}>
            Try again
          </button>
        </p>
      ) : !c ? (
        <div className="mt-4">
          <Skeleton height={14} width={160} />
          <Skeleton height={150} className="mt-6" />
        </div>
      ) : (
        <>
          <p className="mt-1 text-body-sm text-fg-secondary">
            {formatMoney(c.total_usd)} approved · {c.total_tasks} {c.total_tasks === 1 ? 'task' : 'tasks'}
          </p>
          <div className="mt-8">
            <BarChart
              label="Approved earnings per day, last 14 days"
              height={150}
              emptyText="No approved earnings in the last 14 days."
              bars={c.bars.map((b) => ({
                key: b.date,
                label: dayLabel(b.date),
                value: Number(b.amount_usd),
                highlight: b.is_today,
                tooltip: `${dayLabel(b.date)} · ${formatMoney(b.amount_usd)} · ${b.tasks} ${b.tasks === 1 ? 'task' : 'tasks'}`,
              }))}
            />
          </div>
        </>
      )}
    </section>
  );
}

function MethodsCard({ wallet, loading, onAdd }: { wallet?: WalletSummary; loading: boolean; onAdd: () => void }) {
  const methods = wallet?.payout_methods ?? [];
  return (
    <section aria-labelledby="pm-card" className="rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6">
      <div className="flex items-center justify-between">
        <h2 id="pm-card" className="text-label-lg text-fg">
          Payout methods
        </h2>
        <button type="button" onClick={onAdd} className="rounded-[4px] text-label-md text-fg-brand hover:underline focus-visible:shadow-focus focus-visible:outline-none">
          Add
        </button>
      </div>
      {loading ? (
        <div className="mt-4 space-y-3">
          <Skeleton height={60} />
          <Skeleton height={60} />
        </div>
      ) : methods.length === 0 ? (
        <EmptyState compact icon="wallet" title="No payout methods yet" body="Add one before your first withdrawal." action={<Button size="S" onClick={onAdd}>Add</Button>} />
      ) : (
        <ul className="mt-4 space-y-3">
          {methods.slice(0, 3).map((m) => (
            <li key={m.id}>
              <NextLink
                href="/worker/settings#payout-methods"
                className="flex items-center justify-between gap-3 rounded-[12px] bg-subtle px-3 py-3 transition-colors hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none"
              >
                <span className="min-w-0">
                  <span className="block truncate text-label-md text-fg">{m.label}</span>
                  <span className="mt-0.5 block text-body-sm text-fg-secondary tabular-nums">{m.account_masked}</span>
                </span>
                {m.is_default ? (
                  <StatusBadge tone="brand" label="Default" />
                ) : !m.method_enabled ? (
                  <StatusBadge tone="neutral" label="Unavailable" />
                ) : m.status === 'pending_review' ? (
                  <StatusBadge tone="warning" label="In review" />
                ) : m.in_cooldown ? (
                  <StatusBadge tone="warning" label={`From ${formatDate(m.usable_from)}`} />
                ) : null}
              </NextLink>
            </li>
          ))}
          {methods.length > 3 ? (
            <li>
              <Link href="/worker/settings#payout-methods">See all {methods.length}</Link>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
