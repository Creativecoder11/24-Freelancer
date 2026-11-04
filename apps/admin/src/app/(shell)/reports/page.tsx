'use client';
import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState, Tabs } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, FilterSelect, Gate, Pager, post, RefLink, RowMenu, Table, Toolbar, Truncate, type ActionSpec } from '@/components/kit';
import { AdminBadge, LABELS } from '@/components/badges';
import { useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dt } from '@/lib/fmt';
import { suspendJobSpec } from '../jobs/job-actions';

interface Row { id: string; job_public_id: string; job_title: string; job_status: string; reason: string; details: string | null; reporter_public_id: string; open_reports_on_job: number; status: string; created_at: string }

/** SCR-ADM-10 Job reports (Doc 09 §6, §9.6). */
function Reports() {
  usePageHeader('Job reports', 'Jobs with 3 or more open reports come first.');
  const router = useRouter();
  const { can, tick } = useSession();
  const u = useUrlState();
  const status = u.get('status', 'open');
  const list = useApi<Row[]>('/admin/reports', { status, reason: u.get('reason'), job: u.get('job'), page: u.get('page', '1'), t: tick });
  const counts = (list.meta?.counts ?? {}) as Record<string, number>;
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const handle = can('reports.handle');
  const dismiss = (r: Row): ActionSpec => ({ title: 'Dismiss this report?', description: "The job is unchanged. The reporter isn't notified.", confirm: 'Dismiss report', fields: [{ name: 'reason', type: 'textarea', label: 'Note', max: 500, helper: 'Kept in the audit log. Staff only.' }], submit: (v) => post(`/admin/reports/${r.id}/dismiss`, { reason: v.reason }), success: 'Report dismissed.', onDone: list.reload });
  const actioned = (r: Row): ActionSpec => ({ title: 'Mark this report as actioned?', description: "Use this after you've warned the employer or fixed the issue another way.", confirm: 'Mark actioned', fields: [{ name: 'reason', type: 'textarea', label: 'Reason', required: true, max: 500, helper: 'Kept in the audit log. Staff only.' }], submit: (v) => post(`/admin/reports/${r.id}/mark-actioned`, { reason: v.reason }), success: 'Report marked actioned.', onDone: list.reload });
  return (
    <Gate perms={['reports.read']}>
      <Tabs label="Report status" value={status} panelId="rep" className="mb-4" onChange={(v) => u.set({ status: v === 'open' ? null : v })} tabs={[{ value: 'open', label: 'Open', count: counts.open }, { value: 'actioned', label: 'Actioned' }, { value: 'dismissed', label: 'Dismissed' }]} />
      <Toolbar>
        <FilterSelect label="Reason" width={260} value={u.get('reason')} onChange={(v) => u.set({ reason: v })} options={[{ value: '', label: 'Any reason' }, ...Object.entries(LABELS.reportReason).map(([value, label]) => ({ value, label }))]} />
      </Toolbar>
      <Table<Row>
        caption="Job reports"
        rows={list.data}
        loading={list.loading}
        error={list.error}
        onRetry={list.hardReload}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`/jobs/${r.job_public_id}`)}
        empty={<EmptyState icon="flag" title="No reports waiting" body="Reports from workers and employers appear here." compact />}
        cols={[
          { key: 'j', header: 'Job', cell: (r) => <div className="min-w-[200px]"><RefLink href={`/jobs/${r.job_public_id}`}>{r.job_public_id}</RefLink><p className="line-clamp-1 text-body-xs text-fg-secondary">{r.job_title}</p></div> },
          { key: 'r', header: 'Reason', cell: (r) => LABELS.reportReason[r.reason] },
          { key: 'd', header: 'Details', cell: (r) => <Truncate text={r.details} max={50} />, hideBelow: 'desktop' },
          { key: 'p', header: 'Reporter', cell: (r) => <RefLink href={`/users/${r.reporter_public_id}`}>{r.reporter_public_id}</RefLink> },
          { key: 'n', header: 'Reports on job', align: 'right', cell: (r) => <span className={r.open_reports_on_job >= 3 ? 'font-semibold text-fg-danger' : ''}>{r.open_reports_on_job}</span> },
          { key: 's', header: 'Status', cell: (r) => <AdminBadge kind="report" code={r.status} /> },
          { key: 'c', header: 'Reported', cell: (r) => dt(r.created_at), hideBelow: 'laptop' },
          {
            key: 'm',
            header: '',
            align: 'right',
            cell: (r) =>
              handle && r.status === 'open' ? (
                <RowMenu
                  items={[
                    { key: 'o', label: 'Open job', onSelect: () => router.push(`/jobs/${r.job_public_id}`) },
                    can('jobs.moderate') && ['running', 'paused'].includes(r.job_status) && { key: 's', label: 'Suspend job', tone: 'danger', onSelect: () => setSpec(suspendJobSpec(r.job_public_id, null, list.reload)) },
                    { key: 'a', label: 'Mark actioned', onSelect: () => setSpec(actioned(r)) },
                    { key: 'd', label: 'Dismiss', onSelect: () => setSpec(dismiss(r)) },
                  ]}
                />
              ) : null,
          },
        ]}
      />
      <Pager meta={list.meta} onPage={(p) => u.set({ page: String(p) }, false)} />
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </Gate>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Reports />
    </Suspense>
  );
}
