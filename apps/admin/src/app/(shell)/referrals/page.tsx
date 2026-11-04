'use client';
import { Suspense, useState } from 'react';
import { Button, EmptyState, Tabs } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, Gate, Pager, post, RefLink, SidePanel, SplitView, Table, type ActionSpec } from '@/components/kit';
import { AdminBadge } from '@/components/badges';
import { Kpi } from '@/components/charts';
import { useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { usd } from '@/lib/fmt';

interface Row { id: string; referrer_public_id: string; referred_public_id: string; code_used: string; status: string; ineligible_reason: string | null; risk_flags: string[]; risk_score: number; commission_total_usd: string }
interface Detail { id: string; status: string; referrer_public_id: string; referred_public_id: string; referred_name_masked: string; risk_score: number; risk_flags: string[]; signals: Record<string, boolean>; hard_block: string | null; thresholds: { block: number; flag: number }; commissions: { id: string; source_type: string; submission_ref: string | null; deposit_ref: string | null; base_amount_exact: string; rate: string; amount_exact: string; status: string; credited_at: string | null }[] }
interface Agg { aggregate: true; by_status: Record<string, number>; commissions: Record<string, string>; percent_of_deposits: string }

/** SCR-ADM-14 Referrals (Doc 09 §6, §15). Analysts see aggregates only. */
function Referrals() {
  usePageHeader('Referrals', 'Review duplicate and fraud signals.');
  const { can, tick } = useSession();
  const u = useUrlState();
  const full = can('referrals.read');
  const tab = u.get('tab', 'flagged');
  const sel = u.get('id');
  const list = useApi<Row[] | Agg>('/admin/referrals', full ? { flagged: tab === 'flagged' ? 'true' : undefined, status: tab === 'ineligible' ? 'ineligible' : undefined, referrer: u.get('referrer'), page: u.get('page', '1'), t: tick } : {});
  const det = useApi<Detail>(sel && full ? `/admin/referrals/${sel}` : null, { t: tick });
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const reloadAll = () => { list.reload(); det.reload(); };
  if (list.data && !Array.isArray(list.data)) {
    const a = list.data;
    return (
      <Gate perms={['referrals.read', 'referrals.read_aggregate']}>
        <div className="grid gap-4 tablet:grid-cols-3">
          {Object.entries(a.by_status).map(([k, v]) => <Kpi key={k} label={`Referrals · ${k.replace('_', ' ')}`} value={v} sub=" " />)}
          {Object.entries(a.commissions).map(([k, v]) => <Kpi key={k} label={`Commissions ${k}`} value={Number(v)} money sub=" " />)}
          <Kpi label="Commission as % of deposits" value={Number(a.percent_of_deposits)} display={`${a.percent_of_deposits}%`} sub=" " />
        </div>
      </Gate>
    );
  }
  const rows = (list.data as Row[] | null) ?? null;
  const d = det.data;
  const credited = d?.commissions.filter((c) => c.status === 'credited') ?? [];
  const creditedSum = credited.reduce((s, c) => s + Number(c.amount_exact), 0).toFixed(6);
  const markIneligible = (x: Detail): ActionSpec => ({
    title: 'Mark this referral as not eligible?',
    description: `Future commissions from this friend won't be paid. ${credited.length} commissions (${usd(creditedSum)}) are already credited.`,
    confirm: 'Mark not eligible',
    variant: 'destructive',
    fields: [...(can('referrals.reverse') && credited.length ? [{ name: 'reverse_credited', type: 'checkbox' as const, label: `Also take back the ${usd(creditedSum)} already credited` }] : []), { name: 'reason', type: 'textarea', label: 'Reason', required: true, max: 500, helper: 'Kept in the audit log. Staff only.' }],
    submit: (v) => post(`/admin/referrals/${x.id}/mark-ineligible`, { reason: v.reason, reverse_credited: v.reverse_credited === true }),
    success: 'Referral marked not eligible.',
    onDone: reloadAll,
  });
  const clear = (x: Detail): ActionSpec => ({ title: 'Clear this referral?', description: 'Held commissions pay through normal posting.', confirm: 'Clear', fields: [{ name: 'reason', type: 'textarea', label: 'Reason', required: true, max: 500 }], submit: (v) => post(`/admin/referrals/${x.id}/clear`, { reason: v.reason }), success: 'Referral cleared.', onDone: reloadAll });
  const reverse = (c: Detail['commissions'][number], x: Detail): ActionSpec => ({ title: 'Reverse this commission?', description: `${c.amount_exact} comes off ${x.referrer_public_id}'s balance, which may go negative. They see "Adjustment", status "Deducted".`, confirm: `Reverse · ${usd(Number(c.amount_exact).toFixed(3))}`, variant: 'destructive', fields: [{ name: 'reason', type: 'textarea', label: 'Reason', required: true, max: 500 }], submit: (v, idem) => post(`/admin/referrals/commissions/${c.id}/reverse`, { reason: v.reason }, idem), success: 'Commission reversed.', onDone: reloadAll });
  return (
    <Gate perms={['referrals.read', 'referrals.read_aggregate']}>
      <Tabs label="Referral views" value={tab} panelId="ref" className="mb-4" onChange={(v) => u.set({ tab: v, id: null })} tabs={[{ value: 'flagged', label: 'Flagged', count: (list.meta?.counts as Record<string, number> | undefined)?.flagged }, { value: 'all', label: 'All' }, { value: 'ineligible', label: 'Not eligible' }]} />
      <SplitView
        panel={
          <SidePanel
            open={!!sel}
            onClose={() => u.set({ id: null })}
            title={d ? `${d.referrer_public_id} → ${d.referred_public_id}` : 'Referral'}
            meta={d ? <span className="flex items-center gap-2"><AdminBadge kind="referral" code={d.status} /> Score {d.risk_score}</span> : undefined}
            footer={
              d && can('referrals.review') ? (
                <>
                  {d.hard_block ? <p className="text-body-xs text-fg-tertiary">Blocked by a hard rule: {d.hard_block.replace(/_/g, ' ')}.</p> : d.risk_flags.length || d.risk_score ? <Button variant="secondary" onClick={() => setSpec(clear(d))}>Clear</Button> : null}
                  {d.status !== 'ineligible' ? <Button variant="destructive" onClick={() => setSpec(markIneligible(d))}>Mark ineligible</Button> : null}
                </>
              ) : null
            }
          >
            {!d ? <div className="h-40 animate-pulse rounded-[12px] bg-muted" /> : (
              <>
                <div>
                  <h3 className="mb-2 text-label-md text-fg">Signals · score {d.risk_score} (flag ≥ {d.thresholds.flag}, block ≥ {d.thresholds.block})</h3>
                  <ul className="space-y-1">
                    {Object.entries(d.signals).map(([k, v]) => (
                      <li key={k} className="flex items-center justify-between text-body-sm"><span>{k.replace(/_/g, ' ')}</span><span className={v ? 'rounded-full bg-danger-subtle px-2 text-label-sm text-fg-danger' : 'rounded-full bg-muted px-2 text-label-sm text-fg-secondary'}>{v ? 'Matched' : 'No'}</span></li>
                    ))}
                  </ul>
                </div>
                <Table caption="Commissions" rows={d.commissions} rowKey={(c) => c.id} empty={<p className="p-4 text-body-sm text-fg-tertiary">No commissions.</p>} cols={[{ key: 's', header: 'Source', cell: (c) => (c.submission_ref ? <RefLink href={`/submissions?ref=${c.submission_ref}`}>{c.submission_ref}</RefLink> : c.deposit_ref ? <RefLink href={`/deposits?ref=${c.deposit_ref}`}>{c.deposit_ref}</RefLink> : c.source_type) }, { key: 'b', header: 'Base', align: 'right', cell: (c) => <span className="adm-mono">{c.base_amount_exact}</span> }, { key: 'a', header: 'Amount', align: 'right', cell: (c) => <span className="adm-mono">{c.amount_exact}</span> }, { key: 'st', header: 'Status', cell: (c) => <AdminBadge kind="commission" code={c.status} /> }, { key: 'x', header: '', align: 'right', cell: (c) => (c.status === 'credited' && can('referrals.reverse') ? <span className="hidden laptop:inline"><Button size="S" variant="secondary" onClick={() => setSpec(reverse(c, d))}>Reverse</Button></span> : null) }]} />
              </>
            )}
          </SidePanel>
        }
      >
        <Table<Row>
          caption="Referrals"
          rows={rows}
          loading={list.loading}
          error={list.error}
          rowKey={(r) => r.id}
          selectedKey={sel}
          onRowClick={(r) => u.set({ id: r.id }, false)}
          empty={tab === 'flagged' ? <EmptyState icon="gift" title="No referrals to review" body="Referrals scoring 30 or more appear here." compact /> : <EmptyState title="No referrals" compact />}
          cols={[
            { key: 'r', header: 'Referrer', cell: (r) => <RefLink href={`/users/${r.referrer_public_id}`}>{r.referrer_public_id}</RefLink> },
            { key: 'f', header: 'Friend', cell: (r) => <RefLink href={`/users/${r.referred_public_id}`}>{r.referred_public_id}</RefLink> },
            { key: 'c', header: 'Code', cell: (r) => <span className="adm-mono">{r.code_used}</span> },
            { key: 's', header: 'Status', cell: (r) => <AdminBadge kind="referral" code={r.status} /> },
            { key: 'why', header: 'Reason', cell: (r) => r.ineligible_reason ?? '—', hideBelow: 'desktop' },
            { key: 'k', header: 'Risk', cell: (r) => (r.risk_score || r.risk_flags.length ? <span className="rounded-full bg-danger-subtle px-2 text-label-sm text-fg-danger">{r.risk_flags.length} · {r.risk_score}</span> : '—') },
            { key: 'm', header: 'Commission', align: 'right', cell: (r) => usd(r.commission_total_usd) },
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
      <Referrals />
    </Suspense>
  );
}
