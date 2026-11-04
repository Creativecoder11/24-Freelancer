'use client';
import { Suspense, useState } from 'react';
import { Alert, Button, EmptyState, Tabs } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, Gate, Pager, post, RefLink, SidePanel, SplitView, Table, Toggle, Toolbar, type ActionSpec } from '@/components/kit';
import { AdminBadge, LABELS, SlaCell } from '@/components/badges';
import { Attempts, PAID_FROM, type Attempt } from '@/components/attempts';
import { useApi, useNow, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dt, reward } from '@/lib/fmt';

interface Row { ref: string; submission_ref: string; worker_name_masked: string; employer_name: string | null; status: string; disputed_decision: string; opened_at: string; sla_due_at: string; assigned_admin: string | null; assigned_to_me: boolean }
interface Detail { ref: string; status: string; disputed_decision: string; sla_due_at: string; assigned_admin: string | null; assigned_to_me: boolean; worker_statement: string; evidence: { url: string }[]; employer_reason: { code: string | null; text: string | null }; submission: { ref: string; status: string; attempts: Attempt[] }; job: { public_id: string; title: string; steps: string[] }; payment_preview: { source: string; amount_usd: string } | null; resolution_note: string | null; ledger_ref: string | null }

/** SCR-ADM-09 Disputes (Doc 09 §6, §11). */
function Disputes() {
  usePageHeader('Disputes', 'Decide within 48 hours.');
  const { can, isSuper, tick } = useSession();
  const now = useNow();
  const u = useUrlState();
  const tab = u.get('tab', u.get('ref') ? 'all' : 'open');
  const sel = u.get('ref');
  const statusFor: Record<string, string | undefined> = { open: 'open', under_review: 'under_review', mine: undefined, decided: 'decided', withdrawn: 'withdrawn', all: undefined };
  const list = useApi<Row[]>('/admin/disputes', { status: statusFor[tab], assigned: tab === 'mine' ? 'me' : undefined, overdue: u.get('overdue') ? 'true' : undefined, ref: tab === 'all' ? sel : undefined, page: u.get('page', '1'), t: tick });
  const detail = useApi<Detail>(sel ? `/admin/disputes/${sel}` : null, { t: tick });
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const [claiming, setClaiming] = useState(false);
  const counts = (list.meta?.counts ?? {}) as Record<string, number>;
  const d = detail.data;
  const act = can('disputes.resolve');
  const claim = async (ref: string) => {
    setClaiming(true);
    try {
      await post(`/admin/disputes/${ref}/claim`, {});
      list.reload();
      detail.reload();
    } catch (e) {
      (await import('@/lib/hooks')).reportError(e);
    } finally {
      setClaiming(false);
    }
  };
  const forWorker = (x: Detail): ActionSpec => ({
    title: 'Decide for the worker?',
    description: `The submission becomes Approved and ${reward(x.payment_preview?.amount_usd)} is paid from ${PAID_FROM[x.payment_preview?.source ?? 'job_reserve']}, plus any referral commission. The approval rate is recalculated.`,
    confirm: `Decide for worker · ${reward(x.payment_preview?.amount_usd)}`,
    fields: [{ name: 'note', type: 'textarea', label: 'Note', required: true, max: 1000, helper: 'Both sides see this.' }],
    extra: () => (x.payment_preview?.source === 'adjustments' ? <Alert tone="warning">The employer can&apos;t cover this. The platform pays, and the amount is recorded against the employer.</Alert> : null),
    submit: (v, idem) => post(`/admin/disputes/${x.ref}/resolve`, { outcome: 'worker', note: v.note }, idem),
    success: 'Decided for the worker.',
    onDone: () => { list.reload(); detail.reload(); },
  });
  const forEmployer = (x: Detail): ActionSpec => ({
    title: "Uphold the employer's decision?",
    description: `No money moves.${x.disputed_decision === 'needs_fix' ? ' The worker gets 24 hours from now to fix and resubmit.' : ''}`,
    confirm: 'Uphold decision',
    fields: [{ name: 'note', type: 'textarea', label: 'Note', required: true, max: 1000, helper: 'Both sides see this.' }],
    submit: (v, idem) => post(`/admin/disputes/${x.ref}/resolve`, { outcome: 'employer', note: v.note }, idem),
    success: 'Decision upheld.',
    onDone: () => { list.reload(); detail.reload(); },
  });
  return (
    <Gate perms={['disputes.read', 'disputes.resolve']}>
      <Tabs label="Dispute views" value={tab} panelId="disp" className="mb-4" onChange={(v) => u.set({ tab: v, ref: null })} tabs={[{ value: 'open', label: 'Open', count: counts.open }, { value: 'under_review', label: 'Under review', count: counts.under_review }, { value: 'mine', label: 'Mine' }, { value: 'decided', label: 'Decided' }, { value: 'withdrawn', label: 'Withdrawn' }]} />
      <SplitView
        panel={
          <SidePanel
            open={!!sel}
            onClose={() => u.set({ ref: null })}
            title={sel ?? ''}
            meta={d ? <span className="flex flex-wrap items-center gap-2"><AdminBadge kind="dispute" code={d.status} /><SlaCell due={d.sla_due_at} now={now} /> · {d.assigned_admin ? `Reviewer: ${d.assigned_admin}` : 'Unassigned'}</span> : undefined}
            footer={
              d && act ? (
                d.status === 'open' ? (
                  <Button loading={claiming} onClick={() => void claim(d.ref)}>Claim</Button>
                ) : d.status === 'under_review' && (d.assigned_to_me || isSuper) ? (
                  <>
                    <Button variant="secondary" onClick={() => setSpec(forEmployer(d))}>Decide for employer</Button>
                    <Button onClick={() => setSpec(forWorker(d))}>Decide for worker · {reward(d.payment_preview?.amount_usd)}</Button>
                  </>
                ) : d.status === 'under_review' ? (
                  <p className="text-body-sm text-fg-tertiary">Claimed by {d.assigned_admin}</p>
                ) : null
              ) : null
            }
          >
            {!d ? (
              <div className="h-40 animate-pulse rounded-[12px] bg-muted" />
            ) : (
              <>
                <section>
                  <h3 className="text-label-md text-fg">What the worker says</h3>
                  <p className="mt-1 whitespace-pre-wrap text-body-sm text-fg-secondary">{d.worker_statement}</p>
                  {d.evidence.length ? <div className="mt-2 flex gap-2">{d.evidence.map((e, i) => <a key={i} href={e.url} target="_blank" rel="noopener noreferrer" className="text-label-sm text-fg-brand hover:underline">Evidence {i + 1}</a>)}</div> : null}
                </section>
                <section>
                  <h3 className="text-label-md text-fg">What the employer said · {d.disputed_decision === 'needs_fix' ? 'Needs fix' : 'Rejected'}</h3>
                  <p className="mt-1 text-body-sm text-fg-secondary">{d.employer_reason.code ? `${LABELS.submissionReject[d.employer_reason.code] ?? d.employer_reason.code}: ` : ''}{d.employer_reason.text ?? '—'}</p>
                </section>
                <section>
                  <h3 className="text-label-md text-fg">Job steps · <RefLink href={`/jobs/${d.job.public_id}`}>{d.job.public_id}</RefLink></h3>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-body-sm text-fg-secondary">{d.job.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                </section>
                <section>
                  <h3 className="mb-2 text-label-md text-fg">Attempts · <RefLink href={`/submissions?ref=${d.submission.ref}`}>{d.submission.ref}</RefLink></h3>
                  <Attempts attempts={d.submission.attempts} />
                </section>
                {d.payment_preview ? <Alert tone="info">If the worker wins, {reward(d.payment_preview.amount_usd)} is paid from: {PAID_FROM[d.payment_preview.source]}</Alert> : null}
                {d.resolution_note ? <Alert tone="success" title="Decision note">{d.resolution_note}{d.ledger_ref ? ` · ${d.ledger_ref}` : ''}</Alert> : null}
                <details className="rounded-[12px] bg-subtle p-3 text-body-xs text-fg-secondary">
                  <summary className="cursor-pointer text-label-sm text-fg">Reviewer guidance</summary>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                    <li>Read the job steps first, then the proof, then each side&apos;s words.</li>
                    <li>Decide on whether the proof meets the steps as written. An ambiguous step favours the worker.</li>
                    <li>Use the auto-check result as a hint, not as proof.</li>
                    <li>Evidence of fraud: resolve for the employer, and open the account to act on it.</li>
                  </ol>
                </details>
              </>
            )}
          </SidePanel>
        }
      >
        <Toolbar><Toggle label="Overdue" on={!!u.get('overdue')} onChange={(v) => u.set({ overdue: v ? '1' : null })} /></Toolbar>
        <Table<Row>
          caption="Disputes"
          rows={list.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.hardReload}
          rowKey={(r) => r.ref}
          selectedKey={sel}
          onRowClick={(r) => u.set({ ref: r.ref }, false)}
          empty={<EmptyState icon="check-circle" title={tab === 'open' ? 'No open disputes' : 'Nothing here'} body={tab === 'open' ? 'New disputes appear here, most urgent first.' : undefined} compact />}
          cols={[
            { key: 'r', header: 'Dispute', cell: (r) => <span className="font-medium text-fg-brand">{r.ref}</span> },
            { key: 's', header: 'Submission', cell: (r) => <RefLink href={`/submissions?ref=${r.submission_ref}`}>{r.submission_ref}</RefLink> },
            { key: 'w', header: 'Worker', cell: (r) => r.worker_name_masked },
            { key: 'e', header: 'Employer', cell: (r) => r.employer_name ?? '—', hideBelow: 'desktop' },
            { key: 'd', header: 'Decision disputed', cell: (r) => (r.disputed_decision === 'needs_fix' ? 'Needs fix' : 'Rejected') },
            { key: 'st', header: 'Status', cell: (r) => <AdminBadge kind="dispute" code={r.status} /> },
            { key: 'o', header: 'Opened', cell: (r) => dt(r.opened_at), hideBelow: 'desktop' },
            { key: 'sla', header: 'SLA', cell: (r) => (['open', 'under_review'].includes(r.status) ? <SlaCell due={r.sla_due_at} now={now} /> : '—') },
            { key: 'rv', header: 'Reviewer', cell: (r) => r.assigned_admin ?? '—' },
            { key: 'c', header: '', align: 'right', cell: (r) => (act && r.status === 'open' ? <span className="hidden laptop:inline" onClick={(e) => e.stopPropagation()}><Button size="S" variant="secondary" onClick={() => void claim(r.ref)}>Claim</Button></span> : null) },
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
      <Disputes />
    </Suspense>
  );
}
