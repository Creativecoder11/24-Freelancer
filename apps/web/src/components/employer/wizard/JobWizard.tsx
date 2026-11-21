'use client';
import NextLink from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  ChoiceChipGroup,
  CountUp,
  CurrencyInput,
  Dialog,
  Field,
  Icon,
  JobRow,
  NumberStepper,
  Select,
  Skeleton,
  StickyActionBar,
  Switch,
  Textarea,
  Upload,
  cn,
  gsap,
  useGSAP,
  MOTION_OK,
  toast,
} from '@24f/ui';
import { COUNTRY_NAMES, JOB_ZONES, UPLOAD_RULES, formatMoney, formatReward, jobZone, targetingLabel, zoneCountries } from '@24f/shared';
import { useProofUpload } from '@/components/worker/useProofUpload';
import {
  api,
  ApiError,
  ek,
  errorText,
  idemKey,
  invalidateEmployer,
  useCategories,
  useJob,
  useJobOptions,
  useQueryClient,
  useWallet,
  type JobCategory,
  type JobDetail,
  type JobOptions,
  type Quote,
} from '../api';
import { useEmployerHeader } from '../shell';
import { ErrorPanel, TIME_OPTIONS, timeLabel } from '../common';
import { StepsEditor } from './StepsEditor';
import {
  LAST_FORM_STEP,
  MAX_SCREENSHOTS,
  OPEN_FOR,
  PROOF_OPTIONS,
  REVIEW_WINDOWS,
  SLOT_PRESETS,
  STEP_COUNT,
  STEP_LABELS,
  emptyForm,
  formFromJob,
  payloadFor,
  proofLabel,
  publishedPayload,
  serverFieldErrors,
  validate,
  type JobDefaults,
  type ProofType,
  type ValidateCtx,
  type WizardForm,
} from './model';

const money = (n: number) => formatMoney(n.toFixed(6));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Post-a-job wizard (SCR-EMP-02…06), five steps after the Nov 2026 change request:
 * 1 Location · 2 Category · 3 Job information · 4 Budget & settings · 5 Review & publish.
 * `/employer/jobs/new?step=1` creates the draft on the first Continue or Save draft, then the URL
 * moves to `/employer/jobs/[publicId]/edit?step=n`. Each Continue saves via PATCH; edits autosave.
 */
export function JobWizard({ publicId }: { publicId?: string }) {
  const params = useSearchParams();
  const step = Math.min(STEP_COUNT, Math.max(1, Number(params.get('step')) || 1));
  const job = useJob(publicId ?? null);
  const profile = useQuery({
    queryKey: ['employer', 'profile'],
    queryFn: () => api.get<{ job_defaults: JobDefaults }>('/employer/profile'),
    enabled: !publicId,
    staleTime: 60_000,
  });
  const published = !!job.data && job.data.status !== 'draft';
  useEmployerHeader({
    title: published ? 'Edit job' : 'Post a job',
    subtitle: published ? (job.data?.title ?? undefined) : 'Five short steps. You’ll see the full cost before anything is published.',
    hideTabBar: true,
    backHref: published ? `/employer/jobs/${publicId}` : '/employer/jobs',
  });

  if (publicId && job.isError) {
    return job.error instanceof ApiError && job.error.status === 404 ? (
      <ErrorPanelNotFound />
    ) : (
      <ErrorPanel onRetry={() => job.refetch()} />
    );
  }
  if ((publicId && !job.data) || (!publicId && profile.isLoading)) return <WizardSkeleton />;
  if (job.data && (job.data.status === 'completed' || job.data.status === 'cancelled' || job.data.status === 'suspended')) {
    return (
      <Alert tone="warning" title="This job can’t be edited" action={<Button size="S" variant="secondary" href={`/employer/jobs/${publicId}`}>View job</Button>}>
        {job.data.status === 'suspended' ? 'Suspended by admin. Contact support.' : 'It has ended. Duplicate it to post it again.'}
      </Alert>
    );
  }
  return <WizardBody key={publicId ?? 'new'} step={step} job={job.data ?? null} defaults={profile.data?.job_defaults ?? null} />;
}

function ErrorPanelNotFound() {
  return (
    <Alert tone="danger" title="We can’t find that job." action={<Button size="S" variant="secondary" href="/employer/jobs">My jobs</Button>}>
      It may have been deleted.
    </Alert>
  );
}

function WizardBody({ step, job, defaults }: { step: number; job: JobDetail | null; defaults: JobDefaults | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState<WizardForm>(() => (job ? formFromJob(job) : emptyForm(defaults)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [confirmRules, setConfirmRules] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [pubError, setPubError] = useState<{ title: string; body: string } | null>(null);
  const publicId = job?.public_id ?? null;
  const published = !!job && job.status !== 'draft';
  const locked = new Set(job?.locked_fields ?? []);
  const categories = useCategories();
  const options = useJobOptions();
  const wallet = useWallet();
  const card = useRef<HTMLDivElement>(null);

  const cat = categories.data?.find((c) => c.slug === form.category) ?? null;
  const vctx: ValidateCtx = {
    // Jobs published before subcategories existed don't need one.
    subcategoryRequired: !!cat?.subcategories.length && !published,
    minSpendUsd: options.data ? Number(options.data.min_spend_usd) : undefined,
    scheduleMaxDays: options.data?.schedule_max_days,
  };

  // Steps beyond the furthest reachable one go back (drafts only).
  const reachable = job ? (published ? STEP_COUNT : Math.min(STEP_COUNT, Math.max(job.wizard_step + 1, 1))) : 1;
  useEffect(() => {
    if (step > reachable) router.replace(`${base(publicId)}?step=${reachable}`);
  }, [step, reachable, publicId, router]);

  const set = <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
    if (errors[k as string]) setErrors((e) => ({ ...e, [k]: '' }));
  };
  const patch = (p: Partial<WizardForm>) => {
    setForm((f) => ({ ...f, ...p }));
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(p)) delete next[k];
      return next;
    });
  };

  // Step change: card content slides in.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from('[data-wz]', { autoAlpha: 0, y: 12, duration: 0.35, stagger: 0.04, ease: 'power2.out', clearProps: 'all' });
      });
      return () => mm.revert();
    },
    { scope: card, dependencies: [step] },
  );

  // Leaving with unsaved changes (emp.wizard.unsaved).
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // ---------------------------------------------------------------- save

  const bodyFor = (s: number) => (published ? publishedPayload(s, form) : payloadFor(s, form));
  const save = useMutation({
    mutationFn: async ({ s, withStep }: { s: number; withStep: boolean }) => {
      if (!publicId) {
        return api.post<{ public_id: string }>('/employer/jobs', { ...payloadFor(1, form), wizard_step: 1 });
      }
      return api.patch<{ public_id: string }>(`/employer/jobs/${publicId}`, { ...bodyFor(s), ...(withStep ? { wizard_step: s } : {}) });
    },
  });

  // Autosave drafts (debounced) when the current step is valid.
  useEffect(() => {
    if (!publicId || published || !dirty || step > LAST_FORM_STEP) return;
    if (Object.keys(validate(step, form, vctx)).length) return;
    const t = setTimeout(async () => {
      setSaveState('saving');
      try {
        await api.patch(`/employer/jobs/${publicId}`, payloadFor(step, form));
        setSaveState('saved');
        setDirty(false);
        void qc.invalidateQueries({ queryKey: ek.job(publicId) });
      } catch {
        setSaveState('failed');
      }
    }, 1800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, dirty, publicId, step, published]);

  const goto = (s: number, id = publicId) => {
    router.push(`${base(id)}?step=${s}`, { scroll: true });
    window.scrollTo({ top: 0 });
  };

  const submitStep = async (opts: { draftOnly?: boolean } = {}) => {
    const errs = validate(step, form, vctx);
    if (Object.values(errs).some(Boolean)) {
      setErrors(errs);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"], [data-error-anchor]')?.focus());
      return;
    }
    try {
      const r = await save.mutateAsync({ s: step, withStep: !opts.draftOnly });
      setDirty(false);
      setSaveState('saved');
      await qc.invalidateQueries({ queryKey: ek.job(r.public_id) });
      void qc.invalidateQueries({ queryKey: ['employer', 'jobs'] });
      if (opts.draftOnly) {
        toast.show({ tone: 'success', title: 'Draft saved', body: 'Find it any time in My jobs → Drafts.' });
        if (!publicId) router.replace(`${base(r.public_id)}?step=${step}`);
        return;
      }
      if (published && step === LAST_FORM_STEP) {
        toast.show({ tone: 'success', title: 'Changes saved' });
        router.push(`/employer/jobs/${r.public_id}`);
        return;
      }
      goto(step + 1, r.public_id);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VALIDATION_FAILED' && Object.keys(e.fields).length) {
        const fe = serverFieldErrors(e.fields);
        setErrors(fe);
        // An error on a field that isn't on this step would otherwise be invisible.
        const hidden = Object.entries(fe).find(([k]) => !STEP_FIELDS[step]?.includes(k));
        if (hidden) {
          const owner = Object.entries(STEP_FIELDS).find(([, keys]) => keys.includes(hidden[0]))?.[0];
          toast.show({ tone: 'danger', title: 'That didn’t save', body: owner ? `${hidden[1]} (step ${owner}: ${STEP_LABELS[Number(owner) - 1]})` : hidden[1] });
        }
      } else if (e instanceof ApiError && e.code === 'JOB_LOCKED') toast.show({ tone: 'warning', title: 'Submissions have arrived. You can add slots, extend the job or pause it.' });
      else toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Your changes are still here. Try again.' });
    }
  };

  // ---------------------------------------------------------------- quote

  const quote = useDebouncedQuote(publicId, step >= LAST_FORM_STEP ? form.reward_usd : null, form.slots_total);
  const reward = Number(form.reward_usd) || 0;
  const localTotal = reward * form.slots_total;
  const total = quote.data ? Number(quote.data.total_reserved_exact_usd) : localTotal;
  // Publishing only reserves the budget. Top / Pin are bought later on the running job.
  const due = total;
  const available = quote.data ? Number(quote.data.available_usd) : Number(wallet.data?.available_usd ?? 0);
  const shortfall = quote.data ? Number(quote.data.shortfall_usd) : Math.max(0, localTotal - available);
  const totalLabel = quote.data ? formatMoney(quote.data.total_reserved_usd) : money(localTotal);
  const dueLabel = quote.data && !published ? formatMoney(quote.data.total_due_usd) : money(due);
  const minSpend = Number(quote.data?.min_spend_usd ?? options.data?.min_spend_usd ?? 0);
  const belowMin = !!form.reward_usd && reward > 0 && minSpend > 0 && localTotal < minSpend - 1e-9;

  const publish = useMutation({
    mutationFn: () =>
      api.post<{ public_id: string; total_reserved_usd: string; starts_at: string | null }>(
        `/employer/jobs/${publicId}/publish`,
        {
          posting_rules_accepted: true,
          expected_total_reserved_usd: quote.data?.total_reserved_usd ?? localTotal.toFixed(2),
        },
        { headers: { 'Idempotency-Key': idemKey() } },
      ),
    onSuccess: async (r) => {
      setDirty(false);
      toast.show({
        tone: 'success',
        title: r.starts_at ? 'Job scheduled' : 'Job published',
        body: `${formatMoney(r.total_reserved_usd)} is reserved from your deposit.${r.starts_at ? ` Goes live ${new Date(r.starts_at).toLocaleString()}.` : ''}`,
      });
      await invalidateEmployer(qc);
      router.push(`/employer/jobs/${r.public_id}`);
    },
    onError: (e) => {
      setPublishOpen(false);
      void qc.invalidateQueries({ queryKey: ['employer'] });
      if (e instanceof ApiError) {
        if (e.code === 'INSUFFICIENT_BALANCE' || e.code === 'QUOTE_CHANGED') {
          void quote.refetch();
          setPubError(e.code === 'QUOTE_CHANGED' ? { title: 'The price changed', body: e.message || 'Check the new total and publish again.' } : null);
          return;
        }
        if (e.code === 'JOB_CONTENT_BLOCKED') return setPubError({ title: 'This job can’t be published yet', body: 'It may break the posting rules. Edit it or contact support.' });
        if (e.code === 'VERIFICATION_REQUIRED') return setPubError({ title: 'Verify your account', body: 'Verify your email or phone before publishing.' });
        if (e.code === 'JOB_INCOMPLETE') {
          const n = (e.details.first_incomplete_step as number) ?? 1;
          return setPubError({ title: 'Some steps aren’t finished', body: `Finish step ${n} (${STEP_LABELS[n - 1] ?? ''}) first.` });
        }
        if (e.code === 'RECEIVABLE_OUTSTANDING') return setPubError({ title: 'Settle your balance first', body: e.message });
      }
      toast.show({ tone: 'danger', title: 'That didn’t save', body: errorText(e, 'Your changes are still here. Try again.') });
    },
  });

  // ---------------------------------------------------------------- render

  const catName = cat?.name ?? 'Category';
  const subName = cat?.subcategories.find((s) => s.slug === form.subcategory)?.name ?? null;
  const minutes = TIME_OPTIONS.find((t) => t.value === form.time_per_task)?.minutes ?? 5;
  const returnTo = publicId ? `/employer/jobs/${publicId}/edit?step=${step}` : '/employer/jobs/new';
  const addFundsHref = `/employer/wallet?add=${Math.max(10, Math.ceil(shortfall * 100) / 100).toFixed(2)}&return=${encodeURIComponent(returnTo)}`;

  const stepHeader: Record<number, [string, string]> = {
    1: ['Where should workers be?', 'Pick a zone. You can hide individual countries inside it.'],
    2: ['What kind of job is it?', 'Choose a category and a subcategory so the right workers find it.'],
    3: ['Tell workers exactly what to do', 'A clear title and numbered steps cut rejections. Workers tick each step before they can submit.'],
    4: ['Set your budget and settings', 'You pay the reward for each approved task. Nothing is charged until work is approved.'],
    5: ['Review and publish', 'Check everything once more. You can edit the job until the first submission arrives.'],
  };

  return (
    <div className="pb-28 desktop:pb-0">
      <WizardSteps current={step} reachable={reachable} hrefFor={(n) => `${base(publicId)}?step=${n}`} />
      <div className="mt-6 grid gap-6 desktop:mt-8 desktop:grid-cols-[minmax(0,720px)_minmax(0,360px)] desktop:justify-between">
        <div ref={card} className="min-w-0 rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-8">
          <div data-wz className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-h3 text-fg">{stepHeader[step]![0]}</h2>
              <p className="mt-1 text-body-md text-fg-secondary">{stepHeader[step]![1]}</p>
            </div>
            <SaveIndicator state={saveState} />
          </div>
          {locked.size > 1 ? (
            <Alert tone="info" className="mt-5">
              Submissions have arrived. You can add slots, extend the job or pause it.
            </Alert>
          ) : null}

          <form
            className="mt-6 space-y-6"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (step < STEP_COUNT) void submitStep();
            }}
          >
            {step === 1 ? <StepLocation form={form} patch={patch} errors={errors} locked={locked} /> : null}
            {step === 2 ? <StepCategory form={form} patch={patch} errors={errors} locked={locked} categories={categories.data ?? null} published={published} /> : null}
            {step === 3 ? <StepInfo form={form} set={set} patch={patch} errors={errors} locked={locked} /> : null}
            {step === 4 ? (
              <StepBudget
                form={form}
                set={set}
                errors={errors}
                locked={locked}
                published={published}
                job={job}
                options={options.data ?? null}
                totalLabel={money(localTotal)}
                dueLabel={money(localTotal)}
                belowMin={belowMin}
                minSpend={minSpend}
                shortfall={shortfall}
                addFundsHref={addFundsHref}
              />
            ) : null}
            {step === 5 ? (
              <StepReview
                form={form}
                catName={cat?.name ?? '—'}
                subName={subName}
                totalLabel={totalLabel}
                job={job}
                hrefFor={(n) => `${base(publicId)}?step=${n}`}
                confirm={confirmRules}
                onConfirm={setConfirmRules}
                published={published}
              />
            ) : null}

            {step === STEP_COUNT && !published && shortfall > 0 ? (
              <Alert
                tone="danger"
                title="Not enough available balance"
                action={
                  <Button size="S" href={addFundsHref}>
                    Add funds · {formatMoney(Math.max(10, shortfall).toFixed(2))}
                  </Button>
                }
              >
                Publishing takes {dueLabel}, and you have {formatMoney(available.toFixed(6))} available. Add {formatMoney(shortfall.toFixed(2))} to publish.
              </Alert>
            ) : null}
            {step === STEP_COUNT && !published && belowMin ? (
              <Alert tone="danger" title={`Minimum spend is ${formatMoney(minSpend.toFixed(2))}`}>
                Increase the number of workers or the reward in step 4.
              </Alert>
            ) : null}
            {step === STEP_COUNT && pubError ? (
              <Alert tone="danger" title={pubError.title}>
                {pubError.body}
              </Alert>
            ) : null}

            <div className="border-t border-line-subtle pt-6 max-desktop:border-0 max-desktop:pt-0">
              <StickyActionBar>
                {step === 1 ? (
                  published ? (
                    <Button variant="secondary" href={`/employer/jobs/${publicId}`} className="max-desktop:flex-1">
                      Cancel
                    </Button>
                  ) : (
                    <Button variant="tertiary" onClick={() => void submitStep({ draftOnly: true })} loading={save.isPending && save.variables?.withStep === false} className="max-desktop:flex-1">
                      Save draft
                    </Button>
                  )
                ) : (
                  <Button variant="secondary" size="L" onClick={() => goto(step - 1)} className="min-w-[120px] max-desktop:flex-1">
                    Back
                  </Button>
                )}
                <span className="hidden flex-1 desktop:block" />
                {step < STEP_COUNT ? (
                  <Button type="submit" size="L" loading={save.isPending && save.variables?.withStep !== false} loadingText="Saving…" className="min-w-[160px] max-desktop:flex-[2]">
                    {step === LAST_FORM_STEP ? (published ? 'Save changes' : 'Continue to review') : 'Next'}
                  </Button>
                ) : published ? (
                  <Button size="L" href={`/employer/jobs/${publicId}`} className="max-desktop:flex-[2]">
                    Done
                  </Button>
                ) : (
                  <>
                    <Button
                      size="L"
                      onClick={() => {
                        setPubError(null);
                        setPublishOpen(true);
                      }}
                      disabled={!confirmRules || shortfall > 0 || belowMin || quote.isFetching}
                      disabledReasonId="publish-reason"
                      className="min-w-[200px] max-desktop:flex-[2]"
                    >
                      {form.starts_at ? 'Schedule job' : 'Submit post'} · {dueLabel}
                    </Button>
                    <span id="publish-reason" className="sr-only">
                      {shortfall > 0 ? 'Add funds to publish.' : belowMin ? 'Raise the budget to the minimum spend.' : 'Confirm the posting rules to publish.'}
                    </span>
                  </>
                )}
              </StickyActionBar>
              {step === STEP_COUNT && !published && !confirmRules ? <p className="mt-2 text-right text-body-xs text-fg-tertiary max-desktop:hidden">Confirm the posting rules to publish.</p> : null}
            </div>
          </form>
        </div>

        <Rail
          step={step}
          form={form}
          catName={form.category ? catName : 'Category'}
          subName={subName}
          minutes={minutes}
          quote={quote.data ?? null}
          total={total}
          due={due}
          depositBalance={wallet.data?.deposit_balance_usd ?? null}
          available={available}
          isNew={!job?.published_at}
        />
      </div>

      <Dialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title={form.starts_at ? 'Schedule this job?' : 'Publish this job?'}
        description={[
          `We’ll reserve ${totalLabel} from your deposit (${form.slots_total} slots × ${formatReward(form.reward_usd || '0')}). Unused budget returns to your deposit when the job closes.`,
          form.starts_at ? `Workers see it from ${new Date(form.starts_at).toLocaleString()}.` : '',
        ]
          .filter(Boolean)
          .join(' ')}
        busy={publish.isPending}
        footer={
          <>
            <Button variant="secondary" onClick={() => !publish.isPending && setPublishOpen(false)}>
              Back to edit
            </Button>
            <Button onClick={() => publish.mutate()} loading={publish.isPending} loadingText="Publishing…">
              {form.starts_at ? 'Schedule' : 'Publish'} · {dueLabel}
            </Button>
          </>
        }
      />
    </div>
  );
}

const base = (id: string | null) => (id ? `/employer/jobs/${id}/edit` : '/employer/jobs/new');

/** Form fields shown on each step (server errors outside this list are surfaced as a toast). */
const STEP_FIELDS: Record<number, string[]> = {
  1: ['target_zone', 'excluded_countries'],
  2: ['category', 'subcategory'],
  3: ['title', 'note', 'time_per_task', 'steps', 'task_link_url', 'proof_requirements', 'proof_instructions', 'thumbnail_upload_id'],
  4: ['reward_usd', 'slots_total', 'open_for_days', 'eligibility', 'min_approval_rate', 'review_window_hours', 'starts_at'],
};

function useDebouncedQuote(publicId: string | null, reward: string | null, slots: number) {
  const [args, setArgs] = useState<{ reward: string | null; slots: number }>({ reward, slots });
  useEffect(() => {
    const t = setTimeout(() => setArgs({ reward, slots }), 350);
    return () => clearTimeout(t);
  }, [reward, slots]);
  const valid = !!args.reward && /^\d+(\.\d{1,3})?$/.test(args.reward) && Number(args.reward) > 0 && args.slots >= 1;
  return useQuery({
    queryKey: ['employer', 'quote', publicId, args.reward, args.slots],
    queryFn: () => api.post<Quote>(`/employer/jobs/${publicId}/quote`, { reward_usd: args.reward, slots_total: args.slots }),
    enabled: !!publicId && valid,
    placeholderData: (p) => p,
    staleTime: 10_000,
  });
}

function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' | 'failed' }) {
  if (state === 'idle') return null;
  return (
    <span role="status" className={cn('mt-1 hidden shrink-0 items-center gap-1 text-body-xs tablet:inline-flex', state === 'failed' ? 'text-fg-warning' : 'text-fg-tertiary')}>
      <Icon name={state === 'saving' ? 'loader' : state === 'saved' ? 'check' : 'alert-triangle'} size={14} className={state === 'saving' ? 'animate-spin' : undefined} />
      {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Draft saved' : 'Not saved yet. Retrying…'}
    </span>
  );
}

// ------------------------------------------------------------------ stepper

/** Stepper: 4 px bar above each step, numbered/checked dot, label. */
function WizardSteps({ current, reachable, hrefFor }: { current: number; reachable: number; hrefFor: (n: number) => string }) {
  return (
    <ol aria-label="Progress" className="grid max-w-[940px] grid-cols-5 gap-2 tablet:gap-4">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'current' : 'todo';
        const inner = (
          <>
            <span aria-hidden className={cn('block h-1 rounded-full', state === 'todo' ? 'bg-muted' : 'bg-brand')} />
            <span className="mt-3 flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full text-label-sm font-semibold',
                  state === 'todo' ? 'bg-muted text-fg-tertiary' : 'bg-brand text-fg-on-brand',
                )}
              >
                {state === 'done' ? <Icon name="check" size={14} strokeWidth={3} /> : n}
              </span>
              <span className={cn('hidden truncate text-label-md desktop:inline', state === 'todo' ? 'font-medium text-fg-secondary' : 'text-fg')}>{label}</span>
            </span>
            <span className="sr-only">
              Step {n}: {label}
              {state === 'done' ? ' (done)' : state === 'current' ? ' (current)' : ''}
            </span>
          </>
        );
        return (
          <li key={label} aria-current={state === 'current' ? 'step' : undefined} className="min-w-0">
            {n !== current && n <= reachable ? (
              <NextLink href={hrefFor(n)} className="block rounded-[6px] focus-visible:shadow-focus focus-visible:outline-none">
                {inner}
              </NextLink>
            ) : (
              <div>{inner}</div>
            )}
          </li>
        );
      })}
      <li className="col-span-5 text-label-md text-fg desktop:hidden" aria-hidden>
        Step {current} of {STEP_COUNT} · {STEP_LABELS[current - 1]}
      </li>
    </ol>
  );
}

// ------------------------------------------------------------------ steps

type SetFn = <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
type PatchFn = (p: Partial<WizardForm>) => void;

/** Step 1 · Location: zone + optional countries to hide. */
function StepLocation({ form, patch, errors, locked }: { form: WizardForm; patch: PatchFn; errors: Record<string, string>; locked: Set<string> }) {
  const [showAll, setShowAll] = useState(false);
  const countries = zoneCountries(form.target_zone);
  const LIMIT = 24;
  // Keep hidden countries visible even when the list is collapsed.
  const shown = showAll || countries.length <= LIMIT ? countries : [...new Set([...countries.slice(0, LIMIT), ...form.excluded_countries])];
  const disabled = locked.has('target_zone');
  return (
    <>
      <div data-wz>
        <ChoiceChipGroup
          legend="Zone"
          mode="single"
          options={JOB_ZONES.map((z) => ({ value: z.slug, label: z.label }))}
          value={form.target_zone}
          onChange={(v) => !disabled && v !== form.target_zone && patch({ target_zone: v as string, excluded_countries: [] })}
          error={errors.target_zone}
        />
        <p className="mt-2 text-body-sm text-fg-tertiary">
          {jobZone(form.target_zone)?.countries ? `${countries.length} countries in this zone.` : 'Workers in every country can see this job.'}
        </p>
      </div>
      <div data-wz data-error-anchor={errors.excluded_countries ? '' : undefined} tabIndex={errors.excluded_countries ? -1 : undefined}>
        <div className="rounded-[14px] border border-line-warning bg-warning-subtle px-4 py-3 text-body-sm text-fg-secondary">
          Select countries you want to hide from the selected zone <span className="text-fg-tertiary">(optional)</span>
        </div>
        <div className="mt-4">
          <ChoiceChipGroup
            legend="Hide these countries"
            legendHidden
            mode="multi"
            options={shown.map((c) => ({ value: c, label: COUNTRY_NAMES[c] ?? c }))}
            value={form.excluded_countries}
            onChange={(v) => !locked.has('excluded_countries') && patch({ excluded_countries: [...(v as string[])].sort() })}
            error={errors.excluded_countries}
          />
        </div>
        {countries.length > LIMIT ? (
          <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-3 text-label-md text-fg-brand hover:underline focus-visible:shadow-focus focus-visible:outline-none">
            {showAll ? 'Show fewer countries' : `Show all ${countries.length} countries`}
          </button>
        ) : null}
        {form.excluded_countries.length ? (
          <p className="mt-3 text-body-sm text-fg-secondary">
            Hidden from {plural(form.excluded_countries.length, 'country', 'countries')}. Workers there won’t see this job.
          </p>
        ) : null}
      </div>
    </>
  );
}

/** Step 2 · Category + subcategory. */
function StepCategory({
  form,
  patch,
  errors,
  locked,
  categories,
  published,
}: {
  form: WizardForm;
  patch: PatchFn;
  errors: Record<string, string>;
  locked: Set<string>;
  categories: JobCategory[] | null;
  published: boolean;
}) {
  const cat = categories?.find((c) => c.slug === form.category) ?? null;
  return (
    <>
      <div data-wz data-error-anchor={errors.category ? '' : undefined} tabIndex={errors.category ? -1 : undefined}>
        {categories ? (
          <ChoiceChipGroup
            legend="Category"
            mode="single"
            options={categories.map((c) => ({ value: c.slug, label: c.name }))}
            value={form.category}
            onChange={(v) => !locked.has('category') && v !== form.category && patch({ category: v as string, subcategory: null })}
            error={errors.category}
          />
        ) : (
          <Skeleton height={84} radius={12} />
        )}
      </div>
      {cat?.subcategories.length ? (
        <div data-wz className="border-t border-line-subtle pt-6" data-error-anchor={errors.subcategory ? '' : undefined} tabIndex={errors.subcategory ? -1 : undefined}>
          <ChoiceChipGroup
            legend={published ? 'Subcategory (optional for this job)' : 'Select the subcategory'}
            mode="single"
            options={cat.subcategories.map((s) => ({ value: s.slug, label: s.name }))}
            value={form.subcategory}
            onChange={(v) => !locked.has('subcategory') && patch({ subcategory: v as string })}
            error={errors.subcategory}
          />
        </div>
      ) : null}
    </>
  );
}

/** Step 3 · Job information: title, note, steps, proof, image. */
function StepInfo({ form, set, patch, errors, locked }: { form: WizardForm; set: SetFn; patch: PatchFn; errors: Record<string, string>; locked: Set<string> }) {
  const titleLen = [...form.title].length;
  const toggle = (t: ProofType, on: boolean) => set('proof_types', on ? PROOF_OPTIONS.map((o) => o.value).filter((v) => v === t || form.proof_types.includes(v)) : form.proof_types.filter((x) => x !== t));
  const up = useProofUpload('job_thumbnail', null, (id) => {
    if (id) patch({ thumbnail_upload_id: id, thumbnail_url: null });
  });
  const rule = UPLOAD_RULES.job_thumbnail;
  return (
    <>
      <div data-wz>
        <Field
          label="Write an accurate job title"
          value={form.title}
          maxLength={80}
          onChange={(e) => set('title', e.target.value)}
          error={errors.title}
          helper={`${titleLen} / 80 characters · Start with a verb`}
          placeholder="Categorize 20 product photos into a shared sheet"
          disabled={locked.has('title')}
          trimOnBlur={false}
          id="wz-title"
        />
      </div>
      <div data-wz>
        <Textarea
          label="Note"
          optional
          value={form.note}
          softMax={300}
          onChange={(e) => set('note', e.target.value)}
          helper="Shown to workers above the steps."
          placeholder="e.g. Use a desktop browser. Mobile screenshots are hard to check."
          error={errors.note}
          disabled={locked.has('note')}
        />
      </div>
      <div data-wz>
        <StepsEditor value={form.steps} onChange={(v) => set('steps', v)} error={errors.steps} disabled={locked.has('steps')} />
      </div>
      <div data-wz className="grid gap-5 tablet:grid-cols-2 tablet:gap-4">
        <Select
          label="Time per task"
          options={TIME_OPTIONS.map((t) => ({ value: t.value, label: t.label }))}
          value={form.time_per_task}
          onChange={(v) => set('time_per_task', v)}
          disabled={locked.has('time_per_task')}
        />
        <Field
          label="Task link (shown only after a worker starts)"
          leadingIcon="link"
          type="url"
          inputMode="url"
          value={form.task_link_url}
          onChange={(e) => set('task_link_url', e.target.value)}
          placeholder="https://…"
          error={errors.task_link_url}
          disabled={locked.has('task_link_url')}
          optional
        />
      </div>
      <fieldset data-wz aria-describedby={errors.proof_requirements ? 'proof-err' : undefined} data-error-anchor={errors.proof_requirements ? '' : undefined} tabIndex={errors.proof_requirements ? -1 : undefined}>
        <legend className="mb-2 flex flex-wrap items-baseline gap-x-4 text-label-md text-fg">
          Required proof the job was completed <span className="text-body-sm font-normal text-fg-tertiary">Pick what workers must submit</span>
        </legend>
        <div className="grid gap-3 tablet:grid-cols-2">
          {PROOF_OPTIONS.map((o) => {
            const on = form.proof_types.includes(o.value);
            return (
              <label
                key={o.value}
                className={cn(
                  'flex h-12 cursor-pointer items-center gap-3 rounded-[12px] border px-4 transition-colors has-[:focus-visible]:shadow-focus',
                  on ? 'border-line-brand bg-brand-subtle' : 'border-line bg-surface hover:border-line-strong',
                  locked.has('proof_requirements') && 'cursor-not-allowed opacity-60',
                )}
              >
                <input type="checkbox" className="peer sr-only" checked={on} disabled={locked.has('proof_requirements')} onChange={(e) => toggle(o.value, e.target.checked)} />
                <span aria-hidden className={cn('grid size-5 place-items-center rounded-[6px] border-[1.5px]', on ? 'border-brand bg-brand text-fg-on-brand' : 'border-line-strong bg-surface')}>
                  {on ? <Icon name="check" size={14} strokeWidth={3} /> : null}
                </span>
                <span className="text-body-sm text-fg">{o.label}</span>
              </label>
            );
          })}
        </div>
        {errors.proof_requirements ? (
          <p id="proof-err" className="mt-1.5 flex items-center gap-1 text-body-xs text-fg-danger">
            <Icon name="alert-circle" size={14} />
            {errors.proof_requirements}
          </p>
        ) : null}
      </fieldset>
      {form.proof_types.includes('screenshot') ? (
        <div data-wz>
          <NumberStepper
            label="Required screenshots"
            helper={`Each worker uploads this many screenshots (1–${MAX_SCREENSHOTS}).`}
            value={form.screenshot_count}
            onChange={(v) => set('screenshot_count', v)}
            min={1}
            max={MAX_SCREENSHOTS}
            disabled={locked.has('proof_requirements')}
          />
        </div>
      ) : null}
      <div data-wz>
        <Textarea
          label="Proof instructions"
          value={form.proof_instructions}
          softMax={300}
          onChange={(e) => set('proof_instructions', e.target.value)}
          helper="Workers see this next to the upload box."
          placeholder="Share the sheet link with “Anyone with the link can view” and add one screenshot that shows all rows."
          error={errors.proof_instructions}
          disabled={locked.has('proof_instructions')}
        />
      </div>
      <div data-wz className="rounded-[14px] bg-subtle p-4">
        <p className="text-label-md text-fg">
          Thumbnail image <span className="font-normal text-fg-tertiary">(optional)</span>
        </p>
        <p className="mt-0.5 text-body-sm text-fg-tertiary">Shown on the job page. {rule.typesLabel}, up to 2 MB.</p>
        <div className="mt-3">
          {form.thumbnail_url && !up.state.uploadId ? (
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.thumbnail_url} alt="Current job image" className="size-20 rounded-[10px] border border-line object-cover" />
              <Button variant="secondary" size="S" onClick={() => patch({ thumbnail_upload_id: null, thumbnail_url: null })}>
                Remove image
              </Button>
            </div>
          ) : (
            <Upload
              label="Thumbnail image"
              labelHidden
              accept={rule.accept}
              maxBytes={rule.maxBytes}
              phase={up.state.phase}
              progress={up.state.progress}
              file={up.state.file}
              error={up.state.error}
              onSelect={up.select}
              onRemove={() => {
                up.reset();
                patch({ thumbnail_upload_id: null, thumbnail_url: null });
              }}
              copy={{ browse: 'Select image' }}
            />
          )}
        </div>
      </div>
    </>
  );
}

/** Step 4 · Budget & settings: workers, reward, days, eligibility, review, schedule. */
function StepBudget({
  form,
  set,
  errors,
  locked,
  published,
  job,
  options,
  totalLabel,
  dueLabel,
  belowMin,
  minSpend,
  shortfall,
  addFundsHref,
}: {
  form: WizardForm;
  set: SetFn;
  errors: Record<string, string>;
  locked: Set<string>;
  published: boolean;
  job: JobDetail | null;
  options: JobOptions | null;
  totalLabel: string;
  dueLabel: string;
  belowMin: boolean;
  minSpend: number;
  shortfall: number;
  addFundsHref: string;
}) {
  const market = useQuery({
    queryKey: ['employer', 'market', form.category, form.time_per_task],
    queryFn: () => api.get<{ available: boolean; minutes: number; category_name: string; low_usd: string; high_usd: string }>('/employer/market-rates', { query: { category: form.category, time_per_task: form.time_per_task } }),
    enabled: !!form.category,
    staleTime: 300_000,
  });
  const m = market.data;
  const openFor = options?.open_for_days_options ?? OPEN_FOR;
  return (
    <>
      {belowMin ? (
        <p data-wz role="alert" className="flex items-center gap-2 text-label-md text-fg-danger">
          <Icon name="alert-triangle" size={16} />
          Please increase your workers or reward — minimum spend is {formatMoney(minSpend.toFixed(2))}.
        </p>
      ) : null}
      <div data-wz>
        <NumberStepper label="Workers needed" value={form.slots_total} onChange={(v) => set('slots_total', v)} min={1} max={10000} presets={SLOT_PRESETS} error={errors.slots_total} />
      </div>
      <div data-wz className="grid gap-4 tablet:grid-cols-2 tablet:items-end">
        <CurrencyInput
          label="Each worker earns"
          decimals={3}
          value={form.reward_usd}
          onChange={(v) => set('reward_usd', v)}
          error={errors.reward_usd}
          disabled={locked.has('reward_usd')}
          placeholder="0.050"
          helper={!errors.reward_usd ? 'Per approved task, from $0.010 to $10.000' : undefined}
        />
        {m?.available ? (
          <p className="self-start rounded-[12px] bg-brand-subtle px-4 py-3 text-body-sm text-fg-secondary tablet:mt-7">
            Similar {m.minutes}-minute {m.category_name} jobs pay ${m.low_usd}–${m.high_usd}.
          </p>
        ) : null}
      </div>
      <div data-wz className="grid gap-5 tablet:grid-cols-2 tablet:gap-4">
        <Select
          label="Estimated days (keep open for)"
          options={openFor.map((d) => ({ value: String(d), label: plural(d, 'day') }))}
          value={String(form.open_for_days)}
          onChange={(v) => set('open_for_days', Number(v))}
          disabled={published}
          helper={published ? 'Extend from the job page.' : undefined}
        />
        <Select
          label="Review window"
          options={REVIEW_WINDOWS.map((r) => ({ value: String(r.value), label: r.label }))}
          value={String(form.review_window_hours)}
          onChange={(v) => set('review_window_hours', Number(v))}
          disabled={locked.has('review_window_hours')}
        />
      </div>
      <div data-wz className="grid gap-5 tablet:grid-cols-2 tablet:gap-4">
        <Field
          label="Schedule time"
          optional
          type="datetime-local"
          value={form.starts_at}
          onChange={(e) => set('starts_at', e.target.value)}
          disabled={published}
          helper={published ? (job?.starts_at ? `Went live ${new Date(job.starts_at).toLocaleString()}.` : 'Set before publishing.') : 'Leave empty to go live as soon as you publish.'}
          error={errors.starts_at}
          trimOnBlur={false}
        />
      </div>
      <div data-wz className="space-y-4 rounded-[14px] bg-subtle p-4">
        <Switch label="Allow resubmission after a rejection" description="Workers can fix and resubmit while slots are open." checked={form.allow_resubmission} onCheckedChange={(v) => set('allow_resubmission', v)} />
        <Switch
          label="Auto-approve when the review window ends"
          description="Keeps workers’ trust if you’re away. Recommended."
          checked={form.auto_approve}
          onCheckedChange={(v) => set('auto_approve', v)}
          disabled={locked.has('auto_approve')}
        />
        <Switch label="Pause when deposit runs low" description="We pause the job instead of overspending." checked={form.pause_on_low_deposit} onCheckedChange={(v) => set('pause_on_low_deposit', v)} />
      </div>
      <div data-wz className={cn('rounded-[14px] px-5 py-4', belowMin ? 'bg-danger-subtle' : 'bg-brand-subtle')}>
        <p className="text-label-md text-fg">Estimated job cost</p>
        <dl className="mt-2 space-y-1.5 text-body-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-fg-secondary">
              {plural(form.slots_total, 'worker')} × {form.reward_usd ? formatReward(form.reward_usd) : '$0.000'}
            </dt>
            <dd className="tabular-nums text-fg">{totalLabel}</dd>
          </div>
        </dl>
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line-subtle pt-2">
          <span className="text-label-md text-fg">Total</span>
          <span className="font-display text-num-md tabular-nums text-fg">{dueLabel}</span>
        </div>
        <p className={cn('mt-1 text-body-xs', belowMin ? 'text-fg-danger' : 'text-fg-tertiary')}>Minimum spend {formatMoney(minSpend.toFixed(2))} · + platform fee (if any), shown before you publish</p>
      </div>
      {shortfall > 0 ? (
        <Alert tone="warning" action={<Button size="S" variant="secondary" href={addFundsHref}>Add funds</Button>}>
          This is more than your available balance. Add funds before publishing.
        </Alert>
      ) : null}
    </>
  );
}

/** Step 5 · Review & publish. */
function StepReview({
  form,
  catName,
  subName,
  totalLabel,
  job,
  hrefFor,
  confirm,
  onConfirm,
  published,
}: {
  form: WizardForm;
  catName: string;
  subName: string | null;
  totalLabel: string;
  job: JobDetail | null;
  hrefFor: (n: number) => string;
  confirm: boolean;
  onConfirm: (v: boolean) => void;
  published: boolean;
}) {
  const link = form.task_link_url.replace(/^https?:\/\//, '');
  const steps = form.steps.filter((s) => s.body.trim()).length;
  const startsAt = published ? job?.starts_at : form.starts_at ? new Date(form.starts_at).toISOString() : null;
  const sections: { title: string; step: number; rows: [string, string][] }[] = [
    { title: 'Location', step: 1, rows: [['Workers in', targetingLabel(form.target_zone, form.excluded_countries)]] },
    { title: 'Category', step: 2, rows: [['Category', subName ? `${catName} · ${subName}` : catName]] },
    {
      title: 'Job information',
      step: 3,
      rows: [
        ['Title', form.title || '—'],
        ...(form.note.trim() ? ([['Note', form.note.trim().length > 80 ? `${form.note.trim().slice(0, 79)}…` : form.note.trim()]] as [string, string][]) : []),
        ['Steps', `${steps} numbered ${steps === 1 ? 'step' : 'steps'} · ${timeLabel(form.time_per_task)}`],
        ['Task link', link ? (link.length > 36 ? `${link.slice(0, 35)}…` : link) : 'No link'],
        ['Proof', proofLabel(form.proof_types, form.screenshot_count)],
        ['Image', form.thumbnail_upload_id ? 'Added' : 'None'],
      ],
    },
    {
      title: 'Budget & settings',
      step: 4,
      rows: [
        ['Workers', `${plural(form.slots_total, 'worker')} × ${formatReward(form.reward_usd || '0')}`],
        ['Open for', `${plural(form.open_for_days, 'day')} · ${form.min_approval_rate ? `${form.min_approval_rate}%+ approval rate` : 'any approval rate'}`],
        ['Review window', `${form.review_window_hours} hours · auto-approve ${form.auto_approve ? 'on' : 'off'}`],
        ['Starts', startsAt ? new Date(startsAt).toLocaleString() : 'When published'],
        ['Total reserved', totalLabel],
      ],
    },
  ];
  return (
    <>
      {sections.map((s) => (
        <section key={s.title} data-wz aria-labelledby={`rv-${s.step}`} className="rounded-[14px] border border-line p-5">
          <div className="flex items-center justify-between">
            <h3 id={`rv-${s.step}`} className="text-h5 text-fg">
              {s.title}
            </h3>
            <NextLink href={hrefFor(s.step)} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] px-1 text-label-md text-fg-brand hover:underline focus-visible:shadow-focus focus-visible:outline-none">
              <Icon name="pen" size={16} />
              Edit<span className="sr-only"> {s.title}</span>
            </NextLink>
          </div>
          <dl className="mt-3 space-y-2">
            {s.rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 text-body-sm tablet:grid-cols-[160px_minmax(0,1fr)]">
                <dt className="text-fg-tertiary">{k}</dt>
                <dd className="break-words text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {!published ? (
        <div data-wz className="rounded-[14px] bg-subtle px-4 py-3">
          <Checkbox
            label="I confirm this job follows the posting rules"
            description={<span className="mt-1.5 block text-body-sm text-fg-secondary">No fake reviews or ratings, no sign-ups for spam, no collecting workers’ personal or payment data.</span>}
            checked={confirm}
            onChange={(e) => onConfirm(e.target.checked)}
          />
        </div>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ rail

function Rail({
  step,
  form,
  catName,
  subName,
  minutes,
  quote,
  total,
  due,
  depositBalance,
  available,
  isNew,
}: {
  step: number;
  form: WizardForm;
  catName: string;
  subName: string | null;
  minutes: number;
  quote: Quote | null;
  total: number;
  due: number;
  depositBalance: string | null;
  available: number;
  isNew: boolean;
}) {
  const hasBudget = step >= LAST_FORM_STEP || !!form.reward_usd;
  const reward = form.reward_usd ? formatReward(form.reward_usd) : '—';
  const fee = quote && Number(quote.platform_fee_total_usd) > 0 ? formatMoney(quote.platform_fee_total_usd) : quote ? '$0.00' : 'Shown at checkout';
  return (
    <aside aria-label="Preview and cost" className="min-w-0 space-y-6">
      <div>
        <p className="text-overline uppercase text-fg-tertiary">How workers see it</p>
        <ul className="mt-3 overflow-hidden rounded-card border border-line bg-surface shadow-xs" inert>
          <JobRow
            href="#"
            job={{
              publicId: 'preview',
              title: form.title.trim() || 'Your job title',
              category: subName ? `${catName} · ${subName}` : catName,
              employer: `≈ ${minutes} min`,
              ageLabel: targetingLabel(form.target_zone, form.excluded_countries),
              slotsFilled: 0,
              slotsTotal: form.slots_total,
              rewardLabel: reward,
              isNew,
            }}
          />
        </ul>
      </div>

      {step === 3 ? (
        <section aria-labelledby="wws-h" className="rounded-card border border-line bg-surface p-5 shadow-xs">
          <h3 id="wws-h" className="text-label-md text-fg">
            Workers will see
          </h3>
          {form.note.trim() ? <p className="mt-3 rounded-[10px] bg-warning-subtle px-3 py-2.5 text-body-sm text-fg-secondary">{form.note.trim()}</p> : null}
          <ul className="mt-3 space-y-2">
            {form.steps.filter((s) => s.body.trim()).length ? (
              form.steps
                .filter((s) => s.body.trim())
                .map((s) => (
                  <li key={s.id} className="flex items-start gap-3 rounded-[10px] bg-subtle px-3 py-2.5">
                    <span aria-hidden className="mt-0.5 size-5 shrink-0 rounded-[6px] border-[1.5px] border-line-strong bg-surface" />
                    <span className="line-clamp-2 text-body-sm text-fg">{s.body}</span>
                  </li>
                ))
            ) : (
              <li className="text-body-sm text-fg-tertiary">Your steps appear here as a checklist.</li>
            )}
          </ul>
        </section>
      ) : (
        <section aria-labelledby="cost-h" className="rounded-card border border-line bg-surface p-5 shadow-xs">
          <h3 id="cost-h" className="text-label-md text-fg">
            Cost summary
          </h3>
          <dl className="mt-3 space-y-2.5 text-body-sm">
            {hasBudget ? (
              <>
                <Row k={`${form.slots_total} slots × ${reward}`} v={quote ? formatMoney(quote.max_spend_usd) : money(Number(form.reward_usd || 0) * form.slots_total)} />
                <Row k="Platform fee" v={fee} />
                <Row k="Deposit balance" v={depositBalance ? formatMoney(depositBalance) : '—'} />
              </>
            ) : (
              <>
                <Row k="Reward per task" v="Set in step 4" />
                <Row k="Workers" v="Set in step 4" />
              </>
            )}
          </dl>
          <div className="mt-4 border-t border-line-subtle pt-4">
            <div className="flex items-center justify-between">
              <span className="text-label-md text-fg">Total reserved</span>
              {hasBudget && due > 0 ? (
                <span className="font-display text-num-lg tabular-nums text-fg-brand">
                  <CountUp value={due} format={(n) => money(n)} key={money(due)} />
                </span>
              ) : (
                <span className="font-display text-num-lg text-fg-brand">—</span>
              )}
            </div>
            <p className="mt-2 text-body-xs text-fg-tertiary">
              {hasBudget && total > 0
                ? `${available < Number(depositBalance ?? available) ? 'Available' : 'Deposit'} after publishing: ${money(Math.max(0, available - due))}. Unused budget returns to your deposit when the job closes.`
                : `Your deposit balance: ${depositBalance ? formatMoney(depositBalance) : '—'}`}
            </p>
          </div>
        </section>
      )}
    </aside>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-secondary">{k}</dt>
      <dd className="text-right font-semibold tabular-nums text-fg">{v}</dd>
    </div>
  );
}

function WizardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton height={40} width="60%" radius={8} />
      <div className="mt-8 grid gap-6 desktop:grid-cols-[720px_360px] desktop:justify-between">
        <Skeleton.Form fields={5} />
        <Skeleton.JobCard />
      </div>
    </div>
  );
}
