'use client';
import { Suspense, useState } from 'react';
import { Alert, Button, EmptyState, Icon, Search, Skeleton, Tabs, cn } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, Copy, FilterSelect, Gate, KV, Pager, post, RefLink, Section, SidePanel, SplitView, Table, Toolbar, Truncate, type ActionSpec } from '@/components/kit';
import { AdminBadge, LABELS, LEDGER_KIND, accountName } from '@/components/badges';
import { Kpi, useStagger } from '@/components/charts';
import { useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { d, dt, humanize } from '@/lib/fmt';
import { adjustSpec } from '../users/user-actions';

interface Entry { account_kind: string; system_code: string | null; owner_public_id: string | null; amount_exact: string; balance_after_exact: string | null; display_type: string }
interface Tx { ref: string; type: string; occurred_at: string; job_public_id: string | null; submission_ref: string | null; created_by_actor: string; entries: Entry[] }
interface TxDetail extends Omit<Tx, 'job_public_id' | 'submission_ref'> { idempotency_key: string; description_params: Record<string, unknown>; reason: string | null; reason_code: string | null; reverses_ref: string | null; created_by_admin: string | null; approved_by_admin: string | null; links: Record<string, string | null> }
interface Adj { id: string; account_kind: string; owner_public_id: string | null; amount_exact: string; current_balance_exact: string; balance_after_exact: string; reason_code: string; internal_note: string; visible_text: string; status: string; created_by: string; created_by_me: boolean; decided_by: string | null; ledger_ref: string | null; created_at: string; expires_at: string; approver_must_be_super_admin: boolean }
interface Run { id: string; job_name: string; status: string; started_at: string; finished_at: string | null; item_count: number; summary: Record<string, unknown> }
interface Item { id: string; check_code: string; severity: string; entity_type: string | null; entity_ref: string | null; detail: Record<string, unknown>; created_at: string; resolved_at: string | null; resolved_by: string | null }

/** Ledger amounts are exact (6 dp). Show them as money with only the decimals that matter: $12.50, $0.003. */
function money(v: string, signed = false) {
  const neg = v.startsWith('-');
  const [i = '0', f = ''] = v.replace(/^[-+]/, '').split('.');
  const frac = f.replace(/0+$/, '').padEnd(2, '0');
  const body = `$${Number(i).toLocaleString('en-US')}.${frac}`;
  return neg ? `−${body}` : signed ? `+${body}` : body;
}
const sumPositive = (entries: Entry[]) => entries.reduce((a, e) => (e.amount_exact.startsWith('-') ? a : a + Number(e.amount_exact)), 0).toFixed(6);
const ACTOR: Record<string, string> = { system: 'System', admin: 'Admin', user: 'User' };
const LINK_HREF: Record<string, (r: string) => string> = {
  job: (r) => `/jobs/${r}`,
  submission: (r) => `/submissions?ref=${r}`,
  deposit: (r) => `/deposits?ref=${r}`,
  withdrawal: (r) => `/withdrawals?ref=${r}&tab=all`,
  dispute: (r) => `/disputes?ref=${r}`,
};
const entityHref = (r: string | null) => (!r ? null : r.startsWith('WD-') ? LINK_HREF.withdrawal!(r) : r.startsWith('DP-') ? LINK_HREF.deposit!(r) : r.startsWith('TX-') ? `/ledger?ref=${r}` : null);
const RANGES = [{ value: '', label: 'Any time' }, { value: 'today', label: 'Today' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }];
const RANGE_DAYS: Record<string, number> = { today: 1, '7': 7, '30': 30, '90': 90 };
const dhakaDate = (daysAgo: number) => new Date(Date.now() + 6 * 3_600_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);

/** Reconciliation jobs and checks, named for people. */
const JOB: Record<string, string> = { 'recon.ledger_integrity': 'Ledger integrity', 'recon.payouts': 'Statement import (withdrawals)', 'recon.settlement': 'Settlement import (deposits)' };
const jobName = (j: string) => JOB[j] ?? humanize(j.replace(/^recon\./, ''));
const CHECK: Record<string, string> = { P2: 'Statement line with no paid withdrawal', C4: 'Settlement line with no deposit', 'P-1': 'Payout not on a statement yet' };
const detailText = (detail: Record<string, unknown>) =>
  typeof detail.note === 'string'
    ? humanize(detail.note)
    : Object.entries(detail).map(([k, v]) => `${humanize(k)}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ') || '—';
const summaryText = (s: Record<string, unknown>) =>
  Object.entries(s ?? {}).map(([k, v]) => `${typeof v === 'number' ? v.toLocaleString('en-US') : String(v)} ${k.replace(/_/g, ' ')}`).join(' · ') || '—';

/** The posting's description fields, as finance reads them. Keys not listed are shown humanised. */
const METHOD: Record<string, string> = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', usdt_trc20: 'USDT (TRC20)', mobile_wallet: 'Mobile wallet', crypto: 'Crypto', card: 'Card' };
const PARAM: Record<string, { label: string; fmt?: (v: unknown) => string }> = {
  visible_text: { label: 'Shown to the user' },
  reason: { label: 'Cause', fmt: (v) => humanize(String(v)) },
  cause: { label: 'Cause', fmt: (v) => humanize(String(v)) },
  method: { label: 'Method', fmt: (v) => METHOD[String(v)] ?? humanize(String(v)) },
  masked: { label: 'Account' },
  fee: { label: 'Fee', fmt: (v) => money(String(v)) },
  manual: { label: 'Manual deposit', fmt: (v) => (v === true ? 'Yes' : 'No') },
  friend: { label: 'Referred friend' },
  source: { label: 'Source', fmt: (v) => humanize(String(v)) },
  receivable: { label: 'Owed back', fmt: (v) => (v === true ? 'Yes' : 'No') },
  display_status: { label: 'Status shown' },
  phase: { label: 'Stage', fmt: (v) => humanize(String(v)) },
};
const HIDDEN_PARAMS = new Set(['reason_code']);
const paramRow = ([k, v]: [string, unknown]): [string, React.ReactNode] => {
  const p = PARAM[k];
  const text = p?.fmt ? p.fmt(v) : typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
  return [p?.label ?? humanize(k), text];
};

/** "Worker earnings" with its owner's ID underneath, or a system account on one line. */
function AccountCell({ e, compact = false }: { e: Entry; compact?: boolean }) {
  return (
    <span className="min-w-0">
      <span className={cn('block truncate', compact ? 'text-body-xs text-fg-secondary' : 'text-body-sm text-fg')}>{accountName(e.account_kind, e.system_code)}</span>
      {e.owner_public_id && !compact ? <span className="block text-body-xs text-fg-tertiary">{e.owner_public_id}</span> : null}
    </span>
  );
}

/** Where the money came from and went to: debits → credits. */
function Flow({ entries }: { entries: Entry[] }) {
  const out = entries.filter((e) => e.amount_exact.startsWith('-'));
  const into = entries.filter((e) => !e.amount_exact.startsWith('-'));
  const name = (list: Entry[]) => (list[0] ? `${accountName(list[0].account_kind, list[0].system_code)}${list[0].owner_public_id ? ` (${list[0].owner_public_id})` : ''}` : '—');
  const more = (list: Entry[]) => (list.length > 1 ? <span className="text-fg-tertiary"> +{list.length - 1}</span> : null);
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-body-sm">
      <span className="min-w-0 truncate text-fg-secondary">{name(out)}{more(out)}</span>
      <Icon name="arrow-right" size={14} className="shrink-0 text-fg-tertiary" />
      <span className="min-w-0 truncate text-fg">{name(into)}{more(into)}</span>
    </span>
  );
}

/** The posting, as debits and credits that must sum to zero. */
function Entries({ entries }: { entries: Entry[] }) {
  const debit = entries.reduce((a, e) => (e.amount_exact.startsWith('-') ? a + Number(e.amount_exact) : a), 0);
  const credit = entries.reduce((a, e) => (e.amount_exact.startsWith('-') ? a : a + Number(e.amount_exact)), 0);
  const balanced = Math.abs(debit + credit) < 1e-9;
  return (
    <table className="w-full text-body-sm">
      <caption className="sr-only">Entries</caption>
      <thead>
        <tr className="text-left text-overline uppercase text-fg-tertiary">
          <th className="pb-2 font-normal">Account</th>
          <th className="pb-2 text-right font-normal">Debit</th>
          <th className="pb-2 text-right font-normal">Credit</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line-subtle">
        {entries.map((e, i) => {
          const neg = e.amount_exact.startsWith('-');
          return (
            <tr key={i} className="align-top">
              <td className="py-2 pr-3">
                <AccountCell e={e} />
                <span className="block text-body-xs text-fg-tertiary">
                  {[e.display_type ? humanize(e.display_type) : null, e.balance_after_exact ? `balance after ${money(e.balance_after_exact)}` : null].filter(Boolean).join(' · ')}
                </span>
              </td>
              <td className="adm-mono py-2 text-right tabular-nums text-fg">{neg ? money(e.amount_exact.slice(1)) : ''}</td>
              <td className="adm-mono py-2 text-right tabular-nums text-fg-success">{neg ? '' : money(e.amount_exact)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t border-line">
          <td className="pt-2 text-label-md text-fg">
            <span className={cn('inline-flex items-center gap-1', balanced ? 'text-fg-success' : 'text-fg-danger')}>
              <Icon name={balanced ? 'check-circle' : 'alert-triangle'} size={14} />
              {balanced ? 'Balanced' : 'Not balanced'}
            </span>
          </td>
          <td className="adm-mono pt-2 text-right tabular-nums text-fg">{money(Math.abs(debit).toFixed(6))}</td>
          <td className="adm-mono pt-2 text-right tabular-nums text-fg">{money(credit.toFixed(6))}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function TxPanel({ sel, onClose }: { sel: string | null; onClose: () => void }) {
  const det = useApi<TxDetail>(sel ? `/admin/ledger/${sel}` : null);
  const t = det.data;
  const links = t ? Object.entries(t.links).filter(([, v]) => v) : [];
  const params = t ? Object.entries(t.description_params ?? {}).filter(([k, v]) => v !== null && v !== '' && !HIDDEN_PARAMS.has(k)) : [];
  return (
    <SidePanel open={!!sel} wide={false} onClose={onClose} title={sel ?? ''} meta={t ? `${LABELS.ledgerType[t.type] ?? humanize(t.type)} · ${dt(t.occurred_at)}` : undefined}>
      {det.error?.code === 'NOT_FOUND' ? (
        <p className="text-body-sm text-fg-tertiary">We can&apos;t find {sel}.</p>
      ) : !t ? (
        <div className="h-32 animate-pulse rounded-[12px] bg-muted" />
      ) : (
        <div className="space-y-5">
          <div>
            <p className="text-body-sm text-fg-secondary">Amount moved</p>
            <p className="font-display text-num-lg tabular-nums text-fg">{money(sumPositive(t.entries))}</p>
          </div>
          <Entries entries={t.entries} />
          {links.length ? (
            <div>
              <h3 className="mb-1.5 text-overline uppercase text-fg-tertiary">Linked to</h3>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {links.map(([k, v]) => (
                  <li key={k} className="text-body-sm">
                    <span className="text-fg-tertiary">{humanize(k)} </span>
                    <RefLink href={LINK_HREF[k]?.(v!) ?? '#'}>{v}</RefLink>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <KV
            cols={1}
            items={[
              ['Made by', `${ACTOR[t.created_by_actor] ?? humanize(t.created_by_actor)}${t.created_by_admin ? ` · ${t.created_by_admin}` : ''}`],
              ...(t.approved_by_admin ? [['Approved by', t.approved_by_admin] as [string, React.ReactNode]] : []),
              ...(t.reason || t.reason_code ? [['Reason', [t.reason_code ? (LABELS.adjReason[t.reason_code] ?? humanize(t.reason_code)) : null, t.reason].filter(Boolean).join(' · ')] as [string, React.ReactNode]] : []),
              ...(t.reverses_ref ? [['Reverses', <RefLink key="rv" href={`/ledger?ref=${t.reverses_ref}`}>{t.reverses_ref}</RefLink>] as [string, React.ReactNode]] : []),
              ...params.map(paramRow),
              ['Idempotency key', <span key="k" className="flex items-start gap-2"><span className="adm-mono min-w-0 break-all text-fg-secondary">{t.idempotency_key}</span><Copy value={t.idempotency_key} label="Copy key" /></span>],
            ]}
          />
          <Alert tone="info">Ledger entries can&apos;t be changed. To correct one, post an adjustment.</Alert>
        </div>
      )}
    </SidePanel>
  );
}

function Transactions() {
  const { tick } = useSession();
  const u = useUrlState();
  const sel = u.get('ref');
  const [q, setQ] = useState('');
  const range = u.get('range');
  const rangeDays = RANGE_DAYS[range];
  const tx = useApi<Tx[]>('/admin/ledger', { q: q || undefined, user: u.get('user'), type: u.get('type'), kind: u.get('kind'), from: rangeDays ? dhakaDate(rangeDays - 1) : undefined, page: u.get('page', '1'), t: tick });
  const total = tx.meta?.total as number | undefined;
  return (
    <SplitView panel={<TxPanel sel={sel} onClose={() => u.set({ ref: null })} />}>
      <Toolbar actions={total !== undefined ? <span className="self-center text-body-xs text-fg-tertiary">{total.toLocaleString('en-US')} {total === 1 ? 'transaction' : 'transactions'}</span> : null}>
        <div className="w-full max-w-[240px]"><Search value={q} onValueChange={(v) => { setQ(v); if (u.get('page')) u.set({ page: null }, false); }} label="Find transaction" placeholder="TX- reference" size="M" /></div>
        <FilterSelect label="Type" value={u.get('type')} onChange={(v) => u.set({ type: v, page: null })} options={[{ value: '', label: 'Any type' }, ...Object.entries(LABELS.ledgerType).map(([value, label]) => ({ value, label }))]} />
        <FilterSelect label="Account" value={u.get('kind')} onChange={(v) => u.set({ kind: v, page: null })} options={[{ value: '', label: 'Any account' }, ...Object.entries(LEDGER_KIND).map(([value, label]) => ({ value, label }))]} />
        <FilterSelect label="Range" value={rangeDays ? range : ''} onChange={(v) => u.set({ range: v, page: null })} options={RANGES} />
        {u.get('user') ? <Button size="S" variant="secondary" trailingIcon="x" onClick={() => u.set({ user: null, page: null })}>User {u.get('user')}</Button> : null}
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
        empty={<EmptyState icon="file-text" title="No transactions match" body="Try another type, account or date." compact />}
        cols={[
          { key: 'r', header: 'Reference', cell: (r) => <span className="font-medium text-fg-brand">{r.ref}</span> },
          { key: 't', header: 'Type', cell: (r) => LABELS.ledgerType[r.type] ?? humanize(r.type) },
          { key: 'm', header: 'Amount', align: 'right', cell: (r) => <span className="adm-mono tabular-nums">{money(sumPositive(r.entries))}</span> },
          { key: 'f', header: 'From → to', cell: (r) => <Flow entries={r.entries} /> },
          { key: 'j', header: 'Linked to', cell: (r) => (r.submission_ref ? <RefLink href={`/submissions?ref=${r.submission_ref}`}>{r.submission_ref}</RefLink> : r.job_public_id ? <RefLink href={`/jobs/${r.job_public_id}`}>{r.job_public_id}</RefLink> : '—'), hideBelow: 'desktop' },
          { key: 'w', header: 'When', cell: (r) => dt(r.occurred_at) },
          { key: 'a', header: 'Made by', cell: (r) => ACTOR[r.created_by_actor] ?? humanize(r.created_by_actor), hideBelow: 'laptop' },
        ]}
      />
      <Pager meta={tx.meta} onPage={(p) => u.set({ page: String(p) }, false)} />
    </SplitView>
  );
}

/** For roles that see totals only: daily totals by type. */
function Aggregates() {
  const agg = useApi<{ day: string; type: string; count: number; total_exact: string }[]>('/admin/ledger', { aggregate: '1' });
  return (
    <>
      <p className="mb-3 text-body-sm text-fg-secondary">Daily totals for the last 30 days. Your role sees totals, not individual entries.</p>
      <Table
        caption="Daily totals by type"
        rows={agg.data}
        loading={agg.loading}
        error={agg.error}
        rowKey={(r) => `${r.day}${r.type}`}
        empty={<EmptyState icon="file-text" title="No transactions in the last 30 days" compact />}
        cols={[
          { key: 'd', header: 'Day', cell: (r) => d(`${r.day}T12:00:00Z`) },
          { key: 't', header: 'Type', cell: (r) => LABELS.ledgerType[r.type] ?? humanize(r.type) },
          { key: 'n', header: 'Transactions', align: 'right', cell: (r) => r.count.toLocaleString('en-US') },
          { key: 's', header: 'Amount moved', align: 'right', cell: (r) => <span className="adm-mono tabular-nums">{money(r.total_exact)}</span> },
        ]}
      />
    </>
  );
}

function Adjustments({ onSpec }: { onSpec: (s: ActionSpec) => void }) {
  const { can, isSuper, tick } = useSession();
  const u = useUrlState();
  const view = u.get('view', 'needs_me');
  const adj = useApi<Adj[]>('/admin/ledger/adjustments', { view: view === 'all' ? undefined : view, status: view === 'all' ? 'all' : undefined, t: tick });
  const approve = (a: Adj): ActionSpec => ({ title: 'Approve this adjustment?', description: `${money(a.amount_exact, true)} to ${a.owner_public_id}'s ${accountName(a.account_kind).toLowerCase()}. New balance: ${money(a.balance_after_exact)}. They'll see "${a.visible_text}".`, confirm: `Approve and post · ${money(a.amount_exact, true)}`, fields: [{ name: 'decision_note', type: 'textarea', label: 'Decision note', max: 500 }], submit: (v, idem) => post(`/admin/ledger/adjustments/${a.id}/approve`, { decision_note: v.decision_note || undefined }, idem), success: 'Adjustment posted.', onDone: adj.reload });
  const decline = (a: Adj): ActionSpec => ({ title: 'Decline this adjustment?', confirm: 'Decline', variant: 'destructive', fields: [{ name: 'decision_note', type: 'textarea', label: 'Decision note', required: true, max: 500 }], submit: (v) => post(`/admin/ledger/adjustments/${a.id}/decline`, { decision_note: v.decision_note }), success: 'Adjustment declined.', onDone: adj.reload });
  return (
    <>
      <Tabs label="Adjustment views" value={view} panelId="adj" className="mb-3" onChange={(v) => u.set({ view: v })} tabs={[{ value: 'needs_me', label: 'Needs my approval' }, { value: 'mine', label: 'Waiting on another admin' }, { value: 'all', label: 'All' }]} />
      <p className="mb-3 text-body-sm text-fg-secondary">An adjustment changes a balance only after a second admin approves it. Requests expire if nobody decides.</p>
      <div id="adj">
        <Table<Adj>
          caption="Adjustments"
          rows={adj.data}
          loading={adj.loading}
          error={adj.error}
          rowKey={(a) => a.id}
          empty={<EmptyState icon="check-circle" title={view === 'needs_me' ? 'Nothing needs your approval' : 'No adjustments here'} body="Proposed adjustments wait here for a second admin." compact />}
          cols={[
            { key: 'c', header: 'Created', cell: (a) => dt(a.created_at) },
            { key: 'o', header: 'Owner', cell: (a) => (a.owner_public_id ? <RefLink href={`/users/${a.owner_public_id}`}>{a.owner_public_id}</RefLink> : '—') },
            { key: 'k', header: 'Account', cell: (a) => accountName(a.account_kind) },
            { key: 'a', header: 'Amount', align: 'right', cell: (a) => <span className={cn('adm-mono tabular-nums', !a.amount_exact.startsWith('-') && 'text-fg-success')}>{money(a.amount_exact, true)}</span> },
            { key: 'b', header: 'Balance after', align: 'right', cell: (a) => <span className="adm-mono tabular-nums text-fg-secondary">{money(a.balance_after_exact)}</span>, hideBelow: 'desktop' },
            { key: 'r', header: 'Reason', cell: (a) => <span className="block"><span className="block">{LABELS.adjReason[a.reason_code] ?? humanize(a.reason_code)}</span><span className="block text-body-xs text-fg-tertiary"><Truncate text={a.internal_note} max={40} /></span></span> },
            { key: 's', header: 'Status', cell: (a) => <AdminBadge kind="adjustment" code={a.status} /> },
            { key: 'm', header: 'Made by', cell: (a) => a.created_by, hideBelow: 'laptop' },
            { key: 'e', header: 'Expires', cell: (a) => (a.status === 'pending_approval' ? dt(a.expires_at) : '—'), hideBelow: 'desktop' },
            {
              key: 'x',
              header: '',
              align: 'right',
              cell: (a) =>
                a.status === 'pending_approval' && !a.created_by_me && can('ledger.approve') ? (
                  a.approver_must_be_super_admin && !isSuper ? (
                    <span className="text-body-xs text-fg-tertiary">Only a super admin can approve this.</span>
                  ) : (
                    <span className="hidden justify-end gap-2 laptop:flex">
                      <Button size="S" variant="secondary" onClick={() => onSpec(decline(a))}>Decline</Button>
                      <Button size="S" onClick={() => onSpec(approve(a))}>Approve</Button>
                    </span>
                  )
                ) : a.ledger_ref ? (
                  <RefLink href={`/ledger?ref=${a.ledger_ref}`}>{a.ledger_ref}</RefLink>
                ) : null,
            },
          ]}
        />
      </div>
    </>
  );
}

const RAILS = ['treasury:bkash_merchant', 'treasury:nagad_merchant', 'treasury:rocket_merchant', 'treasury:usdt_hot_wallet', 'treasury:bank_main'];
const PROVIDERS = [{ value: 'bkash', label: 'bKash' }, { value: 'nowpayments', label: 'NOWPayments' }, { value: 'sslcommerz', label: 'SSLCommerz' }, { value: 'mock', label: 'Test gateway' }];

function Reconciliation({ onSpec }: { onSpec: (s: ActionSpec) => void }) {
  const { can, tick } = useSession();
  const u = useUrlState();
  const runs = useApi<Run[]>('/admin/reconciliation/runs', { t: tick });
  const items = useApi<Item[]>('/admin/reconciliation/items', { severity: u.get('severity'), resolved: u.get('resolved') || 'false', t: tick });
  const counts = (items.meta?.counts ?? {}) as Record<string, number>;
  const loaded = !!items.meta;
  const ref = useStagger(loaded);
  const resolve = (i: Item): ActionSpec => ({ title: 'Resolve this item?', confirm: 'Resolve item', fields: [{ name: 'resolution_note', type: 'textarea', label: 'Resolution note', required: true, max: 500, helper: 'The ledger is never edited here. Real money errors need an adjustment.' }], submit: (v) => post(`/admin/reconciliation/items/${i.id}/resolve`, { resolution_note: v.resolution_note }), success: 'Item resolved.', onDone: items.reload });
  const importSpec = (kind: 'statements' | 'settlements'): ActionSpec => ({
    title: kind === 'statements' ? 'Import a bank or wallet statement' : 'Import a provider settlement file',
    description: kind === 'statements' ? 'CSV columns: provider_trx_id, direction, amount, currency, occurred_at, counterparty. Payouts are matched by transaction ID.' : 'CSV columns: provider_payment_id, gross_amount, fee_amount, currency, settled_on. Deposits are matched by provider ID.',
    confirm: 'Import',
    fields: [
      kind === 'statements'
        ? { name: 'rail', type: 'select', label: 'Account', required: true, options: RAILS.map((v) => ({ value: v, label: accountName('treasury', v) })) }
        : { name: 'provider', type: 'select', label: 'Provider', required: true, options: PROVIDERS },
      { name: 'csv', type: 'file', label: 'File', accept: '.csv,text/csv', required: true },
    ],
    submit: (v) => post(`/admin/reconciliation/${kind}`, kind === 'statements' ? { rail: v.rail, csv: v.csv } : { provider: v.provider, csv: v.csv }),
    success: (r) => `${(r as { lines: number }).lines} lines imported, ${(r as { unmatched: number }).unmatched} unmatched.`,
    onDone: () => { runs.reload(); items.reload(); },
  });
  const sev = u.get('severity');
  // Each tile filters the list below; clicking the active one clears the filter.
  const tileHref = (key: string) => {
    const p = new URLSearchParams({ tab: 'reconciliation' });
    if (sev !== key) p.set('severity', key);
    if (u.get('resolved')) p.set('resolved', u.get('resolved'));
    return `/ledger?${p}`;
  };
  const tile = (key: string, label: string, tone?: 'danger') => (
    <div key={key} className={cn('rounded-card', sev === key && 'ring-2 ring-[var(--fl-bg-brand)]')}>
      <Kpi label={label} value={counts[key] ?? 0} tone={counts[key] && tone ? tone : undefined} sub={sev === key ? 'Showing these · click to clear' : counts[key] ? 'Open items' : 'Nothing open'} href={tileHref(key)} replace />
    </div>
  );
  const last = runs.data?.[0];
  return (
    <div ref={ref} className="space-y-5">
      <p className="text-body-sm text-fg-secondary">
        Checks compare the ledger with provider statements and settlement files. {last ? `Last check ${dt(last.finished_at ?? last.started_at)}.` : 'No checks have run yet.'}
      </p>
      <section aria-label="Open items by severity" className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-4">
        {loaded ? (
          <>
            {tile('critical', 'Critical', 'danger')}
            {tile('high', 'High', 'danger')}
            {tile('medium', 'Medium')}
            {tile('info', 'Info')}
          </>
        ) : (
          [...Array(4)].map((_, i) => <Skeleton.StatCard key={i} />)
        )}
      </section>

      <Section
        title="Items to review"
        actions={
          can('recon.write') ? (
            <span className="hidden gap-2 laptop:flex">
              <Button size="S" variant="secondary" leadingIcon="upload" onClick={() => onSpec(importSpec('settlements'))}>Import settlement file</Button>
              <Button size="S" variant="secondary" leadingIcon="upload" onClick={() => onSpec(importSpec('statements'))}>Import statement</Button>
            </span>
          ) : null
        }
      >
        <Toolbar>
          <FilterSelect label="Severity" value={sev} onChange={(v) => u.set({ severity: v })} options={[{ value: '', label: 'Any severity' }, { value: 'critical', label: 'Critical' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'info', label: 'Info' }]} />
          <FilterSelect label="Status" value={u.get('resolved')} onChange={(v) => u.set({ resolved: v })} options={[{ value: '', label: 'Open' }, { value: 'true', label: 'Resolved' }]} />
        </Toolbar>
        <Table<Item>
          caption="Reconciliation items"
          rows={items.data}
          loading={items.loading}
          error={items.error}
          onRetry={items.hardReload}
          rowKey={(i) => i.id}
          empty={<EmptyState icon="check-circle" title={u.get('resolved') === 'true' ? 'No resolved items' : 'All checks passed'} body={last ? `Last check ${dt(last.finished_at ?? last.started_at)}.` : undefined} compact />}
          cols={[
            { key: 's', header: 'Severity', cell: (i) => <AdminBadge kind="severity" code={i.severity} /> },
            { key: 'c', header: 'Check', cell: (i) => <span className="block"><span className="block text-fg">{CHECK[i.check_code] ?? detailText(i.detail)}</span>{CHECK[i.check_code] && detailText(i.detail) !== CHECK[i.check_code] ? <span className="block text-body-xs text-fg-tertiary">{detailText(i.detail)}</span> : null}</span> },
            { key: 'e', header: 'Record', cell: (i) => { const h = entityHref(i.entity_ref); return h ? <RefLink href={h}>{i.entity_ref}</RefLink> : <span className="adm-mono text-fg-secondary">{i.entity_ref ?? '—'}</span>; } },
            { key: 'at', header: 'Found', cell: (i) => dt(i.created_at), hideBelow: 'laptop' },
            { key: 'r', header: '', align: 'right', cell: (i) => (i.resolved_at ? <span className="text-body-xs text-fg-tertiary">Resolved {dt(i.resolved_at)}{i.resolved_by ? ` by ${i.resolved_by}` : ''}</span> : can('recon.write') ? <span className="hidden laptop:inline"><Button size="S" variant="secondary" onClick={() => onSpec(resolve(i))}>Resolve</Button></span> : null) },
          ]}
        />
      </Section>

      <Section title="Recent checks">
        <Table
          caption="Reconciliation runs"
          rows={runs.data}
          loading={runs.loading}
          error={runs.error}
          rowKey={(r) => r.id}
          empty={<EmptyState icon="clock" title="No checks have run yet" compact />}
          cols={[
            { key: 'j', header: 'Check', cell: (r) => jobName(r.job_name) },
            { key: 's', header: 'Result', cell: (r) => <AdminBadge kind="run" code={r.status} /> },
            { key: 'a', header: 'Started', cell: (r) => dt(r.started_at) },
            { key: 'f', header: 'Took', cell: (r) => (r.finished_at ? `${Math.max(1, Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000))} s` : 'Running'), hideBelow: 'laptop' },
            { key: 'n', header: 'Items found', align: 'right', cell: (r) => r.item_count.toLocaleString('en-US') },
            { key: 'y', header: 'Summary', cell: (r) => <span className="text-fg-secondary">{summaryText(r.summary)}</span>, hideBelow: 'desktop' },
          ]}
        />
      </Section>
    </div>
  );
}

/** SCR-ADM-13 Ledger (Doc 09 §6). Read-only; corrections are adjustments. */
function Ledger() {
  usePageHeader('Ledger', 'Every money movement, double-entry. Nothing here is ever edited.');
  const { can, tick } = useSession();
  const u = useUrlState();
  const full = can('ledger.read');
  const tab = u.get('tab', 'transactions');
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const pending = useApi<Adj[]>(can('ledger.adjust', 'ledger.approve') ? '/admin/ledger/adjustments' : null, { view: 'needs_me', t: tick });
  const tabs = [
    { value: 'transactions', label: full ? 'Transactions' : 'Daily totals' },
    ...(can('ledger.adjust', 'ledger.approve') ? [{ value: 'adjustments', label: 'Adjustments', count: (pending.meta?.counts as Record<string, number> | undefined)?.needs_me }] : []),
    ...(can('recon.read') ? [{ value: 'reconciliation', label: 'Reconciliation' }] : []),
  ];
  return (
    <Gate perms={['ledger.read', 'ledger.read_aggregate']}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <Tabs label="Ledger views" value={tab} panelId="led" onChange={(v) => u.set({ tab: v === 'transactions' ? null : v, ref: null, page: null })} tabs={tabs} />
        {can('ledger.adjust') ? (
          <span className="hidden laptop:inline-flex">
            <Button leadingIcon="plus" onClick={() => setSpec(adjustSpec({}, pending.reload))}>New adjustment</Button>
          </span>
        ) : null}
      </div>
      <div id="led">
        {tab === 'transactions' ? (full ? <Transactions /> : <Aggregates />) : null}
        {tab === 'adjustments' ? <Adjustments onSpec={setSpec} /> : null}
        {tab === 'reconciliation' ? <Reconciliation onSpec={setSpec} /> : null}
      </div>
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
