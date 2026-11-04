'use client';
import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState, Search, Tabs } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, FilterSelect, Gate, NoResults, Pager, RefLink, RowMenu, Table, Toolbar, type ActionSpec } from '@/components/kit';
import { AdminBadge } from '@/components/badges';
import { useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dt, reward } from '@/lib/fmt';
import { clearFlagSpec, suspendJobSpec } from './job-actions';

interface Row { public_id: string; title: string; employer: { public_id: string; business_name: string | null }; status: string; pause_reason: string | null; flagged: boolean; open_reports: number; reward_usd: string; slots_total: number; slots_left: number; published_at: string | null }

/** SCR-ADM-07 Jobs list (Doc 09 §6, §9). */
function Jobs() {
  usePageHeader('Jobs', 'Live jobs are reviewed after publishing.');
  const router = useRouter();
  const { can, tick } = useSession();
  const u = useUrlState();
  const tab = u.get('tab', 'all');
  const [q, setQ] = useState('');
  const query = { q, status: tab === 'suspended' ? 'suspended' : u.get('status'), flagged: tab === 'flagged' ? 'true' : undefined, reported: tab === 'reported' ? 'true' : undefined, employer: u.get('employer'), sort: u.get('sort'), page: u.get('page', '1'), t: tick };
  const list = useApi<Row[]>('/admin/jobs', query);
  const counts = (list.meta?.counts ?? {}) as Record<string, number>;
  const detail = can('jobs.read_detail');
  const mod = can('jobs.moderate');
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  return (
    <Gate perms={['jobs.read']}>
      <Tabs label="Job views" value={tab} panelId="jobs" className="mb-4" onChange={(v) => u.set({ tab: v === 'all' ? null : v, status: null })} tabs={[{ value: 'all', label: 'All' }, { value: 'flagged', label: 'Flagged', count: counts.flagged }, { value: 'reported', label: 'Reported', count: counts.reported }, { value: 'suspended', label: 'Suspended', count: counts.suspended }]} />
      <Toolbar>
        <div className="w-full max-w-[360px]">
          <Search value={q} onValueChange={setQ} label="Search jobs" placeholder="Job ID or title" size="M" />
        </div>
        {tab === 'all' ? <FilterSelect label="Status" value={u.get('status')} onChange={(v) => u.set({ status: v })} options={[{ value: '', label: 'Any status' }, ...['running', 'paused', 'completed', 'cancelled', 'suspended'].map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))]} /> : null}
        <FilterSelect label="Sort" value={u.get('sort')} onChange={(v) => u.set({ sort: v })} options={[{ value: '', label: 'Newest first' }, { value: 'published_at', label: 'Oldest first' }, { value: '-open_reports', label: 'Most reports' }]} />
      </Toolbar>
      <div id="jobs">
        <Table<Row>
          caption="Jobs"
          rows={list.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.hardReload}
          rowKey={(r) => r.public_id}
          onRowClick={detail ? (r) => router.push(`/jobs/${r.public_id}`) : undefined}
          empty={tab === 'flagged' ? <EmptyState icon="flag" title="No flagged jobs" body="Jobs that hit the automated screen appear here while they stay live." compact /> : <NoResults onClear={() => { setQ(''); u.set({ status: null, sort: null, employer: null }); }} />}
          cols={[
            { key: 'job', header: 'Job', cell: (r) => (<div className="min-w-[220px]">{detail ? <RefLink href={`/jobs/${r.public_id}`}>{r.public_id}</RefLink> : <span className="font-medium">{r.public_id}</span>}<p className="line-clamp-1 text-body-xs text-fg-secondary">{r.title}</p></div>) },
            { key: 'emp', header: 'Employer', cell: (r) => (<div><RefLink href={`/users/${r.employer.public_id}`}>{r.employer.business_name ?? r.employer.public_id}</RefLink><p className="text-body-xs text-fg-tertiary">{r.employer.public_id}</p></div>) },
            { key: 'st', header: 'Status', cell: (r) => (<span className="flex flex-wrap gap-1"><AdminBadge kind="job" code={r.status} />{r.flagged ? <span className="rounded-full bg-danger-subtle px-2 text-label-sm leading-6 text-fg-danger">Flagged</span> : null}</span>) },
            { key: 'rep', header: 'Reports', align: 'right', cell: (r) => (r.open_reports ? <span className={r.open_reports >= 3 ? 'font-semibold text-fg-danger' : 'text-fg-warning'}>{r.open_reports}</span> : '—') },
            { key: 'rw', header: 'Reward', align: 'right', cell: (r) => reward(r.reward_usd) },
            { key: 'sl', header: 'Slots', cell: (r) => `${r.slots_left} of ${r.slots_total} left`, hideBelow: 'desktop' },
            { key: 'pub', header: 'Published', cell: (r) => dt(r.published_at), hideBelow: 'laptop' },
            {
              key: 'm',
              header: '',
              align: 'right',
              cell: (r) =>
                mod ? (
                  <RowMenu
                    items={[
                      detail && { key: 'open', label: 'Open', onSelect: () => router.push(`/jobs/${r.public_id}`) },
                      ['running', 'paused'].includes(r.status) && !(r.status === 'paused' && r.pause_reason === 'admin') && { key: 's', label: 'Suspend', tone: 'danger', onSelect: () => setSpec(suspendJobSpec(r.public_id, null, list.reload)) },
                      (r.status === 'suspended' || (r.status === 'paused' && r.pause_reason === 'admin')) && { key: 'r', label: 'Reinstate', onSelect: () => router.push(`/jobs/${r.public_id}?action=reinstate`) },
                      ['running', 'paused', 'suspended'].includes(r.status) && { key: 'c', label: 'Close job', tone: 'danger', onSelect: () => router.push(`/jobs/${r.public_id}?action=close`) },
                      r.flagged && { key: 'f', label: 'Clear flag', onSelect: () => setSpec(clearFlagSpec(r.public_id, list.reload)) },
                    ]}
                  />
                ) : null,
            },
          ]}
        />
      </div>
      <Pager meta={list.meta} onPage={(p) => u.set({ page: String(p) }, false)} />
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </Gate>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Jobs />
    </Suspense>
  );
}
