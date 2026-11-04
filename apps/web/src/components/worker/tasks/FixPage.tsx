'use client';
/**
 * SCR-WRK-08 Rejected task: Fix and resubmit (Figma 31:2246). Reason banner with the resubmit
 * deadline, tracker, fix form (link kept, new screenshot required, change note), previous
 * submission, checklist from the job's proof requirements, dispute info + dialog.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { ResubmitResponse, WorkerProofRequirement, WorkerSubmissionDetail } from '@24f/shared';
import { formatDateTime, formatReward, formatTimeLeft, isHttpsUrl, LINK_INVALID_MESSAGE } from '@24f/shared';
import { Alert, Button, Field, Icon, StickyActionBar, Textarea, cn, useToast } from '@24f/ui';
import { api, ApiError } from '@/lib/api/client';
import { useWorkerTask, wk } from '../data';
import { UploadField } from '../submit/SubmitProof';
import { useWorkerHeader } from '../shell';
import { BackLink, LoadError, Panel, shortUrl, useTickBounce } from '../ui';
import { DisputeDialog, Tracker } from './shared';
import { ProofThumb, TaskSkeleton } from './TaskDetail';

type Val = { link_url: string; text_value: string; upload_id: string | null };

export function FixPage({ submissionRef }: { submissionRef: string }) {
  const q = useWorkerTask(submissionRef);
  const router = useRouter();
  const t = q.data?.task;
  const offset = q.data?.offset ?? 0;
  useWorkerHeader(t ? { subtitle: `${t.job.title} · ${formatReward(t.reward_usd)}` } : null);
  const notFix = !!t && t.status !== 'needs_fix';
  useEffect(() => {
    if (notFix) router.replace(`/worker/tasks/${submissionRef}`);
  }, [notFix, router, submissionRef]);
  if (q.isError && !t) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  if (!t || notFix) return <TaskSkeleton />;
  return <FixView t={t} offset={offset} />;
}

function FixView({ t, offset }: { t: WorkerSubmissionDetail; offset: number }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), 30_000);
    return () => clearInterval(id);
  }, [offset]);
  const employer = t.job.employer.business_name;
  const prev = t.attempts[t.attempts.length - 1];
  const deadline = t.rejection?.resubmit_deadline ?? null;
  const disputeActive = !!t.dispute && (t.dispute.status === 'open' || t.dispute.status === 'under_review');
  const passed = !!deadline && new Date(deadline).getTime() <= now && !disputeActive;
  const noAttempts = t.resubmissions_left <= 0 || (!t.can_resubmit && !passed);
  const readOnly = passed || noAttempts;

  const [vals, setVals] = useState<Record<string, Val>>(() => {
    const out: Record<string, Val> = {};
    for (const r of t.proof_requirements) {
      const p = prev?.proof_items.find((x) => x.proof_requirement_id === r.id);
      out[r.id] = { link_url: p?.link_url ?? '', text_value: p?.text_value ?? '', upload_id: null };
    }
    return out;
  });
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [dispute, setDispute] = useState(false);
  const set = (id: string, p: Partial<Val>) => {
    setVals((v) => ({ ...v, [id]: { ...v[id]!, ...p } }));
    setErrors((e) => ({ ...e, [id]: '' }));
  };

  const prevOf = (r: WorkerProofRequirement) => prev?.proof_items.find((x) => x.proof_requirement_id === r.id);
  const okFor = (r: WorkerProofRequirement) => {
    const v = vals[r.id]!;
    if (r.proof_type === 'link') return isHttpsUrl(v.link_url.trim());
    if (r.proof_type === 'text') return !!v.text_value.trim();
    return !!v.upload_id;
  };
  const changed = t.proof_requirements.some((r) => {
    const v = vals[r.id]!;
    const p = prevOf(r);
    if (r.proof_type === 'link') return v.link_url.trim() !== (p?.link_url ?? '');
    if (r.proof_type === 'text') return v.text_value.trim() !== (p?.text_value ?? '');
    return !!v.upload_id;
  });
  const needsUpload = t.proof_requirements.filter((r) => r.is_required && (r.proof_type === 'screenshot' || r.proof_type === 'file'));
  const ready = !readOnly && changed && needsUpload.every((r) => !!vals[r.id]!.upload_id) && t.proof_requirements.every((r) => !r.is_required || okFor(r)) && [...note].length <= 300;

  const checklist = useMemo(
    () =>
      t.proof_requirements.map((r) => ({
        key: r.id,
        label: r.proof_type === 'link' && prevOf(r)?.link_url && vals[r.id]!.link_url.trim() === prevOf(r)!.link_url ? 'Keep the same link' : r.title,
        done: okFor(r),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t.proof_requirements, vals],
  );

  const submit = async () => {
    const e: Record<string, string> = {};
    for (const r of t.proof_requirements) {
      const v = vals[r.id]!;
      if (r.proof_type === 'link' && v.link_url.trim() && !isHttpsUrl(v.link_url.trim())) e[r.id] = LINK_INVALID_MESSAGE;
      if ((r.proof_type === 'screenshot' || r.proof_type === 'file') && r.is_required && !v.upload_id) e[r.id] = r.proof_type === 'screenshot' ? 'Upload a new screenshot.' : 'Upload a new file.';
    }
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setBusy(true);
    try {
      await api.post<ResubmitResponse>(`/worker/submissions/${t.ref}/resubmit`, {
        proof_items: t.proof_requirements.map((r) => ({
          proof_requirement_id: r.id,
          link_url: vals[r.id]!.link_url.trim() || null,
          text_value: vals[r.id]!.text_value.trim() || null,
          upload_id: vals[r.id]!.upload_id,
        })),
        change_note: note.trim() || null,
      });
      toast.show({ tone: 'success', title: 'Fix sent', body: 'The employer has a new review window.' });
      void qc.invalidateQueries({ queryKey: wk.all });
      router.push(`/worker/tasks/${t.ref}`);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError) {
        const fe: Record<string, string> = {};
        for (const [k, m] of Object.entries(err.fields)) {
          const mm = k.match(/^proof_items\.(\d+)\./);
          if (mm && t.proof_requirements[Number(mm[1])]) fe[t.proof_requirements[Number(mm[1])]!.id] = m[0]!;
          if (k === 'change_note') fe.note = m[0]!;
        }
        if (Object.keys(fe).length) return setErrors(fe);
        if (err.code === 'RESUBMIT_NOT_ALLOWED') {
          toast.show({ tone: 'danger', title: err.message });
          void qc.invalidateQueries({ queryKey: wk.task(t.ref) });
          return;
        }
      }
      toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Your changes are still here. Try again.' });
    }
  };

  const prevFile = prev?.proof_items.find((p) => p.file)?.file ?? null;
  const prevLink = prev?.proof_items.find((p) => p.link_url)?.link_url ?? null;
  const leftMs = deadline ? new Date(deadline).getTime() - now : 0;

  return (
    <div className="grid gap-6 desktop:grid-cols-[minmax(0,1fr)_360px] max-tablet:pb-24">
      <div className="min-w-0 space-y-6">
        <BackLink href="/worker/tasks">Back to My tasks</BackLink>

        {/* Reason banner 31:2374 */}
        <section role="status" className="rounded-card border border-line-danger bg-danger-subtle p-5">
          <p className="flex items-center gap-2 text-label-lg text-fg-danger">
            <Icon name="alert-circle" size={20} />
            {employer} asked for a fix
          </p>
          {t.rejection?.reason_text ? <p className="mt-2 text-body-md text-fg tablet:pl-7">“{t.rejection.reason_text}”</p> : null}
          {deadline ? (
            <p className="mt-3 inline-flex rounded-full bg-surface px-3 py-1 text-label-sm font-semibold text-fg-danger tablet:ml-7">
              Resubmit by {formatDateTime(deadline, now)}
              {disputeActive ? ' · paused while your dispute is open' : leftMs > 0 ? ` · ${formatTimeLeft(leftMs)}` : ' · deadline passed'}
            </p>
          ) : null}
        </section>

        {passed ? <Alert tone="danger">The resubmit deadline has passed, so this task is now rejected.</Alert> : null}
        {!passed && noAttempts ? <Alert tone="warning">You’ve used your resubmission for this task.</Alert> : null}
        {disputeActive ? <Alert tone="info">Dispute open. A 24 Freelancing reviewer will look at it. It doesn’t affect your approval rate while open. Resubmitting a fix withdraws the dispute.</Alert> : null}

        <Panel aria-labelledby="stand-h">
          <h3 id="stand-h" className="text-h5 text-fg">
            Where it stands
          </h3>
          <div className="mt-5">
            <Tracker task={t} now={now} />
          </div>
        </Panel>

        {/* Your fix 31:2411 */}
        <Panel aria-labelledby="fix-h">
          <h3 id="fix-h" className="font-display text-h4 text-fg">
            Your fix
          </h3>
          <p className="mt-1 text-body-sm text-fg-secondary">
            {needsUpload.length ? 'Upload a new screenshot.' : 'Update your proof.'}
            {t.proof_requirements.some((r) => r.proof_type === 'link') ? ' Your link is kept from the first attempt — update it only if it changed.' : ''}
          </p>
          <fieldset disabled={readOnly || busy} className="mt-4 space-y-5">
            {t.proof_requirements.map((r) =>
              r.proof_type === 'link' ? (
                <Field
                  key={r.id}
                  label={r.field_label ?? 'Link'}
                  leadingIcon="link"
                  type="url"
                  value={vals[r.id]!.link_url}
                  onChange={(e) => set(r.id, { link_url: e.target.value })}
                  helper={prevOf(r)?.link_url && vals[r.id]!.link_url.trim() === prevOf(r)!.link_url ? 'Same link as your first attempt.' : (r.helper ?? 'Check that “Anyone with the link” can view it.')}
                  error={errors[r.id] || undefined}
                />
              ) : r.proof_type === 'text' ? (
                <Textarea key={r.id} label={r.title} value={vals[r.id]!.text_value} softMax={2000} onChange={(e) => set(r.id, { text_value: e.target.value })} error={errors[r.id] || undefined} />
              ) : readOnly ? null : (
                <UploadField
                  key={r.id}
                  type={r.proof_type}
                  label={r.proof_type === 'screenshot' ? 'New screenshot' : 'New file'}
                  error={errors[r.id] || undefined}
                  onChange={(id) => set(r.id, { upload_id: id })}
                />
              ),
            )}
            <Textarea
              label="What did you change? (optional)"
              placeholder="e.g. “Zoomed out so all 12 rows are visible.”"
              value={note}
              softMax={300}
              helper="Visible to the employer only."
              error={errors.note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </fieldset>
          <div className="mt-6 hidden items-center justify-between gap-4 tablet:flex">
            {t.can_dispute ? (
              <Button variant="tertiary" size="L" onClick={() => setDispute(true)}>
                Dispute this decision
              </Button>
            ) : (
              <span />
            )}
            <Button size="L" className="w-[220px]" disabled={!ready} loading={busy} loadingText="Sending…" onClick={() => void submit()}>
              Resubmit for review
            </Button>
          </div>
          {t.can_dispute ? (
            <Button variant="tertiary" size="L" fullWidth className="mt-4 tablet:hidden" onClick={() => setDispute(true)}>
              Dispute this decision
            </Button>
          ) : null}
        </Panel>
      </div>

      <aside className="min-w-0 space-y-6">
        <Panel aria-labelledby="prev-h" className="p-5">
          <div className="flex items-center justify-between gap-4">
            <h3 id="prev-h" className="text-label-lg text-fg">
              Previous submission
            </h3>
            {prev ? <span className="text-body-sm text-fg-tertiary">{formatDateTime(prev.submitted_at, now)}</span> : null}
          </div>
          <div className="mt-4">
            {prevFile ? (
              <ProofThumb file={prevFile} />
            ) : (
              <div className="grid h-[128px] place-items-center rounded-[12px] bg-muted text-fg-tertiary">
                <Icon name="image" size={24} />
                <span className="sr-only">No preview available</span>
              </div>
            )}
            {prevLink ? (
              <a href={prevLink} target="_blank" rel="noopener noreferrer" className="mt-2 block truncate text-body-sm text-fg-secondary hover:underline">
                {shortUrl(prevLink, 32)}
              </a>
            ) : null}
            {prev?.worker_note ? <p className="mt-2 text-body-sm text-fg-secondary">“{prev.worker_note}”</p> : null}
          </div>
        </Panel>

        <Panel aria-labelledby="chk-h" className="p-5">
          <h3 id="chk-h" className="text-label-lg text-fg">
            Checklist for approval
          </h3>
          <ul className="mt-4 space-y-4">
            {checklist.map((c) => (
              <ChecklistRow key={c.key} label={c.label} done={c.done} />
            ))}
          </ul>
        </Panel>

        <section className="rounded-card border border-line-subtle bg-subtle p-5">
          <h3 className="text-label-md text-fg">Think this is wrong?</h3>
          <p className="mt-2 text-body-sm text-fg-secondary">
            Open a dispute and a 24 Freelancing reviewer will look at your proof and the employer’s reason. Disputes don’t affect your approval rate while open.
          </p>
          {t.can_dispute ? (
            <Button variant="secondary" size="S" className="mt-3" onClick={() => setDispute(true)}>
              Open a dispute
            </Button>
          ) : null}
        </section>
      </aside>

      {!readOnly ? (
        <StickyActionBar className="tablet:hidden">
          <Button size="L" fullWidth disabled={!ready} loading={busy} loadingText="Sending…" onClick={() => void submit()}>
            Resubmit for review
          </Button>
        </StickyActionBar>
      ) : null}
      <DisputeDialog open={dispute} onOpenChange={setDispute} submissionRef={t.ref} />
    </div>
  );
}

function ChecklistRow({ label, done }: { label: string; done: boolean }) {
  const ref = useTickBounce<HTMLSpanElement>(done);
  return (
    <li className="flex items-center gap-3 text-body-sm text-fg">
      <span ref={ref} className={cn('grid size-6 shrink-0 place-items-center rounded-full', done ? 'bg-success-bright text-fg-inverse' : 'bg-muted')}>
        {done ? <Icon name="check" size={14} /> : null}
      </span>
      {label}
      <span className="sr-only">{done ? ' (done)' : ' (not done)'}</span>
    </li>
  );
}
