'use client';
import { Suspense, useState } from 'react';
import { Alert, Button, EmptyState, Search, Tabs } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, FilterSelect, Gate, KV, Pager, post, RefLink, SidePanel, SplitView, Table, Toolbar, Truncate, type ActionSpec } from '@/components/kit';
import { AdminBadge, LABELS } from '@/components/badges';
import { Kpi } from '@/components/charts';
import { useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dt, exact } from '@/lib/fmt';
import { adjustSpec } from '../users/user-actions';

interface Entry { account_kind: string; system_code: string | null; owner_public_id: string | null; amount_exact: string; balance_after_exact: string | null; display_type: string }
interface Tx { ref: string; type: string; occurred_at: string; job_public_id: string | null; submission_ref: string | null; created_by_actor: string; entries: Entry[] }
interface TxDetail extends Omit<Tx, 'job_public_id' | 'submission_ref'> { idempotency_key: string; description_params: Record<string, unknown>; reason: string | null; reason_code: string | null; reverses_ref: string | null; created_by_admin: string | null; links: Record<string, string | null> }
interface Adj { id: string; account_kind: string; owner_public_id: string | null; amount_exact: string; current_balance_exact: string; balance_after_exact: string; reason_code: string; internal_note: string; visible_text: string; status: string; created_by: string; created_by_me: boolean; decided_by: string | null; ledger_ref: string | null; created_at: string; expires_at: string; approver_must_be_super_admin: boolean }
interface Run { id: string; job_name: string; status: string; started_at: string; finished_at: string | null; item_count: number; summary: Record<string, unknown> }
interface Item { id: string; check_code: string; severity: string; entity_type: string | null; entity_ref: string | null; detail: Record<string, unknown>; created_at: string; resolved_at: string | null; resolved_by: string | null }

const acct = (e: Entry) => e.system_code ?? `${e.account_kind}${e.owner_public_id ? ` · ${e.owner_public_id}` : ''}`;
const entityHref = (t: string | null, r: string | null) => (!r ? null : r.startsWith('WD-') ? `/withdrawals?ref=${r}&tab=all` : r.startsWith('DP-') ? `/deposits?ref=${r}` : r.startsWith('TX-') ? `/ledger?ref=${r}` : null);

/** SCR-ADM-13 Ledger (Doc 09 §6). Read-only; corrections are adjustments. */
function Ledger() {
  usePageHeader('Ledger', 'Every money movement. Nothing here is ever edited.');
  const { can, isSuper, tick } = useSession();
  const u = useUrlState();
  const full = can('ledger.read');
  const tab = u.get('tab', 'transactions');
  const sel = u.get('ref');
  const [q, setQ] = useState('');
  const aggregate = !full;
  const tx = useApi<Tx[]>(tab === 'transactions' && !aggregate ? '/admin/ledger' : null, { q: q || undefined, user: u.get('user'), type: u.get('type'), page: u.get('page', '1'), t: tick });
  const agg = useApi<{ day: string; type: string; count: number; total_exact: string }[]>(tab === 'transactions' && aggregate ? '/admin/ledger' : null, { aggregate: '1' });
  const det = useApi<TxDetail>(sel && full ? `/admin/ledger/${sel}` : null);
  const view = u.get('view', 'needs_me');
  const adj = useApi<Adj[]>(tab === 'adjustments' ? '/admin/ledger/adjustments' : null, { view: view === 'all' ? undefined : view, status: view === 'all' ? 'all' : undefined, t: tick });
  const runs = useApi<Run[]>(tab === 'reconciliation' ? '/admin/reconciliation/runs' : null, { t: tick });
  const items = useApi<Item[]>(tab === 'reconciliation' ? '/admin/reconciliation/items' : null, { severity: u.get('severity'), resolved: u.get('resolved') || 'false', t: tick });
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const tabs = [{ value: 'transactions', label: 'Transactions' }, ...(can('ledger.adjust', 'ledger.approve') ? [{ value: 'adjustments', label: 'Adjustments', count: (adj.meta?.counts as Record<string, number> | undefined)?.pending_approval }] : []), ...(can('recon.read') ? [{ value: 'reconciliation', label: 'Reconciliation' }] : [])];
  const approve = (a: Adj): ActionSpec => ({ title: 'Approve this adjustment?', description: `${exact(a.amount_exact)} to ${a.owner_public_id}'s ${LABELS.account[a.account_kind]}. New balance: ${a.balance_after_exact}. They'll see "${a.visible_text}".`, confirm: `Approve and post · ${exact(a.amount_exact)}`, fields: [{ name: 'decision_note', type: 'textarea', label: 'Decision note', max: 500 }], submit: (v, idem) => post(`/admin/ledger/adjustments/${a.id}/approve`, { decision_note: v.decision_note || undefined }, idem), success: 'Adjustment posted.', onDone: adj.reload });
  const decline = (a: Adj): ActionSpec => ({ title: 'Decline this adjustment?', confirm: 'Decline', variant: 'destructive', fields: [{ name: 'decision_note', type: 'textarea', label: 'Decision note', required: true, max: 500 }], submit: (v) => post(`/admin/ledger/adjustments/${a.id}/decline`, { decision_note: v.decision_note }), success: 'Adjustment declined.', onDone: adj.reload });
  const resolve = (i: Item): ActionSpec => ({ title: 'Resolve this item?', confirm: 'Resolve item', fields: [{ name: 'resolution_note', type: 'textarea', label: 'Resolution note', required: true, max: 500, helper: 'The ledger is never edited here. Real money errors need an adjustment.' }], submit: (v) => post(`/admin/reconciliation/items/${i.id}/resolve`, { resolution_note: v.resolution_note }), success: 'Item resolved.', onDone: items.reload });
  const importSpec = (kind: 'statements' | 'settlements'): ActionSpec => ({
    title: kind === 'statements' ? 'Import statement' : 'Import settlement file',
    description: kind === 'statements' ? 'CSV columns: provider_trx_id,direction,amount,currency,occurred_at,counterparty. Payouts are matched by TrxID.' : 'CSV columns: provider_payment_id,gross_amount,fee_amount,currency,settled_on. Deposits are matched by provider ID.',
    confirm: 'Import',
    fields: [
      kind === 'statements'
        ? { name: 'rail', type: 'select', label: 'Account', required: true, options: ['treasury:bkash_merchant', 'treasury:nagad_merchant', 'treasury:rocket_merchant', 'treasury:usdt_hot_wallet', 'treasury:bank_main'].map((v) => ({ value: v, label: v })) }
        : { name: 'provider', type: 'select', label: 'Provider', required: true, options: ['bkash', 'nowpayments', 'sslcommerz', 'mock'].map((v) => ({ value: v, label: v })) },
      { name: 'csv', type: 'file', label: 'File', accept: '.csv,text/csv', required: true },
    ],
    submit: (v) => post(`/admin/reconciliation/${kind}`, kind === 'statements' ? { rail: v.rail, csv: v.csv } : { provider: v.provider, csv: v.csv }),
    success: (r) => `${(r as { lines: number }).lines} lines imported, ${(r as { unmatched: number }).unmatched} unmatched.`,
    onDone: () => { runs.reload(); items.reload(); },
  });
  const counts = (items.meta?.counts ?? {}) as Record<string, number>;
  return (
    <Gate perms={['ledger.read', 'ledger.read_aggregate']}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs label="Ledger views" value={tab} panelId="led" onChange={(v) => u.set({ tab: v === 'transactions' ? null : v, ref: null })} tabs={tabs} />
        {can('ledger.adjust') ? <span className="hidden laptop:inline-flex"><Button onClick={() => setSpec(adjustSpec({}, adj.reload))}>New adjustment</Button></span> : null}
      </div>
      {tab === 'transactions' && aggregate ? (
        <Table caption="Ledger aggregates" rows={agg.data} loading={agg.loading} error={agg.error} rowKey={(r) => `${r.day}${r.type}`} empty={<EmptyState title="No transactions found." compact />} cols={[{ key: 'd', header: 'Day', cell: (r) => r.day }, { key: 't', header: 'Type', cell: (r) => LABELS.ledgerType[r.type] ?? r.type }, { key: 'n', header: 'Count', align: 'right', cell: (r) => r.count }, { key: 's', header: 'Total', align: 'right', cell: (r) => <span className="adm-mono">{r.total_exact}</span> }]} />
      ) : null}
      {tab === 'transactions' && !aggregate ? (
        <SplitView
          panel={
            <SidePanel open={!!sel} wide={false} onClose={() => u.set({ ref: null })} title={sel ?? ''} meta={det.data ? `${LABELS.ledgerType[det.data.type] ?? det.data.type} · ${dt(det.data.occurred_at)}` : undefined}>
              {det.error?.code === 'NOT_FOUND' ? <p className="text-body-sm text-fg-tertiary">We can&apos;t find {sel}.</p> : !det.data ? <div className="h-32 animate-pulse rounded-[12px] bg-muted" /> : (
                <>
                  <ul className="space-y-1.5">
                    {det.data.entries.map((e, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-3 text-body-sm">
                        <span className="min-w-0"><span className="text-fg">{acct(e)}</span><span className="block text-body-xs text-fg-tertiary">{e.display_type}{e.balance_after_exact ? ` · after ${e.balance_after_exact}` : ''}</span></span>
                        <span className={`adm-mono ${e.amount_exact.startsWith('-') ? 'text-fg' : 'text-fg-success'}`}>{exact(e.amount_exact)}</span>
                      </li>
                    ))}
                  </ul>
                  <KV cols={1} items={[['Idempotency key', <span key="k" className="adm-mono break-all">{det.data.idempotency_key}</span>], ['Description', <span key="d" className="adm-mono break-all">{JSON.stringify(det.data.description_params)}</span>], ['Reason', det.data.reason ?? '—'], ['Reverses', det.data.reverses_ref ?? '—'], ['Actor', `${det.data.created_by_actor}${det.data.created_by_admin ? ` · ${det.data.created_by_admin}` : ''}`], ...Object.entries(det.data.links).filter(([, v]) => v).map(([k, v]) => [k, v] as [string, string])]} />
                  <Alert tone="info">This entry can&apos;t be changed. To correct it, post an adjustment.</Alert>
                </>
              )}
            </SidePanel>
          }
        >
          <Toolbar>
            <div className="w-full max-w-[260px]"><Search value={q} onValueChange={setQ} label="Find transaction" placeholder="TX- reference" size="M" /></div>
            <FilterSelect label="Type" value={u.get('type')} onChange={(v) => u.set({ type: v })} options={[{ value: '', label: 'Any type' }, ...Object.entries(LABELS.ledgerType).map(([value, label]) => ({ value, label }))]} />
            {u.get('user') ? <Button size="S" variant="secondary" trailingIcon="x" onClick={() => u.set({ user: null })}>User {u.get('user')}</Button> : null}
          </Toolbar>
          <Table<Tx>
            caption="Transactions"
            rows={tx.data}
            loading={tx.loading}
            error={tx.error}
            onRetry={tx.hardReload}
            rowKey={(r) => r.ref}
            selectedKey={sel}
            onRowClick={(r) => u.set({ ref: r.ref }, false)}
            empty={<EmptyState title="No transactions found." compact />}
            cols={[
              { key: 'r', header: 'Reference', cell: (r) => <span className="font-medium text-fg-brand">{r.ref}</span> },
              { key: 't', header: 'Type', cell: (r) => LABELS.ledgerType[r.type] ?? r.type },
              { key: 'w', header: 'When', cell: (r) => dt(r.occurred_at) },
              { key: 'j', header: 'Job or submission', cell: (r) => (r.submission_ref ? <RefLink href={`/submissions?ref=${r.submission_ref}`}>{r.submission_ref}</RefLink> : r.job_public_id ? <RefLink href={`/jobs/${r.job_public_id}`}>{r.job_public_id}</RefLink> : '—'), hideBelow: 'desktop' },
              { key: 'e', header: 'Entries', cell: (r) => <ul className="space-y-0.5">{r.entries.map((e, i) => <li key={i} className="flex justify-between gap-4 text-body-xs"><span className="text-fg-secondary">{acct(e)}</span><span className={`adm-mono ${e.amount_exact.startsWith('-') ? '' : 'text-fg-success'}`}>{exact(e.amount_exact)}</span></li>)}</ul> },
              { key: 'a', header: 'Actor', cell: (r) => r.created_by_actor, hideBelow: 'laptop' },
            ]}
          />
          <Pager meta={tx.meta} onPage={(p) => u.set({ page: String(p) }, false)} />
        </SplitView>
      ) : null}
      {tab === 'adjustments' ? (
        <>
          <Tabs label="Adjustment views" value={view} panelId="adj" className="mb-3" onChange={(v) => u.set({ view: v })} tabs={[{ value: 'needs_me', label: 'Needs my approval' }, { value: 'mine', label: 'Waiting on another admin' }, { value: 'all', label: 'All' }]} />
          <Table<Adj>
            caption="Adjustments"
            rows={adj.data}
            loading={adj.loading}
            error={adj.error}
            rowKey={(a) => a.id}
            empty={<EmptyState title="No adjustments waiting" body="Proposed adjustments wait here for a second admin." compact />}
            cols={[
              { key: 'c', header: 'Created', cell: (a) => dt(a.created_at) },
              { key: 'o', header: 'Owner', cell: (a) => (a.owner_public_id ? <RefLink href={`/users/${a.owner_public_id}`}>{a.owner_public_id}</RefLink> : '—') },
              { key: 'k', header: 'Account', cell: (a) => LABELS.account[a.account_kind] ?? a.account_kind },
              { key: 'a', header: 'Amount', align: 'right', cell: (a) => <span className="adm-mono">{exact(a.amount_exact)}</span> },
              { key: 'r', header: 'Reason', cell: (a) => LABELS.adjReason[a.reason_code] ?? a.reason_code },
              { key: 'n', header: 'Note', cell: (a) => <Truncate text={a.internal_note} max={40} />, hideBelow: 'desktop' },
              { key: 's', header: 'Status', cell: (a) => <AdminBadge kind="adjustment" code={a.status} /> },
              { key: 'm', header: 'Made by', cell: (a) => a.created_by },
              { key: 'e', header: 'Expires', cell: (a) => dt(a.expires_at), hideBelow: 'desktop' },
              {
                key: 'x',
                header: '',
                align: 'right',
                cell: (a) =>
                  a.status === 'pending_approval' && !a.created_by_me && can('ledger.approve') ? (
                    a.approver_must_be_super_admin && !isSuper ? <span className="text-body-xs text-fg-tertiary">Only a super admin can approve this.</span> : (
                      <span className="hidden justify-end gap-2 laptop:flex"><Button size="S" variant="secondary" onClick={() => setSpec(decline(a))}>Decline</Button><Button size="S" onClick={() => setSpec(approve(a))}>Approve</Button></span>
                    )
                  ) : null,
              },
            ]}
          />
        </>
      ) : null}
      {tab === 'reconciliation' ? (
        <div className="space-y-5">
          <div className="grid gap-4 tablet:grid-cols-4">
            <Kpi label="Critical open" value={counts.critical ?? 0} tone={counts.critical ? 'danger' : undefined} sub=" " />
            <Kpi label="High open" value={counts.high ?? 0} sub=" " />
            <Kpi label="Medium open" value={counts.medium ?? 0} sub=" " />
            <Kpi label="Info open" value={counts.info ?? 0} sub=" " />
          </div>
          {can('recon.write') ? (
            <div className="hidden justify-end gap-2 laptop:flex">
              <Button variant="secondary" onClick={() => setSpec(importSpec('settlements'))}>Import settlement file</Button>
              <Button variant="secondary" onClick={() => setSpec(importSpec('statements'))}>Import statement</Button>
            </div>
          ) : null}
          <Table caption="Reconciliation runs" rows={runs.data} loading={runs.loading} rowKey={(r) => r.id} empty={<EmptyState title="No runs yet" compact />} cols={[{ key: 'j', header: 'Job', cell: (r) => <span className="adm-mono">{r.job_name}</span> }, { key: 's', header: 'Status', cell: (r) => <AdminBadge kind="run" code={r.status} /> }, { key: 'a', header: 'Started', cell: (r) => dt(r.started_at) }, { key: 'f', header: 'Finished', cell: (r) => dt(r.finished_at) }, { key: 'n', header: 'Items', align: 'right', cell: (r) => r.item_count }, { key: 'y', header: 'Summary', cell: (r) => <span className="adm-mono">{JSON.stringify(r.summary)}</span> }]} />
          <Toolbar>
            <FilterSelect label="Severity" value={u.get('severity')} onChange={(v) => u.set({ severity: v })} options={[{ value: '', label: 'Any severity' }, { value: 'critical', label: 'Critical' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'info', label: 'Info' }]} />
            <FilterSelect label="Resolved" value={u.get('resolved')} onChange={(v) => u.set({ resolved: v })} options={[{ value: '', label: 'Open' }, { value: 'true', label: 'Resolved' }]} />
          </Toolbar>
          <Table<Item>
            caption="Reconciliation items"
            rows={items.data}
            loading={items.loading}
            rowKey={(i) => i.id}
            empty={<EmptyState icon="check-circle" title="All checks passed" body={runs.data?.[0] ? `Last run ${dt(runs.data[0].finished_at ?? runs.data[0].started_at)}.` : undefined} compact />}
            cols={[
              { key: 'c', header: 'Check', cell: (i) => <span className="adm-mono">{i.check_code}</span> },
              { key: 's', header: 'Severity', cell: (i) => <AdminBadge kind="severity" code={i.severity} /> },
              { key: 'e', header: 'Entity', cell: (i) => { const h = entityHref(i.entity_type, i.entity_ref); return h ? <RefLink href={h}>{i.entity_ref}</RefLink> : (i.entity_ref ?? '—'); } },
              { key: 'd', header: 'Detail', cell: (i) => <Truncate text={JSON.stringify(i.detail)} max={60} /> },
              { key: 'at', header: 'Created', cell: (i) => dt(i.created_at) },
              { key: 'r', header: 'Resolved', cell: (i) => (i.resolved_at ? `${dt(i.resolved_at)} · ${i.resolved_by ?? ''}` : can('recon.write') ? <span className="hidden laptop:inline"><Button size="S" variant="secondary" onClick={() => setSpec(resolve(i))}>Resolve</Button></span> : '—') },
            ]}
          />
        </div>
      ) : null}
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </Gate>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Ledger />
    </Suspense>
  );
}
