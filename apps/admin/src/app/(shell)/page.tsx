'use client';
import NextLink from 'next/link';
import { Alert, Button, Skeleton } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ErrorState, Gate } from '@/components/kit';
import { Kpi, TrendChart, useStagger } from '@/components/charts';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface Dash {
  queues: Record<string, number>;
  today: { approvals: number; new_users: number; deposits_usd?: string; payouts_usd?: string };
  service: Record<string, number | null | undefined>;
  trend: { days: string[]; approvals: number[]; new_users: number[]; deposits_usd?: number[]; payouts_usd?: number[] };
  alerts: { severity: string; code: string; message: string; link: string }[];
}

type Card = { key: string; label: string; href: string; perms: string[]; sub?: (q: Record<string, number>) => string | undefined };
const QUEUES: Card[] = [
  { key: 'kyc_pending', label: 'KYC to review', href: '/kyc', perms: ['kyc.read_status', 'kyc.read'], sub: (q) => (q.kyc_overdue ? `${q.kyc_overdue} overdue` : undefined) },
  { key: 'employer_verification', label: 'Employer verification', href: '/employers/verification', perms: ['employers.verify'] },
  { key: 'withdrawals_requested', label: 'Withdrawals requested', href: '/withdrawals?status=requested', perms: ['withdrawals.read_masked', 'withdrawals.read'] },
  { key: 'withdrawals_processing', label: 'Withdrawals processing', href: '/withdrawals?tab=processing', perms: ['withdrawals.read_masked', 'withdrawals.read'] },
  { key: 'disputes_open', label: 'Disputes open', href: '/disputes', perms: ['disputes.read', 'disputes.resolve'], sub: (q) => (q.disputes_overdue ? `${q.disputes_overdue} overdue` : undefined) },
  { key: 'reports_open', label: 'Job reports', href: '/reports', perms: ['reports.read'] },
  { key: 'flagged_jobs', label: 'Flagged jobs', href: '/jobs?tab=flagged', perms: ['jobs.moderate'] },
  { key: 'escalated_submissions', label: 'Escalated submissions', href: '/submissions?tab=escalated', perms: ['submissions.read'] },
  { key: 'support_new', label: 'Support messages', href: '/support/messages?status=new', perms: ['support.reply'] },
  { key: 'adjustments_pending', label: 'Adjustments to approve', href: '/ledger?tab=adjustments', perms: ['ledger.approve'] },
];

/** SCR-ADM-02 Dashboard (Doc 09 §6, §21). */
export default function DashboardPage() {
  usePageHeader('Dashboard', 'Today in Dhaka time. Queues update every minute.');
  const { can, tick } = useSession();
  const { data, error, loading, hardReload } = useApi<Dash>('/admin/dashboard', { t: tick }, { pollMs: 60_000 });
  const ref = useStagger(!!data);
  if (error && !data) return <ErrorState error={error} onRetry={hardReload} title="We couldn't load the dashboard" />;
  if (loading && !data) {
    return (
      <div className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-4">
        {[...Array(8)].map((_, i) => (
          <Skeleton.StatCard key={i} />
        ))}
      </div>
    );
  }
  if (!data) return null;
  const q = data.queues;
  const cards = QUEUES.filter((c) => can(...c.perms));
  const money = data.today.deposits_usd !== undefined;
  const s = data.service;
  return (
    <Gate perms={['dashboard.read']}>
      <div ref={ref} className="space-y-8">
        {data.alerts.length ? (
          <section aria-label="Alerts" className="space-y-2">
            {data.alerts.map((a) => (
              <Alert key={a.code} tone={a.severity === 'critical' || a.severity === 'high' ? 'danger' : a.severity === 'medium' ? 'warning' : 'info'} action={<Button size="S" variant="secondary" href={a.link}>Open</Button>}>
                {a.message}
              </Alert>
            ))}
          </section>
        ) : null}
        {cards.length ? (
          <section aria-labelledby="q-h">
            <h2 id="q-h" className="mb-3 text-overline uppercase text-fg-tertiary">Queues</h2>
            <div className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-4">
              {cards.map((c) => (
                <Kpi key={c.key} label={c.label} value={q[c.key] ?? 0} href={c.href} sub={c.sub?.(q)} tone={c.sub?.(q) ? 'danger' : undefined} />
              ))}
            </div>
          </section>
        ) : null}
        <section aria-labelledby="t-h">
          <h2 id="t-h" className="mb-3 text-overline uppercase text-fg-tertiary">Today</h2>
          <div className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-4">
            {money ? <Kpi label="Deposits" value={Number(data.today.deposits_usd)} money /> : null}
            {money ? <Kpi label="Payouts" value={Number(data.today.payouts_usd)} money /> : null}
            <Kpi label="Approvals" value={data.today.approvals} sub=" " />
            <Kpi label="New users" value={data.today.new_users} sub=" " />
          </div>
        </section>
        <section aria-labelledby="s-h">
          <h2 id="s-h" className="mb-3 text-overline uppercase text-fg-tertiary">Service levels · last 7 days</h2>
          <div className="grid gap-4 tablet:grid-cols-3 desktop:grid-cols-6">
            <Kpi label="KYC within 24 h" value={s.kyc_within_sla_7d_pct ?? 0} display={s.kyc_within_sla_7d_pct == null ? '—' : `${s.kyc_within_sla_7d_pct}%`} sub=" " />
            <Kpi label="Disputes within 48 h" value={s.disputes_within_sla_7d_pct ?? 0} display={s.disputes_within_sla_7d_pct == null ? '—' : `${s.disputes_within_sla_7d_pct}%`} sub=" " />
            <Kpi label="Median time to paid" value={s.withdrawal_median_hours_7d ?? 0} display={s.withdrawal_median_hours_7d == null ? '—' : `${s.withdrawal_median_hours_7d} h`} sub="Target under 24 h" />
            <Kpi label="Running jobs" value={s.jobs_running ?? 0} sub=" " />
            <Kpi label="Waiting for review" value={s.in_review_total ?? 0} sub=" " />
            {s.fx_age_hours !== undefined ? <Kpi label="BDT rate age" value={s.fx_age_hours ?? 0} display={s.fx_age_hours == null ? '—' : `${s.fx_age_hours} h`} tone={(s.fx_age_hours ?? 0) >= 24 ? 'danger' : undefined} sub={<NextLink href="/settings?tab=fx" className="text-fg-brand hover:underline">Rates</NextLink>} /> : null}
          </div>
        </section>
        <section aria-labelledby="tr-h" className="grid gap-4 desktop:grid-cols-2">
          <h2 id="tr-h" className="sr-only">Trends</h2>
          <div data-reveal-item>
            <TrendChart title="Approvals and sign-ups · 14 days" labels={data.trend.days} series={[{ name: 'Approvals', values: data.trend.approvals, tone: 'brand' }, { name: 'New users', values: data.trend.new_users, tone: 'warning' }]} />
          </div>
          {money && data.trend.deposits_usd ? (
            <div data-reveal-item>
              <TrendChart title="Money in and out · 14 days" money labels={data.trend.days} series={[{ name: 'Deposits', values: data.trend.deposits_usd, tone: 'success' }, { name: 'Payouts', values: data.trend.payouts_usd ?? [], tone: 'info' }]} />
            </div>
          ) : null}
        </section>
      </div>
    </Gate>
  );
}
