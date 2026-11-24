'use client';
import NextLink from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, FilterChip, FilterChipGroup, Skeleton, StatusBadge, cn, useStaggerIn } from '@24f/ui';
import { formatRelative, formatReward } from '@24f/shared';
import { apiFetch, ek, type SubJobRow, type SubJobsMeta } from './api';
import { useEmployerHeader } from './shell';
import { ErrorPanel } from './common';

export const SUB_RANGES = [
  { value: '', label: 'Any time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '15d', label: 'Last 15 days' },
  { value: '30d', label: 'Last 30 days' },
] as const;
export type SubRange = '' | '7d' | '15d' | '30d';
export const readRange = (v: string | null): SubRange => (v === '7d' || v === '15d' || v === '30d' ? v : '');
export const rangeText = (r: SubRange) => SUB_RANGES.find((x) => x.value === r)?.label.toLowerCase() ?? '';

/** Link into one job's review queue; opens on Approved when nothing is waiting but some were approved. */
export function jobReviewHref(j: Pick<SubJobRow, 'public_id' | 'counts'>, range: SubRange) {
  const u = new URLSearchParams({ job: j.public_id });
  if (!j.counts.to_review && j.counts.approved) u.set('tab', 'approved');
  else if (!j.counts.to_review && j.counts.rejected) u.set('tab', 'rejected');
  if (range) u.set('range', range);
  return `/employer/submissions?${u}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Submissions page, step 1: every job with its submission counters and a date filter. */
export function SubmissionJobs() {
  const router = useRouter();
  const sp = useSearchParams();
  const range = readRange(sp.get('range'));
  const q = useQuery({
    queryKey: ek.subJobs(range),
    queryFn: () => apiFetch<SubJobRow[], SubJobsMeta>('/employer/submissions/jobs', { query: { range: range || undefined } }),
    placeholderData: (p) => p,
  });
  const rows = q.data?.data ?? [];
  const t = q.data?.meta?.totals;
  useEmployerHeader({
    title: 'Review submissions',
    subtitle: t ? (t.to_review ? `${t.to_review} waiting across ${plural(t.jobs_waiting, 'job')}.` : 'Nothing waiting for review.') : undefined,
  });
  const listRef = useStaggerIn<HTMLTableSectionElement>([range, rows.length], { selector: '[data-row]' });
  const setRange = (r: SubRange) => router.replace(`/employer/submissions${r ? `?range=${r}` : ''}`, { scroll: false });

  return (
    <div>
      <div className="flex flex-col gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <FilterChipGroup label="Submitted">
          {SUB_RANGES.map((r) => (
            <FilterChip key={r.value || 'all'} label={r.label} selected={range === r.value} onClick={() => setRange(r.value)} />
          ))}
        </FilterChipGroup>
        {t ? (
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-body-sm">
            <div className="flex gap-1.5"><dt className="text-fg-secondary">To review</dt><dd className="font-semibold tabular-nums text-fg-warning">{t.to_review}</dd></div>
            <div className="flex gap-1.5"><dt className="text-fg-secondary">Approved</dt><dd className="font-semibold tabular-nums text-fg">{t.approved}</dd></div>
            <div className="flex gap-1.5"><dt className="text-fg-secondary">Rejected</dt><dd className="font-semibold tabular-nums text-fg">{t.rejected}</dd></div>
          </dl>
        ) : null}
      </div>

      <div className="mt-5">
        {q.isError && !q.data ? (
          <ErrorPanel onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="overflow-hidden rounded-card border border-line bg-surface shadow-xs" aria-busy="true" aria-label="Loading jobs">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-line-subtle px-5 py-4 last:border-0">
                <div className="flex-1 space-y-2">
                  <Skeleton height={16} width="40%" />
                  <Skeleton height={14} width="25%" />
                </div>
                <Skeleton height={28} width={64} radius={14} />
                <Skeleton height={36} width={110} radius={10} />
              </div>
            ))}
          </div>
        ) : !rows.length ? (
          <div className="rounded-card border border-line bg-surface">
            {range ? (
              <EmptyState icon="inbox" title={`No submissions in the ${rangeText(range)}`} body="Try a longer period." action={<Button variant="secondary" onClick={() => setRange('')}>Show any time</Button>} />
            ) : (
              <EmptyState icon="inbox" title="Nothing to review yet" body="Submissions appear here once you publish a job." action={<Button href="/employer/jobs/new">Post a job</Button>} />
            )}
          </div>
        ) : (
          <>
            {/* Desktop / tablet table */}
            <div className={cn('hidden overflow-hidden rounded-card border border-line bg-surface shadow-xs tablet:block', q.isFetching && q.isPlaceholderData && 'opacity-60')}>
              <table className="w-full table-fixed text-left">
                <caption className="sr-only">Jobs with submissions{range ? `, ${rangeText(range)}` : ''}</caption>
                <colgroup>
                  <col />
                  <col className="w-[120px] max-desktop:hidden" />
                  <col className="w-[110px]" />
                  <col className="w-[100px]" />
                  <col className="w-[100px] max-desktop:hidden" />
                  <col className="w-[150px] max-desktop:hidden" />
                  <col className="w-[150px]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-line-subtle bg-subtle text-overline uppercase text-fg-tertiary">
                    <th scope="col" className="px-5 py-3.5">Job</th>
                    <th scope="col" className="px-3 py-3.5 max-desktop:hidden">Status</th>
                    <th scope="col" className="px-3 py-3.5">To review</th>
                    <th scope="col" className="px-3 py-3.5">Approved</th>
                    <th scope="col" className="px-3 py-3.5 max-desktop:hidden">Rejected</th>
                    <th scope="col" className="px-3 py-3.5 max-desktop:hidden">Last submission</th>
                    <th scope="col" className="px-3 py-3.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody ref={listRef} className="divide-y divide-line-subtle">
                  {rows.map((j) => {
                    const href = jobReviewHref(j, range);
                    return (
                      <tr key={j.public_id} data-row className="group relative text-body-sm transition-colors hover:bg-subtle">
                        <td className="px-5 py-4">
                          <NextLink href={href} className="block truncate text-label-md text-fg after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:shadow-focus">
                            {j.title || 'Untitled job'}
                          </NextLink>
                          <p className="mt-0.5 truncate text-body-sm text-fg-secondary">
                            {[j.category, j.reward_usd ? `${formatReward(j.reward_usd)} each` : null, `${j.approved_total} / ${j.slots_total} approved`].filter(Boolean).join(' · ')}
                          </p>
                        </td>
                        <td className="px-3 py-4 max-desktop:hidden">
                          <StatusBadge enum="job_status" code={j.status} label={j.status === 'suspended' ? 'Suspended' : undefined} />
                        </td>
                        <td className="px-3 py-4">
                          {j.counts.to_review ? (
                            <span className="inline-flex h-7 min-w-[52px] items-center justify-center rounded-full bg-warning-subtle px-3 text-label-sm font-semibold tabular-nums text-fg-warning">{j.counts.to_review}</span>
                          ) : (
                            <span className="inline-block min-w-[52px] text-center text-fg-tertiary">0</span>
                          )}
                        </td>
                        <td className="px-3 py-4 tabular-nums text-fg">{j.counts.approved}</td>
                        <td className="px-3 py-4 tabular-nums text-fg max-desktop:hidden">{j.counts.rejected}</td>
                        <td className="px-3 py-4 text-fg-secondary max-desktop:hidden">{j.last_submitted_at ? formatRelative(j.last_submitted_at) : 'None yet'}</td>
                        <td className="relative z-[1] px-3 py-4 text-right">
                          <Button size="S" variant={j.counts.to_review ? 'primary' : 'secondary'} href={href}>
                            {j.counts.to_review ? `Review ${j.counts.to_review}` : 'View'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="space-y-3 tablet:hidden" aria-label="Jobs with submissions">
              {rows.map((j) => {
                const href = jobReviewHref(j, range);
                return (
                  <li key={j.public_id} className="relative rounded-card border border-line bg-surface p-4 shadow-xs">
                    <div className="flex items-start justify-between gap-2">
                      <StatusBadge enum="job_status" code={j.status} label={j.status === 'suspended' ? 'Suspended' : undefined} />
                      {j.counts.to_review ? <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-label-sm font-semibold text-fg-warning">{j.counts.to_review} to review</span> : null}
                    </div>
                    <NextLink href={href} className="mt-2 block text-label-md text-fg after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:shadow-focus">
                      {j.title || 'Untitled job'}
                    </NextLink>
                    <p className="mt-0.5 text-body-xs text-fg-secondary">
                      {j.counts.approved} approved · {j.counts.rejected} rejected · {j.last_submitted_at ? `last ${formatRelative(j.last_submitted_at)}` : 'no submissions yet'}
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      <p className="mt-4 text-body-xs text-fg-tertiary">Unreviewed submissions are approved automatically when the review window ends.</p>
    </div>
  );
}
