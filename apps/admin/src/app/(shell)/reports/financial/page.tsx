'use client';
import NextLink from 'next/link';
import { Suspense, useState } from 'react';
import { Alert, Button, Dialog, EmptyState, Field, Icon, SegmentedControl, Skeleton, Tabs, cn, toast } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ErrorState, FilterSelect, Gate, Pager, Section, Table, Toolbar } from '@/components/kit';
import { Kpi, TrendChart, useStagger } from '@/components/charts';
import { download } from '@/lib/api';
import { d, usd } from '@/lib/fmt';
import { reportError, useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface Money { count: number; usd: string }
interface Split { label: string; count: number; usd: string }
interface Overview {
  period: { days: number; from: string; to: string; previous_from: string; timezone: string; generated_at: string };
  totals: {
    deposits_usd: string; deposits_count: number; deposits_change_pct: number | null;
    payouts_usd: string; payouts_count: number; payouts_change_pct: number | null;
    net_flow_usd: string; revenue_usd: string; revenue_change_pct: number | null;
    referral_expense_usd: string; provider_fees_usd: string; net_revenue_usd: string; refunds_usd: string;
  };
  trend: { days: string[]; deposits_usd: number[]; payouts_usd: number[]; revenue_usd: number[] };
  by_method: { deposits: Split[]; withdrawals: Split[] };
  waiting: { deposits_pending: Money; withdrawals_requested: Money; withdrawals_processing: Money };
}
interface Summary {
  date: string;
  summary: { deposits_usd: string; payouts_usd: string; customer_funds: Record<string, string>; open_reconciliation_items: { critical: number; high: number; medium: number } };
  overview: Overview;
}
interface Report { report: string; from: string; to: string; timezone: string; header: string[]; rows: (string | number | null)[][] }

type Meta = { name: string; freq: string; use: string };
const REPORTS: Record<string, Meta> = {
  general_journal: { name: 'General journal', freq: 'Daily, monthly', use: 'Every ledger entry, line by line.' },
  trial_balance: { name: 'Trial balance', freq: 'Daily, month end', use: 'Opening, debits, credits and closing per account type.' },
  customer_funds: { name: 'Customer funds', freq: 'Daily', use: 'Worker earnings, employer balances and money in flight.' },
  aged_balances: { name: 'Unspent and aged balances', freq: 'Monthly', use: 'Balances grouped by how long they have been idle.' },
  deposits: { name: 'Deposits', freq: 'Daily, monthly', use: 'Every top-up with its method, provider and refunds.' },
  withdrawals: { name: 'Withdrawals', freq: 'Daily, monthly', use: 'Every payout, with accounts masked.' },
  provider_settlement: { name: 'Provider settlement', freq: 'On import', use: 'Settlement lines and how they matched.' },
  refunds_chargebacks: { name: 'Refunds and chargebacks', freq: 'Monthly', use: 'Deposit refunds and chargebacks.' },
  platform_revenue: { name: 'Platform revenue', freq: 'Monthly', use: 'Fees earned, by day.' },
  referral_expense: { name: 'Referral commissions', freq: 'Monthly', use: 'Commissions paid and reversed.' },
  provider_fees: { name: 'Provider fees', freq: 'Monthly', use: 'Gateway fees, by day.' },
  fx: { name: 'Exchange rates', freq: 'Monthly', use: 'Every rate in force during the period.' },
  adjustments: { name: 'Adjustments', freq: 'Monthly', use: 'Maker, approver, reason and amount.' },
  employer_statement: { name: 'Employer statement', freq: 'On demand', use: 'One employer’s money in and out. Needs a user ID.' },
  worker_statement: { name: 'Worker earnings statement', freq: 'On demand', use: 'One worker’s earnings and payouts. Needs a user ID.' },
  withdrawal_sla: { name: 'Withdrawal speed', freq: 'Weekly', use: 'Median and slowest 5% time to paid, by method.' },
  kyc_sla: { name: 'KYC speed', freq: 'Daily', use: 'Decisions made and time to decide.' },
  dispute_sla: { name: 'Dispute speed', freq: 'Daily', use: 'Disputes resolved within 48 hours.' },
  moderation_activity: { name: 'Moderation activity', freq: 'Daily', use: 'Suspensions, closures and reports handled.' },
  support_queue: { name: 'Support queue', freq: 'Daily', use: 'New, answered and spam messages by topic.' },
};
const FIN_GROUPS: { title: string; codes: string[] }[] = [
  { title: 'Ledger and balances', codes: ['general_journal', 'trial_balance', 'customer_funds', 'aged_balances'] },
  { title: 'Money in and out', codes: ['deposits', 'withdrawals', 'provider_settlement', 'refunds_chargebacks', 'withdrawal_sla'] },
  { title: 'Revenue and costs', codes: ['platform_revenue', 'referral_expense', 'provider_fees', 'fx', 'adjustments'] },
  { title: 'Statements', codes: ['employer_statement', 'worker_statement'] },
];
const OPS_GROUPS: { title: string; codes: string[] }[] = [
  { title: 'Service speed', codes: ['withdrawal_sla', 'kyc_sla', 'dispute_sla'] },
  { title: 'Team activity', codes: ['moderation_activity', 'support_queue'] },
];
const PII = new Set(['general_journal', 'deposits', 'withdrawals', 'referral_expense', 'employer_statement', 'worker_statement', 'adjustments']);
const PERIODS = [
  { value: '1', label: 'Today' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const;

/** Column names the reports send (snake_case) → what a person reads. */
const COLUMN: Record<string, string> = {
  ref: 'Reference', tx_ref: 'Ledger ref', occurred_at: 'Time', account_kind: 'Account type', account: 'Account', amount_exact: 'Amount',
  employer_id: 'Employer', worker_id: 'Worker', provider_id: 'Provider ref', provider_payment_id: 'Provider ref', charge_bdt: 'Charged (BDT)',
  fx_rate: 'Rate', completed_at: 'Completed', refunded_usd: 'Refunded (USD)', amount_usd: 'Amount (USD)', fee_usd: 'Fee (USD)',
  account_masked: 'Account', payout_amount: 'Paid out', payout_currency: 'Currency', trx_id: 'Transaction ID', batch_id: 'Batch',
  requested_at: 'Requested', paid_at: 'Paid', finance_user: 'Paid by', total_exact: 'Total', entries: 'Entries', day: 'Day',
  median_hours_to_paid: 'Median hours to paid', p95_hours_to_paid: 'Slowest 5% (hours)', rejected_pct: 'Rejected %', failed_pct: 'Failed %',
  age_bucket_days: 'Idle for (days)', effective_from: 'Effective', settled_on: 'Settled on', match_status: 'Match', created_at: 'Created',
  reason_code: 'Reason', amount_usd_total: 'Amount (USD)',
};
const colLabel = (h: string) => COLUMN[h] ?? (h.charAt(0).toUpperCase() + h.slice(1)).replace(/_usd$/, ' (USD)').replace(/_pct$/, ' %').replace(/_exact$/, '').replace(/_/g, ' ');
const isMoneyCol = (h: string) => /exact|usd|amount|total|closing|opening|debits|credits|fee|gross|net/.test(h);

const periodWord = (days: number) => (days === 1 ? 'yesterday' : `the previous ${days} days`);

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** "+12.4% vs the previous 30 days", green when it moved the good way. */
function Delta({ pct, days, neutral = false }: { pct: number | null; days: number; neutral?: boolean }) {
  if (pct === null) return <span>No figures for {periodWord(days)}</span>;
  const up = pct > 0;
  // Withdrawals are workers' own money leaving, neither good nor bad for the platform.
  const good = pct === 0 || neutral ? null : up;
  return (
    <span className={cn('inline-flex items-center gap-1', good === true && 'text-fg-success', good === false && 'text-fg-danger')}>
      {pct !== 0 ? <Icon name={up ? 'trending-up' : 'trending-down'} size={14} /> : null}
      {up ? '+' : pct < 0 ? '−' : ''}
      {Math.abs(pct).toFixed(1)}% vs {periodWord(days)}
    </span>
  );
}

/** One row of the revenue statement. */
function Line({ label, value, sign, strong }: { label: string; value: string; sign?: '+' | '−'; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-2', strong && 'border-t border-line pt-3')}>
      <dt className={strong ? 'text-label-md text-fg' : 'text-body-sm text-fg-secondary'}>{label}</dt>
      <dd className={cn('adm-mono tabular-nums', strong ? 'text-num-md text-fg' : 'text-fg')}>
        {sign && Number(value) !== 0 ? `${sign} ` : ''}
        {usd(value)}
      </dd>
    </div>
  );
}

const FUND_PARTS = [
  { key: 'worker_earnings_usd', label: 'Worker earnings', hint: 'Earned, not yet withdrawn', color: 'var(--fl-bg-brand)' },
  { key: 'employer_available_usd', label: 'Employer available', hint: 'Deposits free to spend', color: 'var(--fl-bg-success)' },
  { key: 'employer_reserved_usd', label: 'Employer reserved', hint: 'Held for running jobs', color: 'var(--fl-bg-warning)' },
  { key: 'in_flight_usd', label: 'Withdrawals in transit', hint: 'Requested or processing', color: 'var(--fl-text-info)' },
] as const;

/** What the platform holds for users right now, as one bar split by part. */
function CustomerFunds({ funds }: { funds: Record<string, string> }) {
  const parts = FUND_PARTS.map((p) => ({ ...p, value: Math.max(0, Number(funds[p.key] ?? 0)) }));
  const total = parts.reduce((a, p) => a + p.value, 0);
  const negative = Number(funds.negative_balances_usd ?? 0);
  return (
    <Section title="Customer funds" actions={<span className="text-body-xs text-fg-tertiary">Right now</span>}>
      <p className="text-body-sm text-fg-secondary">Money held for users</p>
      <p className="mt-0.5 font-display text-num-xl tabular-nums text-fg">{usd(total.toFixed(2))}</p>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={parts.map((p) => `${p.label} ${usd(p.value.toFixed(2))}`).join(', ')}>
        {total > 0 ? parts.map((p) => (p.value > 0 ? <span key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} /> : null)) : null}
      </div>
      <ul className="mt-4 grid gap-x-6 gap-y-3 tablet:grid-cols-2">
        {parts.map((p) => (
          <li key={p.key} className="flex items-start gap-2.5">
            <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-label-md text-fg">{p.label}</span>
                <span className="adm-mono tabular-nums text-fg">{usd(p.value.toFixed(2))}</span>
              </span>
              <span className="flex justify-between gap-2 text-body-xs text-fg-tertiary">
                <span>{p.hint}</span>
                <span>{total > 0 ? `${Math.round((p.value / total) * 100)}%` : '—'}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
      {negative > 0 ? (
        <Alert tone="danger" className="mt-4" action={<Button size="S" variant="secondary" href="/ledger">Open ledger</Button>}>
          {usd(negative.toFixed(2))} sits in negative balances. Check the accounts before month end.
        </Alert>
      ) : null}
    </Section>
  );
}

/** Deposits or withdrawals by method, each with its share of the period's total. */
function MethodSplit({ title, rows, color, empty, href, unit }: { title: string; rows: Split[]; color: string; empty: string; href: string; unit: string }) {
  const total = rows.reduce((a, r) => a + Number(r.usd), 0);
  return (
    <Section title={title} actions={<Button size="S" variant="tertiary" href={href}>View all</Button>}>
      {rows.length ? (
        <ul className="divide-y divide-line-subtle">
          {rows.map((r) => {
            const pct = total > 0 ? (Number(r.usd) / total) * 100 : 0;
            return (
              <li key={r.label} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-label-md text-fg">{r.label}</span>
                  <span className="adm-mono tabular-nums text-fg">{usd(r.usd)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                  </span>
                  <span className="w-[112px] shrink-0 text-right text-body-xs text-fg-tertiary">
                    {plural(r.count, unit)} · {Math.round(pct)}%
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-6 text-center text-body-sm text-fg-tertiary">{empty}</p>
      )}
    </Section>
  );
}

/** Work waiting on finance, each linked to the queue that clears it. */
function Waiting({ w, recon }: { w: Overview['waiting']; recon: Summary['summary']['open_reconciliation_items'] }) {
  const rows: { label: string; count: number; sub?: string; href: string; urgent?: boolean }[] = [
    { label: 'Deposits to approve', count: w.deposits_pending.count, sub: usd(w.deposits_pending.usd), href: '/deposits?tab=pending' },
    { label: 'Withdrawals requested', count: w.withdrawals_requested.count, sub: usd(w.withdrawals_requested.usd), href: '/withdrawals?status=requested' },
    { label: 'Withdrawals processing', count: w.withdrawals_processing.count, sub: usd(w.withdrawals_processing.usd), href: '/withdrawals?tab=processing' },
    { label: 'Reconciliation · critical', count: recon.critical, href: '/ledger?tab=reconciliation&severity=critical', urgent: true },
    { label: 'Reconciliation · high', count: recon.high, href: '/ledger?tab=reconciliation&severity=high' },
    { label: 'Reconciliation · medium', count: recon.medium, href: '/ledger?tab=reconciliation&severity=medium' },
  ];
  return (
    <Section title="Waiting on finance" actions={<span className="text-body-xs text-fg-tertiary">Right now</span>}>
      <ul className="-mx-2">
        {rows.map((r) => (
          <li key={r.label}>
            <NextLink href={r.href} aria-label={`${r.label}: ${r.count}${r.sub && r.count ? `, ${r.sub}` : ''}`} className="flex items-center gap-3 rounded-[10px] px-2 py-2.5 transition-colors hover:bg-subtle focus-visible:shadow-focus">
              <span className="min-w-0 flex-1">
                <span className="block text-body-sm text-fg">{r.label}</span>
                {r.sub && r.count ? <span className="block text-body-xs text-fg-tertiary">{r.sub}</span> : null}
              </span>
              <span className={cn('min-w-7 rounded-full px-2 text-center text-label-sm leading-6 tabular-nums', !r.count ? 'bg-muted text-fg-tertiary' : r.urgent ? 'bg-danger-subtle text-fg-danger' : 'bg-warning-subtle text-fg-warning')}>{r.count}</span>
              <Icon name="chevron-right" size={16} className="text-fg-tertiary" />
            </NextLink>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Overview() {
  const u = useUrlState();
  const raw = u.get('period', '30');
  const days = PERIODS.some((p) => p.value === raw) ? raw : '30';
  const data = useApi<Summary>('/admin/reports/financial', { days });
  const ref = useStagger(`${days}:${!!data.data}`);
  if (data.error && !data.data) return <ErrorState error={data.error} onRetry={data.hardReload} title="We couldn't load the summary" />;
  const o = data.data?.overview;
  const s = data.data?.summary;
  return (
    <div ref={ref} className="space-y-5">
      <Toolbar actions={o ? <span className="self-center text-body-xs text-fg-tertiary">{o.period.days === 1 ? d(o.period.to) : `${d(o.period.from)} – ${d(o.period.to)}`} · Dhaka time</span> : null}>
        <SegmentedControl label="Period" kind="radio" value={days} onChange={(v) => u.set({ period: v === '30' ? null : v })} options={PERIODS.map((p) => ({ ...p }))} />
      </Toolbar>
      {data.error && data.data ? (
        <Alert tone="danger" action={<Button size="S" variant="secondary" onClick={data.hardReload}>Try again</Button>}>
          We couldn&apos;t load this period. The figures below are from the last one that loaded.
        </Alert>
      ) : null}
      {!o || !s ? (
        <div className="space-y-5" aria-busy="true" aria-label="Loading summary">
          <div className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-4">
            {[...Array(4)].map((_, i) => <Skeleton.StatCard key={i} />)}
          </div>
          <div className="h-72 animate-pulse rounded-card bg-muted" />
        </div>
      ) : (
        <div className={cn('space-y-5 transition-opacity', data.loading && 'opacity-60')} aria-busy={data.loading}>
          <section aria-label="Totals for the period" className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-4">
            <Kpi label="Deposits" value={Number(o.totals.deposits_usd)} money sub={<><span className="block">{plural(o.totals.deposits_count, 'deposit')} completed</span><Delta pct={o.totals.deposits_change_pct} days={o.period.days} /></>} />
            <Kpi label="Withdrawals paid" value={Number(o.totals.payouts_usd)} money sub={<><span className="block">{plural(o.totals.payouts_count, 'withdrawal')} paid</span><Delta pct={o.totals.payouts_change_pct} days={o.period.days} neutral /></>} />
            <Kpi label="Net flow" value={Number(o.totals.net_flow_usd)} display={usd(o.totals.net_flow_usd)} tone={Number(o.totals.net_flow_usd) < 0 ? 'danger' : undefined} sub="Deposits minus withdrawals paid" />
            <Kpi label="Platform revenue" value={Number(o.totals.revenue_usd)} money sub={<><span className="block">Fees on jobs and withdrawals</span><Delta pct={o.totals.revenue_change_pct} days={o.period.days} /></>} />
          </section>

          <div className="grid gap-4 desktop:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <TrendChart title={`Daily totals · ${o.trend.days.length} days`} money labels={o.trend.days} series={[{ name: 'Deposits', values: o.trend.deposits_usd, tone: 'success' }, { name: 'Withdrawals paid', values: o.trend.payouts_usd, tone: 'info' }, { name: 'Platform revenue', values: o.trend.revenue_usd, tone: 'brand' }]} />
            <Section title="Revenue and costs">
              <dl>
                <Line label="Platform revenue" value={o.totals.revenue_usd} sign="+" />
                <Line label="Referral commissions" value={o.totals.referral_expense_usd} sign="−" />
                <Line label="Provider fees" value={o.totals.provider_fees_usd} sign="−" />
                <Line label="Net revenue" value={o.totals.net_revenue_usd} strong />
              </dl>
              <p className="mt-3 text-body-xs text-fg-tertiary">Refunds issued in this period: {usd(o.totals.refunds_usd)}</p>
            </Section>
          </div>

          <div className="grid gap-4 desktop:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <CustomerFunds funds={s.customer_funds} />
            <Waiting w={o.waiting} recon={s.open_reconciliation_items} />
          </div>

          <div className="grid gap-4 desktop:grid-cols-2">
            <MethodSplit title="Deposits by method" rows={o.by_method.deposits} color="var(--fl-bg-success)" empty="No completed deposits in this period." href="/deposits" unit="deposit" />
            <MethodSplit title="Withdrawals by method" rows={o.by_method.withdrawals} color="var(--fl-text-info)" empty="No paid withdrawals in this period." href="/withdrawals" unit="withdrawal" />
          </div>
        </div>
      )}
    </div>
  );
}

/** The report catalogue, grouped by what each report is for. */
function Library({ groups, onOpen }: { groups: { title: string; codes: string[] }[]; onOpen: (code: string) => void }) {
  return (
    <div className="grid gap-4 desktop:grid-cols-2">
      {groups.map((g) => (
        <Section key={g.title} title={g.title}>
          <ul className="-mx-2">
            {g.codes.map((code) => {
              const r = REPORTS[code]!;
              return (
                <li key={code}>
                  <button type="button" onClick={() => onOpen(code)} className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2.5 text-left transition-colors hover:bg-subtle focus-visible:shadow-focus">
                    <Icon name="file-text" size={20} className="shrink-0 text-fg-tertiary" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-label-md text-fg">{r.name}</span>
                        {PII.has(code) ? <Icon name="lock" size={14} className="text-fg-tertiary" label="Holds personal data" /> : null}
                      </span>
                      <span className="block text-body-xs text-fg-secondary">{r.use}</span>
                    </span>
                    <span className="hidden shrink-0 text-body-xs text-fg-tertiary tablet:inline">{r.freq}</span>
                    <Icon name="chevron-right" size={16} className="shrink-0 text-fg-tertiary" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      ))}
    </div>
  );
}

function Viewer({ code }: { code: string }) {
  const r = REPORTS[code] ?? { name: code, freq: '', use: '' };
  const { can, me } = useSession();
  const u = useUrlState();
  const asked = Number(u.get('days', '30'));
  const days = [1, 7, 30, 90, 365].includes(asked) ? asked : 30;
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const tz = u.get('tz', 'Asia/Dhaka');
  const [user, setUser] = useState(u.get('user'));
  const needsUser = code.endsWith('_statement');
  const q = { from, timezone: tz, user: u.get('user') || undefined, page: u.get('page', '1'), format: 'json' };
  const data = useApi<Report>(!needsUser || u.get('user') ? `/admin/reports/financial/${code}` : null, q);
  const [dl, setDl] = useState(false);
  const [busy, setBusy] = useState(false);
  const canCsv = can('reports.financial') || !(me.roles.length === 1 && me.roles[0] === 'moderator');
  const total = data.meta?.total as number | undefined;
  const doDownload = async () => {
    setBusy(true);
    try {
      await download(`/admin/reports/financial/${code}`, { query: { ...q, page: undefined, format: 'csv' } }, `${code}.csv`);
      toast.success('Report downloaded. This download is logged.');
      setDl(false);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Button size="S" variant="tertiary" leadingIcon="arrow-left" onClick={() => u.set({ report: null, page: null, user: null })}>
        All reports
      </Button>
      <Section>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-h5 text-fg">
              {r.name}
              {PII.has(code) ? <Icon name="lock" size={16} className="text-fg-tertiary" label="Holds personal data" /> : null}
            </h2>
            <p className="mt-0.5 text-body-sm text-fg-secondary">{r.use}</p>
            <p className="mt-1 text-body-xs text-fg-tertiary">
              {d(`${from}T12:00:00Z`)} to today · {tz === 'UTC' ? 'UTC' : 'Dhaka time'}
              {total !== undefined ? ` · ${total.toLocaleString('en-US')} ${total === 1 ? 'row' : 'rows'}` : ''}
              {r.freq ? ` · usually run ${r.freq.toLowerCase()}` : ''}
            </p>
          </div>
          {canCsv ? <Button variant="secondary" leadingIcon="download" onClick={() => setDl(true)}>Download CSV</Button> : null}
        </div>
        <Toolbar>
          <FilterSelect label="Period" value={String(days) as '30'} onChange={(v) => u.set({ days: v || null, page: null })} options={[...PERIODS.map((p) => ({ value: p.value as string, label: p.label })), { value: '365', label: '1 year' }]} />
          <SegmentedControl label="Timezone" kind="radio" value={tz} onChange={(v) => u.set({ tz: v === 'Asia/Dhaka' ? null : v })} options={[{ value: 'Asia/Dhaka', label: 'Dhaka' }, { value: 'UTC', label: 'UTC' }]} />
          {needsUser ? (
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); u.set({ user: user || null, page: null }); }}>
              <Field label="User ID" value={user} onChange={(e) => setUser(e.target.value)} wrapperClassName="w-[160px]" />
              <Button type="submit" variant="secondary">Show</Button>
            </form>
          ) : null}
        </Toolbar>
        {needsUser && !u.get('user') ? (
          <EmptyState icon="user" title="Enter a user ID" body="Statements are for one user at a time." compact />
        ) : data.error ? (
          <ErrorState error={data.error} onRetry={data.hardReload} />
        ) : (
          <>
            <Table<(string | number | null)[]>
              caption={r.name}
              rows={data.data?.rows}
              loading={data.loading}
              rowKey={(row) => row.join('|')}
              empty={<EmptyState icon="calendar" title="Nothing in these dates" body="Try a longer range." action={days < 90 ? <Button variant="secondary" onClick={() => u.set({ days: '90', page: null })}>Show 90 days</Button> : undefined} compact />}
              cols={(data.data?.header ?? []).map((h, i) => ({
                key: h,
                header: colLabel(h),
                cell: (row: (string | number | null)[]) => <span className={isMoneyCol(h) ? 'adm-mono tabular-nums' : ''}>{row[i] ?? '—'}</span>,
                align: typeof data.data?.rows[0]?.[i] === 'number' || isMoneyCol(h) ? ('right' as const) : ('left' as const),
              }))}
            />
            <Pager meta={data.meta} onPage={(p) => u.set({ page: String(p) }, false)} />
          </>
        )}
      </Section>
      <Dialog open={dl} onOpenChange={setDl} title={`Download ${r.name}?`} description={`${d(`${from}T12:00:00Z`)} to today, ${tz === 'UTC' ? 'UTC' : 'Dhaka time'}. This download is logged.${PII.has(code) ? ' This report holds personal or financial data.' : ''}`} busy={busy} footer={<><Button variant="secondary" onClick={() => setDl(false)}>Cancel</Button><Button loading={busy} onClick={() => void doDownload()}>Download CSV</Button></>} />
    </div>
  );
}

/** SCR-ADM-21 Financial and operational reports (Doc 09 §6, §12). */
function Reports() {
  usePageHeader('Reports', 'Money, balances and service speed. Dhaka time unless you choose UTC.');
  const { can } = useSession();
  const u = useUrlState();
  const fin = can('reports.financial');
  const tab = u.get('tab', fin ? 'summary' : 'operational');
  const report = u.get('report');
  const groups = tab === 'financial' ? FIN_GROUPS : OPS_GROUPS;
  const open = report && groups.some((g) => g.codes.includes(report)) ? report : null;
  return (
    <Gate perms={['reports.financial', 'reports.operational']}>
      <Tabs
        label="Report groups"
        value={tab}
        panelId="rp"
        className="mb-5"
        onChange={(v) => u.set({ tab: v, report: null, page: null, user: null })}
        tabs={[...(fin ? [{ value: 'summary', label: 'Summary' }, { value: 'financial', label: 'Financial reports' }] : []), { value: 'operational', label: 'Operational reports' }]}
      />
      <div id="rp">
        {tab === 'summary' ? <Overview /> : open ? <Viewer code={open} /> : <Library groups={groups} onOpen={(code) => u.set({ report: code, page: null })} />}
      </div>
    </Gate>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Reports />
    </Suspense>
  );
}
