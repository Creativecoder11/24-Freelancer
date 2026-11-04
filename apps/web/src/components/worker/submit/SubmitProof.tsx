'use client';
/**
 * SCR-WRK-05 Submit proof (Figma 29:1471, mobile 48:1009). Form generated from the job's proof
 * requirements. Autosaves the draft 2 s after the last change (PUT …/progress with a monotonic
 * `rev`), "Save draft" saves at once; both show the "Draft saved" toast. Submit asks to confirm,
 * then redirects to the task with the "Proof submitted" toast.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { ProofType, SubmitResponse, UploadRecord, WorkerJobDetail, WorkerProofRequirement } from '@24f/shared';
import { formatMmSs, formatReward, isHttpsUrl, LINK_INVALID_MESSAGE, UPLOAD_RULES } from '@24f/shared';
import { Button, Checkbox, Dialog, Field, Icon, Skeleton, StickyActionBar, Textarea, Timeline, Upload, WizardStepper, cn, useToast } from '@24f/ui';
import { api, ApiError } from '@/lib/api/client';
import { useWorkerJob, wk } from '../data';
import { ExpiredDialog } from '../job/dialogs';
import { useSlotLeft } from '../job/JobDetail';
import { useWorkerHeader } from '../shell';
import { LoadError, Panel, Rows, usePulse, useTickBounce } from '../ui';
import { useProofUpload } from '../useProofUpload';

type Val = { link_url: string; text_value: string; upload_id: string | null };
type Vals = Record<string, Val>;

const NOTE_MAX = 300;

export function SubmitProof({ publicId }: { publicId: string }) {
  const q = useWorkerJob(publicId);
  const router = useRouter();
  const job = q.data?.job;
  useWorkerHeader(job ? { subtitle: `${job.title} · ${formatReward(job.reward_usd)}` } : null);

  const noReservation = !!job && (job.start_state !== 'in_progress' || !job.reservation);
  useEffect(() => {
    if (noReservation) router.replace(`/worker/jobs/${publicId}`);
  }, [noReservation, publicId, router]);

  if (q.isError && !job) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  if (!job || noReservation) return <SubmitSkeleton />;
  return <SubmitForm key={job.reservation!.id} job={job} offset={q.data!.offset} />;
}

function SubmitSkeleton() {
  return (
    <div className="grid gap-6 desktop:grid-cols-[minmax(0,1fr)_360px]" aria-busy="true">
      <Panel>
        <Skeleton width={200} height={28} />
        <Skeleton width="90%" height={14} className="mt-3" />
        <Skeleton.Form fields={3} />
      </Panel>
      <Panel>
        <Skeleton width={160} height={20} />
        <Skeleton width="100%" height={160} className="mt-4" />
      </Panel>
    </div>
  );
}

function labelFor(r: WorkerProofRequirement): string {
  if (r.field_label) return r.field_label;
  if (r.proof_type === 'screenshot') return 'Screenshot';
  if (r.proof_type === 'link') return 'Link';
  if (r.proof_type === 'file') return 'File';
  return r.title;
}

function checklistLabel(r: WorkerProofRequirement): string {
  const l = labelFor(r);
  return r.proof_type === 'screenshot' || r.proof_type === 'file' ? `${l} uploaded` : `${l} added`;
}

function isDone(r: WorkerProofRequirement, v: Val | undefined): boolean {
  if (!v) return false;
  if (r.proof_type === 'link') return isHttpsUrl(v.link_url.trim());
  if (r.proof_type === 'text') return v.text_value.trim().length > 0 && [...v.text_value].length <= 2000;
  return !!v.upload_id;
}

function SubmitForm({ job, offset }: { job: WorkerJobDetail; offset: number }) {
  const res = job.reservation!;
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const left = useSlotLeft(res.expires_at, offset);
  const low = left > 0 && left < 5 * 60_000;
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (left <= 0 && new Date(res.expires_at).getTime() - offset <= Date.now()) setExpired(true);
  }, [left, res.expires_at, offset]);

  const draft = res.draft;
  const [vals, setVals] = useState<Vals>(() => {
    const out: Vals = {};
    for (const r of job.proof_requirements) {
      const d = draft?.proof_items.find((p) => p.proof_requirement_id === r.id);
      out[r.id] = { link_url: d?.link_url ?? '', text_value: d?.text_value ?? '', upload_id: d?.upload_id ?? null };
    }
    return out;
  });
  const [note, setNote] = useState(draft?.worker_note ?? '');
  const [attest, setAttest] = useState(!!draft?.attestation);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const rev = useRef(draft?.rev ?? 0);
  const dirty = useRef(false);
  const lastToast = useRef(0);

  const steps = res.steps_checked.filter((p) => job.steps.some((s) => s.position === p)).length;
  const stepsOk = steps >= job.steps.length;
  const setVal = (id: string, patch: Partial<Val>) => {
    dirty.current = true;
    setVals((v) => ({ ...v, [id]: { ...v[id]!, ...patch } }));
    setErrors((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
  };

  const payloadItems = useCallback(
    () =>
      job.proof_requirements.map((r) => ({
        proof_requirement_id: r.id,
        link_url: vals[r.id]?.link_url.trim() || null,
        text_value: vals[r.id]?.text_value || null,
        upload_id: vals[r.id]?.upload_id ?? null,
      })),
    [job.proof_requirements, vals],
  );

  const saveDraft = useCallback(
    async (manual: boolean) => {
      rev.current += 1;
      setSaveState('saving');
      try {
        await api.put(`/worker/reservations/${res.id}/progress`, {
          draft: { proof_items: payloadItems(), worker_note: note.trim() || null, attestation: attest, rev: rev.current },
        });
        dirty.current = false;
        setSaveState('saved');
        if (manual || Date.now() - lastToast.current > 30_000) {
          lastToast.current = Date.now();
          toast.show({ tone: 'info', title: 'Draft saved', body: 'We save your progress automatically while the slot is held.' });
        }
      } catch (e) {
        setSaveState('failed');
        if (e instanceof ApiError && e.code === 'RESERVATION_EXPIRED') setExpired(true);
        else if (manual) toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Your changes are still here. Try again.' });
      }
    },
    [res.id, payloadItems, note, attest, toast],
  );

  // 2 s autosave after the last change; retries a failed save on the next change or after 5 s.
  const key = JSON.stringify([vals, note, attest]);
  const savedKey = useRef(key);
  useEffect(() => {
    if (key === savedKey.current) return;
    if (submitting || expired) return;
    dirty.current = true;
    const id = setTimeout(() => {
      savedKey.current = key;
      void saveDraft(false);
    }, 2000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (saveState !== 'failed' || expired) return;
    const id = setTimeout(() => void saveDraft(false), 5000);
    return () => clearTimeout(id);
  }, [saveState, saveDraft, expired]);

  const warned = useRef(false);
  useEffect(() => {
    if (warned.current) return;
    warned.current = true;
    if (job.slots_left <= 3) toast.show({ tone: 'warning', title: `Only ${job.slots_left} slots left`, body: 'Submit soon to make sure your work counts.' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checklist = useMemo(
    () => [
      ...job.proof_requirements.filter((r) => r.is_required).map((r) => ({ key: r.id, label: checklistLabel(r), done: isDone(r, vals[r.id]), what: labelFor(r).toLowerCase() })),
      { key: 'steps', label: `All ${job.steps.length} steps ticked`, done: stepsOk, what: '' },
    ],
    [job.proof_requirements, job.steps.length, vals, stepsOk],
  );
  const ready = checklist.every((c) => c.done) && attest && [...note].length <= NOTE_MAX;
  const disabledReason = useMemo(() => {
    const parts: string[] = [];
    if (!stepsOk) parts.push(`Tick all ${job.steps.length} steps to submit`);
    const missing = checklist.filter((c) => c.key !== 'steps' && !c.done).map((c) => `add ${c.what}`);
    if (missing.length) parts.push(parts.length ? missing.join(', ') : `${missing.join(', ').replace(/^a/, 'A')} to submit`);
    if (!attest) parts.push(parts.length ? 'confirm you did this work yourself' : 'Confirm you did this work yourself');
    return parts.join(', ');
  }, [stepsOk, job.steps.length, checklist, attest]);

  const validate = () => {
    const e: Record<string, string> = {};
    for (const r of job.proof_requirements) {
      const v = vals[r.id];
      if (r.proof_type === 'link' && v?.link_url.trim() && !isHttpsUrl(v.link_url.trim())) e[r.id] = LINK_INVALID_MESSAGE;
      else if (r.is_required && !isDone(r, v)) e[r.id] = r.proof_type === 'link' ? LINK_INVALID_MESSAGE : 'Add this proof.';
    }
    if ([...note].length > NOTE_MAX) e.note = 'Keep the note under 300 characters.';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await api.post<SubmitResponse>(`/worker/reservations/${res.id}/submit`, {
        steps_checked: res.steps_checked,
        proof_items: payloadItems().filter((p) => p.link_url || p.text_value || p.upload_id),
        worker_note: note.trim() || null,
        attestation: true,
      });
      setConfirm(false);
      toast.show({ tone: 'success', title: 'Proof submitted', body: `The employer has up to ${job.terms.review_window_hours} h to review it. We’ll notify you.` });
      void qc.invalidateQueries({ queryKey: wk.all });
      qc.removeQueries({ queryKey: wk.job(job.public_id) });
      router.push(`/worker/tasks/${r.ref}`);
    } catch (e) {
      setSubmitting(false);
      setConfirm(false);
      if (e instanceof ApiError) {
        if (e.code === 'RESERVATION_EXPIRED') return setExpired(true);
        if (e.code === 'JOB_NOT_AVAILABLE') {
          toast.show({ tone: 'danger', title: 'This job was closed by the employer, so your slot was released.' });
          void qc.invalidateQueries({ queryKey: wk.job(job.public_id) });
          return;
        }
        const fe: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(e.fields)) {
          const m = k.match(/^proof_items\.(\d+)\./);
          const items = payloadItems().filter((p) => p.link_url || p.text_value || p.upload_id);
          if (m) {
            const it = items[Number(m[1])];
            const reqId = it?.proof_requirement_id ?? job.proof_requirements[Number(m[1])]?.id;
            if (reqId) fe[reqId] = msgs[0]!;
          } else if (k === 'worker_note') fe.note = msgs[0]!;
          else if (k === 'steps_checked') fe.steps = msgs[0]!;
        }
        if (Object.keys(fe).length) {
          setErrors(fe);
          return;
        }
      }
      toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Your changes are still here. Try again.' });
    }
  };

  const onSubmitClick = () => {
    if (!ready) return;
    if (validate()) setConfirm(true);
  };

  const reward = formatReward(job.reward_usd);
  const employer = job.employer.business_name;
  const pulseRef = usePulse<HTMLSpanElement>(low);
  const intro = job.proof_instructions ?? `The employer asked for ${job.proof_requirements.map((r) => r.title.charAt(0).toLowerCase() + r.title.slice(1)).join(' and ')}.`;

  return (
    <div className="max-desktop:pb-24">
      <WizardStepper steps={['Instructions', 'Submit proof', 'Review']} current={2} hrefFor={() => `/worker/jobs/${job.public_id}`} className="max-w-[520px] max-tablet:hidden" />

      {/* Mobile heading 48:1009 */}
      <div className="mb-4 tablet:hidden">
        <h2 className="text-h5 text-fg">{job.title}</h2>
        <p className="mt-1 text-body-sm text-fg-tertiary">
          {employer} · slot held{' '}
          <span ref={pulseRef} className={cn('inline-block tabular-nums', low && 'text-fg-danger')}>
            {formatMmSs(left)}
          </span>
        </p>
      </div>

      <div className="grid gap-6 tablet:mt-6 desktop:grid-cols-[minmax(0,1fr)_360px]">
        <form
          noValidate
          className="min-w-0 max-tablet:space-y-5 tablet:rounded-card tablet:border tablet:border-line tablet:bg-surface tablet:p-6 tablet:shadow-xs"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmitClick();
          }}
        >
          <div className="max-tablet:hidden">
            <h2 className="font-display text-h3 text-fg">Submit your proof</h2>
            <p className="mt-1 text-body-md text-fg-secondary">{intro}</p>
          </div>

          <div className="space-y-5 tablet:mt-5">
            {job.proof_requirements.map((r) => (
              <ProofField key={r.id} req={r} value={vals[r.id]!} onChange={(p) => setVal(r.id, p)} error={errors[r.id]} initialUpload={vals[r.id]?.upload_id ? res.draft_uploads?.[vals[r.id]!.upload_id!] : null} />
            ))}

            <Textarea
              label="Note to the employer (optional)"
              placeholder="Anything they should know about your submission"
              value={note}
              softMax={NOTE_MAX}
              helper="Visible to the employer only."
              error={errors.note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />

            <div className="rounded-[12px] bg-success-subtle p-4">
              <p className="text-label-md text-fg-success">Proof checklist</p>
              <ul className="mt-2 grid gap-2 tablet:grid-cols-3">
                {checklist.map((c) => (
                  <CheckItem key={c.key} label={c.label} done={c.done} />
                ))}
              </ul>
              {!stepsOk ? (
                <NextLink href={`/worker/jobs/${job.public_id}`} className="mt-2 inline-block text-label-sm font-semibold text-fg-brand hover:underline">
                  Back to the steps
                </NextLink>
              ) : null}
              {errors.steps ? <p className="mt-2 text-body-sm text-fg-danger">{errors.steps}</p> : null}
            </div>

            <Checkbox
              label={
                <>
                  <span className="tablet:hidden">I did this work myself</span>
                  <span className="max-tablet:hidden">I did this work myself and followed every step</span>
                </>
              }
              checked={attest}
              onChange={(e) => {
                dirty.current = true;
                setAttest(e.target.checked);
              }}
            />

            <div className="hidden flex-wrap items-center justify-between gap-4 tablet:flex">
              <div>
                <p className="text-body-xs text-fg-tertiary">You can fix and resubmit if the employer asks.</p>
                <p className="mt-1 text-body-xs text-fg-tertiary" aria-live="polite">
                  {saveState === 'saving' ? 'Saving…' : saveState === 'failed' ? 'Not saved yet. Retrying…' : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button type="button" variant="secondary" size="L" className="w-[140px]" loading={saveState === 'saving'} loadingText="Saving…" onClick={() => void saveDraft(true)}>
                  Save draft
                </Button>
                <Button type="submit" size="L" className="w-[220px]" disabled={!ready} aria-describedby={!ready ? 'submit-reason' : undefined}>
                  Submit for review
                </Button>
              </div>
            </div>
            {!ready ? (
              <p id="submit-reason" className="text-body-sm text-fg-tertiary max-tablet:hidden tablet:text-right">
                {disabledReason}
              </p>
            ) : null}
          </div>
        </form>

        <aside className="min-w-0 space-y-6">
          <Panel className="max-tablet:hidden">
            <h3 className="text-h5 text-fg">What happens next</h3>
            <Timeline
              className="mt-5"
              items={[
                { title: 'You submit', body: `Your proof goes to ${employer} right away.`, state: 'current' },
                { title: 'Employer reviews', body: `Within ${job.terms.review_window_hours} hours. Rejections must include a reason.`, state: 'current' },
                { title: 'Approved', body: 'Or returned with a reason so you can fix it.', state: 'current' },
                { title: `${reward} added to balance`, body: 'Instantly after approval. Withdraw any time above the minimum.', state: 'current' },
              ]}
            />
          </Panel>
          <Panel className="tablet:hidden">
            <h3 className="text-label-md text-fg">What happens next</h3>
            <p className="mt-1 text-body-sm text-fg-secondary">
              {employer} reviews within {job.terms.review_window_hours} h. Approved rewards land in your balance instantly.
            </p>
          </Panel>
          <section className="rounded-card border border-line-subtle bg-subtle p-5 max-tablet:hidden">
            <h3 className="text-label-md text-fg">Job summary</h3>
            <Rows
              className="mt-4"
              rows={[
                ['Reward', reward],
                ['Employer', employer],
                ['Slot held for', <SlotTime key="t" ms={left} low={low} />],
                ['Job ID', job.public_id],
              ]}
            />
          </section>
        </aside>
      </div>

      <StickyActionBar className="tablet:hidden">
        <Button size="L" fullWidth disabled={!ready} onClick={onSubmitClick}>
          Submit for review
        </Button>
      </StickyActionBar>
      {!ready ? <p className="mt-4 text-center text-body-sm text-fg-tertiary tablet:hidden">{disabledReason}</p> : null}

      <Dialog
        open={confirm}
        onOpenChange={(o) => !submitting && setConfirm(o)}
        title="Submit for review?"
        description={`${employer} will see your proof and has up to ${job.terms.review_window_hours} hours to review it.`}
        busy={submitting}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)} disabled={submitting}>
              Keep editing
            </Button>
            <Button loading={submitting} loadingText="Submitting…" onClick={() => void submit()}>
              Submit for review
            </Button>
          </>
        }
      />
      <ExpiredDialog open={expired} />
    </div>
  );
}

function SlotTime({ ms, low }: { ms: number; low: boolean }) {
  const ref = usePulse<HTMLSpanElement>(low);
  return (
    <span ref={ref} className={cn('inline-block font-display tabular-nums', low && 'text-fg-danger')}>
      {formatMmSs(ms)}
    </span>
  );
}

function CheckItem({ label, done }: { label: string; done: boolean }) {
  const ref = useTickBounce<HTMLSpanElement>(done);
  return (
    <li className={cn('flex items-center gap-2 text-body-sm', done ? 'text-fg' : 'text-fg-tertiary')}>
      <span ref={ref} className="inline-flex">
        <Icon name={done ? 'check-circle' : 'x-circle'} size={16} className={done ? 'text-fg-success' : 'text-fg-disabled'} />
      </span>
      {label}
      <span className="sr-only">{done ? ' (done)' : ' (not done)'}</span>
    </li>
  );
}

function ProofField({ req, value, onChange, error, initialUpload }: { req: WorkerProofRequirement; value: Val; onChange: (p: Partial<Val>) => void; error?: string; initialUpload?: UploadRecord | null }) {
  const label = labelFor(req);
  if (req.proof_type === 'link')
    return (
      <Field
        label={label}
        leadingIcon="link"
        type="url"
        inputMode="url"
        placeholder="https://"
        value={value.link_url}
        trimOnBlur
        onChange={(e) => onChange({ link_url: e.target.value })}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && !isHttpsUrl(v)) onChange({ link_url: e.target.value });
        }}
        helper={req.helper ?? 'Check that “Anyone with the link” can view it.'}
        error={error ?? (value.link_url.trim() && !isHttpsUrl(value.link_url.trim()) && value.link_url.length > 8 ? LINK_INVALID_MESSAGE : undefined)}
      />
    );
  if (req.proof_type === 'text')
    return (
      <Textarea
        label={req.title}
        value={value.text_value}
        softMax={2000}
        helper={req.helper ?? undefined}
        error={error}
        onChange={(e) => onChange({ text_value: e.target.value })}
        rows={4}
      />
    );
  return <UploadField type={req.proof_type} label={label} helper={req.helper} error={error} initial={initialUpload} onChange={(id) => onChange({ upload_id: id })} />;
}

export function UploadField({ type, label, helper, error, initial, onChange }: { type: ProofType; label: string; helper?: string | null; error?: string; initial?: UploadRecord | null; onChange: (id: string | null) => void }) {
  const purpose = type === 'file' ? 'proof_file' : 'proof_screenshot';
  const rule = UPLOAD_RULES[purpose];
  const up = useProofUpload(purpose, initial, onChange);
  return (
    <div>
      <Upload
        label={label}
        accept={rule.accept}
        maxBytes={rule.maxBytes}
        phase={up.state.phase}
        progress={up.state.progress}
        file={up.state.file}
        error={up.state.error ?? (error ? { title: error } : null)}
        onSelect={(f) => void up.select(f)}
        onRemove={up.reset}
        title={type === 'file' ? 'Drag your file here or browse' : 'Drag your screenshot here or browse'}
        helper={type === 'file' ? `${rule.typesLabel} · up to 10 MB · one file` : 'PNG or JPG · up to 5 MB · one file'}
      />
      {helper && up.state.phase !== 'error' ? <p className="mt-1.5 text-body-xs text-fg-tertiary">{helper}</p> : null}
    </div>
  );
}
