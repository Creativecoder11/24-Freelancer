'use client';
/** SCR-WRK-01 Worker overview (Figma 28:477, mobile 47:686). Data: GET /worker/overview. */
import NextLink from 'next/link';
import { useEffect, useState } from 'react';
import type { WorkerOverview } from '@24f/shared';
import { formatMoney, formatRelative, formatReward, formatHoursLeft } from '@24f/shared';
import { Alert, Button, EmptyState, JobRow, Link, Skeleton, StatCard, StatusBadge, TaskRow, cn, useStaggerIn } from '@24f/ui';
import { toRowData } from '@/lib/jobs';
import { useOverview } from '../data';
import { useWorkerHeader } from '../shell';
import { LoadError, Panel } from '../ui';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function overviewSubtitle(o: WorkerOverview): string {
  const { tasks_in_review: t, new_matching_jobs: j } = o.subtitle_counts;
  if (!t && !j) return 'Here’s what’s happening with your tasks today.';
  if (!j) return `You have ${plural(t, 'task')} in review.`;
  if (!t) return `You have ${plural(j, 'new job')} that match your interests.`;
  return `You have ${plural(t, 'task')} in review and ${plural(j, 'new job')} that match your interests.`;
}

function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export function OverviewPage() {
  const q = useOverview();
  const o = q.data;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  useWorkerHeader(o ? { title: o.greeting, subtitle: overviewSubtitle(o) } : null);
  const recRef = useStaggerIn<HTMLUListElement>([o?.recommended.jobs.length ?? 0]);
  const actRef = useStaggerIn<HTMLUListElement>([o?.recent_activity.length ?? 0]);
  const waitRef = useStaggerIn<HTMLUListElement>([o?.waiting_for_review.items.length ?? 0]);

  if (q.isError && !o) return <LoadError error={q.error} onRetry={() => q.refetch()} />;

  const tc = o ? `${plural(o.subtitle_counts.tasks_in_review, 'task')} in review · ${plural(o.subtitle_counts.new_matching_jobs, 'new match', 'new matches')}` : '';

  return (
    <div className="space-y-6">
      {/* Mobile greeting (47:686) */}
      <div className="tablet:hidden">
        {o ? (
          <>
            <h2 className="font-display text-h3 text-fg">{o.greeting}</h2>
            <p className="mt-0.5 text-body-sm text-fg-tertiary">{tc}</p>
          </>
        ) : (
          <Skeleton width={220} height={28} />
        )}
      </div>

      {/* Row 1: stat cards */}
      {o ? (
        <div className="grid grid-cols-2 gap-3 tablet:grid-cols-3 tablet:gap-6">
          <StatCard
            type="balance"
            label="Available balance"
            value={formatMoney(o.stats.available_usd)}
            meta={`Pending review: ${formatMoney(o.stats.pending_review_usd)}`}
            action={{ label: 'Withdraw', href: '/worker/wallet/withdraw' }}
            countUp
            className="col-span-2 tablet:col-span-1"
          />
          <StatCard
            type="default"
            label="Pending review"
            value={formatMoney(o.stats.pending_review_usd)}
            badge={{ label: plural(o.stats.pending_review_tasks, 'task'), tone: 'warning' }}
            meta={o.stats.show_usually_reviewed_24h || o.stats.pending_review_tasks ? 'Usually reviewed within 24 h' : undefined}
            countUp
            className="max-tablet:hidden"
          />
          <StatCard
            type="trend"
            label="Approved this month"
            value={formatMoney(o.stats.approved_this_month_usd)}
            valueTone="success"
            trendPercent={o.stats.approved_trend_percent}
            meta={`vs. last month · ${plural(o.stats.approved_this_month_tasks, 'task')}`}
            countUp
            className="max-tablet:hidden"
          />
          {/* Mobile mini cards */}
          <MiniStat label="Pending" value={formatMoney(o.stats.pending_review_usd)} meta={`${plural(o.stats.pending_review_tasks, 'task')} in review`} />
          <MiniStat
            label="This month"
            value={formatMoney(o.stats.approved_this_month_usd)}
            meta={o.stats.approved_trend_percent !== null ? `${o.stats.approved_trend_percent > 0 ? '+' : ''}${o.stats.approved_trend_percent}% vs. last month` : 'This month so far'}
            success
          />
        </div>
      ) : (
        <div className="grid gap-3 tablet:grid-cols-3 tablet:gap-6">
          <Skeleton.StatCard />
          <Skeleton.StatCard />
          <Skeleton.StatCard />
        </div>
      )}

      {/* Post-onboarding nudges (C-10) */}
      {o ? <Nudges o={o} /> : null}

      {/* Row 2: recommended + right column */}
      <div className="grid gap-6 desktop:grid-cols-[minmax(0,1fr)_352px]">
        <section aria-labelledby="rec-h" className="min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="rec-h" className="font-display text-h4 text-fg">
                Recommended
              </h2>
              <p className="mt-1 hidden text-body-sm text-fg-tertiary tablet:block">
                {o
                  ? o.recommended.based_on.length
                    ? `Based on ${joinList(o.recommended.based_on)}`
                    : 'Newest jobs. Add interests to tailor this.'
                  : ' '}
              </p>
            </div>
            <Link href="/worker/jobs?chip=for_you" className="mt-1 shrink-0">
              See all
            </Link>
          </div>
          {o ? (
            o.recommended.jobs.length ? (
              <ul ref={recRef} className="mt-4 divide-y divide-line-subtle overflow-hidden rounded-card border border-line bg-surface shadow-xs">
                {o.recommended.jobs.slice(0, 5).map((j, i) => (
                  <JobRow
                    key={j.public_id}
                    job={toRowData(j, now)}
                    href={`/worker/jobs/${j.public_id}`}
                    ctaLabel={j.my_state === 'in_progress' ? 'Continue' : j.my_state === 'done' ? 'View task' : 'View'}
                    className={cn(i > 2 && 'max-tablet:hidden')}
                  />
                ))}
              </ul>
            ) : (
              <Panel className="mt-4">
                <EmptyState
                  icon="briefcase"
                  title="Nothing to recommend yet"
                  body="Add more interests to see more jobs here."
                  action={
                    <Button variant="secondary" href="/worker/settings#interests">
                      Update interests
                    </Button>
                  }
                />
              </Panel>
            )
          ) : (
            <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-xs [&>*:last-child]:border-b-0" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton.JobRow key={i} />
              ))}
            </div>
          )}
        </section>

        <div className="hidden space-y-6 tablet:block">
          <Panel aria-labelledby="act-h" className="p-5">
            <div className="flex items-center justify-between">
              <h2 id="act-h" className="text-h5 text-fg">
                Recent activity
              </h2>
              <Link href="/worker/notifications" className="text-label-sm">
                View all
              </Link>
            </div>
            {o ? (
              o.recent_activity.length ? (
                <ul ref={actRef} className="mt-2 divide-y divide-line-subtle">
                  {o.recent_activity.slice(0, 5).map((a, i) => {
                    const inner = (
                      <>
                        <span className="min-w-0">
                          <span className="block text-label-md text-fg">{a.title}</span>
                          <span className="block truncate text-body-sm text-fg-tertiary">{a.description}</span>
                        </span>
                        <span className="shrink-0 text-body-xs text-fg-tertiary">{formatRelative(a.occurred_at, now)}</span>
                      </>
                    );
                    return (
                      <li key={`${a.kind}-${a.occurred_at}-${i}`}>
                        {a.link_path ? (
                          <NextLink href={a.link_path} className="-mx-2 flex items-start justify-between gap-3 rounded-[10px] px-2 py-4 hover:bg-subtle focus-visible:shadow-focus focus-visible:outline-none">
                            {inner}
                          </NextLink>
                        ) : (
                          <div className="flex items-start justify-between gap-3 py-4">{inner}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState compact icon="inbox" title="Nothing here yet" body="Your approvals and payouts will show up here." />
              )
            ) : (
              <div className="mt-4 space-y-5">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton width="60%" height={14} />
                    <Skeleton width="80%" height={12} />
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* Row 4: waiting for review (hidden when none) */}
      {o && o.waiting_for_review.total > 0 ? (
        <section aria-labelledby="wait-h" className="hidden overflow-hidden rounded-card border border-line bg-surface shadow-xs tablet:block">
          <div className="flex items-center justify-between gap-4 border-b border-line-subtle px-5 py-4 desktop:px-6">
            <div className="flex items-center gap-3">
              <h2 id="wait-h" className="text-h5 text-fg">
                Waiting for review
              </h2>
              <StatusBadge tone="warning" label={plural(o.waiting_for_review.total, 'task')} />
            </div>
            <Link href="/worker/tasks?tab=in_review">Go to My tasks</Link>
          </div>
          <ul ref={waitRef} className="divide-y divide-line-subtle">
            {o.waiting_for_review.items.slice(0, 3).map((t) => (
              <TaskRow
                key={t.ref}
                className="tablet:[&>div:first-child]:grid-cols-[minmax(0,1fr)_96px_120px_150px]"
                href={`/worker/tasks/${t.ref}`}
                task={{
                  ref: t.ref,
                  title: t.job_title,
                  employer: t.employer_name,
                  submittedLabel: `Submitted ${formatRelative(t.submitted_at, now)}`,
                  rewardLabel: formatReward(t.reward_usd),
                  status: 'in_review',
                  meta: t.review_due_at ? `Review due in ${formatHoursLeft(Math.max(0, new Date(t.review_due_at).getTime() - now))}` : undefined,
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function MiniStat({ label, value, meta, success }: { label: string; value: string; meta: string; success?: boolean }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-xs tablet:hidden">
      <h3 className="text-body-sm text-fg-secondary">{label}</h3>
      <p className={cn('mt-1 font-display text-num-lg tabular-nums', success ? 'text-fg-success' : 'text-fg')}>{value}</p>
      <p className="mt-1 text-body-xs text-fg-tertiary">{meta}</p>
    </section>
  );
}

function Nudges({ o }: { o: WorkerOverview }) {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    try {
      setHidden(JSON.parse(localStorage.getItem('fl_wrk_nudges') ?? '[]'));
    } catch {
      /* ignore */
    }
  }, []);
  const dismiss = (k: string) => {
    const next = [...hidden, k];
    setHidden(next);
    try {
      localStorage.setItem('fl_wrk_nudges', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const items: { key: string; title: string; body: string; href: string; cta: string }[] = [];
  if (o.nudges.active_reservation)
    items.push({ key: `res-${o.nudges.active_reservation.id}`, title: 'You have a job in progress', body: `“${o.nudges.active_reservation.job_title}” — finish and submit before the timer ends.`, href: `/worker/jobs/${o.nudges.active_reservation.job_public_id}`, cta: 'Continue' });
  if (o.nudges.no_payout_method) items.push({ key: 'payout', title: 'Add a payout method', body: 'Add one now so your first withdrawal is quick.', href: '/worker/settings#payout-methods', cta: 'Add a payout method' });
  if (!o.nudges.setup.starter_task_done) items.push({ key: 'starter', title: 'Try a starter task', body: 'Earn your first reward.', href: '/worker/jobs', cta: 'Find a starter task' });
  const visible = items.filter((i) => i.key.startsWith('res-') || !hidden.includes(i.key));
  if (!visible.length) return null;
  return (
    <div className="space-y-3">
      {visible.map((n) => (
        <Alert
          key={n.key}
          tone="info"
          title={n.title}
          onDismiss={n.key.startsWith('res-') ? undefined : () => dismiss(n.key)}
          action={
            <Button size="S" variant="secondary" href={n.href}>
              {n.cta}
            </Button>
          }
        >
          {n.body}
        </Alert>
      ))}
    </div>
  );
}
