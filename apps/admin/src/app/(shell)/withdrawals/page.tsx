'use client';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Button, EmptyState, StatusTracker, Tabs, Tooltip, toast } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, Copy, FilterSelect, Gate, KV, Pager, post, RefLink, SidePanel, SplitView, Table, Toolbar, type ActionSpec } from '@/components/kit';
import { AdminBadge, LABELS } from '@/components/badges';
import { Kpi } from '@/components/charts';
import { PendingCard, type Pending } from '@/components/pending';
import { api, download, newIdemKey } from '@/lib/api';
import { reportError, useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dt, payout, rel, usd } from '@/lib/fmt';

interface Row { ref: string; user_public_id: string; name_masked: string; kyc_status: string; method: string; destination_masked: string; amount_usd: string; fee_usd: string; fx_rate: string; payout_amount: string; payout_currency: string; status: string; risk_flags: string[]; risk_acknowledged: boolean; hold_until: string | null; first_withdrawal: boolean; requested_at: string; pending_approval: Pending | null }
interface Detail { ref: string; status: string; user: { public_id: string; kyc_name: string; kyc_status: string; approval_rate_pct: number | null; account_created_at: string }; first_withdrawal: boolean; method: string; destination: string | null; destination_masked: string; destination_unavailable: boolean; amount_usd: string; fee_usd: string; net_usd: string; fx_rate: string; payout_amount: string; payout_currency: string; risk_flags: string[]; hold_until: string | null; requested_at: string; processing_at: string | null; paid_at: string | null; provider_trx_id: string | null; reject_reason_text: string | null; request_ledger_ref: string; settle_ledger_ref: string | null; reversal_ledger_ref: string | null; events: { from_status: string | null; to_status: string; actor_type: string; actor: string | null; note: string | null; occurred_at: string }[]; requires_second_approval: boolean; pending_approval: Pending | null }
interface Batch { id: string; method: string; count: number; total_usd: string; status: string; created_by: string; created_at: string; checksum: string | null; imported_at: string | null; import_result: { paid: number; rejected: number; failed?: number; pending_approval: number; errors: { reference: string; code: string }[] } | null }

const TABS = [
  { value: 'ready', label: 'Ready to pay', q: { status: 'requested', held: 'false', risk: 'false' } },
  { value: 'hold', label: 'On hold', q: { status: 'requested', held: 'true' } },
  { value: 'processing', label: 'Processing', q: { status: 'processing' } },
  { value: 'approval', label: 'Needs my approval', q: { pending_approval: 'true' } },
  { value: 'batches', label: 'Batches', q: {} },
  { value: 'all', label: 'All', q: {} },
] as const;

/** SCR-ADM-12 Withdrawals (Doc 09 §6, §14). */
function Withdrawals() {
  usePageHeader('Withdrawals', 'Payouts are sent by hand from the merchant wallets, then marked paid.');
  const { can, tick } = useSession();
  const u = useUrlState();
  const tab = u.get('tab', u.get('ref') ? 'all' : u.get('status') === 'processing' ? 'processing' : 'ready');
  const sel = u.get('ref');
  const t = TABS.find((x) => x.value === tab) ?? TABS[0];
  const write = can('withdrawals.write');
  const detailOk = can('withdrawals.read');
  const list = useApi<Row[]>(tab !== 'batches' ? '/admin/withdrawals' : null, { ...t.q, ...(tab === 'all' ? { status: u.get('status') } : {}), ref: tab === 'all' ? sel : undefined, method: u.get('method'), batch: u.get('batch'), page: u.get('page', '1'), t: tick }, { pollMs: 60_000 });
  const batches = useApi<Batch[]>(tab === 'batches' && write ? '/admin/withdrawals/batches' : null, { t: tick });
  const detail = useApi<Detail>(sel && detailOk ? `/admin/withdrawals/${sel}` : null, { t: tick });
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [checksum, setChecksum] = useState<string | null>(null);
  const counts = (list.meta?.counts ?? {}) as Record<string, number>;
  const d = detail.data;
  const reloadAll = () => { list.reload(); detail.reload(); };

  const process = async (ref: string) => {
    setBusy(true);
    try {
      await api(`/admin/withdrawals/${ref}/process`, { method: 'POST', idem: newIdemKey() });
      toast.success('Processing started. The worker can no longer cancel.');
      reloadAll();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const markPaid = (x: Detail): ActionSpec => ({
    title: `Mark ${x.ref} as paid?`,
    confirm: `Mark paid · ${payout(x.payout_amount, x.payout_currency)}`,
    fields: [
      x.method === 'usdt_trc20'
        ? { name: 'provider_trx_id', type: 'text', label: 'Transaction hash', required: true, pattern: /^[0-9a-fA-F]{64}$/, patternMsg: 'Enter the 64-character transaction hash.' }
        : { name: 'provider_trx_id', type: 'text', label: 'TrxID', required: true, transform: (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ''), pattern: /^[A-Z0-9]{8,12}$/, patternMsg: 'Enter the TrxID: 8 to 12 letters and digits.' },
      { name: 'paid_at', type: 'datetime-local', label: 'Paid at', helper: 'Leave empty for now.' },
    ],
    extra: () => (
      <div className="space-y-2">
        <p className="text-body-sm text-fg-secondary">You sent {payout(x.payout_amount, x.payout_currency)} to {x.destination ?? x.destination_masked}.</p>
        {x.requires_second_approval ? <Alert tone="warning">A second admin has to approve this before it counts as paid.</Alert> : null}
      </div>
    ),
    submit: (v, idem) => post(`/admin/withdrawals/${x.ref}/mark-paid`, { provider_trx_id: v.provider_trx_id, paid_at: v.paid_at ? new Date(String(v.paid_at)).toISOString() : undefined }, idem),
    success: 'Marked paid. Worker notified.',
    onDone: reloadAll,
  });
  const reject = (x: { ref: string; amount_usd: string; requires_second_approval?: boolean }): ActionSpec => ({
    title: `Reject ${x.ref}?`,
    description: `${usd(x.amount_usd)} goes back to the worker's balance right away.`,
    confirm: `Reject and refund · ${usd(x.amount_usd)}`,
    variant: 'destructive',
    fields: [
      { name: 'reason_code', type: 'radio', label: 'Reason', required: true, options: Object.entries(LABELS.wdReject).map(([value, label]) => ({ value, label })), onPick: (v, set) => set('reason_text', LABELS.wdRejectText[v] ?? '') },
      { name: 'reason_text', type: 'textarea', label: 'Message', required: true, max: 300, helper: 'The worker sees this.' },
    ],
    extra: (v) => (v.reason_code === 'suspected_fraud' ? <Alert tone="warning">Consider restricting the account too, so the refunded money can&apos;t be requested again at once.</Alert> : null),
    submit: (v, idem) => post(`/admin/withdrawals/${x.ref}/reject`, { reason_code: v.reason_code, reason_text: v.reason_text }, idem),
    success: 'Withdrawal rejected and refunded.',
    onDone: reloadAll,
  });
  const markFailed = (x: Detail): ActionSpec => ({
    title: `Mark ${x.ref} as failed?`,
    description: `Use this only when the provider confirms the money didn't arrive. ${usd(x.amount_usd)} goes back to the worker's balance.`,
    confirm: `Mark failed and refund · ${usd(x.amount_usd)}`,
    variant: 'destructive',
    fields: [{ name: 'reason_text', type: 'textarea', label: 'Provider error', required: true, max: 300 }],
    submit: (v, idem) => post(`/admin/withdrawals/${x.ref}/mark-failed`, { reason_text: v.reason_text }, idem),
    success: 'Marked failed and refunded.',
    onDone: reloadAll,
  });
  const releaseHold = (x: Detail): ActionSpec => ({
    title: 'Release this hold?',
    description: `It moves to Ready to pay. Check the flags first: ${x.risk_flags.length ? x.risk_flags.join(', ') : 'none'}.`,
    confirm: 'Release hold',
    fields: [{ name: 'reason', type: 'textarea', label: 'Reason', required: true, max: 500, helper: 'Kept in the audit log. Staff only.' }],
    submit: (v) => post(`/admin/withdrawals/${x.ref}/release-hold`, { reason: v.reason }),
    success: 'Hold released.',
    onDone: reloadAll,
  });
  const approve = (ref: string, p: Pending, amount: string): ActionSpec => ({
    title: 'Approve this payout action?',
    description: `${p.requested_by} wants to ${p.action === 'withdrawal.mark_paid' ? `mark paid with TrxID ${String(p.payload.provider_trx_id)}` : `reject with reason "${String(p.payload.reason_text)}"`}. Amount: ${usd(amount)}. Check it against the provider statement.`,
    confirm: `Approve · ${usd(amount)}`,
    submit: (_v, idem) => post(`/admin/withdrawals/${ref}/approve`, {}, idem),
    success: 'Approved.',
    onDone: reloadAll,
  });
  const decline = (ref: string): ActionSpec => ({
    title: 'Decline this payout action?',
    confirm: 'Decline',
    variant: 'destructive',
    fields: [{ name: 'decision_note', type: 'textarea', label: 'Decision note', required: true, max: 500 }],
    submit: (v) => post(`/admin/withdrawals/${ref}/decline`, { decision_note: v.decision_note }),
    success: 'Declined. The maker can act again.',
    onDone: reloadAll,
  });
  const exportBatch: ActionSpec = {
    title: 'Export a payout batch?',
    description: "They all move to Processing, so workers can no longer cancel them. The file has full account numbers. It's created once, isn't stored, and the download is logged.",
    confirm: 'Export rows',
    fields: [
      { name: 'method', type: 'select', label: 'Method', required: true, options: Object.entries(LABELS.method).map(([value, label]) => ({ value, label })) },
      { name: 'max_rows', type: 'text', label: 'Maximum rows', default: '100', pattern: /^\d{1,3}$/, patternMsg: 'Enter 1 to 500.' },
      { name: 'min_amount_usd', type: 'text', label: 'Minimum amount, USD' },
      { name: 'max_amount_usd', type: 'text', label: 'Maximum amount, USD' },
    ],
    extra: (v) => <BatchCount v={v} />,
    submit: async (v, idem) => {
      const h = await download('/admin/withdrawals/batches', { method: 'POST', idem, body: { method: v.method, max_rows: Number(v.max_rows || 100), min_amount_usd: v.min_amount_usd || undefined, max_amount_usd: v.max_amount_usd || undefined } }, `payout-batch-${v.method}.csv`);
      setChecksum(h.get('x-checksum-sha256'));
      return null;
    },
    success: 'Batch exported. Rows are now processing.',
    onDone: () => { list.reload(); batches.reload(); },
  };
  const importSpec = (b: Batch): ActionSpec => ({
    title: 'Import paid results',
    description: 'CSV columns: reference,provider_trx_id,paid_at,status,reason',
    confirm: 'Import',
    fields: [{ name: 'csv', type: 'file', label: 'Results file', accept: '.csv,text/csv', required: true, helper: 'CSV only, up to 10 MB.' }],
    submit: (v) => post(`/admin/withdrawals/batches/${b.id}/import`, { csv: v.csv }),
    success: (r) => {
      const x = r as Batch['import_result'];
      return `${x?.paid ?? 0} paid, ${x?.rejected ?? 0} rejected, ${x?.pending_approval ?? 0} sent for second approval, ${x?.errors.length ?? 0} errors`;
    },
    onDone: () => batches.reload(),
  });

  return (
    <Gate perms={['withdrawals.read_masked', 'withdrawals.read']}>
      <div className="mb-5 grid gap-4 tablet:grid-cols-3 desktop:grid-cols-5">
        <Kpi label="Requested" value={counts.requested ?? 0} sub=" " />
        <Kpi label="Processing" value={counts.processing ?? 0} sub=" " />
        <Kpi label="On hold" value={counts.held ?? 0} sub=" " />
        <Kpi label="Awaiting approval" value={counts.pending_approval ?? 0} sub=" " />
        <Kpi label="Oldest waiting" value={0} display={list.meta?.oldest_requested_at ? rel(String(list.meta.oldest_requested_at)) : '—'} sub=" " />
      </div>
      <Tabs label="Withdrawal views" value={tab} panelId="wd" className="mb-4" onChange={(v) => u.set({ tab: v, ref: null, status: null })} tabs={TABS.filter((x) => (x.value === 'batches' || x.value === 'approval' ? can('withdrawals.write', 'withdrawals.approve') : true)).map((x) => ({ value: x.value, label: x.label }))} />
      {checksum ? <Alert tone="success" className="mb-4" title="Batch file saved">SHA-256 {checksum} <Copy value={checksum} /></Alert> : null}
      {tab === 'batches' ? (
        <>
          <Toolbar actions={write ? <span className="hidden laptop:inline-flex"><Button onClick={() => setSpec(exportBatch)}>Export batch</Button></span> : null} />
          <Table<Batch>
            caption="Payout batches"
            rows={batches.data}
            loading={batches.loading}
            error={batches.error}
            rowKey={(b) => b.id}
            empty={<EmptyState title="No batches yet" body="Export a batch from Ready to pay." compact />}
            cols={[
              { key: 'c', header: 'Created', cell: (b) => dt(b.created_at) },
              { key: 'm', header: 'Method', cell: (b) => LABELS.method[b.method] },
              { key: 'n', header: 'Rows', align: 'right', cell: (b) => b.count },
              { key: 't', header: 'Total', align: 'right', cell: (b) => usd(b.total_usd) },
              { key: 's', header: 'Status', cell: (b) => b.status },
              { key: 'by', header: 'Made by', cell: (b) => b.created_by },
              { key: 'h', header: 'Checksum', cell: (b) => (b.checksum ? <span className="flex items-center gap-1"><span className="adm-mono">{b.checksum.slice(0, 10)}…</span><Copy value={b.checksum} /></span> : '—') },
              { key: 'i', header: 'Imported', cell: (b) => (b.import_result ? `${dt(b.imported_at)} · ${b.import_result.paid} paid, ${b.import_result.errors.length} errors` : '—') },
              { key: 'a', header: '', align: 'right', cell: (b) => (<span className="flex justify-end gap-2"><Button size="S" variant="secondary" onClick={() => u.set({ tab: 'all', batch: b.id })}>View rows</Button>{write ? <span className="hidden laptop:inline"><Button size="S" variant="secondary" onClick={() => setSpec(importSpec(b))}>Import results</Button></span> : null}</span>) },
            ]}
          />
        </>
      ) : (
        <SplitView
          panel={
            <SidePanel
              open={!!sel && detailOk}
              onClose={() => u.set({ ref: null })}
              title={sel ?? ''}
              meta={d ? <span className="flex flex-wrap gap-1.5"><AdminBadge kind="withdrawal" code={d.status} />{d.first_withdrawal ? <span className="rounded-full bg-info-subtle px-2 text-label-sm leading-6 text-fg-info">First withdrawal</span> : null}{d.pending_approval ? <span className="rounded-full bg-warning-subtle px-2 text-label-sm leading-6 text-fg-warning">Awaiting second approval</span> : null}</span> : undefined}
              footer={
                d && write && !d.pending_approval ? (
                  <>
                    {d.status === 'requested' && d.hold_until && new Date(d.hold_until) > new Date() ? <Button variant="secondary" onClick={() => setSpec(releaseHold(d))}>Release hold</Button> : null}
                    {d.status === 'requested' && d.risk_flags.length ? <Button variant="secondary" onClick={() => setSpec(releaseHold(d))}>Acknowledge flags</Button> : null}
                    {['requested', 'processing'].includes(d.status) ? <Button variant="secondary" onClick={() => setSpec(reject(d))}>Reject</Button> : null}
                    {d.status === 'processing' ? <Button variant="secondary" onClick={() => setSpec(markFailed(d))}>Mark failed</Button> : null}
                    {d.status === 'requested' ? <Button loading={busy} onClick={() => void process(d.ref)}>Start processing</Button> : null}
                    {d.status === 'processing' ? <Button onClick={() => setSpec(markPaid(d))}>Mark paid</Button> : null}
                  </>
                ) : null
              }
            >
              {!d ? (
                <div className="h-40 animate-pulse rounded-[12px] bg-muted" />
              ) : (
                <>
                  <StatusTracker compact steps={[{ label: 'Requested', sub: dt(d.requested_at), state: 'done' }, { label: 'Processing', sub: d.processing_at ? `Started ${dt(d.processing_at)}` : undefined, state: d.processing_at ? 'done' : d.status === 'requested' ? 'current' : 'pending' }, { label: ['rejected', 'failed', 'cancelled'].includes(d.status) ? (d.status[0]!.toUpperCase() + d.status.slice(1)) : 'Paid', sub: d.paid_at ? dt(d.paid_at) : undefined, state: d.status === 'paid' ? 'done' : ['rejected', 'failed', 'cancelled'].includes(d.status) ? 'problem' : d.status === 'processing' ? 'current' : 'pending' }]} />
                  {d.pending_approval ? <PendingCard p={d.pending_approval} canApprove={can('withdrawals.approve')} onApprove={() => setSpec(approve(d.ref, d.pending_approval!, d.amount_usd))} onDecline={() => setSpec(decline(d.ref))} /> : null}
                  <KV items={[['User', <RefLink key="u" href={`/users/${d.user.public_id}`}>{d.user.public_id}</RefLink>], ['KYC name', d.user.kyc_name], ['KYC', <AdminBadge key="k" kind="kyc" code={d.user.kyc_status} />], ['Approval rate', d.user.approval_rate_pct === null ? '—' : `${d.user.approval_rate_pct}%`], ['Account since', dt(d.user.account_created_at)], ['First withdrawal', d.first_withdrawal ? 'Yes' : 'No']]} />
                  <section className="rounded-[12px] border border-line bg-subtle p-4">
                    <p className="text-body-xs text-fg-tertiary">{LABELS.method[d.method]} · {d.method === 'usdt_trc20' ? 'Address' : 'Account'}</p>
                    <p className="mt-0.5 flex items-center gap-1 font-display text-num-sm text-fg">
                      <span className="adm-mono break-all text-[15px]">{d.destination ?? d.destination_masked}</span>
                      {d.destination ? <Copy value={d.destination} label="Copy account" /> : null}
                    </p>
                    {d.destination_unavailable ? <p className="text-body-xs text-fg-warning">Full account unavailable (stored value can&apos;t be decrypted).</p> : null}
                    <p className="mt-3 text-body-xs text-fg-tertiary">Send exactly</p>
                    <p className="font-display text-num-lg text-fg">{payout(d.payout_amount, d.payout_currency)}</p>
                    <p className="text-body-xs text-fg-secondary">1 USD = {d.payout_currency === 'BDT' ? `৳${d.fx_rate}` : `${d.fx_rate} USDT`}, locked at request · Net {usd(d.net_usd)} (fee {usd(d.fee_usd)})</p>
                  </section>
                  {d.risk_flags.length ? (
                    <Alert tone="warning" title="Risk flags">
                      <ul className="list-disc pl-4">{d.risk_flags.map((f) => <li key={f}>{f}: {LABELS.risk[f] ?? f}</li>)}</ul>
                      {d.hold_until ? <p className="mt-1">On hold until {dt(d.hold_until)}.</p> : null}
                    </Alert>
                  ) : d.hold_until && new Date(d.hold_until) > new Date() ? <Alert tone="info">On hold until {dt(d.hold_until)}.</Alert> : null}
                  {d.reject_reason_text ? <Alert tone="danger" title="Reason given to the worker">{d.reject_reason_text}</Alert> : null}
                  <KV items={[['Request', <RefLink key="a" href={`/ledger?ref=${d.request_ledger_ref}`}>{d.request_ledger_ref}</RefLink>], ['Settlement', d.settle_ledger_ref ? <RefLink key="b" href={`/ledger?ref=${d.settle_ledger_ref}`}>{d.settle_ledger_ref}</RefLink> : '—'], ['Reversal', d.reversal_ledger_ref ? <RefLink key="c" href={`/ledger?ref=${d.reversal_ledger_ref}`}>{d.reversal_ledger_ref}</RefLink> : '—'], ['TrxID', d.provider_trx_id ?? '—']]} />
                  <Table caption="Events" rows={d.events} rowKey={(e) => `${e.occurred_at}${e.to_status}${e.note}`} cols={[{ key: 'w', header: 'When', cell: (e) => dt(e.occurred_at) }, { key: 's', header: 'Status', cell: (e) => `${e.from_status ?? '—'} → ${e.to_status}` }, { key: 'b', header: 'By', cell: (e) => e.actor ?? e.actor_type }, { key: 'n', header: 'Note', cell: (e) => e.note ?? '—' }]} />
                </>
              )}
            </SidePanel>
          }
        >
          <Toolbar actions={write && tab === 'ready' ? <span className="hidden laptop:inline-flex"><Button onClick={() => setSpec(exportBatch)}>Export batch</Button></span> : null}>
            <FilterSelect label="Method" value={u.get('method')} onChange={(v) => u.set({ method: v })} options={[{ value: '', label: 'Any method' }, ...Object.entries(LABELS.method).map(([value, label]) => ({ value, label }))]} />
            {tab === 'all' ? <FilterSelect label="Status" value={u.get('status')} onChange={(v) => u.set({ status: v })} options={[{ value: '', label: 'Any status' }, ...['requested', 'processing', 'paid', 'rejected', 'cancelled', 'failed'].map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))]} /> : null}
            {u.get('batch') ? <Button size="S" variant="secondary" trailingIcon="x" onClick={() => u.set({ batch: null })}>Batch filter</Button> : null}
          </Toolbar>
          <Table<Row>
            caption="Withdrawals"
            rows={list.data}
            loading={list.loading}
            error={list.error}
            onRetry={list.hardReload}
            rowKey={(r) => r.ref}
            selectedKey={sel}
            onRowClick={detailOk ? (r) => u.set({ ref: r.ref }, false) : undefined}
            empty={tab === 'ready' ? <EmptyState icon="check-circle" title="Nothing is ready to pay" body="New requests appear here once any hold ends." compact /> : <EmptyState title="Nothing here" compact />}
            cols={[
              { key: 'r', header: 'Reference', cell: (r) => <span className="font-medium text-fg-brand">{r.ref}</span> },
              { key: 'u', header: 'User', cell: (r) => <RefLink href={`/users/${r.user_public_id}`}>{r.name_masked} · {r.user_public_id}</RefLink> },
              { key: 'k', header: 'KYC', cell: (r) => <AdminBadge kind="kyc" code={r.kyc_status} />, hideBelow: 'desktop' },
              { key: 'm', header: 'Method', cell: (r) => LABELS.method[r.method] },
              { key: 'd', header: 'Destination', cell: (r) => <span className="adm-mono">{r.destination_masked}</span>, hideBelow: 'laptop' },
              { key: 'a', header: 'Amount', align: 'right', cell: (r) => usd(r.amount_usd) },
              { key: 'f', header: 'Fee', align: 'right', cell: (r) => usd(r.fee_usd), hideBelow: 'desktop' },
              { key: 'p', header: 'Pay out', align: 'right', cell: (r) => <Tooltip content={`1 USD = ${r.payout_currency === 'BDT' ? '৳' : ''}${r.fx_rate}${r.payout_currency === 'BDT' ? '' : ' USDT'}, locked at request`}><span tabIndex={0}>{payout(r.payout_amount, r.payout_currency)}</span></Tooltip> },
              { key: 's', header: 'Status', cell: (r) => (<span className="flex flex-wrap gap-1"><AdminBadge kind="withdrawal" code={r.status} />{r.pending_approval ? <span className="rounded-full bg-warning-subtle px-2 text-label-sm leading-6 text-fg-warning">Awaiting second approval</span> : null}{r.first_withdrawal && r.status !== 'paid' ? <span className="rounded-full bg-info-subtle px-2 text-label-sm leading-6 text-fg-info">First withdrawal</span> : null}</span>) },
              { key: 'risk', header: 'Risk', cell: (r) => (r.risk_flags.length ? <Tooltip content={r.risk_flags.map((f) => LABELS.risk[f] ?? f).join('; ')}><span tabIndex={0} className="rounded-full bg-danger-subtle px-2 text-label-sm text-fg-danger">{r.risk_flags.length}</span></Tooltip> : '—'), hideBelow: 'desktop' },
              { key: 'h', header: 'Hold ends', cell: (r) => dt(r.hold_until), hideBelow: 'desktop' },
              { key: 'q', header: 'Requested', cell: (r) => <span className={Date.now() - new Date(r.requested_at).getTime() > 86_400_000 && r.status === 'requested' ? 'text-fg-warning' : ''}>{dt(r.requested_at)}</span> },
            ]}
          />
          <Pager meta={list.meta} onPage={(p) => u.set({ page: String(p) }, false)} />
        </SplitView>
      )}
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </Gate>
  );
}

function BatchCount({ v }: { v: Record<string, unknown> }) {
  const [n, setN] = useState<{ count: number; total_usd: string } | null>(null);
  useEffect(() => {
    if (!v.method) return;
    const t = setTimeout(() => {
      api<{ count: number; total_usd: string }>('/admin/withdrawals/batches/preview', { query: { method: String(v.method), max_rows: String(v.max_rows || 100), min_amount_usd: String(v.min_amount_usd || ''), max_amount_usd: String(v.max_amount_usd || '') } })
        .then((r) => setN(r.data))
        .catch(() => setN(null));
    }, 250);
    return () => clearTimeout(t);
  }, [v.method, v.max_rows, v.min_amount_usd, v.max_amount_usd]);
  if (!v.method) return null;
  return <p className="text-label-md text-fg">{n ? `${n.count} withdrawals · ${usd(n.total_usd)} total` : 'Counting…'}</p>;
}

export default function Page() {
  return (
    <Suspense>
      <Withdrawals />
    </Suspense>
  );
}
