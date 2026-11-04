'use client';
/** SCR-WRK-06 My tasks (Figma 30:1824, mobile 48:1101). Tabs, search, date range and page live in the URL. */
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { WorkerTaskRow } from '@24f/shared';
import { WORKER_TASK_RANGES, WORKER_TASK_RANGE_LABEL, WORKER_TASK_TABS, formatDateTime, formatHoursLeft, formatMoney, formatRelative, formatReward, type WorkerTaskRange, type WorkerTaskTab } from '@24f/shared';
import { Button, EmptyState, Pagination, Search, Select, Skeleton, StatCard, TabPanel, Tabs, TaskRow, cn, useStaggerIn } from '@24f/ui';
import { useWorkerTasks } from '../data';
import { LoadError, MobileTitle } from '../ui';

const TAB_LABEL: Record<WorkerTaskTab, string> = { all: 'All', in_review: 'In review', approved: 'Approved', needs_fix: 'Needs fix', rejected: 'Rejected' };
const EMPTY: Record<Exclude<WorkerTaskTab, 'all'>, { title: string; body: string; cta?: boolean }> = {
  in_review: { title: 'Nothing in review', body: 'Tasks you submit wait here until the employer decides.', cta: true },
  approved: { title: 'No approved tasks yet', body: 'Approved rewards go straight to your balance.', cta: true },
  needs_fix: { title: 'Nothing needs a fix', body: 'If an employer asks for a fix, you’ll see the reason here.' },
  rejected: { title: 'No rejected tasks', body: 'Rejections always come with a reason.' },
};
const RANGE_OPTIONS = WORKER_TASK_RANGES.map((r) => ({ value: r, label: WORKER_TASK_RANGE_LABEL[r] }));
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function rowFor(t: WorkerTaskRow, now: number) {
  const due = t.review_due_at ? new Date(t.review_due_at).getTime() - now : null;
  return {
    ref: t.ref,
    title: t.job_title,
    employer: t.employer_name,
    submittedLabel: `Submitted ${formatRelative(t.submitted_at, now).replace(/^Yesterday$/, 'yesterday')}`,
    rewardLabel: formatReward(t.reward_usd),
    status: t.status,
    meta:
      t.status === 'in_review'
        ? t.waiting_for_employer
          ? 'Waiting for the employer'
          : due !== null
            ? `Review due in ${formatHoursLeft(Math.max(0, due))}`
            : undefined
        : t.status === 'approved'
          ? 'Paid to balance'
          : t.dispute_open
            ? 'Dispute open'
            : undefined,
    reason: t.rejection_reason_text ?? undefined,
    deadline: t.status === 'needs_fix' && t.resubmit_deadline ? `Resubmit by ${formatDateTime(t.resubmit_deadline, now)}` : undefined,
  } as const;
}

export function TasksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tab = ((WORKER_TASK_TABS as readonly string[]).includes(sp.get('tab') ?? '') ? sp.get('tab') : 'all') as WorkerTaskTab;
  const range = ((WORKER_TASK_RANGES as readonly string[]).includes(sp.get('range') ?? '') ? sp.get('range') : 'last_30_days') as WorkerTaskRange;
  const qText = sp.get('q') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? 1) || 1);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const build = (p: { tab?: string; q?: string; range?: string; page?: number }) => {
    const s = new URLSearchParams();
    const t = p.tab ?? tab;
    const qq = p.q ?? qText;
    const r = p.range ?? range;
    const pg = p.page ?? 1;
    if (t !== 'all') s.set('tab', t);
    if (qq) s.set('q', qq);
    if (r !== 'last_30_days') s.set('range', r);
    if (pg > 1) s.set('page', String(pg));
    return s.toString();
  };
  const apiQs = useMemo(() => {
    const s = new URLSearchParams(build({ page }));
    s.set('range', range);
    return s.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, qText, range, page]);
  const href = (p: Parameters<typeof build>[0]) => {
    const s = build(p);
    return `${pathname}${s ? `?${s}` : ''}`;
  };

  const q = useWorkerTasks(apiQs);
  const data = q.data;
  const s = data?.meta.summary;
  const listRef = useStaggerIn<HTMLUListElement>([apiQs, data?.data.length ?? 0]);

  return (
    <div className="space-y-6">
      <MobileTitle title="My tasks" />

      {/* Stat cards */}
      {s ? (
        <>
          <div className="hidden gap-6 tablet:grid tablet:grid-cols-3">
            <StatCard
              type="default"
              label="Pending review"
              value={formatMoney(s.pending_review_usd)}
              badge={{ label: plural(s.pending_review_tasks, 'task'), tone: 'warning' }}
              meta={s.pending_review_tasks ? 'Usually reviewed within 24 h' : undefined}
              countUp
            />
            <StatCard
              type="trend"
              label="Approved this month"
              value={formatMoney(s.approved_this_month_usd)}
              valueTone="success"
              trendPercent={s.approved_trend_percent}
              meta={`vs. last month · ${plural(s.approved_this_month_tasks, 'task')}`}
              countUp
            />
            <StatCard
              type="progress"
              label="Approval rate · last 30 days"
              value={s.approval_rate_percent !== null ? `${s.approval_rate_percent}%` : '—'}
              meta={s.approval_rate_percent !== null ? `${s.approved_30d} approved · ${s.rejected_30d} rejected` : 'Shown after 5 decisions'}
              progress={{ value: s.approval_rate_percent ?? 0, max: 100, valueText: s.approval_rate_percent !== null ? `${s.approval_rate_percent}% approved` : 'Not enough decisions yet' }}
              countUp
            />
          </div>
          <dl className="grid grid-cols-3 divide-x divide-line-subtle rounded-card border border-line bg-surface py-3 shadow-xs tablet:hidden">
            {[
              ['In review', formatMoney(s.pending_review_usd), ''],
              ['Approved', formatMoney(s.approved_this_month_usd), 'text-fg-success'],
              ['Rate', s.approval_rate_percent !== null ? `${s.approval_rate_percent}%` : '—', ''],
            ].map(([k, v, c]) => (
              <div key={k} className="flex flex-col-reverse px-3">
                <dd className={cn('font-display text-num-md tabular-nums text-fg', c)}>{v}</dd>
                <dt className="text-body-xs text-fg-tertiary">{k}</dt>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <div className="grid gap-3 tablet:grid-cols-3 tablet:gap-6">
          <Skeleton.StatCard />
          <div className="max-tablet:hidden">
            <Skeleton.StatCard />
          </div>
          <div className="max-tablet:hidden">
            <Skeleton.StatCard />
          </div>
        </div>
      )}

      {/* Tabs + toolbar */}
      <div className="flex flex-col gap-3 desktop:flex-row desktop:items-end desktop:justify-between">
        <Tabs<WorkerTaskTab>
          label="Task status"
          panelId="tasks-panel"
          value={tab}
          hrefFor={(v) => href({ tab: v })}
          tabs={WORKER_TASK_TABS.map((t) => ({ value: t, label: TAB_LABEL[t], count: data?.meta.counts[t] }))}
          className="min-w-0 max-tablet:-mx-5 max-tablet:px-5"
        />
        <div className="flex gap-3">
          <Search size="M" label="Search your tasks" placeholder="Search your tasks" value={qText} onValueChange={(v) => v !== qText && router.replace(href({ q: v }), { scroll: false })} className="min-w-0 flex-1 desktop:w-[240px]" />
          <div className="w-[170px] shrink-0">
            <Select label="Date range" labelHidden options={RANGE_OPTIONS} value={range} onChange={(v) => router.replace(href({ range: v }), { scroll: false })} />
          </div>
        </div>
      </div>

      <TabPanel id="tasks-panel">
        {q.isError && !data ? (
          <LoadError error={q.error} onRetry={() => q.refetch()} title="We couldn’t load your tasks" body="Check your connection and try again. Nothing you submitted was lost." />
        ) : !data ? (
          <div className="overflow-hidden rounded-card border border-line bg-surface" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton.TaskRow key={i} />
            ))}
          </div>
        ) : data.data.length ? (
          <ul
            ref={listRef}
            className={cn(
              'max-tablet:space-y-3 tablet:divide-y tablet:divide-line-subtle tablet:overflow-hidden tablet:rounded-card tablet:border tablet:border-line tablet:bg-surface tablet:shadow-xs',
              q.isFetching && q.isPlaceholderData && 'opacity-60',
            )}
          >
            {data.data.map((t) => (
              <TaskRow
                key={t.ref}
                task={rowFor(t, now)}
                href={t.status === 'needs_fix' && t.fix_allowed !== false ? `/worker/tasks/${t.ref}/fix` : `/worker/tasks/${t.ref}`}
                fixHref={t.status === 'needs_fix' && t.fix_allowed !== false ? `/worker/tasks/${t.ref}/fix` : undefined}
                className={cn('tablet:[&>div:first-child]:grid-cols-[minmax(0,1fr)_96px_120px_150px] max-tablet:rounded-card max-tablet:border max-tablet:bg-surface max-tablet:shadow-xs', t.status === 'needs_fix' ? 'max-tablet:border-line-danger' : 'max-tablet:border-line')}
              />
            ))}
          </ul>
        ) : (
          <div className="rounded-card border border-line bg-surface">
            {qText ? (
              <EmptyState icon="search" title="No tasks match your search" body="Try another word or a wider date range." />
            ) : tab === 'all' ? (
              <EmptyState
                icon="list-checks"
                title="No tasks yet"
                body="When you submit work, you’ll track every review here — from “In review” to “Paid”."
                action={<Button href="/worker/jobs">Find jobs</Button>}
              />
            ) : (
              <EmptyState
                icon="list-checks"
                title={EMPTY[tab].title}
                body={EMPTY[tab].body}
                action={
                  EMPTY[tab].cta ? (
                    <Button variant="secondary" href="/worker/jobs">
                      Find jobs
                    </Button>
                  ) : undefined
                }
              />
            )}
          </div>
        )}
      </TabPanel>

      {data && data.meta.total > 0 ? (
        <Pagination page={data.meta.page} totalPages={Math.max(1, data.meta.total_pages)} total={data.meta.total} perPage={data.meta.per_page} hrefFor={(p) => href({ page: p })} />
      ) : null}
    </div>
  );
}
