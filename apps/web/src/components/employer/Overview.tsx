'use client';
import NextLink from 'next/link';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Avatar, Button, EmptyState, Icon, Progress, Skeleton, StatCard, StatusBadge, cn, toast, useStaggerIn } from '@24f/ui';
import { formatMoney, formatRelative, formatReward } from '@24f/shared';
import { api, ApiError, errorText, idemKey, invalidateEmployer, useOverview, useQueryClient, type Overview as OverviewData, type RunningJob } from './api';
import { useEmployerHeader } from './shell';
import { SpendingChart } from './SpendingChart';
import { RejectDialog, type RejectTarget } from './RejectDialog';
import { ErrorPanel, endsLabel, pausedLabel } from './common';

/** SCR-EMP-01 Employer overview (Figma 32:477). */
export function Overview() {
  const q = useOverview();
  const d = q.data;
  useEmployerHeader({
    title: d?.greeting ?? 'Overview',
    subtitle: d
      ? d.subtitle_counts.waiting > 0
        ? `${d.subtitle_counts.waiting} ${d.subtitle_counts.waiting === 1 ? 'submission is' : 'submissions are'} waiting for your review across ${d.subtitle_counts.running_jobs} running ${d.subtitle_counts.running_jobs === 1 ? 'job' : 'jobs'}.`
        : d.subtitle_counts.running_jobs > 0
          ? `Nothing is waiting for review. ${d.subtitle_counts.running_jobs} running ${d.subtitle_counts.running_jobs === 1 ? 'job' : 'jobs'}.`
          : 'Post a job to get work done. You see the full cost upfront.'
      : undefined,
  });

  if (q.isError) return <ErrorPanel onRetry={() => q.refetch()} />;
  if (!d) return <OverviewSkeleton />;
  return <OverviewBody d={d} />;
}

function OverviewBody({ d }: { d: OverviewData }) {
  const s = d.stats;
  const isNew = d.running_jobs.length === 0 && Number(s.deposit_balance_usd) === 0 && s.approved_this_month_tasks === 0;
  const cards = useStaggerIn<HTMLDivElement>([], { selector: '[data-stagger]' });
  return (
    <div ref={cards} className="space-y-6 tablet:space-y-8">
      <div className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-3 desktop:gap-6">
        <div data-stagger>
          <StatCard
            type="balance"
            label="Deposit balance"
            value={formatMoney(s.deposit_balance_usd)}
            countUp
            action={{ label: 'Add funds', href: '/employer/wallet' }}
            meta={`Reserved for running jobs: ${formatMoney(s.reserved_usd)}`}
            className="h-full"
          />
        </div>
        <div data-stagger>
          <StatCard
            type="default"
            label="Waiting for your review"
            value={String(s.waiting_for_review)}
            countUp
            badge={s.waiting_jobs > 0 ? { label: `${s.waiting_jobs} ${s.waiting_jobs === 1 ? 'job' : 'jobs'}`, tone: 'warning' } : undefined}
            meta={s.oldest_waiting_submitted_at ? `Oldest submitted ${formatRelative(s.oldest_waiting_submitted_at)}` : 'Nothing waiting'}
            className="h-full"
          />
        </div>
        <div data-stagger className="tablet:col-span-2 desktop:col-span-1">
          <StatCard
            type="trend"
            label="Spent this month"
            value={formatMoney(s.spent_this_month_usd)}
            valueTone="success"
            countUp
            trendPercent={s.spent_trend_percent}
            meta={`${s.approved_this_month_tasks} approved ${s.approved_this_month_tasks === 1 ? 'task' : 'tasks'}`}
            className="h-full"
          />
        </div>
      </div>

      {isNew ? (
        <Alert brand title="Post your first job" action={<Button size="S" href="/employer/jobs/new">Post a job</Button>}>
          Set a reward and slots. You see the full cost before anything is published.
        </Alert>
      ) : null}
      {d.alerts.low_deposit.visible ? (
        <Alert
          tone="warning"
          title="Low deposit balance"
          action={
            <NextLink href="/employer/wallet" className="whitespace-nowrap text-label-md font-semibold text-fg-warning hover:underline">
              Add funds
            </NextLink>
          }
        >
          {d.alerts.low_deposit.paused_jobs > 0
            ? `${d.alerts.low_deposit.paused_jobs} ${d.alerts.low_deposit.paused_jobs === 1 ? 'job is' : 'jobs are'} paused because your deposit ran low. Add funds to resume.`
            : `Your reserve can’t cover remaining slots. Add funds to keep jobs running.`}
        </Alert>
      ) : null}
      {d.alerts.decision_needed.visible ? (
        <Alert
          tone="warning"
          title={`${d.alerts.decision_needed.count} ${d.alerts.decision_needed.count === 1 ? 'submission needs' : 'submissions need'} a decision`}
          action={
            <NextLink href="/employer/submissions" className="whitespace-nowrap text-label-md font-semibold text-fg-warning hover:underline">
              Review now
            </NextLink>
          }
        >
          Unreviewed work is auto-approved when each job’s review window ends. Review now to keep your quality bar.
        </Alert>
      ) : null}

      <nav aria-label="Quick actions" className="grid grid-cols-2 gap-3 desktop:grid-cols-4 desktop:gap-6">
        <QuickAction href="/employer/jobs/new" title="Post a job" sub="Cost shown upfront" icon="plus-circle" />
        <QuickAction href="/employer/submissions" title="Review submissions" sub={`${d.quick_actions.review_waiting} waiting`} icon="inbox" />
        <QuickAction href="/employer/wallet" title="Add funds" sub={`Balance ${formatMoney(d.quick_actions.deposit_balance_usd)}`} icon="wallet" />
        <QuickAction href="/employer/wallet/transactions" title="Transactions" sub="Deposits & spending" icon="file-text" />
      </nav>

      <section aria-labelledby="running-h">
        <div className="flex items-center justify-between">
          <h2 id="running-h" className="font-display text-h4 text-fg tablet:text-h3">
            Running jobs
          </h2>
          <NextLink href="/employer/jobs" className="text-label-md font-semibold text-fg-brand hover:underline">
            See all jobs
          </NextLink>
        </div>
        {d.running_jobs.length ? (
          <ul className="mt-4 grid gap-4 tablet:grid-cols-2 desktop:grid-cols-3 desktop:gap-6">
            {d.running_jobs.map((j) => (
              <li key={j.public_id} data-stagger>
                <RunningJobCard j={j} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 rounded-card border border-line bg-surface">
            <EmptyState compact icon="briefcase" title="No running jobs" body="Publish a job to start getting work done." action={<Button href="/employer/jobs/new">Post a job</Button>} />
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 desktop:grid-cols-[minmax(0,1fr)_352px] [&>*]:min-w-0">
        <SpendingChart />
        <LatestSubmissions items={d.latest_submissions} />
      </div>
    </div>
  );
}

function QuickAction({ href, title, sub, icon }: { href: string; title: string; sub: string; icon: 'plus-circle' | 'inbox' | 'wallet' | 'file-text' }) {
  return (
    <NextLink
      href={href}
      data-stagger
      className="group flex min-h-[80px] items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-xs transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:shadow-focus focus-visible:outline-none tablet:px-4 tablet:py-5"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-brand-subtle text-fg-brand desktop:hidden">
        <Icon name={icon} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-label-md text-fg">{title}</span>
        <span className="mt-0.5 block truncate text-body-sm text-fg-secondary">{sub}</span>
      </span>
      <Icon name="arrow-right" size={20} className="hidden shrink-0 text-fg-tertiary transition-transform group-hover:translate-x-0.5 desktop:block" />
    </NextLink>
  );
}

export function RunningJobCard({ j }: { j: RunningJob }) {
  const footer = j.status === 'running' ? endsLabel(j.ends_at) : pausedLabel(j.pause_reason, j.paused_at, j.status);
  return (
    <article className="relative flex h-full flex-col rounded-card border border-line bg-surface p-5 shadow-xs transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <StatusBadge enum="job_status" code={j.status} />
        {j.to_review > 0 ? <span className="text-label-sm font-semibold text-fg-warning">{j.to_review} to review</span> : null}
      </div>
      <h3 className="mt-3 line-clamp-2 text-h5 text-fg">
        <NextLink href={`/employer/jobs/${j.public_id}`} className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:shadow-focus">
          {j.title}
        </NextLink>
      </h3>
      <div className="mt-3 flex items-baseline justify-between gap-2 text-body-sm">
        <span className="text-fg-secondary">
          {j.approved} of {j.slots_total} approved
        </span>
        <span className="font-semibold tabular-nums text-fg">
          {formatMoney(j.spent_usd)} of {formatMoney(j.budget_total_usd)}
        </span>
      </div>
      <Progress className="mt-2" tone="success" value={j.approved} max={Math.max(1, j.slots_total)} valueText={`${j.approved} of ${j.slots_total} approved`} />
      <div className="mt-auto pt-5">
        <div className="flex items-center justify-between border-t border-line-subtle pt-4">
          <span className="text-body-sm text-fg-secondary">{footer}</span>
          <NextLink href={`/employer/submissions?job=${j.public_id}`} className="relative z-[1] text-label-md font-semibold text-fg-brand hover:underline">
            Review
          </NextLink>
        </div>
      </div>
    </article>
  );
}

function LatestSubmissions({ items }: { items: OverviewData['latest_submissions'] }) {
  const qc = useQueryClient();
  const [reject, setReject] = useState<RejectTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const list = useStaggerIn<HTMLUListElement>([items.length]);
  const approve = useMutation({
    mutationFn: (ref: string) => api.post(`/employer/submissions/${ref}/approve`, {}, { headers: { 'Idempotency-Key': idemKey() } }),
    onMutate: (ref) => setBusy(ref),
    onSettled: () => setBusy(null),
    onSuccess: (_r, ref) => {
      const it = items.find((i) => i.ref === ref);
      toast.show({ tone: 'success', title: `Approved · ${formatReward(it?.unit_cost_usd ?? '0')}`, body: 'The reward moved to the worker.' });
      void invalidateEmployer(qc);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'ALREADY_DECIDED') toast.show({ tone: 'warning', title: 'This submission was already decided. We’ve refreshed the list.' });
      else toast.show({ tone: 'danger', title: 'That didn’t save', body: errorText(e) });
      void invalidateEmployer(qc);
    },
  });
  return (
    <section aria-labelledby="latest-h" className="rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6">
      <div className="flex items-center justify-between">
        <h2 id="latest-h" className="text-h5 text-fg tablet:text-h4">
          Latest submissions
        </h2>
        <NextLink href="/employer/submissions" className="text-label-sm font-semibold text-fg-brand hover:underline">
          View queue
        </NextLink>
      </div>
      {items.length ? (
        <ul ref={list} className="mt-3 divide-y divide-line-subtle">
          {items.map((s) => (
            <li key={s.ref} className={cn('flex items-center gap-3 py-3.5', busy === s.ref && 'opacity-60')}>
              <Avatar initials={s.worker_initials} size="M" tone="brand" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-label-sm font-semibold text-fg">
                  {s.worker_name_masked} · {formatRelative(s.submitted_at)}
                </p>
                <NextLink href={`/employer/submissions?job=${s.job_public_id}&sub=${s.ref}`} className="block truncate text-body-xs text-fg-secondary hover:underline">
                  {s.job_title}
                </NextLink>
              </div>
              <DecisionButton
                tone="danger"
                icon="x"
                label={`Reject submission from ${s.worker_name_masked}`}
                onClick={() => setReject({ ref: s.ref, workerName: s.worker_name_masked, reward: s.unit_cost_usd, jobPublicId: s.job_public_id })}
                disabled={busy === s.ref}
              />
              <DecisionButton tone="success" icon="check" label={`Approve · ${formatReward(s.unit_cost_usd)}`} onClick={() => approve.mutate(s.ref)} disabled={busy === s.ref} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact icon="inbox" title="No submissions yet." />
      )}
      <RejectDialog
        target={reject}
        onOpenChange={(o) => !o && setReject(null)}
        onRejected={() => {
          setReject(null);
          void invalidateEmployer(qc);
        }}
      />
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading overview">
      <div className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-3 desktop:gap-6">
        <Skeleton.StatCard />
        <Skeleton.StatCard />
        <Skeleton.StatCard />
      </div>
      <Skeleton height={72} radius={12} />
      <div className="grid grid-cols-2 gap-3 desktop:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={80} radius={16} />
        ))}
      </div>
      <div className="grid gap-4 desktop:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={196} radius={16} />
        ))}
      </div>
    </div>
  );
}

/** 32 px tinted icon tile (Figma 32:729): reject = danger-subtle ✕, approve = success-subtle ✓; 44 px hit area. */
function DecisionButton({ tone, icon, label, onClick, disabled }: { tone: 'danger' | 'success'; icon: 'x' | 'check'; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'relative grid size-8 shrink-0 place-items-center rounded-[8px] transition-colors focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-50',
        "before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
        tone === 'danger' ? 'bg-danger-subtle text-fg-danger hover:bg-danger hover:text-fg-inverse' : 'bg-success-subtle text-fg-success hover:bg-success hover:text-fg-inverse',
      )}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
