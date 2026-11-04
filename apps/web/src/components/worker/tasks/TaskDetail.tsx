'use client';
/**
 * SCR-WRK-07 Task status details (Figma 30:2125) with the state variants from Doc 02 §6.4.7:
 * in review (deadline box), approved, rejected (reason + dispute link), dispute open / resolved.
 * `needs_fix` redirects to SCR-WRK-08.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProofItemView, WorkerSubmissionDetail } from '@24f/shared';
import { formatDateTime, formatHoursLeft, formatReward } from '@24f/shared';
import { Alert, Button, Dialog, EmptyState, Icon, IconButton, LinkButton, Skeleton, StatusBadge, StickyActionBar, cn, useStaggerIn, useToast } from '@24f/ui';
import { api, ApiError } from '@/lib/api/client';
import { useWorkerTask, wk } from '../data';
import { ReportDialog } from '../job/dialogs';
import { useWorkerHeader } from '../shell';
import { BackLink, EmployerCard, LoadError, Panel, copyText, shortUrl } from '../ui';
import { DisputeDialog, Tracker } from './shared';

export function TaskDetail({ submissionRef }: { submissionRef: string }) {
  const q = useWorkerTask(submissionRef);
  const router = useRouter();
  const t = q.data?.task;
  const offset = q.data?.offset ?? 0;
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const id = setInterval(() => setNow(Date.now() + offset), 30_000);
    return () => clearInterval(id);
  }, [offset]);
  useWorkerHeader(t ? { subtitle: `Submitted ${formatDateTime(t.last_submitted_at, now)} · Job ID ${t.job.public_id}` } : null);
  const toFix = t?.status === 'needs_fix';
  useEffect(() => {
    if (toFix) router.replace(`/worker/tasks/${submissionRef}/fix`);
  }, [toFix, router, submissionRef]);

  if (q.isError && !t) {
    if (q.error.status === 404)
      return (
        <Panel>
          <EmptyState
            icon="search"
            title="We couldn’t find this task"
            body="It may belong to another account."
            action={
              <Button variant="secondary" href="/worker/tasks">
                Back to My tasks
              </Button>
            }
          />
        </Panel>
      );
    return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  }
  if (!t || toFix) return <TaskSkeleton />;
  return <TaskView t={t} now={now} />;
}

export function TaskSkeleton() {
  return (
    <div className="grid gap-6 desktop:grid-cols-[minmax(0,1fr)_360px]" aria-busy="true">
      <div className="space-y-6">
        {[0, 1, 2].map((i) => (
          <Panel key={i}>
            <Skeleton width={160} height={14} />
            <Skeleton width="75%" height={24} className="mt-3" />
            <Skeleton width="100%" height={60} className="mt-4" />
          </Panel>
        ))}
      </div>
      <div className="space-y-6">
        <Panel>
          <Skeleton width={120} height={14} />
          <Skeleton width={140} height={40} className="mt-3" />
        </Panel>
        <Panel>
          <Skeleton width="70%" height={20} />
          <Skeleton width="100%" height={60} className="mt-4" />
        </Panel>
      </div>
    </div>
  );
}

function TaskView({ t, now }: { t: WorkerSubmissionDetail; now: number }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [report, setReport] = useState(false);
  const [dispute, setDispute] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const employer = t.job.employer.business_name;
  const reward = formatReward(t.reward_usd);
  const attempt = t.attempts[t.attempts.length - 1];
  const activityRef = useStaggerIn<HTMLOListElement>([t.activity.length]);
  const d = t.dispute;
  const disputeActive = d && (d.status === 'open' || d.status === 'under_review');

  const withdraw = useMutation<unknown, ApiError>({
    mutationFn: () => api.post(`/worker/disputes/${d!.ref}/withdraw`),
    onSuccess: () => {
      setConfirmWithdraw(false);
      toast.show({ tone: 'success', title: 'Dispute withdrawn' });
      void qc.invalidateQueries({ queryKey: wk.all });
    },
    onError: (e) => {
      setConfirmWithdraw(false);
      toast.show({ tone: 'danger', title: e.message || 'That didn’t save' });
      void qc.invalidateQueries({ queryKey: wk.task(t.ref) });
    },
  });

  const rewardMeta =
    t.status === 'in_review' ? `Reward ${reward} · pending until approved` : t.status === 'approved' ? `Reward ${reward} · added to your balance` : `Reward ${reward} · not paid`;

  const due = t.review_due_at ? new Date(t.review_due_at).getTime() - now : null;

  return (
    <div className="grid gap-6 desktop:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-6">
        <BackLink href="/worker/tasks">Back to My tasks</BackLink>

        {/* Task header 30:2253 */}
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-overline uppercase text-fg-brand">
              {[t.job.category?.name, employer].filter(Boolean).join(' · ')}
            </p>
            <div className="flex gap-2">
              {disputeActive ? <StatusBadge tone="info" label="Dispute open" /> : null}
              <StatusBadge enum="submission_status" code={t.status} />
            </div>
          </div>
          <h2 className="mt-2 font-display text-h4 text-fg">{t.job.title}</h2>
          <p className="mt-2 text-body-sm text-fg-secondary">{rewardMeta}</p>
        </Panel>

        {t.status === 'rejected' && t.rejection ? (
          <div role="status" className="rounded-card border border-line-danger bg-danger-subtle p-5">
            <p className="flex items-center gap-2 text-label-lg text-fg-danger">
              <Icon name="alert-circle" size={20} />
              {employer} rejected this task
            </p>
            {t.rejection.reason_text ? <p className="mt-2 text-body-md text-fg">“{t.rejection.reason_text}”</p> : null}
          </div>
        ) : null}

        {/* Where it stands 30:2260 */}
        <Panel aria-labelledby="stand-h">
          <h3 id="stand-h" className="text-h5 text-fg">
            Where it stands
          </h3>
          <div className="mt-5">
            <Tracker task={t} now={now} />
          </div>
          <div className="mt-5 space-y-3">
            {t.status === 'in_review' && t.review_due_at ? (
              <p className="rounded-[12px] bg-warning-subtle px-4 py-3 text-body-sm text-fg">
                {t.job.auto_approve
                  ? `${employer} has until ${formatDateTime(t.review_due_at, now)} to review (in ${formatHoursLeft(Math.max(0, due ?? 0))}). If they don’t, it’s approved automatically.`
                  : `${employer} has until ${formatDateTime(t.review_due_at, now)} to review. If they miss it, our team steps in.`}
              </p>
            ) : null}
            {t.status === 'approved' ? (
              <Alert tone="success">
                Approved. {reward} was added to your balance.{t.decision_source === 'auto' ? ' (auto-approved)' : ''}
              </Alert>
            ) : null}
            {disputeActive ? (
              <Alert
                tone="info"
                action={
                  d.can_withdraw ? (
                    <Button size="S" variant="secondary" onClick={() => setConfirmWithdraw(true)}>
                      Withdraw dispute
                    </Button>
                  ) : undefined
                }
              >
                Dispute open. A 24 Freelancing reviewer will look at it. It doesn’t affect your approval rate while open.
              </Alert>
            ) : null}
            {d && d.status === 'resolved_worker' ? <Alert tone="success">Your dispute was upheld. {reward} was added to your balance.</Alert> : null}
            {d && d.status === 'resolved_employer' ? <Alert tone="warning">The decision stands. {d.resolution_note ?? ''}</Alert> : null}
            {t.status === 'rejected' && t.can_dispute ? (
              <p className="text-body-sm text-fg-secondary">
                Think this is wrong?{' '}
                <LinkButton onClick={() => setDispute(true)} className="font-semibold">
                  Dispute this decision
                </LinkButton>
                {t.dispute_deadline ? ` by ${formatDateTime(t.dispute_deadline, now)}.` : ''}
              </p>
            ) : null}
          </div>
        </Panel>

        {/* Your submission 30:2286 */}
        {attempt ? <Submission attempt={attempt} now={now} /> : null}

        {/* Activity 30:2305 */}
        <Panel aria-labelledby="act-h">
          <h3 id="act-h" className="text-h5 text-fg">
            Activity
          </h3>
          <ol ref={activityRef} className="mt-4 space-y-4">
            {t.activity.map((a, i) => (
              <li key={`${a.event_type}-${i}`} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-4 text-label-md text-fg">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-brand" />
                  {a.label}
                </span>
                <time dateTime={a.occurred_at} className="shrink-0 text-body-sm text-fg-tertiary">
                  {formatDateTime(a.occurred_at, now)}
                </time>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <aside className="min-w-0 space-y-6">
        <Panel>
          <p className="text-body-sm text-fg-secondary">{t.status === 'in_review' ? 'Pending reward' : 'Reward'}</p>
          <p className={cn('mt-1 font-display text-num-2xl', t.status === 'approved' ? 'text-fg-success' : 'text-fg')}>{t.status === 'rejected' ? 'Not paid' : reward}</p>
          <p className="mt-2 text-body-sm text-fg-secondary">
            {t.status === 'in_review' ? 'Added to your balance when approved.' : t.status === 'approved' ? 'Added to your balance.' : 'Rejected work isn’t paid.'}
          </p>
          <StatusBadge enum="submission_status" code={t.status} className="mt-3" />
        </Panel>
        <EmployerCard employer={t.job.employer} />
        <Panel className="p-5">
          <h3 className="text-label-lg text-fg">Something wrong?</h3>
          <p className="mt-1 text-body-sm text-fg-secondary">If the job changed after you submitted, or you think the review is unfair, we can help.</p>
          <div className="mt-4 flex items-center gap-8">
            <a href="/help#live-support" className="text-label-md text-fg-brand hover:underline">
              Live support
            </a>
            <LinkButton onClick={() => setReport(true)} className="!text-fg-secondary">
              Report job
            </LinkButton>
          </div>
        </Panel>
      </aside>

      {t.status === 'rejected' && t.can_dispute ? (
        <StickyActionBar className="tablet:hidden">
          <Button size="L" variant="secondary" fullWidth onClick={() => setDispute(true)}>
            Dispute this decision
          </Button>
        </StickyActionBar>
      ) : null}

      <ReportDialog open={report} onOpenChange={setReport} publicId={t.job.public_id} />
      <DisputeDialog open={dispute} onOpenChange={setDispute} submissionRef={t.ref} />
      <Dialog
        open={confirmWithdraw}
        onOpenChange={setConfirmWithdraw}
        title="Withdraw this dispute?"
        description="The employer’s decision will stand. If a fix was requested, you get a fresh 24 hours to resubmit."
        busy={withdraw.isPending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmWithdraw(false)}>
              Keep dispute
            </Button>
            <Button variant="destructive" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
              Withdraw dispute
            </Button>
          </>
        }
      />
    </div>
  );
}

export function ProofThumb({ file, overlay }: { file: NonNullable<ProofItemView['file']>; overlay?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const isImage = !!file.thumbnail_url;
  return (
    <figure className="min-w-0">
      <button
        type="button"
        onClick={() => (isImage ? setOpen(true) : file.url && window.open(file.url, '_blank', 'noopener'))}
        className="relative grid h-[140px] w-full max-w-[240px] place-items-center overflow-hidden rounded-[12px] bg-muted text-fg-secondary focus-visible:shadow-focus focus-visible:outline-none tablet:w-[200px]"
        aria-label={`Open ${file.filename}`}
      >
        {file.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.thumbnail_url} alt="" className="size-full object-cover" />
        ) : (
          <Icon name={isImage ? 'image' : 'file-text'} size={24} />
        )}
        {overlay}
      </button>
      <figcaption className="mt-2 text-body-xs text-fg-tertiary">
        {file.filename} · {file.size_bytes >= 1024 * 1024 ? `${(file.size_bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size_bytes / 1024))} KB`}
      </figcaption>
      <Dialog open={open} onOpenChange={setOpen} width={560} title={file.filename} footer={<Button onClick={() => setOpen(false)}>Close</Button>}>
        {file.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.url} alt={file.filename} className="max-h-[60vh] w-full rounded-[12px] object-contain" />
        ) : null}
      </Dialog>
    </figure>
  );
}

function Submission({ attempt, now }: { attempt: WorkerSubmissionDetail['attempts'][number]; now: number }) {
  const toast = useToast();
  const links = attempt.proof_items.filter((p) => p.link_url);
  const texts = attempt.proof_items.filter((p) => p.text_value);
  const files = attempt.proof_items.filter((p) => p.file);
  const note = attempt.worker_note ?? attempt.change_note;
  return (
    <Panel aria-labelledby="sub-h">
      <div className="flex items-center justify-between gap-4">
        <h3 id="sub-h" className="text-h5 text-fg">
          Your submission
        </h3>
        <time dateTime={attempt.submitted_at} className="text-body-sm text-fg-tertiary">
          {formatDateTime(attempt.submitted_at, now)}
        </time>
      </div>
      <div className="mt-4 space-y-4">
        {links.map((p) => (
          <div key={p.proof_requirement_id} className="flex items-center justify-between gap-3 rounded-[12px] bg-subtle py-1 pl-4 pr-1">
            <a href={p.link_url!} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-body-sm text-fg hover:underline">
              {shortUrl(p.link_url!)}
            </a>
            <IconButton
              icon="copy"
              variant="ghost"
              size="S"
              aria-label="Copy link"
              onClick={async () => (await copyText(p.link_url!)) ? toast.show({ tone: 'success', title: 'Copied' }) : toast.show({ tone: 'danger', title: 'Couldn’t copy', body: 'Select the text and copy it yourself.' })}
            />
          </div>
        ))}
        <div className="flex flex-col gap-5 tablet:flex-row">
          {files.map((p) => (
            <ProofThumb key={p.proof_requirement_id} file={p.file!} />
          ))}
          {note || texts.length ? (
            <div className="min-w-0 flex-1 space-y-3">
              {texts.map((p) => (
                <div key={p.proof_requirement_id}>
                  <p className="text-label-sm text-fg">{p.title}</p>
                  <p className="mt-1 whitespace-pre-line text-body-md text-fg-secondary">{p.text_value}</p>
                </div>
              ))}
              {note ? (
                <div>
                  <p className="text-label-sm text-fg">Note</p>
                  <p className="mt-1 text-body-md text-fg-secondary">“{note}”</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {!links.length && !files.length && !texts.length ? <p className="text-body-sm text-fg-tertiary">No proof files are available for this attempt.</p> : null}
      </div>
    </Panel>
  );
}
