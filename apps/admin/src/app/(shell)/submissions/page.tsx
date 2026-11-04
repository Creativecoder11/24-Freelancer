'use client';
import { Suspense, useState } from 'react';
import { Alert, Button, EmptyState, Search, Tabs } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, FilterSelect, Gate, NoResults, Pager, post, RefLink, SidePanel, SplitView, Table, Toolbar, type ActionSpec } from '@/components/kit';
import { AdminBadge, LABELS, SlaCell } from '@/components/badges';
import { Attempts, PAID_FROM, type Attempt } from '@/components/attempts';
import { useApi, useNow, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dt, reward } from '@/lib/fmt';

interface Row { ref: string; job_public_id: string; job_title: string; worker_public_id: string; worker_name_masked: string; employer_name: string | null; status: string; reward_usd: string; submitted_at: string; review_due_at: string; escalated_at: string | null; dispute_open: boolean; dispute_ref: string | null }
interface Detail { ref: string; status: string; decision_source: string | null; reward_usd: string; worker_public_id: string; worker_name_masked: string; job: { public_id: string; title: string; steps: string[] }; escalated_at: string | null; dispute_open: boolean; dispute_ref: string | null; duplicate_suspected: boolean; attempts: Attempt[]; events: { event_type: string; actor_type: string; occurred_at: string }[]; paid_ledger_ref: string | null; payment_preview: { source: string; amount_usd: string } | null }

/** SCR-ADM-08 Submissions (Doc 09 §6, §10). */
function Submissions() {
  usePageHeader('Submissions', 'Search proof, and decide overdue reviews.');
  const { can, tick } = useSession();
  const now = useNow();
  const u = useUrlState();
  const override = can('submissions.override');
  const tab = u.get('tab', u.get('ref') || u.get('job') ? 'all' : override ? 'escalated' : 'all');
  const [q, setQ] = useState('');
  const sel = u.get('ref');
  const list = useApi<Row[]>('/admin/submissions', { q, escalated: tab === 'escalated' ? 'true' : undefined, status: u.get('status'), job: u.get('job'), worker: u.get('worker'), page: u.get('page', '1'), t: tick });
  const detail = useApi<Detail>(sel ? `/admin/submissions/${sel}` : null, { t: tick });
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const counts = (list.meta?.counts ?? {}) as Record<string, number>;
  const d = detail.data;
  const approve = (x: Detail): ActionSpec => ({
    title: `Approve and pay ${x.ref}?`,
    description: `${reward(x.reward_usd)} goes to the worker from ${PAID_FROM[x.payment_preview?.source ?? 'job_reserve']?.toLowerCase()}, plus any referral commission. The source is recorded as Admin.`,
    confirm: `Approve · ${reward(x.reward_usd)}`,
    fields: [{ name: 'reason', type: 'textarea', label: 'Reason', required: true, max: 300, helper: 'Kept in the audit log. Staff only.' }],
    submit: (v, idem) => post(`/admin/submissions/${x.ref}/override`, { outcome: 'approved', reason: v.reason }, idem),
    success: 'Approved and paid.',
    onDone: detail.reload,
  });
  const reject = (x: Detail): ActionSpec =>
    x.status === 'approved'
      ? { title: 'This submission is already paid', description: `Overturning takes ${reward(x.reward_usd)} back from the worker and reverses any commission. Finance has to post the adjustment, and a second admin has to approve it.`, confirm: 'Overturn and request adjustment', variant: 'destructive', fields: [{ name: 'reason_code', type: 'select', label: 'Reason', required: true, options: Object.entries(LABELS.submissionReject).map(([value, label]) => ({ value, label })) }, { name: 'reason', type: 'textarea', label: 'Reason details', required: true, min: 10, max: 300 }], submit: (v, idem) => post(`/admin/submissions/${x.ref}/override`, { outcome: 'rejected', reason_code: v.reason_code, reason: v.reason }, idem), onDone: detail.reload }
      : { title: `Reject ${x.ref}?`, description: "This is a final rejection. The slot's budget returns under the job's rules.", confirm: 'Reject submission', variant: 'destructive', fields: [{ name: 'reason_code', type: 'select', label: 'Reason', required: true, options: Object.entries(LABELS.submissionReject).map(([value, label]) => ({ value, label })) }, { name: 'reason', type: 'textarea', label: 'Reason details', required: true, min: 10, max: 300, helper: 'The worker sees this.' }], submit: (v, idem) => post(`/admin/submissions/${x.ref}/override`, { outcome: 'rejected', reason_code: v.reason_code, reason: v.reason }, idem), success: 'Submission rejected.', onDone: detail.reload };
  return (
    <Gate perms={['submissions.read']}>
      <Tabs label="Submission views" value={tab} panelId="subs" className="mb-4" onChange={(v) => u.set({ tab: v, ref: null })} tabs={[...(override ? [{ value: 'escalated', label: 'Escalated', count: counts.escalated }] : []), { value: 'all', label: 'All' }]} />
      <SplitView
        panel={
          <SidePanel
            open={!!sel}
            onClose={() => u.set({ ref: null })}
            title={sel ?? ''}
            meta={d ? <span className="flex flex-wrap items-center gap-2"><AdminBadge kind="submission" code={d.status} />{d.decision_source ? `Source: ${d.decision_source}` : ''} · {reward(d.reward_usd)}</span> : undefined}
            footer={
              d && override && !d.dispute_open ? (
                <>
                  {d.status !== 'rejected' ? <Button variant="secondary" onClick={() => setSpec(reject(d))}>{d.status === 'approved' ? 'Overturn' : 'Reject'}</Button> : null}
                  {d.status !== 'approved' ? <Button onClick={() => setSpec(approve(d))}>Approve · {reward(d.reward_usd)}</Button> : null}
                </>
              ) : null
            }
          >
            {!d ? (
              <div className="h-40 animate-pulse rounded-[12px] bg-muted" />
            ) : (
              <>
                {d.dispute_open ? <Alert tone="info" title="Decide this through the dispute." action={<Button size="S" variant="secondary" href={`/disputes?ref=${d.dispute_ref}`}>Open dispute</Button>} /> : null}
                {d.duplicate_suspected ? <Alert tone="warning">Duplicate suspected: the screenshot matches another submission.</Alert> : null}
                <div>
                  <p className="text-label-md text-fg">Job · <RefLink href={`/jobs/${d.job.public_id}`}>{d.job.public_id}</RefLink></p>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-body-sm text-fg-secondary">{d.job.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                </div>
                <Attempts attempts={d.attempts} />
                <div>
                  <p className="mb-1 text-label-md text-fg">Timeline</p>
                  <ol className="space-y-1 border-l-2 border-line pl-3 text-body-sm">
                    {d.events.map((e, i) => <li key={i}><span className="text-fg">{e.event_type.replace(/_/g, ' ')}</span> <span className="text-body-xs text-fg-tertiary">· {e.actor_type} · {dt(e.occurred_at)}</span></li>)}
                  </ol>
                </div>
                {d.paid_ledger_ref ? <p className="text-body-sm">Paid: <RefLink href={`/ledger?ref=${d.paid_ledger_ref}`}>{d.paid_ledger_ref}</RefLink></p> : null}
                {d.payment_preview && d.status !== 'in_review' ? <p className="text-body-xs text-fg-tertiary">If approved, paid from: {PAID_FROM[d.payment_preview.source]}</p> : null}
              </>
            )}
          </SidePanel>
        }
      >
        <Toolbar>
          <div className="w-full max-w-[320px]">
            <Search value={q} onValueChange={setQ} label="Search submissions" placeholder="SB-, WJ- or worker ID" size="M" />
          </div>
          {tab === 'all' ? <FilterSelect label="Status" value={u.get('status')} onChange={(v) => u.set({ status: v })} options={[{ value: '', label: 'Any status' }, { value: 'in_review', label: 'In review' }, { value: 'approved', label: 'Approved' }, { value: 'needs_fix', label: 'Needs fix' }, { value: 'rejected', label: 'Rejected' }]} /> : null}
          {u.get('job') ? <Button size="S" variant="secondary" trailingIcon="x" onClick={() => u.set({ job: null })}>Job {u.get('job')}</Button> : null}
        </Toolbar>
        <Table<Row>
          caption="Submissions"
          rows={list.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.hardReload}
          rowKey={(r) => r.ref}
          selectedKey={sel}
          onRowClick={(r) => u.set({ ref: r.ref }, false)}
          empty={tab === 'escalated' ? <EmptyState icon="check-circle" title="Nothing is overdue" body="Submissions on jobs with auto-approve off appear here 7 days after their review window ends." compact /> : <NoResults onClear={() => { setQ(''); u.set({ status: null, job: null, worker: null }); }} />}
          cols={[
            { key: 'r', header: 'Reference', cell: (r) => <span className="font-medium text-fg-brand">{r.ref}</span> },
            { key: 'j', header: 'Job', cell: (r) => <RefLink href={`/jobs/${r.job_public_id}`}>{r.job_public_id}</RefLink> },
            { key: 'w', header: 'Worker', cell: (r) => <RefLink href={`/users/${r.worker_public_id}`}>{r.worker_name_masked} · {r.worker_public_id}</RefLink> },
            { key: 'e', header: 'Employer', cell: (r) => r.employer_name ?? '—', hideBelow: 'desktop' },
            { key: 's', header: 'Status', cell: (r) => <AdminBadge kind="submission" code={r.status} /> },
            { key: 'sub', header: 'Submitted', cell: (r) => dt(r.submitted_at), hideBelow: 'laptop' },
            { key: 'due', header: 'Review due', cell: (r) => (r.status === 'in_review' ? <SlaCell due={r.review_due_at} now={now} /> : '—') },
            { key: 'esc', header: 'Escalated', cell: (r) => (r.escalated_at ? <span className="rounded-full bg-danger-subtle px-2 text-label-sm leading-6 text-fg-danger">{Math.max(7, Math.floor((now - new Date(r.review_due_at).getTime()) / 86_400_000))} days overdue</span> : '—'), hideBelow: 'desktop' },
            { key: 'd', header: 'Dispute', cell: (r) => (r.dispute_open ? <RefLink href={`/disputes?ref=${r.dispute_ref}`}>Open dispute</RefLink> : '—') },
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
      <Submissions />
    </Suspense>
  );
}
