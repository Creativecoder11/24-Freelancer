'use client';
/**
 * SCR-WRK-04 Job details and instructions (Figma 29:1226, mobile 47:1033) with the undesigned
 * states from G-08: pre-start "Start this job", full, already done, slot expired, not eligible,
 * paused/closed, restricted. In progress: slot countdown, tickable steps synced with
 * PUT /worker/reservations/{id}/progress (500 ms debounce), task link, Release slot dialog.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { StartJobResponse, WorkerJobDetail } from '@24f/shared';
import { formatMmSs, formatRelative, formatReward } from '@24f/shared';
import { Alert, Button, Checkbox, EmptyState, Icon, LinkButton, Progress, Skeleton, StatusBadge, StickyActionBar, cn, useStaggerIn, useToast } from '@24f/ui';
import { api, ApiError } from '@/lib/api/client';
import { useCountdown } from '@/lib/use-countdown';
import { useWorkerJob, wk } from '../data';
import { useWorkerHeader } from '../shell';
import { BackLink, EmployerCard, LoadError, Panel, Rows, shortUrl, usePulse, useTickBounce } from '../ui';
import { ExpiredDialog, ReleaseDialog, ReportDialog } from './dialogs';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Reservation countdown on the server clock: ms left. */
export function useSlotLeft(expiresAt: string | null | undefined, offset: number) {
  const target = expiresAt ? new Date(expiresAt).getTime() - offset : null;
  return useCountdown(target);
}

function proofNeeds(job: WorkerJobDetail): string {
  const items = job.proof_requirements.map((p) => p.title.charAt(0).toLowerCase() + p.title.slice(1));
  if (!items.length) return 'the proof listed by the employer.';
  return `${items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0]}.`;
}

export function JobDetail({ publicId }: { publicId: string }) {
  const q = useWorkerJob(publicId);
  const job = q.data?.job;
  const offset = q.data?.offset ?? 0;
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  useWorkerHeader(job ? { subtitle: [job.category?.name, job.employer.business_name].filter(Boolean).join(' · ') } : null);

  if (q.isError && !job) {
    if (q.error.status === 404)
      return (
        <Panel>
          <EmptyState
            icon="search"
            title="This job isn’t available"
            body="It may have closed or been removed."
            action={
              <Button variant="secondary" href="/worker/jobs">
                Browse jobs
              </Button>
            }
          />
        </Panel>
      );
    return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  }
  if (!job) return <DetailSkeleton />;

  return (
    <>
      <JobView job={job} offset={offset} onRelease={() => setReleaseOpen(true)} onReport={() => setReportOpen(true)} />
      {job.reservation ? <ReleaseDialog open={releaseOpen} onOpenChange={setReleaseOpen} reservationId={job.reservation.id} publicId={job.public_id} /> : null}
      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} publicId={job.public_id} />
    </>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-6 desktop:grid-cols-[minmax(0,1fr)_360px]" aria-busy="true">
      <div className="space-y-6">
        <Panel>
          <Skeleton width={120} height={14} />
          <Skeleton width="80%" height={32} className="mt-4" />
          <Skeleton width="50%" height={14} className="mt-3" />
          <Skeleton width="100%" height={72} radius={12} className="mt-6" />
        </Panel>
        <Panel>
          <Skeleton width={140} height={22} />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={64} radius={12} className="mt-4" />
          ))}
        </Panel>
      </div>
      <div className="space-y-6">
        <Panel>
          <Skeleton width={160} height={14} />
          <Skeleton width={140} height={40} className="mt-3" />
          <Skeleton width="100%" height={6} className="mt-6" />
        </Panel>
        <Panel>
          <Skeleton width="70%" height={20} />
          <Skeleton width="100%" height={60} className="mt-4" />
        </Panel>
      </div>
    </div>
  );
}

function headerBadge(job: WorkerJobDetail) {
  switch (job.start_state) {
    case 'in_progress':
      return <StatusBadge tone="warning" label="In progress" />;
    case 'full':
      return <StatusBadge tone="neutral" label="Full" />;
    case 'already_done':
      return job.submission_status ? <StatusBadge enum="submission_status" code={job.submission_status} /> : <StatusBadge tone="success" label="Submitted" />;
    case 'paused':
      return <StatusBadge tone="warning" label="Paused" />;
    case 'closed':
      return <StatusBadge tone="neutral" label="Closed" />;
    default:
      if (job.last_reservation?.status === 'expired') return <StatusBadge tone="neutral" label="Slot expired" />;
      return job.is_new ? <StatusBadge tone="brand" label="New" /> : null;
  }
}

function JobView({ job, offset, onRelease, onReport }: { job: WorkerJobDetail; offset: number; onRelease: () => void; onReport: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const res = job.start_state === 'in_progress' ? job.reservation : null;
  const left = useSlotLeft(res?.expires_at, offset);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (res && left <= 0 && new Date(res.expires_at).getTime() - offset <= Date.now()) {
      setExpired(true);
      void qc.invalidateQueries({ queryKey: wk.job(job.public_id) });
    }
  }, [left, res, offset, qc, job.public_id]);

  const start = useMutation<StartJobResponse, ApiError>({
    mutationFn: () => api.post<StartJobResponse>(`/worker/jobs/${job.public_id}/start`),
    onSuccess: (r) => {
      qc.setQueryData(wk.job(job.public_id), (old: { job: WorkerJobDetail; offset: number } | undefined) =>
        old ? { ...old, job: { ...old.job, start_state: 'in_progress', reservation: r.reservation, task_link_url: r.task_link_url, slots_left: r.slots_left } } : old,
      );
      void qc.invalidateQueries({ queryKey: wk.job(job.public_id) });
      void qc.invalidateQueries({ queryKey: wk.overview });
      toast.show({ tone: 'success', title: 'Slot reserved', body: 'Finish and submit before the timer ends.' });
    },
    onError: (e) => {
      toast.show({ tone: 'danger', title: e.message || 'We couldn’t start this job' });
      void qc.invalidateQueries({ queryKey: wk.job(job.public_id) });
    },
  });

  const elapsedMin = res ? Math.max(0, Math.floor((Date.now() + offset - new Date(res.started_at).getTime()) / 60_000)) : 0;
  const low = !!res && left > 0 && left < 5 * 60_000;
  const pulseRef = usePulse<HTMLSpanElement>(low);
  const reward = formatReward(job.reward_usd);
  const facts: [string, string, boolean][] = [
    ['Reward', reward, true],
    ['Slots left', `${job.slots_left} of ${job.slots_total}`, false],
    ['Takes about', `${job.display_minutes} min`, false],
    ['Proof', job.proof_label, false],
  ];

  return (
    <div className={cn('grid gap-6 desktop:grid-cols-[minmax(0,1fr)_360px]', 'max-desktop:pb-24')}>
      <div className="min-w-0 space-y-4 tablet:space-y-6">
        <BackLink href="/worker/jobs">Back to Find jobs</BackLink>

        {/* Job header 29:1350 */}
        <section className="tablet:rounded-card tablet:border tablet:border-line tablet:bg-surface tablet:p-6 tablet:shadow-xs">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-overline uppercase text-fg-brand">
              {job.category?.name ?? 'Other'}
              <span className="tablet:hidden"> · {job.employer.business_name}</span>
            </p>
            {headerBadge(job)}
          </div>
          <h2 className="mt-2 font-display text-h3 text-fg tablet:text-h2">{job.title}</h2>
          <p className="mt-2 text-body-sm text-fg-tertiary">
            Posted {formatRelative(job.published_at)}
            <span className="max-tablet:hidden"> by {job.employer.business_name}</span> · Job ID {job.public_id}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 tablet:mt-5 tablet:grid-cols-4 tablet:gap-0 tablet:divide-x tablet:divide-line-subtle tablet:overflow-hidden tablet:rounded-[12px] tablet:border tablet:border-line">
            {facts.map(([k, v, money]) => (
              <div key={k} className="bg-surface px-4 py-3 max-tablet:rounded-[12px] max-tablet:border max-tablet:border-line">
                <dt className="text-overline uppercase text-fg-tertiary">{k}</dt>
                <dd className={cn('mt-1 text-label-lg', money ? 'font-display text-num-md text-fg-success' : 'text-fg')}>{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Reservation banner 29:1369 */}
        {res ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-warning-subtle px-4 py-4 tablet:px-5" role="status">
            <p className="text-label-md text-fg">
              <span className="tablet:hidden">
                Slot held for{' '}
                <span ref={pulseRef} className="inline-block tabular-nums">
                  {formatMmSs(left)}
                </span>{' '}
                more
              </span>
              <span className="max-tablet:hidden">
                {low ? (
                  <>
                    Under {Math.max(1, Math.ceil(left / 60_000))} min left on your slot. Submit soon or it goes back to the job.{' '}
                  </>
                ) : (
                  <>You started this job {elapsedMin < 1 ? 'just now' : `${elapsedMin} min ago`}. </>
                )}
                Your slot is held for <PulseTime ms={left} low={low} /> more.
              </span>
            </p>
            <LinkButton tone="warning" onClick={onRelease} className="font-semibold">
              Release slot
            </LinkButton>
          </div>
        ) : null}

        {!res && job.last_reservation?.status === 'expired' && job.start_state === 'can_start' ? <Alert tone="warning">Your slot expired, so your draft was removed. Start again if slots remain.</Alert> : null}
        {!res && job.last_reservation?.status === 'cancelled' ? <Alert tone="warning">This job was closed by the employer, so your slot was released.</Alert> : null}

        {/* What to do 29:1375 */}
        <Steps job={job} reservationId={res?.id ?? null} initial={res?.steps_checked ?? []} />

        {/* Proof needed (mobile 47:1033; pre-start on all sizes) */}
        <Panel className={cn(res && 'tablet:hidden')}>
          <h3 className="text-h5 text-fg">Proof needed</h3>
          <ul className="mt-3 space-y-3">
            {job.proof_requirements.map((p) => (
              <li key={p.id} className="flex gap-3 text-body-sm text-fg">
                <Icon name={p.proof_type === 'link' ? 'link' : p.proof_type === 'text' ? 'file-text' : p.proof_type === 'file' ? 'upload' : 'image'} size={20} className="mt-0.5 shrink-0 text-fg-brand max-tablet:hidden" />
                <span>
                  {p.title}
                  {p.helper ? <span className="block text-body-xs text-fg-tertiary">{p.helper}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        {!res ? (
          <Panel>
            <h3 className="text-h5 text-fg">Rules for this job</h3>
            <ul className="mt-3 space-y-3">
              {job.rules.allowed.map((r) => (
                <li key={r} className="flex gap-3 text-body-sm text-fg">
                  <Icon name="check-circle" size={20} className="shrink-0 text-fg-success" />
                  {r}
                </li>
              ))}
              {job.rules.not_allowed.map((r) => (
                <li key={r} className="flex gap-3 text-body-sm text-fg">
                  <Icon name="x-circle" size={20} className="shrink-0 text-fg-danger" />
                  {r}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {/* Next step 29:1410 */}
        {res ? (
          <Panel className="hidden items-center justify-between gap-6 tablet:flex">
            <div>
              <h3 className="text-label-lg text-fg">Ready to submit?</h3>
              <p className="mt-1 max-w-[360px] text-body-sm text-fg-secondary">You’ll need: {proofNeeds(job)}</p>
            </div>
            <Button size="L" href={`/worker/jobs/${job.public_id}/submit`} className="w-[260px] shrink-0">
              Continue to submit proof
            </Button>
          </Panel>
        ) : null}
      </div>

      {/* Right column */}
      <aside className="min-w-0 space-y-6">
        <Panel className="shadow-sm">
          <p className="text-body-sm text-fg-secondary">Reward per approved task</p>
          <p className="mt-1 font-display text-num-2xl text-fg-success">{reward}</p>
          <p className="mt-3 text-body-xs text-fg-secondary">
            {job.slots_left} of {job.slots_total} slots left
          </p>
          <Progress className="mt-2" value={job.slots_filled} max={job.slots_total} valueText={`${job.slots_filled} of ${job.slots_total} slots filled`} />
          <StartArea job={job} starting={start.isPending} onStart={() => start.mutate()} />
          <Rows
            className="mt-5 border-t border-line-subtle pt-5"
            rows={[
              ['Review window', `${job.terms.review_window_hours} hours`],
              ['If not reviewed', job.terms.auto_approve ? 'Auto-approved' : 'Escalated to support'],
              ['Rejections', job.terms.rejections_need_reason ? 'Reason required' : 'Reason optional'],
            ]}
          />
        </Panel>
        <EmployerCard employer={job.employer} />
        <Panel className="p-5">
          <h3 className="text-h5 text-fg">Tips for approval</h3>
          <ul className="mt-3 space-y-2 text-body-sm text-fg-secondary">
            <li>Follow every step exactly — partial work is usually returned.</li>
            <li>Use your own screenshot; reused images are flagged.</li>
            <li>Asked to fix it? Resubmit before the deadline.</li>
          </ul>
        </Panel>
        <LinkButton tone="info" onClick={onReport} className="!text-fg-tertiary hover:!text-fg-secondary">
          Report this job
        </LinkButton>
      </aside>

      {/* Mobile sticky action bar */}
      <StickyActionBar className="desktop:hidden">
        <div className="mr-auto">
          <p className="font-display text-num-md text-fg-success">{reward}</p>
          <p className="text-body-xs text-fg-tertiary">per approved task</p>
        </div>
        {res ? (
          <Button size="L" href={`/worker/jobs/${job.public_id}/submit`} className="w-[200px]">
            Submit proof
          </Button>
        ) : job.start_state === 'can_start' ? (
          <Button size="L" loading={start.isPending} loadingText="Starting…" onClick={() => start.mutate()} className="w-[200px]">
            Start this job
          </Button>
        ) : job.start_state === 'already_done' && job.submission_ref ? (
          <Button size="L" variant="secondary" href={`/worker/tasks/${job.submission_ref}`} className="w-[200px]">
            View your task
          </Button>
        ) : (
          <Button size="L" disabled className="w-[200px]">
            Start this job
          </Button>
        )}
      </StickyActionBar>

      <ExpiredDialog open={expired} />
    </div>
  );
}

function PulseTime({ ms, low }: { ms: number; low: boolean }) {
  const ref = usePulse<HTMLSpanElement>(low);
  return (
    <span ref={ref} className={cn('inline-block tabular-nums', low && 'text-fg-danger')}>
      {formatMmSs(ms)}
    </span>
  );
}

/** Right-card action per start state (G-08 table). */
function StartArea({ job, starting, onStart }: { job: WorkerJobDetail; starting: boolean; onStart: () => void }) {
  const box = (children: React.ReactNode) => <div className="mt-5 space-y-3">{children}</div>;
  const reason = (t: string) => <p className="text-body-sm text-fg-secondary">{t}</p>;
  const disabled = (t: string, extra?: React.ReactNode) =>
    box(
      <>
        <Button size="L" fullWidth disabled aria-describedby="start-reason">
          Start this job
        </Button>
        <p id="start-reason" className="text-body-sm text-fg-secondary">
          {t}
        </p>
        {extra}
      </>,
    );
  switch (job.start_state) {
    case 'in_progress':
      return null;
    case 'can_start':
      return box(
        <>
          <Button size="L" fullWidth loading={starting} loadingText="Starting…" onClick={onStart} className="max-desktop:hidden">
            Start this job
          </Button>
          {reason(`Starting reserves a slot for ${job.slot_hold_minutes} minutes. The task link appears after you start.`)}
        </>,
      );
    case 'full':
      return disabled(
        'All slots are taken. New jobs are added throughout the day.',
        <Button variant="secondary" size="M" fullWidth href={`/worker/jobs${job.category ? `?chip=${job.category.slug}` : ''}`}>
          Browse similar jobs
        </Button>,
      );
    case 'already_done':
      return box(
        <>
          {job.submission_ref ? (
            <Button variant="secondary" size="L" fullWidth href={`/worker/tasks/${job.submission_ref}`}>
              View your task
            </Button>
          ) : null}
          {reason('You’ve already submitted this job. One submission per worker.')}
        </>,
      );
    case 'paused':
      return disabled('The employer paused this job. Check back later.');
    case 'closed':
      return disabled('This job has closed.');
    case 'not_eligible':
      if (job.ineligible?.reason === 'kyc_required')
        return box(
          <>
            <Button variant="secondary" size="L" fullWidth href="/worker/settings#verification">
              Verify identity
            </Button>
            {reason('This job is for identity-verified workers. Verify to take it.')}
          </>,
        );
      return disabled(
        `This job needs an approval rate of ${job.ineligible?.required_rate ?? '—'}% or higher. Yours is ${job.ineligible?.your_rate !== null && job.ineligible?.your_rate !== undefined ? `${job.ineligible.your_rate}%` : '—'}.`,
      );
    case 'verify_required':
      return box(
        <>
          <Button size="L" fullWidth href="/verify?purpose=signup">
            Verify now
          </Button>
          {reason('Verify your email or phone to start jobs.')}
        </>,
      );
    case 'restricted':
      return disabled('Your account is restricted. You can’t start jobs right now. Contact support to appeal.');
    case 'own_job':
      return disabled('This is your own job.');
    default:
      return null;
  }
}

/** "What to do" with tickable steps (in progress) or read-only steps (pre-start). */
function Steps({ job, reservationId, initial }: { job: WorkerJobDetail; reservationId: string | null; initial: number[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [checked, setChecked] = useState<number[]>(initial);
  const saved = useRef<number[]>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useStaggerIn<HTMLOListElement>([reservationId]);
  useEffect(() => {
    setChecked(initial);
    saved.current = initial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationId]);

  const pending = useRef<number[] | null>(null);
  const flush = useCallback(async () => {
    const next = pending.current;
    if (!reservationId || !next) return;
    pending.current = null;
    try {
      const r = await api.put<{ steps_checked: number[] }>(`/worker/reservations/${reservationId}/progress`, { steps_checked: next });
      saved.current = r.steps_checked;
      qc.setQueryData(wk.job(job.public_id), (old: { job: WorkerJobDetail; offset: number } | undefined) =>
        old?.job.reservation ? { ...old, job: { ...old.job, reservation: { ...old.job.reservation, steps_checked: r.steps_checked } } } : old,
      );
    } catch (e) {
      setChecked(saved.current);
      toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Your changes are still here. Try again.' });
      if (e instanceof ApiError && e.code === 'RESERVATION_EXPIRED') void qc.invalidateQueries({ queryKey: wk.job(job.public_id) });
    }
  }, [reservationId, job.public_id, qc, toast]);
  const save = useCallback(
    (next: number[]) => {
      if (!reservationId) return;
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 500);
    },
    [reservationId, flush],
  );
  // Leaving the page (e.g. "Continue to submit proof") sends a pending tick right away.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flushRef.current();
    },
    [],
  );

  const toggle = (pos: number) => {
    const next = checked.includes(pos) ? checked.filter((x) => x !== pos) : [...checked, pos].sort((a, b) => a - b);
    setChecked(next);
    save(next);
  };
  const done = checked.filter((p) => job.steps.some((s) => s.position === p)).length;
  const total = job.steps.length;
  const interactive = !!reservationId;

  return (
    <Panel aria-labelledby="todo-h">
      <div className="flex items-center justify-between gap-4">
        <h3 id="todo-h" className="text-h5 text-fg tablet:font-display tablet:text-h4">
          What to do
        </h3>
        {interactive ? (
          <span className="text-label-sm font-semibold text-fg-success" aria-live="polite">
            {done} of {total} done
          </span>
        ) : (
          <span className="text-body-sm text-fg-tertiary">{plural(total, 'step')}</span>
        )}
      </div>
      {interactive ? <Progress tone="success" className="mt-3 max-tablet:hidden" value={done} max={total || 1} valueText={`${done} of ${total} steps done`} /> : null}
      <ol ref={listRef} className="mt-4 space-y-3">
        {job.steps.map((s) => (
          <StepItem key={s.position} position={s.position} body={s.body} checked={checked.includes(s.position)} interactive={interactive} onToggle={() => toggle(s.position)} />
        ))}
      </ol>
      {!interactive && job.start_state === 'can_start' ? (
        <Alert brand className="mt-4">
          Starting reserves a slot for {job.slot_hold_minutes} minutes. The task link appears after you start.
        </Alert>
      ) : null}
      {interactive && job.task_link_url ? (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-[12px] bg-brand-subtle px-4 py-3">
          <div className="min-w-0 max-tablet:hidden">
            <p className="text-label-md text-fg">Task link</p>
            <p className="truncate text-body-sm text-fg-secondary">{shortUrl(job.task_link_url)}</p>
          </div>
          <a
            href={job.task_link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[8px] bg-brand px-3 text-label-md text-fg-on-brand hover:bg-brand-hover focus-visible:shadow-focus focus-visible:outline-none max-tablet:h-11 max-tablet:w-full max-tablet:justify-between max-tablet:bg-transparent max-tablet:px-0 max-tablet:text-fg-brand"
          >
            Open task link
            <Icon name="arrow-right" size={20} className="tablet:hidden" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      ) : null}
    </Panel>
  );
}

function StepItem({ position, body, checked, interactive, onToggle }: { position: number; body: string; checked: boolean; interactive: boolean; onToggle: () => void }) {
  const bounce = useTickBounce<HTMLDivElement>(checked, 0.96);
  const label = (
    <span className="block">
      <span className={cn('block text-overline uppercase', checked ? 'text-fg-success' : 'text-fg-brand')}>Step {position}</span>
      <span className="mt-1 block text-body-md text-fg">{body}</span>
    </span>
  );
  return (
    <li className={cn('rounded-[12px] p-4 transition-colors', checked ? 'bg-success-subtle' : 'bg-subtle')}>
      {interactive ? (
        <div ref={bounce} className="origin-left">
          <Checkbox label={label} checked={checked} onChange={onToggle} wrapperClassName="items-start" />
        </div>
      ) : (
        <div className="flex gap-4">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-subtle font-display text-num-sm text-fg-brand">{position}</span>
          {label}
        </div>
      )}
    </li>
  );
}
