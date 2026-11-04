'use client';
import { Suspense, useState } from 'react';
import { Button, Dialog, EmptyState, Field, Select, toast } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { Copy, FilterSelect, Gate, KV, Pager, SidePanel, SplitView, Table, Toolbar, Truncate } from '@/components/kit';
import { api, download } from '@/lib/api';
import { reportError, useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dtSec } from '@/lib/fmt';

interface Row { id: string; actor_type: string; actor_name: string; action: string; entity_type: string; entity_id: string | null; entity_ref: string | null; reason: string | null; before_data: unknown; after_data: unknown; ip_address: string | null; user_agent: string | null; request_id: string | null; created_at: string }

const PRESET: Record<string, number> = { today: 0, '7': 7, '30': 30, '90': 90, '365': 365 };
const ACTIONS = ['admin.', 'user.', 'appeal.', 'kyc.', 'employer.', 'job.', 'job_report.', 'submission.', 'dispute.', 'deposit.', 'withdrawal.', 'ledger.', 'reconciliation.', 'referral.', 'contact.', 'content.', 'legal.', 'notification.', 'settings.', 'payout_config.', 'fx.', 'report.', 'audit.'];

function link(ref: string | null) {
  if (!ref) return null;
  if (/^\d{6}$/.test(ref)) return `/users/${ref}`;
  if (/^WJ-/.test(ref)) return `/jobs/${ref}`;
  const m: Record<string, string> = { 'SB-': '/submissions?ref=', 'DS-': '/disputes?ref=', 'WD-': '/withdrawals?tab=all&ref=', 'DP-': '/deposits?ref=', 'TX-': '/ledger?ref=' };
  const p = m[ref.slice(0, 3)];
  return p ? `${p}${ref}` : null;
}

/** SCR-ADM-20 Audit log (Doc 09 §6, §20). Append-only: no edit or delete anywhere. */
function Audit() {
  usePageHeader('Audit log', 'Append-only. Kept for 7 years.');
  const { can, tick } = useSession();
  const u = useUrlState();
  const range = u.get('range', '7');
  const from = new Date(Date.now() - (PRESET[range] ?? 7) * 86_400_000 + (range === 'today' ? 0 : 0)).toISOString().slice(0, 10);
  const q = { actor: u.get('actor'), action: u.get('action'), entity_type: u.get('entity_type'), entity_ref: u.get('entity_ref'), from, page: u.get('page', '1') };
  const list = useApi<Row[]>('/admin/audit-log', { ...q, t: tick });
  const sel = list.data?.find((r) => r.id === u.get('id')) ?? null;
  const actors = (list.meta?.actors as { id: string; name: string }[] | undefined) ?? [];
  const [ref, setRef] = useState(u.get('entity_ref'));
  const [exp, setExp] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const askExport = async () => {
    try {
      const r = await api<{ rows: number }>('/admin/audit-log/export', { query: { ...q, page: undefined, count_only: '1' } });
      setExp(r.data.rows);
    } catch (e) {
      reportError(e);
    }
  };
  const doExport = async () => {
    setBusy(true);
    try {
      await download('/admin/audit-log/export', { query: { ...q, page: undefined } }, 'audit-log.csv');
      toast.success('Export downloaded. Your export is logged.');
      setExp(null);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Gate perms={['audit.read']}>
      <SplitView
        panel={
          <SidePanel open={!!sel} onClose={() => u.set({ id: null }, false)} title={sel?.action ?? ''} meta={sel ? dtSec(sel.created_at) : undefined}>
            {sel ? (
              <>
                <KV cols={1} items={[['Actor', `${sel.actor_name} (${sel.actor_type})`], ['Object', `${sel.entity_type}${sel.entity_ref ? ` · ${sel.entity_ref}` : ''}`], ['Reason', sel.reason ?? '—'], ['IP', sel.ip_address ?? '—'], ['User agent', <span key="ua" className="break-all text-body-xs">{sel.user_agent ?? '—'}</span>], ['Request ID', sel.request_id ? <span key="r" className="flex items-center gap-1"><span className="adm-mono">{sel.request_id}</span><Copy value={sel.request_id} /></span> : '—']]} />
                <div className="grid gap-3">
                  <div><p className="mb-1 text-label-sm text-fg-tertiary">Before</p><pre className="adm-mono overflow-x-auto rounded-[10px] bg-subtle p-3 text-fg">{JSON.stringify(sel.before_data, null, 2) ?? 'null'}</pre></div>
                  <div><p className="mb-1 text-label-sm text-fg-tertiary">After</p><pre className="adm-mono overflow-x-auto rounded-[10px] bg-subtle p-3 text-fg">{JSON.stringify(sel.after_data, null, 2) ?? 'null'}</pre></div>
                </div>
              </>
            ) : null}
          </SidePanel>
        }
      >
        <Toolbar actions={can('audit.export') ? <span className="hidden laptop:inline"><Button variant="secondary" leadingIcon="download" onClick={() => void askExport()}>Export CSV</Button></span> : null}>
          <div style={{ width: 220 }}><Select label="Actor" labelHidden compact={{ inlineLabel: 'Actor' }} searchable value={u.get('actor') || '__all'} onChange={(v) => u.set({ actor: v === '__all' ? null : v })} options={[{ value: '__all', label: 'Anyone' }, { value: 'system', label: 'System' }, ...actors.map((a) => ({ value: a.id, label: a.name }))]} /></div>
          <div style={{ width: 220 }}><Select label="Action" labelHidden compact={{ inlineLabel: 'Action' }} searchable value={u.get('action') || '__all'} onChange={(v) => u.set({ action: v === '__all' ? null : v })} options={[{ value: '__all', label: 'Any action' }, ...ACTIONS.map((a) => ({ value: `${a}*`, label: `${a}*` }))]} /></div>
          <FilterSelect label="Range" value={range as '7'} onChange={(v) => u.set({ range: v || null })} options={[{ value: 'today', label: 'Today' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: '365', label: 'Last year' }]} />
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); u.set({ entity_ref: ref || null }); }}>
            <Field label="Reference" labelHidden placeholder="WD-90412, 482910…" value={ref} onChange={(e) => setRef(e.target.value)} wrapperClassName="w-[200px]" />
          </form>
        </Toolbar>
        <Table<Row>
          caption="Audit entries"
          rows={list.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.hardReload}
          rowKey={(r) => r.id}
          selectedKey={u.get('id')}
          onRowClick={(r) => u.set({ id: r.id }, false)}
          empty={<EmptyState title="No entries in this range" action={<Button variant="secondary" onClick={() => { setRef(''); u.set({ actor: null, action: null, entity_ref: null, entity_type: null, range: null }); }}>Clear filters</Button>} compact />}
          cols={[
            { key: 'w', header: 'When', cell: (r) => <span className="whitespace-nowrap">{dtSec(r.created_at)}</span> },
            { key: 'a', header: 'Actor', cell: (r) => r.actor_name },
            { key: 'x', header: 'Action', cell: (r) => <span className="adm-mono">{r.action}</span> },
            { key: 'o', header: 'Object', cell: (r) => { const h = link(r.entity_ref); return <span>{r.entity_type}{r.entity_ref ? <> · {h ? <a href={`/admin${h}`} onClick={(e) => e.stopPropagation()} className="text-fg-brand hover:underline">{r.entity_ref}</a> : r.entity_ref}</> : null}</span>; } },
            { key: 'r', header: 'Reason', cell: (r) => <Truncate text={r.reason} max={40} />, hideBelow: 'desktop' },
            { key: 'ip', header: 'IP', cell: (r) => <span className="adm-mono">{r.ip_address ?? '—'}</span>, hideBelow: 'desktop' },
          ]}
        />
        <Pager meta={list.meta} onPage={(p) => u.set({ page: String(p) }, false)} />
      </SplitView>
      <Dialog open={exp !== null} onOpenChange={(o) => !o && setExp(null)} title="Export audit log?" description={`${exp ?? 0} rows from ${from} to today, in CSV. Your export is logged. The file holds IP addresses, so store it safely.`} busy={busy} footer={<><Button variant="secondary" onClick={() => setExp(null)}>Cancel</Button><Button loading={busy} onClick={() => void doExport()}>Export {exp ?? 0} rows</Button></>} />
    </Gate>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Audit />
    </Suspense>
  );
}
