'use client';
import { Suspense, use, useEffect, useState } from 'react';
import { Alert, Button, EmptyState, StatCard } from '@24f/ui';
import { usePageHeader, WriteOnly } from '@/components/shell';
import { ActionDialog, Copy, ErrorState, Gate, KV, post, RefLink, Section, Table, type ActionSpec } from '@/components/kit';
import { AdminBadge, LABELS } from '@/components/badges';
import { useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dt, reward, usd } from '@/lib/fmt';
import { clearFlagSpec, closeJobSpec, reinstateJobSpec, suspendJobSpec, type JobPreview } from '../job-actions';

interface Detail extends JobPreview {
  public_id: string; title: string; status: string; pause_reason: string | null; category: string | null; task_link_url: string | null; proof_instructions: string | null; steps: { position: number; body: string }[]; proof_requirements: { proof_type: string; title: string; required: boolean }[]; screen_hits: unknown[]; flagged: boolean;
  reports: { id: string; reason: string; details: string | null; reporter_public_id: string; status: string; created_at: string }[];
  employer: { public_id: string; business_name: string | null; status: string };
  counts: { active_reservations: number; in_review: number; needs_fix: number; approved: number; rejected: number };
  reward_usd: string; slots_total: number; slots_left: number; budget_usd: string; reserve_outstanding_usd: string; review_window_hours: number; auto_approve: boolean; eligibility: string; min_approval_rate: number; published_at: string | null; ends_at: string | null; suspended_at: string | null; suspended_by: string | null; suspension_reason: string | null;
  preview: { suspend_release_usd: string; reinstate_reserve_usd: string; close_release_usd: string };
}

/** SCR-ADM-07 Job detail (Doc 09 §6, §9). */
function JobDetail({ id }: { id: string }) {
  const { can, tick } = useSession();
  const u = useUrlState();
  const { data, error, reload, hardReload } = useApi<Detail>(`/admin/jobs/${id}`, { t: tick });
  const history = useApi<{ id: string; action: string; actor_name: string; reason: string | null; created_at: string }[]>(can('audit.read') ? '/admin/audit-log' : null, { entity_ref: id, from: '2020-01-01', t: tick });
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  usePageHeader(data?.title ?? 'Job', id);
  const mod = can('jobs.moderate');
  const preview = data ? { ...data, close_release_usd: data.preview.close_release_usd } : null;
  useEffect(() => {
    if (!data || !mod) return;
    const a = u.get('action');
    if (a === 'close') setSpec(closeJobSpec(id, preview!, reload));
    if (a === 'reinstate') setSpec(reinstateJobSpec(id, data.preview.reinstate_reserve_usd, reload));
    if (a) u.set({ action: null }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data]);
  if (error?.code === 'NOT_FOUND') return <EmptyState title={`We can't find job ${id}.`} action={<Button href="/jobs">Back to jobs</Button>} />;
  if (error && !data) return <ErrorState error={error} onRetry={hardReload} />;
  if (!data) return <div className="h-40 animate-pulse rounded-card bg-muted" />;
  const canSuspend = ['running', 'paused'].includes(data.status) && !(data.status === 'paused' && data.pause_reason === 'admin');
  const canReinstate = data.status === 'suspended' || (data.status === 'paused' && data.pause_reason === 'admin');
  const report = (rid: string, kind: 'dismiss' | 'mark-actioned') =>
    setSpec(
      kind === 'dismiss'
        ? { title: 'Dismiss this report?', description: "The job is unchanged. The reporter isn't notified.", confirm: 'Dismiss report', fields: [{ name: 'reason', type: 'textarea', label: 'Note', max: 500, helper: 'Kept in the audit log. Staff only.' }], submit: (v) => post(`/admin/reports/${rid}/dismiss`, { reason: v.reason }), success: 'Report dismissed.', onDone: reload }
        : { title: 'Mark this report as actioned?', description: "Use this after you've warned the employer or fixed the issue another way.", confirm: 'Mark actioned', fields: [{ name: 'reason', type: 'textarea', label: 'Reason', required: true, max: 500, helper: 'Kept in the audit log. Staff only.' }], submit: (v) => post(`/admin/reports/${rid}/mark-actioned`, { reason: v.reason }), success: 'Report marked actioned.', onDone: reload },
    );
  return (
    <Gate perms={['jobs.read_detail']}>
      <div className="space-y-5">
        <section className="flex flex-wrap items-start justify-between gap-4 rounded-card border border-line bg-surface p-5 shadow-xs">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-h5 text-fg">{data.public_id}</span>
              <AdminBadge kind="job" code={data.status} />
              {data.category ? <span className="rounded-[6px] bg-muted px-2 text-label-sm leading-6 text-fg-secondary">{data.category}</span> : null}
            </div>
            <p className="text-body-sm text-fg-secondary">Posted by <RefLink href={`/users/${data.employer.public_id}`}>{data.employer.business_name ?? data.employer.public_id}</RefLink> · Published {dt(data.published_at)}</p>
          </div>
          {mod ? (
            <WriteOnly>
              <div className="flex flex-wrap gap-2">
                {data.flagged ? <Button variant="secondary" onClick={() => setSpec(clearFlagSpec(id, reload))}>Clear flag</Button> : null}
                {canSuspend ? <Button variant="destructive" onClick={() => setSpec(suspendJobSpec(id, { active: data.counts.active_reservations, release: data.preview.suspend_release_usd }, reload))}>Suspend</Button> : null}
                {canReinstate ? <Button onClick={() => setSpec(reinstateJobSpec(id, data.preview.reinstate_reserve_usd, reload))}>Reinstate</Button> : null}
                {['running', 'paused', 'suspended'].includes(data.status) ? <Button variant="secondary" onClick={() => setSpec(closeJobSpec(id, preview!, reload))}>Close job</Button> : null}
              </div>
            </WriteOnly>
          ) : null}
        </section>
        {data.status === 'suspended' ? <Alert tone="danger" title="Suspended by admin">{data.suspension_reason} · {dt(data.suspended_at)} by {data.suspended_by ?? '—'}</Alert> : null}
        {data.flagged ? (
          <Alert tone="warning" title="Flagged by the automated screen">
            <ul className="list-disc pl-4">
              {data.screen_hits.map((h, i) => (
                <li key={i}>{typeof h === 'string' ? h : `${(h as { kind?: string }).kind ?? 'Hit'}: "${(h as { term?: string }).term ?? ''}"${(h as { step?: number }).step ? ` in step ${(h as { step?: number }).step}` : ''}`}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <div className="grid gap-4 tablet:grid-cols-3 desktop:grid-cols-6">
          <StatCard type="default" compact label="In progress" value={String(data.counts.active_reservations)} countUp />
          <StatCard type="default" compact label="To review" value={String(data.counts.in_review)} countUp />
          <StatCard type="default" compact label="Needs fix" value={String(data.counts.needs_fix)} countUp />
          <StatCard type="default" compact label="Approved" value={String(data.counts.approved)} countUp />
          <StatCard type="default" compact label="Rejected" value={String(data.counts.rejected)} countUp />
          <StatCard type="default" compact label="Budget left" value={usd(data.reserve_outstanding_usd)} />
        </div>
        <div className="grid gap-5 desktop:grid-cols-2">
          <Section title="Instructions">
            <ol className="list-decimal space-y-1.5 pl-5 text-body-sm text-fg">
              {data.steps.map((s) => <li key={s.position}>{s.body}</li>)}
            </ol>
            <h3 className="mt-4 text-label-md text-fg">Proof required</h3>
            <ul className="mt-1 list-disc pl-5 text-body-sm text-fg-secondary">
              {data.proof_requirements.map((p, i) => <li key={i}>{p.title} · {p.proof_type}{p.required ? '' : ' (optional)'}</li>)}
            </ul>
            {data.proof_instructions ? <p className="mt-2 text-body-sm text-fg-secondary">{data.proof_instructions}</p> : null}
          </Section>
          <Section title="Task link and rules">
            {data.task_link_url ? (
              <div className="mb-3 rounded-[12px] bg-subtle p-3">
                <div className="flex items-center gap-2">
                  <span className="adm-mono min-w-0 flex-1 break-all text-fg">{data.task_link_url}</span>
                  <Copy value={data.task_link_url} label="Copy task link" />
                </div>
                <p className="mt-1 text-body-xs text-fg-warning">This link was supplied by the employer. Open it in an isolated browser.</p>
              </div>
            ) : null}
            <KV items={[['Reward', reward(data.reward_usd)], ['Slots', `${data.slots_left} of ${data.slots_total} left`], ['Budget', usd(data.budget_usd)], ['Review window', `${data.review_window_hours} h`], ['Auto-approve', data.auto_approve ? 'On' : 'Off'], ['Eligibility', data.eligibility === 'kyc_verified' ? 'KYC verified only' : 'All verified workers'], ['Minimum approval rate', `${data.min_approval_rate}%`], ['Ends', dt(data.ends_at)]]} />
          </Section>
        </div>
        <Section title="Reports" actions={<Button size="S" variant="secondary" href={`/submissions?job=${id}&tab=all`}>Submissions</Button>}>
          <Table
            caption="Reports"
            rows={data.reports}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No reports" compact />}
            cols={[
              { key: 'r', header: 'Reason', cell: (r) => LABELS.reportReason[r.reason] },
              { key: 'd', header: 'Details', cell: (r) => <span className="line-clamp-2">{r.details ?? '—'}</span> },
              { key: 'p', header: 'Reporter', cell: (r) => <RefLink href={`/users/${r.reporter_public_id}`}>{r.reporter_public_id}</RefLink> },
              { key: 's', header: 'Status', cell: (r) => <AdminBadge kind="report" code={r.status} /> },
              { key: 'c', header: 'Created', cell: (r) => dt(r.created_at) },
              { key: 'a', header: '', align: 'right', cell: (r) => (can('reports.handle') && r.status === 'open' ? <WriteOnly><span className="flex justify-end gap-2"><Button size="S" variant="secondary" onClick={() => report(r.id, 'dismiss')}>Dismiss</Button><Button size="S" variant="secondary" onClick={() => report(r.id, 'mark-actioned')}>Mark actioned</Button></span></WriteOnly> : null) },
            ]}
          />
        </Section>
        {can('audit.read') ? (
          <Section title="History">
            <Table caption="History" rows={history.data} loading={history.loading} rowKey={(r) => r.id} empty={<EmptyState title="No history" compact />} cols={[{ key: 'w', header: 'When', cell: (r) => dt(r.created_at) }, { key: 'a', header: 'Action', cell: (r) => <span className="adm-mono">{r.action}</span> }, { key: 'b', header: 'Actor', cell: (r) => r.actor_name }, { key: 'r', header: 'Reason', cell: (r) => r.reason ?? '—' }]} />
          </Section>
        ) : null}
      </div>
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </Gate>
  );
}

export default function Page({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = use(params);
  return (
    <Suspense>
      <JobDetail id={publicId} />
    </Suspense>
  );
}
