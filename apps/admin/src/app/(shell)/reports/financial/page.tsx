'use client';
import { Suspense, useState } from 'react';
import { Button, Dialog, EmptyState, Field, SegmentedControl, Tabs, toast } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ErrorState, FilterSelect, Gate, Pager, Section, Table, Toolbar } from '@/components/kit';
import { Kpi } from '@/components/charts';
import { download } from '@/lib/api';
import { reportError, useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface Summary { date: string; summary: { deposits_usd: string; payouts_usd: string; customer_funds: Record<string, string>; open_reconciliation_items: { critical: number; high: number; medium: number } } }
interface Report { report: string; from: string; to: string; timezone: string; header: string[]; rows: (string | number | null)[][] }

const FIN: [string, string, string, string][] = [
  ['general_journal', 'General journal', 'Daily, monthly', 'Every ledger entry'],
  ['trial_balance', 'Trial balance', 'Daily, month end', 'Opening, debits, credits, closing per account kind'],
  ['customer_funds', 'Customer funds', 'Daily', 'Worker earnings, employer balances, in flight'],
  ['deposits', 'Deposits', 'Daily, monthly', 'Every top-up with provider and refund'],
  ['withdrawals', 'Withdrawals', 'Daily, monthly', 'Every payout, accounts masked'],
  ['provider_settlement', 'Provider settlement', 'On import', 'Settlement lines and matches'],
  ['platform_revenue', 'Platform revenue', 'Monthly', 'Fees by day'],
  ['referral_expense', 'Referral expense', 'Monthly', 'Commissions and reversals'],
  ['provider_fees', 'Provider fees', 'Monthly', 'Gateway fees by day'],
  ['fx', 'FX report', 'Monthly', 'Rates in force'],
  ['refunds_chargebacks', 'Refunds and chargebacks', 'Monthly', 'Deposit refunds and chargebacks'],
  ['adjustments', 'Adjustments', 'Monthly', 'Maker, approver, reason, amount'],
  ['aged_balances', 'Unspent and aged balances', 'Monthly', 'Balances by inactivity age'],
  ['withdrawal_sla', 'Withdrawal SLA', 'Weekly', 'Median and P95 time to paid'],
  ['employer_statement', 'Employer statement', 'On demand', 'One employer, needs a user ID'],
  ['worker_statement', 'Worker earnings statement', 'On demand', 'One worker, needs a user ID'],
];
const OPS: [string, string, string, string][] = [
  ['withdrawal_sla', 'Withdrawal SLA', 'Weekly', 'Median and P95 time to paid by method'],
  ['kyc_sla', 'KYC SLA', 'Daily', 'Decisions and time to decide'],
  ['dispute_sla', 'Dispute SLA', 'Daily', 'Resolutions within 48 h'],
  ['moderation_activity', 'Moderation activity', 'Daily', 'Suspends, closes, reports handled'],
  ['support_queue', 'Support queue', 'Daily', 'New, answered and spam by topic'],
];
const PII = new Set(['general_journal', 'deposits', 'withdrawals', 'referral_expense', 'employer_statement', 'worker_statement', 'adjustments']);

function Viewer({ code, name }: { code: string; name: string }) {
  const { can, me } = useSession();
  const u = useUrlState();
  const days = Number(u.get('days', '30'));
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const tz = u.get('tz', 'Asia/Dhaka');
  const [user, setUser] = useState(u.get('user'));
  const needsUser = code.endsWith('_statement');
  const q = { from, timezone: tz, user: u.get('user') || undefined, page: u.get('page', '1'), format: 'json' };
  const data = useApi<Report>(!needsUser || u.get('user') ? `/admin/reports/financial/${code}` : null, q);
  const [dl, setDl] = useState(false);
  const [busy, setBusy] = useState(false);
  const canCsv = can('reports.financial') || !(me.roles.length === 1 && me.roles[0] === 'moderator');
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
    <Section title={name} actions={<Button size="S" variant="tertiary" onClick={() => u.set({ report: null })}>All reports</Button>}>
      <Toolbar actions={canCsv ? <Button variant="secondary" leadingIcon="download" onClick={() => setDl(true)}>Download CSV</Button> : null}>
        <FilterSelect label="Range" value={String(days) as '30'} onChange={(v) => u.set({ days: v || null })} options={[{ value: '1', label: 'Today' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: '365', label: 'Last year' }]} />
        <SegmentedControl label="Timezone" kind="radio" value={tz} onChange={(v) => u.set({ tz: v === 'Asia/Dhaka' ? null : v })} options={[{ value: 'Asia/Dhaka', label: 'Asia/Dhaka' }, { value: 'UTC', label: 'UTC' }]} />
        {needsUser ? <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); u.set({ user: user || null }); }}><Field label="User ID" value={user} onChange={(e) => setUser(e.target.value)} wrapperClassName="w-[160px]" /><Button type="submit" variant="secondary">Show</Button></form> : null}
      </Toolbar>
      {needsUser && !u.get('user') ? <EmptyState title="Enter a user ID" body="Statements are for one user at a time." compact /> : data.error ? <ErrorState error={data.error} onRetry={data.hardReload} /> : (
        <>
          <Table<(string | number | null)[]>
            caption={name}
            rows={data.data?.rows}
            loading={data.loading}
            rowKey={(r) => r.join('|')}
            empty={<EmptyState title="No data for these dates." action={<Button variant="secondary" onClick={() => u.set({ days: '90' })}>Change dates</Button>} compact />}
            cols={(data.data?.header ?? []).map((h, i) => ({ key: h, header: h.replace(/_/g, ' '), cell: (r: (string | number | null)[]) => <span className={/exact|usd|amount|total|closing|opening|debits|credits/.test(h) ? 'adm-mono' : ''}>{r[i] ?? '—'}</span>, align: typeof data.data?.rows[0]?.[i] === 'number' || /exact|usd|amount|total/.test(h) ? 'right' as const : 'left' as const }))}
          />
          <Pager meta={data.meta} onPage={(p) => u.set({ page: String(p) }, false)} />
        </>
      )}
      <Dialog open={dl} onOpenChange={setDl} title={`Download ${name}?`} description={`${from} to today, ${tz}. This download is logged.${PII.has(code) ? ' This report holds personal or financial data.' : ''}`} busy={busy} footer={<><Button variant="secondary" onClick={() => setDl(false)}>Cancel</Button><Button loading={busy} onClick={() => void doDownload()}>Download CSV</Button></>} />
    </Section>
  );
}

/** SCR-ADM-21 Financial and operational reports (Doc 09 §6, §12). */
function Reports() {
  usePageHeader('Reports', 'All times in Asia/Dhaka unless you choose UTC.');
  const { can } = useSession();
  const u = useUrlState();
  const fin = can('reports.financial');
  const tab = u.get('tab', fin ? 'summary' : 'operational');
  const summary = useApi<Summary>(fin && tab === 'summary' ? '/admin/reports/financial' : null, {});
  const report = u.get('report');
  const list = tab === 'financial' ? FIN : OPS;
  const sel = list.find((r) => r[0] === report);
  const s = summary.data?.summary;
  return (
    <Gate perms={['reports.financial', 'reports.operational']}>
      <Tabs label="Report groups" value={tab} panelId="rp" className="mb-5" onChange={(v) => u.set({ tab: v, report: null, page: null })} tabs={[...(fin ? [{ value: 'summary', label: 'Summary' }, { value: 'financial', label: 'Financial' }] : []), { value: 'operational', label: 'Operational' }]} />
      <div id="rp">
        {tab === 'summary' ? (
          summary.error ? <ErrorState error={summary.error} onRetry={summary.hardReload} /> : !s ? <div className="h-40 animate-pulse rounded-card bg-muted" /> : (
            <div className="space-y-6">
              <div className="grid gap-4 tablet:grid-cols-2">
                <Kpi label={`Deposits · ${summary.data!.date}`} value={Number(s.deposits_usd)} money />
                <Kpi label={`Payouts · ${summary.data!.date}`} value={Number(s.payouts_usd)} money />
              </div>
              <div>
                <h2 className="mb-3 text-overline uppercase text-fg-tertiary">Customer funds</h2>
                <div className="grid gap-4 tablet:grid-cols-3 desktop:grid-cols-5">
                  <Kpi label="Worker earnings" value={Number(s.customer_funds.worker_earnings_usd)} money />
                  <Kpi label="Employer available" value={Number(s.customer_funds.employer_available_usd)} money />
                  <Kpi label="Employer reserved" value={Number(s.customer_funds.employer_reserved_usd)} money />
                  <Kpi label="In flight" value={Number(s.customer_funds.in_flight_usd)} money />
                  <Kpi label="Negative balances" value={Number(s.customer_funds.negative_balances_usd)} money tone={Number(s.customer_funds.negative_balances_usd) > 0 ? 'danger' : undefined} />
                </div>
              </div>
              <div>
                <h2 className="mb-3 text-overline uppercase text-fg-tertiary">Open reconciliation items</h2>
                <div className="grid gap-4 tablet:grid-cols-3">
                  <Kpi label="Critical" value={s.open_reconciliation_items.critical} href="/ledger?tab=reconciliation&severity=critical" tone={s.open_reconciliation_items.critical ? 'danger' : undefined} />
                  <Kpi label="High" value={s.open_reconciliation_items.high} href="/ledger?tab=reconciliation&severity=high" />
                  <Kpi label="Medium" value={s.open_reconciliation_items.medium} href="/ledger?tab=reconciliation&severity=medium" />
                </div>
              </div>
            </div>
          )
        ) : sel ? (
          <Viewer code={sel[0]} name={sel[1]} />
        ) : (
          <div className="grid gap-3 tablet:grid-cols-2 desktop:grid-cols-3">
            {list.map(([code, name, freq, use]) => (
              <button key={code} type="button" onClick={() => u.set({ report: code, page: null })} className="rounded-card border border-line bg-surface p-4 text-left shadow-xs transition-shadow hover:border-line-strong hover:shadow-sm focus-visible:shadow-focus">
                <p className="text-label-md text-fg">{name}</p>
                <p className="mt-0.5 text-body-xs text-fg-tertiary">{freq}</p>
                <p className="mt-2 text-body-sm text-fg-secondary">{use}</p>
              </button>
            ))}
          </div>
        )}
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
