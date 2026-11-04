'use client';
import { Suspense, useState } from 'react';
import { Alert, Button, EmptyState, Search, Tabs, Tooltip, toast } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, FilterSelect, Gate, KV, Pager, post, RefLink, SidePanel, SplitView, Table, Toolbar, type ActionSpec } from '@/components/kit';
import { AdminBadge } from '@/components/badges';
import { Kpi } from '@/components/charts';
import { PendingCard, type Pending } from '@/components/pending';
import { api, newIdemKey } from '@/lib/api';
import { reportError, useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { d as day, dt, usd } from '@/lib/fmt';

interface Row { ref: string; employer_public_id: string; business_name: string | null; method_label: string; amount_usd: string; credited_amount_usd: string | null; status: string; needs_review: boolean; initiated_at: string; pending_approval: Pending | null }
interface Detail { ref: string; status: string; needs_review: boolean; employer: { public_id: string; business_name: string | null }; method_label: string; provider: string; provider_payment_id: string | null; amount_usd: string; amount_received_usd: string | null; credited_amount_usd: string | null; refunded_amount_usd: string; provider_fee_exact: string | null; charge_amount_bdt: string | null; fx_rate: string | null; pay_currency: string | null; tx_hash: string | null; confirmations: number | null; failure_reason: string | null; initiated_at: string; completed_at: string | null; credit_ledger_ref: string | null; refund_ledger_ref: string | null; refundable_usd: string; refund_window_ends_at: string | null; refund_window_open: boolean; requery_supported: boolean; webhook_events: { id: string; event_type: string | null; signature_valid: boolean; processing_result: string | null; received_at: string }[]; pending_approval: Pending | null }

const TABS = [
  { value: 'all', label: 'All', q: {} },
  { value: 'pending', label: 'Pending', q: { status: 'pending' } },
  { value: 'review', label: 'Needs review', q: { needs_review: 'true' } },
  { value: 'approval', label: 'Needs my approval', q: { pending_approval: 'true' } },
  { value: 'refunded', label: 'Refunded', q: { status: 'refunded' } },
] as const;

/** SCR-ADM-11 Deposits (Doc 09 §6, §13). */
function Deposits() {
  usePageHeader('Deposits', 'Search top-ups, check stuck payments, and handle refunds.');
  const { can, isSuper, tick } = useSession();
  const u = useUrlState();
  const tab = u.get('tab', 'all');
  const t = TABS.find((x) => x.value === tab) ?? TABS[0];
  const sel = u.get('ref');
  const [q, setQ] = useState('');
  const list = useApi<Row[]>('/admin/deposits', { ...t.q, q, ref: sel && tab === 'all' && !q ? undefined : undefined, method: u.get('method'), from: u.get('from'), to: u.get('to'), page: u.get('page', '1'), t: tick });
  const full = can('deposits.read');
  const detail = useApi<Detail>(sel && full ? `/admin/deposits/${sel}` : null, { t: tick });
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const counts = (list.meta?.counts ?? {}) as Record<string, number>;
  const d = detail.data;
  const write = can('deposits.write');
  const reloadAll = () => { list.reload(); detail.reload(); };

  const requery = async (ref: string) => {
    setBusy(true);
    try {
      const r = await api<{ provider_status: string; credited: boolean; amount_usd: string }>(`/admin/deposits/${ref}/requery`, { method: 'POST', idem: newIdemKey() });
      if (r.data.provider_status === 'paid' && r.data.credited) toast.success(`Provider says paid. ${usd(r.data.amount_usd)} credited.`);
      else toast.info('Provider says unpaid. Nothing changed.');
      reloadAll();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const manual = (x: Detail): ActionSpec => ({
    title: 'Request a manual credit?',
    description: 'A second admin has to approve this before any money moves. Use it only when you have proof of payment from the provider.',
    confirm: 'Request credit',
    fields: [
      { name: 'provider_reference', type: 'text', label: 'Provider reference', required: true, max: 120 },
      { name: 'amount_usd', type: 'text', label: 'Verified amount, USD', required: true, default: x.amount_usd, pattern: /^\d+(\.\d{1,2})?$/, patternMsg: 'Enter an amount with up to 2 decimals.' },
      { name: 'reason', type: 'textarea', label: 'Reason', required: true, max: 500, helper: 'Kept in the audit log. Staff only.' },
    ],
    extra: (v) => (v.amount_usd && Number(v.amount_usd) !== Number(x.amount_usd) ? <Alert tone="warning">This differs from the {usd(x.amount_usd)} requested.</Alert> : null),
    confirmLabel: (v) => `Request credit · ${usd(String(v.amount_usd || '0'))}`,
    submit: (v, idem) => post(`/admin/deposits/${x.ref}/manual-complete`, { provider_reference: v.provider_reference, amount_usd: v.amount_usd, reason: v.reason }, idem),
    onDone: reloadAll,
  });
  const markFailed = (x: Detail): ActionSpec => ({ title: 'Mark this deposit as failed?', description: 'Nothing is credited, and the employer is told.', confirm: 'Mark failed', variant: 'destructive', fields: [{ name: 'reason', type: 'textarea', label: 'Reason', required: true, max: 300, helper: 'The employer sees this on the deposit.' }], submit: (v) => post(`/admin/deposits/${x.ref}/mark-failed`, { reason: v.reason }), success: 'Deposit marked failed.', onDone: reloadAll });
  const refund = (x: Detail): ActionSpec => ({
    title: 'Refund this deposit?',
    description: 'Refund at the provider first if this rail has no API refund.',
    confirm: 'Refund',
    variant: 'destructive',
    fields: [
      { name: 'amount_usd', type: 'text', label: 'Refund amount, USD', required: true, default: x.refundable_usd, helper: `Refundable now: ${usd(x.refundable_usd)}`, pattern: /^\d+(\.\d{1,2})?$/, patternMsg: 'Enter an amount with up to 2 decimals.' },
      { name: 'provider_fee_usd', type: 'text', label: 'Provider fee kept, USD', default: x.provider_fee_exact ? Number(x.provider_fee_exact).toFixed(2) : '0.00' },
      { name: 'reason', type: 'textarea', label: 'Reason', required: true, max: 500, helper: 'Kept in the audit log. Staff only.' },
    ],
    extra: (v) => {
      const a = Number(v.amount_usd || 0);
      const f = Number(v.provider_fee_usd || 0);
      return (
        <div className="space-y-2">
          <p className="text-body-sm text-fg-secondary">Employer balance falls by {usd(a.toFixed(2))}. They receive {usd(Math.max(0, a - f).toFixed(2))} to the original payment method.</p>
          {a >= 100 ? <Alert tone="warning">A second admin has to approve this.</Alert> : null}
          {!x.refund_window_open ? <Alert tone="warning">{isSuper ? "This is past the 30-day window. It's your override, and it's logged." : 'This deposit is past the 30-day refund window.'}</Alert> : null}
        </div>
      );
    },
    confirmLabel: (v) => `Refund · ${usd(Math.max(0, Number(v.amount_usd || 0) - Number(v.provider_fee_usd || 0)).toFixed(2))}`,
    submit: (v, idem) => post(`/admin/deposits/${x.ref}/refund`, { amount_usd: v.amount_usd, provider_fee_usd: v.provider_fee_usd, reason: v.reason }, idem),
    success: 'Refund recorded.',
    onDone: reloadAll,
  });
  const chargeback = (x: Detail): ActionSpec => ({
    title: 'Record a chargeback?',
    description: 'This debits the employer, even into a negative balance. All their jobs are paused and the account is restricted. Workers keep money for approved work.',
    confirm: 'Record chargeback',
    variant: 'destructive',
    fields: [
      { name: 'amount_usd', type: 'text', label: 'Amount, USD', required: true, default: x.credited_amount_usd ?? x.amount_usd },
      { name: 'fee_usd', type: 'text', label: 'Provider fee, USD' },
      { name: 'reason', type: 'textarea', label: 'Case reference', required: true, max: 300 },
    ],
    confirmLabel: (v) => `Record chargeback · ${usd(String(v.amount_usd || '0'))}`,
    submit: (v, idem) => post(`/admin/deposits/${x.ref}/chargeback`, { amount_usd: v.amount_usd, fee_usd: v.fee_usd || undefined, reason: v.reason }, idem),
    success: (r) => {
      const y = r as { jobs_paused: number; employer_available_usd: string };
      return `Recorded. ${y.jobs_paused} jobs paused, account restricted, balance now ${usd(y.employer_available_usd)}.`;
    },
    onDone: reloadAll,
  });
  const approvePending = (x: Detail): ActionSpec => {
    const p = x.pending_approval!;
    return p.action === 'deposit.manual_complete'
      ? { title: 'Approve this manual credit?', description: `${p.requested_by} asked to credit ${usd(String(p.payload.amount_usd))} to ${x.employer.business_name ?? x.employer.public_id}. Reference: ${String(p.payload.provider_reference)}. Reason: ${p.reason}. Referral commission is posted as usual, and low-deposit jobs may resume.`, confirm: `Approve · ${usd(String(p.payload.amount_usd))}`, submit: (_v, idem) => post(`/admin/deposits/${x.ref}/approve-manual`, {}, idem), success: 'Manual credit posted.', onDone: reloadAll }
      : { title: 'Approve this refund?', description: `${p.requested_by} asked to refund ${usd(String(p.payload.amount_usd))}. Reason: ${p.reason}.`, confirm: `Approve · ${usd(String(p.payload.amount_usd))}`, submit: (_v, idem) => post(`/admin/deposits/${x.ref}/approve-refund`, {}, idem), success: 'Refund posted.', onDone: reloadAll };
  };
  const declinePending = (x: Detail): ActionSpec => ({ title: 'Decline this pending action?', confirm: 'Decline', variant: 'destructive', fields: [{ name: 'decision_note', type: 'textarea', label: 'Decision note', required: true, max: 500 }], submit: (v) => post(`/admin/deposits/${x.ref}/decline-pending`, { decision_note: v.decision_note }), success: 'Declined.', onDone: reloadAll });

  return (
    <Gate perms={['deposits.read_masked', 'deposits.read']}>
      <div className="mb-5 grid gap-4 tablet:grid-cols-3">
        <Kpi label="Pending" value={counts.pending ?? 0} sub=" " />
        <Kpi label="Needs review" value={counts.needs_review ?? 0} sub=" " />
        <Kpi label="Waiting on approval" value={counts.pending_approval ?? 0} sub=" " />
      </div>
      <Tabs label="Deposit views" value={tab} panelId="dep" className="mb-4" onChange={(v) => u.set({ tab: v === 'all' ? null : v, ref: null })} tabs={TABS.filter((x) => x.value !== 'approval' || can('deposits.approve')).map((x) => ({ value: x.value, label: x.label }))} />
      <SplitView
        panel={
          <SidePanel
            open={!!sel && full}
            onClose={() => u.set({ ref: null })}
            title={sel ?? ''}
            meta={d ? <span className="flex flex-wrap items-center gap-2"><AdminBadge kind="deposit" code={d.status} /><RefLink href={`/users/${d.employer.public_id}`}>{d.employer.business_name ?? d.employer.public_id}</RefLink></span> : undefined}
            footer={
              d && write && !d.pending_approval ? (
                <>
                  {['initiated', 'pending', 'expired', 'failed', 'cancelled'].includes(d.status) ? (
                    d.requery_supported ? <Button variant="secondary" loading={busy} onClick={() => void requery(d.ref)}>Check with provider</Button> : <Tooltip content="This provider has no status query yet."><span tabIndex={0}><Button variant="secondary" disabled disabledReasonId="rq">Check with provider</Button></span></Tooltip>
                  ) : null}
                  {['initiated', 'pending', 'expired'].includes(d.status) ? <Button variant="secondary" onClick={() => setSpec(markFailed(d))}>Mark failed</Button> : null}
                  {['initiated', 'pending', 'expired'].includes(d.status) ? <Button onClick={() => setSpec(manual(d))}>Credit manually</Button> : null}
                  {d.status === 'completed' ? <Button variant="secondary" onClick={() => setSpec(chargeback(d))}>Record chargeback</Button> : null}
                  {d.status === 'completed' ? <Button variant="destructive" onClick={() => setSpec(refund(d))}>Refund</Button> : null}
                  {d.status === 'refunded' ? <Button variant="secondary" onClick={() => setSpec(chargeback(d))}>Record chargeback</Button> : null}
                  <span id="rq" className="sr-only">No status query for this provider.</span>
                </>
              ) : null
            }
          >
            {!d ? (
              <div className="h-40 animate-pulse rounded-[12px] bg-muted" />
            ) : (
              <>
                {d.pending_approval ? <PendingCard p={d.pending_approval} canApprove={can('deposits.approve')} onApprove={() => setSpec(approvePending(d))} onDecline={() => setSpec(declinePending(d))} /> : null}
                {d.needs_review ? <Alert tone="warning">This deposit needs review: pending over an hour or a webhook mismatch.</Alert> : null}
                {d.failure_reason ? <Alert tone="danger">{d.failure_reason}</Alert> : null}
                <KV items={[['Method', d.method_label], ['Requested', usd(d.amount_usd)], ['Received', usd(d.amount_received_usd)], ['Credited', usd(d.credited_amount_usd)], ['Refunded', usd(d.refunded_amount_usd)], ['Provider fee kept', d.provider_fee_exact ?? '—'], ...(d.charge_amount_bdt ? [['BDT charge', `৳${d.charge_amount_bdt} at ${d.fx_rate}`] as [string, string]] : []), ...(d.tx_hash ? [['Coin', `${d.pay_currency} · ${d.confirmations ?? 0} confirmations`] as [string, string], ['Tx hash', d.tx_hash] as [string, string]] : []), ['Provider ID', d.provider_payment_id ?? '—'], ['Credit', d.credit_ledger_ref ? <RefLink key="c" href={`/ledger?ref=${d.credit_ledger_ref}`}>{d.credit_ledger_ref}</RefLink> : '—'], ['Started', dt(d.initiated_at)], ['Completed', dt(d.completed_at)]]} />
                {d.status === 'completed' ? <Alert tone="info">Refundable now: {usd(d.refundable_usd)}. Refund window ends {day(d.refund_window_ends_at)}.</Alert> : null}
                <div>
                  <h3 className="mb-2 text-label-md text-fg">Webhook history</h3>
                  <Table caption="Webhooks" rows={d.webhook_events} rowKey={(e) => e.id} empty={<p className="p-4 text-body-sm text-fg-tertiary">No webhooks received.</p>} cols={[{ key: 'e', header: 'Event', cell: (e) => e.event_type ?? '—' }, { key: 's', header: 'Signature', cell: (e) => (e.signature_valid ? 'Valid' : 'Invalid') }, { key: 'r', header: 'Result', cell: (e) => e.processing_result ?? '—' }, { key: 'w', header: 'Received', cell: (e) => dt(e.received_at) }]} />
                </div>
              </>
            )}
          </SidePanel>
        }
      >
        <Toolbar>
          <div className="w-full max-w-[320px]">
            <Search value={q} onValueChange={setQ} label="Search deposits" placeholder="DP-, employer ID or provider ID" size="M" />
          </div>
          <FilterSelect label="Method" value={u.get('method')} onChange={(v) => u.set({ method: v })} options={[{ value: '', label: 'Any method' }, { value: 'mobile_wallet', label: 'Mobile wallet' }, { value: 'card', label: 'Card' }, { value: 'crypto', label: 'Crypto' }]} />
          <FilterSelect label="Range" value={u.get('range')} onChange={(v) => { const days = { '': 0, today: 0, '7': 7, '30': 30, '90': 90 }[v] ?? 0; const from = v ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) : null; u.set({ range: v, from }); }} options={[{ value: '', label: 'Any time' }, { value: 'today', label: 'Today' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} />
        </Toolbar>
        <Table<Row>
          caption="Deposits"
          rows={list.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.hardReload}
          rowKey={(r) => r.ref}
          selectedKey={sel}
          onRowClick={full ? (r) => u.set({ ref: r.ref }, false) : undefined}
          empty={tab === 'review' ? <EmptyState title="Nothing needs review." compact /> : <EmptyState icon="arrow-down-left" title="No deposits yet" body="Employer top-ups appear here." compact />}
          cols={[
            { key: 'r', header: 'Reference', cell: (r) => <span className="font-medium text-fg-brand">{r.ref}</span> },
            { key: 'e', header: 'Employer', cell: (r) => <div><RefLink href={`/users/${r.employer_public_id}`}>{r.employer_public_id}</RefLink>{r.business_name ? <p className="text-body-xs text-fg-tertiary">{r.business_name}</p> : null}</div> },
            { key: 'm', header: 'Method', cell: (r) => r.method_label },
            { key: 'a', header: 'Amount', align: 'right', cell: (r) => usd(r.amount_usd) },
            { key: 'c', header: 'Credited', align: 'right', cell: (r) => <span className={r.credited_amount_usd && Number(r.credited_amount_usd) !== Number(r.amount_usd) ? 'text-fg-danger' : ''}>{usd(r.credited_amount_usd)}</span> },
            { key: 's', header: 'Status', cell: (r) => (<span className="flex flex-wrap gap-1"><AdminBadge kind="deposit" code={r.status} />{r.needs_review ? <span className="rounded-full bg-warning-subtle px-2 text-label-sm leading-6 text-fg-warning">Needs review</span> : null}{r.pending_approval ? <span className="rounded-full bg-warning-subtle px-2 text-label-sm leading-6 text-fg-warning">Awaiting second approval</span> : null}</span>) },
            { key: 'i', header: 'Started', cell: (r) => dt(r.initiated_at) },
          ]}
        />
        <Pager meta={list.meta} onPage={(p) => u.set({ page: String(p) }, false)} />
      </SplitView>
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </Gate>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Deposits />
    </Suspense>
  );
}
