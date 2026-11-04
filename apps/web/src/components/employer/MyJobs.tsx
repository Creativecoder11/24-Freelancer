'use client';
import NextLink from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ActionMenu, Button, EmptyState, IconButton, Pagination, Progress, Search, Skeleton, StatusBadge, TabPanel, Tabs, useStaggerIn } from '@24f/ui';
import { formatDate, formatMoney } from '@24f/shared';
import { useJobs, type JobListRow } from './api';
import { useEmployerHeader } from './shell';
import { ErrorPanel, endsShort } from './common';
import { useJobActions } from './JobActions';

const TABS = ['running', 'paused', 'completed', 'drafts'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { running: 'Running', paused: 'Paused', completed: 'Completed', drafts: 'Drafts' };

/** SCR-EMP-07 My jobs (Figma 36:1496). */
export function MyJobs() {
  useEmployerHeader({ title: 'My jobs', subtitle: 'Track progress, review work and manage budgets.' });
  const router = useRouter();
  const sp = useSearchParams();
  const tab = (TABS as readonly string[]).includes(sp.get('tab') ?? '') ? (sp.get('tab') as Tab) : 'running';
  const q = sp.get('q') ?? '';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const jobs = useJobs(tab, q, page);
  const actions = useJobActions();
  const href = (p: Partial<{ tab: string; q: string; page: number }>) => {
    const u = new URLSearchParams();
    const t = p.tab ?? tab;
    const qq = p.q ?? q;
    if (t !== 'running') u.set('tab', t);
    if (qq) u.set('q', qq);
    if ((p.page ?? 1) > 1) u.set('page', String(p.page));
    return `/employer/jobs${u.size ? `?${u}` : ''}`;
  };
  const meta = jobs.data?.meta;
  const rows = jobs.data?.data ?? [];
  const list = useStaggerIn<HTMLDivElement>([tab, q, page, rows.length], { selector: '[data-row]' });
  const allEmpty = meta && !q && meta.counts.running + meta.counts.paused + meta.counts.completed + meta.counts.drafts === 0;

  return (
    <div>
      <div className="flex flex-col-reverse gap-4 desktop:flex-row desktop:items-end desktop:justify-between">
        <Tabs
          label="Job status"
          panelId="jobs-panel"
          value={tab}
          tabs={TABS.map((t) => ({ value: t, label: TAB_LABEL[t], count: meta?.counts[t] }))}
          hrefFor={(t) => href({ tab: t, page: 1 })}
          className="max-tablet:-mx-5 max-tablet:px-5 desktop:min-w-[480px]"
        />
        <div className="flex items-center gap-3 desktop:mb-1">
          <Search size="M" label="Search jobs" placeholder="Search jobs" value={q} onValueChange={(v) => router.replace(href({ q: v, page: 1 }), { scroll: false })} className="min-w-0 flex-1 desktop:w-[280px] desktop:flex-none" />
          <Button href="/employer/jobs/new" leadingIcon="plus" className="shrink-0 max-tablet:hidden">
            Post a job
          </Button>
          <IconButton icon="plus" variant="primary" aria-label="Post a job" href="/employer/jobs/new" className="tablet:hidden" />
        </div>
      </div>

      <TabPanel id="jobs-panel" className="mt-6">
        {jobs.isError ? (
          <ErrorPanel onRetry={() => jobs.refetch()} />
        ) : !jobs.data ? (
          <div className="rounded-card border border-line bg-surface p-4" aria-busy="true" aria-label="Loading jobs">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton.TableRow key={i} columns={6} />
            ))}
          </div>
        ) : allEmpty ? (
          <div className="rounded-card border border-line bg-surface">
            <EmptyState icon="briefcase" title="No jobs yet" body="Post a job in four short steps." action={<Button href="/employer/jobs/new">Post a job</Button>} />
          </div>
        ) : !rows.length ? (
          <div className="rounded-card border border-line bg-surface">
            {q ? (
              <EmptyState compact icon="search" title="No jobs match your search." action={<Button variant="secondary" href={href({ q: '', page: 1 })}>Clear search</Button>} />
            ) : (
              <EmptyState compact icon="briefcase" title="No jobs in this list." />
            )}
          </div>
        ) : (
          <div ref={list} className={jobs.isFetching ? 'opacity-70 transition-opacity' : undefined}>
            {/* Desktop/tablet table */}
            <div className="hidden overflow-hidden rounded-card border border-line bg-surface shadow-xs tablet:block">
              <table className="w-full table-fixed text-left">
                <caption className="sr-only">{TAB_LABEL[tab]} jobs</caption>
                <colgroup>
                  <col />
                  <col className="w-[120px]" />
                  <col className="w-[160px] max-desktop:w-[120px]" />
                  <col className="w-[110px] max-desktop:hidden" />
                  <col className="w-[150px]" />
                  <col className="w-[120px] max-desktop:hidden" />
                  <col className="w-[60px]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-line-subtle bg-subtle text-overline uppercase text-fg-tertiary">
                    <th scope="col" className="px-5 py-3.5">Job</th>
                    <th scope="col" className="px-3 py-3.5">Status</th>
                    <th scope="col" className="px-3 py-3.5">Approved / slots</th>
                    <th scope="col" className="px-3 py-3.5 max-desktop:hidden">To review</th>
                    <th scope="col" className="whitespace-nowrap px-3 py-3.5">Spent / budget</th>
                    <th scope="col" className="px-3 py-3.5 max-desktop:hidden">Ends</th>
                    <th scope="col" className="px-3 py-3.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {rows.map((j) => (
                    <tr key={j.public_id} data-row className="group relative text-body-sm transition-colors hover:bg-subtle">
                      <td className="px-5 py-4">
                        <NextLink href={rowHref(j)} className="block truncate text-label-md text-fg after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:shadow-focus">
                          {j.title || 'Untitled draft'}
                        </NextLink>
                        <p className="mt-0.5 truncate text-body-sm text-fg-secondary">{metaLine(j)}</p>
                      </td>
                      <td className="px-3 py-4">
                        <StatusBadge enum="job_status" code={j.status} label={j.status === 'suspended' ? 'Suspended' : undefined} />
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-semibold tabular-nums text-fg">
                          {j.approved} / {j.slots_total}
                        </p>
                        <Progress className="mt-1.5 max-w-[140px]" size={4} tone="success" value={j.approved} max={Math.max(1, j.slots_total)} valueText={`${j.approved} of ${j.slots_total} approved`} />
                      </td>
                      <td className="px-3 py-4 max-desktop:hidden">
                        {j.to_review > 0 ? (
                          <span className="inline-flex h-7 min-w-[64px] items-center justify-center rounded-full bg-warning-subtle px-3 text-label-sm font-semibold text-fg-warning">{j.to_review}</span>
                        ) : (
                          <span className="inline-block min-w-[64px] text-center text-fg-tertiary">—</span>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-semibold tabular-nums text-fg">{formatMoney(j.spent_usd)}</p>
                        <p className="text-fg-secondary">of {formatMoney(j.budget_total_usd)}</p>
                      </td>
                      <td className="px-3 py-4 text-fg-secondary max-desktop:hidden">{endsCell(j)}</td>
                      <td className="relative z-[1] px-3 py-4 text-right">
                        <ActionMenu label={`Actions for ${j.title ?? 'job'}`} items={actions.menuItems(j)} trigger={<IconButton icon="more" aria-label={`Actions for ${j.title ?? 'job'}`} variant="ghost" tooltip={false} />} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards (Doc 02 §12: tables → cards) */}
            <ul className="space-y-3 tablet:hidden" aria-label={`${TAB_LABEL[tab]} jobs`}>
              {rows.map((j) => (
                <li key={j.public_id} data-row className="relative rounded-card border border-line bg-surface p-4 shadow-xs">
                  <div className="flex items-start justify-between gap-2">
                    <StatusBadge enum="job_status" code={j.status} label={j.status === 'suspended' ? 'Suspended' : undefined} />
                    <span className="relative z-[1] -mr-2 -mt-2">
                      <ActionMenu label={`Actions for ${j.title ?? 'job'}`} items={actions.menuItems(j)} trigger={<IconButton icon="more" aria-label={`Actions for ${j.title ?? 'job'}`} variant="ghost" tooltip={false} />} />
                    </span>
                  </div>
                  <NextLink href={rowHref(j)} className="mt-2 block text-label-md text-fg after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:shadow-focus">
                    {j.title || 'Untitled draft'}
                  </NextLink>
                  <p className="mt-0.5 text-body-xs text-fg-secondary">{metaLine(j)}</p>
                  <div className="mt-3 flex items-center justify-between text-body-sm">
                    <span className="tabular-nums text-fg-secondary">
                      {j.approved} / {j.slots_total} approved
                    </span>
                    <span className="font-semibold tabular-nums text-fg">
                      {formatMoney(j.spent_usd)} <span className="font-normal text-fg-secondary">of {formatMoney(j.budget_total_usd)}</span>
                    </span>
                  </div>
                  <Progress className="mt-2" size={4} tone="success" value={j.approved} max={Math.max(1, j.slots_total)} valueText={`${j.approved} of ${j.slots_total} approved`} />
                  <div className="mt-3 flex items-center justify-between text-body-xs text-fg-tertiary">
                    <span>{endsCell(j)}</span>
                    {j.to_review > 0 ? <span className="rounded-full bg-warning-subtle px-2 py-0.5 font-semibold text-fg-warning">{j.to_review} to review</span> : null}
                  </div>
                </li>
              ))}
            </ul>
            {meta ? (
              <div className="mt-5 flex flex-col items-center justify-between gap-3 tablet:flex-row">
                <p className="text-body-sm text-fg-secondary">
                  Showing {rows.length} of {meta.total} {meta.total === 1 ? 'job' : 'jobs'}
                </p>
                {meta.total_pages > 1 ? <Pagination page={meta.page} totalPages={meta.total_pages} total={meta.total} perPage={meta.per_page} hrefFor={(p) => href({ page: p })} hideSummary /> : null}
              </div>
            ) : null}
          </div>
        )}
      </TabPanel>
      {actions.dialogs}
    </div>
  );
}

function rowHref(j: JobListRow) {
  return j.status === 'draft' ? `/employer/jobs/${j.public_id}/edit?step=${Math.min(4, Math.max(1, j.wizard_step))}` : `/employer/jobs/${j.public_id}`;
}
function metaLine(j: JobListRow) {
  const cat = j.category?.name ?? 'No category';
  return j.status === 'draft' ? `${cat} · draft` : `${cat} · posted ${formatDate(j.published_at ?? j.created_at)}`;
}
function endsCell(j: JobListRow) {
  if (j.status === 'draft') return 'Not published';
  if (j.status === 'paused') return j.pause_reason === 'low_deposit' ? 'Paused · low deposit' : j.pause_reason === 'admin' ? 'Paused by admin' : 'Paused';
  if (j.status === 'suspended') return 'Suspended';
  if (j.status === 'completed' || j.status === 'cancelled') return `Ended ${formatDate(j.closed_at ?? j.ends_at)}`;
  return endsShort(j.ends_at);
}
