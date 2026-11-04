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
  JobCard,
  NumberStepper,
  Select,
  Skeleton,
  StickyActionBar,
  Switch,
  Textarea,
  cn,
  gsap,
  useGSAP,
  MOTION_OK,
  toast,
} from '@24f/ui';
import { formatMoney, formatReward } from '@24f/shared';
import { api, ApiError, ek, errorText, idemKey, invalidateEmployer, useCategories, useJob, useQueryClient, useWallet, type JobDetail, type Quote } from '../api';
import { useEmployerHeader } from '../shell';
import { ErrorPanel, TIME_OPTIONS, timeLabel } from '../common';
import { StepsEditor } from './StepsEditor';
import {
  APPROVAL_RATES,
  OPEN_FOR,
  PROOF_OPTIONS,
  REVIEW_WINDOWS,
  SLOT_PRESETS,
  STEP_LABELS,
  emptyForm,
  formFromJob,
  payloadFor,
  proofLabel,
  serverFieldErrors,
  validate,
  type JobDefaults,
  type ProofType,
  type WizardForm,
} from './model';

const money = (n: number) => formatMoney(n.toFixed(6));

/**
 * Post-a-job wizard (SCR-EMP-02…06, Figma 34:648 / 34:903 / 35:1021 / 35:1261 / 35:1491).
 * `/employer/jobs/new?step=1` creates the draft on the first Continue or Save draft, then the URL
 * moves to `/employer/jobs/[publicId]/edit?step=n`. Each Continue saves via PATCH; edits autosave.
 */
export function JobWizard({ publicId }: { publicId?: string }) {
  const params = useSearchParams();
  const step = Math.min(4, Math.max(1, Number(params.get('step')) || 1));
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
    subtitle: published ? (job.data?.title ?? undefined) : 'Four short steps. You’ll see the full cost before anything is published.',
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
  const wallet = useWallet();
  const card = useRef<HTMLDivElement>(null);

  // Steps beyond the furthest reachable one go back (drafts only).
  const reachable = job ? (published ? 4 : Math.min(4, Math.max(job.wizard_step + 1, 1))) : 1;
  useEffect(() => {
    if (step > reachable) router.replace(`${base(publicId)}?step=${reachable}`);
  }, [step, reachable, publicId, router]);

  const set = <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
    if (errors[k as string]) setErrors((e) => ({ ...e, [k]: '' }));
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

  const save = useMutation({
    mutationFn: async ({ s, withStep }: { s: number; withStep: boolean }) => {
      const body = { ...payloadFor(s, form), ...(withStep ? { wizard_step: s } : {}) };
      if (!publicId) {
        return api.post<{ public_id: string }>('/employer/jobs', { ...payloadFor(1, form), wizard_step: 1 });
      }
      return api.patch<{ public_id: string }>(`/employer/jobs/${publicId}`, body);
    },
  });

  // Autosave drafts (debounced) when the current step is valid.
  useEffect(() => {
    if (!publicId || published || !dirty || step > 3) return;
    if (Object.keys(validate(step, form)).length) return;
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
    const errs = opts.draftOnly && step === 1 ? pick(validate(1, form), ['title']) : validate(step, form);
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
      if (published && step === 3) {
        toast.show({ tone: 'success', title: 'Changes saved' });
        router.push(`/employer/jobs/${r.public_id}`);
        return;
      }
      goto(step + 1, r.public_id);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VALIDATION_FAILED' && Object.keys(e.fields).length) setErrors(serverFieldErrors(e.fields));
      else if (e instanceof ApiError && e.code === 'JOB_LOCKED') toast.show({ tone: 'warning', title: 'Submissions have arrived. You can add slots, extend the job or pause it.' });
      else toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Your changes are still here. Try again.' });
    }
  };

  // ---------------------------------------------------------------- quote

  const quote = useDebouncedQuote(publicId, step >= 3 ? form.reward_usd : null, form.slots_total);
  const reward = Number(form.reward_usd) || 0;
  const localTotal = reward * form.slots_total;
  const total = quote.data ? Number(quote.data.total_reserved_exact_usd) : localTotal;
  const available = quote.data ? Number(quote.data.available_usd) : Number(wallet.data?.available_usd ?? 0);
  const shortfall = quote.data ? Number(quote.data.shortfall_usd) : Math.max(0, localTotal - available);
  const totalLabel = quote.data ? formatMoney(quote.data.total_reserved_usd) : money(localTotal);

  const publish = useMutation({
    mutationFn: () =>
      api.post<{ public_id: string; total_reserved_usd: string }>(
        `/employer/jobs/${publicId}/publish`,
        { posting_rules_accepted: true, expected_total_reserved_usd: quote.data?.total_reserved_usd ?? localTotal.toFixed(2) },
        { headers: { 'Idempotency-Key': idemKey() } },
      ),
    onSuccess: async (r) => {
      setDirty(false);
      toast.show({ tone: 'success', title: 'Job published', body: `${formatMoney(r.total_reserved_usd)} is reserved from your deposit.` });
      await invalidateEmployer(qc);
      router.push(`/employer/jobs/${r.public_id}`);
    },
    onError: (e) => {
      setPublishOpen(false);
      void qc.invalidateQueries({ queryKey: ['employer'] });
      if (e instanceof ApiError) {
        if (e.code === 'INSUFFICIENT_BALANCE' || e.code === 'QUOTE_CHANGED') {
          void quote.refetch();
          setPubError(null);
          return;
        }
        if (e.code === 'JOB_CONTENT_BLOCKED') return setPubError({ title: 'This job can’t be published yet', body: 'It may break the posting rules. Edit it or contact support.' });
        if (e.code === 'VERIFICATION_REQUIRED') return setPubError({ title: 'Verify your account', body: 'Verify your email or phone before publishing.' });
        if (e.code === 'JOB_INCOMPLETE') return setPubError({ title: 'Some steps aren’t finished', body: `Finish step ${(e.details.first_incomplete_step as number) ?? 1} first.` });
        if (e.code === 'RECEIVABLE_OUTSTANDING') return setPubError({ title: 'Settle your balance first', body: e.message });
      }
      toast.show({ tone: 'danger', title: 'That didn’t save', body: errorText(e, 'Your changes are still here. Try again.') });
    },
  });

  // ---------------------------------------------------------------- render

  const catName = categories.data?.find((c) => c.slug === form.category)?.name ?? 'Category';
  const minutes = TIME_OPTIONS.find((t) => t.value === form.time_per_task)?.minutes ?? 5;
  const returnTo = publicId ? `/employer/jobs/${publicId}/edit?step=${step}` : '/employer/jobs/new';
  const addFundsHref = `/employer/wallet?add=${Math.max(10, Math.ceil(shortfall * 100) / 100).toFixed(2)}&return=${encodeURIComponent(returnTo)}`;

  const stepHeader: Record<number, [string, string]> = {
    1: ['What do you need done?', 'A clear, specific title gets more workers to open your job.'],
    2: ['Tell workers exactly what to do', 'Numbered steps cut rejections. Workers tick each one before they can submit.'],
    3: ['Set your budget', 'You pay the reward for each approved task. Nothing is charged until work is approved.'],
    4: ['Review and publish', 'Check everything once more. You can edit the job until the first submission arrives.'],
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
              if (step < 4) void submitStep();
            }}
          >
            {step === 1 ? <Step1 form={form} set={set} errors={errors} locked={locked} categories={categories.data ?? []} published={published} /> : null}
            {step === 2 ? <Step2 form={form} set={set} errors={errors} locked={locked} /> : null}
            {step === 3 ? <Step3 form={form} set={set} errors={errors} locked={locked} totalLabel={money(localTotal)} shortfall={shortfall} addFundsHref={addFundsHref} /> : null}
            {step === 4 ? (
              <Step4
                form={form}
                catName={categories.data?.find((c) => c.slug === form.category)?.name ?? '—'}
                totalLabel={totalLabel}
                hrefFor={(n) => `${base(publicId)}?step=${n}`}
                confirm={confirmRules}
                onConfirm={setConfirmRules}
                published={published}
              />
            ) : null}

            {step === 4 && !published && shortfall > 0 ? (
              <Alert
                tone="danger"
                title="Not enough available balance"
                action={
                  <Button size="S" href={addFundsHref}>
                    Add funds · {formatMoney(Math.max(10, shortfall).toFixed(2))}
                  </Button>
                }
              >
                This job reserves {totalLabel}, and you have {formatMoney(available.toFixed(6))} available. Add {formatMoney(shortfall.toFixed(2))} to publish.
              </Alert>
            ) : null}
            {step === 4 && pubError ? (
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
                {step < 4 ? (
                  <Button type="submit" size="L" loading={save.isPending && save.variables?.withStep !== false} loadingText="Saving…" className="min-w-[160px] max-desktop:flex-[2]">
                    {step === 3 ? (published ? 'Save changes' : 'Continue to review') : 'Continue'}
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
                      disabled={!confirmRules || shortfall > 0 || quote.isFetching}
                      disabledReasonId="publish-reason"
                      className="min-w-[200px] max-desktop:flex-[2]"
                    >
                      Publish job · {totalLabel}
                    </Button>
                    <span id="publish-reason" className="sr-only">
                      {shortfall > 0 ? 'Add funds to publish.' : 'Confirm the posting rules to publish.'}
                    </span>
                  </>
                )}
              </StickyActionBar>
              {step === 4 && !published && !confirmRules ? <p className="mt-2 text-right text-body-xs text-fg-tertiary max-desktop:hidden">Confirm the posting rules to publish.</p> : null}
            </div>
          </form>
        </div>

        <Rail
          step={step}
          form={form}
          catName={form.category ? catName : 'Category'}
          minutes={minutes}
          quote={quote.data ?? null}
          totalLabel={totalLabel}
          total={total}
          depositBalance={wallet.data?.deposit_balance_usd ?? null}
          available={available}
          isNew={!job?.published_at}
        />
      </div>

      <Dialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Publish this job?"
        description={`We’ll reserve ${totalLabel} from your deposit (${form.slots_total} slots × ${formatReward(form.reward_usd || '0')}). Unused budget returns to your deposit when the job closes.`}
        busy={publish.isPending}
        footer={
          <>
            <Button variant="secondary" onClick={() => !publish.isPending && setPublishOpen(false)}>
              Back to edit
            </Button>
            <Button onClick={() => publish.mutate()} loading={publish.isPending} loadingText="Publishing…">
              Publish · {totalLabel}
            </Button>
          </>
        }
      />
    </div>
  );
}

const base = (id: string | null) => (id ? `/employer/jobs/${id}/edit` : '/employer/jobs/new');
function pick(o: Record<string, string>, keys: string[]) {
  return Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k)));
}

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

/** Figma stepper (752×52): 4 px bar above each step, numbered/checked dot, label. */
function WizardSteps({ current, reachable, hrefFor }: { current: number; reachable: number; hrefFor: (n: number) => string }) {
  return (
    <ol aria-label="Progress" className="grid max-w-[752px] grid-cols-4 gap-2 tablet:gap-4">
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
              <span className={cn('hidden truncate text-label-md tablet:inline', state === 'todo' ? 'font-medium text-fg-secondary' : 'text-fg')}>{label}</span>
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
      <li className="col-span-4 text-label-md text-fg tablet:hidden" aria-hidden>
        Step {current} of 4 · {STEP_LABELS[current - 1]}
      </li>
    </ol>
  );
}

// ------------------------------------------------------------------ steps

type SetFn = <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;

function Step1({ form, set, errors, locked, categories, published }: { form: WizardForm; set: SetFn; errors: Record<string, string>; locked: Set<string>; categories: { slug: string; name: string }[]; published: boolean }) {
  const titleLen = [...form.title].length;
  return (
    <>
      <div data-wz>
        <Field
          label="Job title"
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
      <div data-wz data-error-anchor={errors.category ? '' : undefined} tabIndex={errors.category ? -1 : undefined}>
        {categories.length ? (
          <ChoiceChipGroup
            legend="Category"
            mode="single"
            options={categories.map((c) => ({ value: c.slug, label: c.name }))}
            value={form.category}
            onChange={(v) => !locked.has('category') && set('category', v as string)}
            error={errors.category}
          />
        ) : (
          <Skeleton height={84} radius={12} />
        )}
      </div>
      <div data-wz className="grid gap-5 tablet:grid-cols-2 tablet:gap-4">
        <Select
          label="Time per task"
          options={TIME_OPTIONS.map((t) => ({ value: t.value, label: t.label }))}
          value={form.time_per_task}
          onChange={(v) => set('time_per_task', v)}
          disabled={locked.has('time_per_task')}
        />
        <Select
          label="Keep open for"
          options={OPEN_FOR.map((d) => ({ value: String(d), label: `${d} ${d === 1 ? 'day' : 'days'}` }))}
          value={String(form.open_for_days)}
          onChange={(v) => set('open_for_days', Number(v))}
          disabled={published}
          helper={published ? 'Extend from the job page.' : undefined}
        />
        <Select
          label="Who can take it"
          options={[
            { value: 'all_verified', label: 'All verified workers' },
            { value: 'kyc_verified', label: 'Identity-verified workers only' },
          ]}
          value={form.eligibility}
          onChange={(v) => set('eligibility', v as WizardForm['eligibility'])}
          disabled={locked.has('eligibility')}
        />
        <Select
          label="Minimum approval rate"
          options={APPROVAL_RATES.map((r) => ({ value: String(r.value), label: r.label }))}
          value={String(form.min_approval_rate)}
          onChange={(v) => set('min_approval_rate', Number(v))}
          disabled={locked.has('min_approval_rate')}
        />
      </div>
      <p data-wz className="rounded-[12px] bg-brand-subtle px-4 py-3.5 text-body-sm text-fg-secondary">
        Higher approval-rate requirements mean better quality but fewer available workers. 80% is a good default for most tasks.
      </p>
    </>
  );
}

function Step2({ form, set, errors, locked }: { form: WizardForm; set: SetFn; errors: Record<string, string>; locked: Set<string> }) {
  const toggle = (t: ProofType, on: boolean) => set('proof_types', on ? PROOF_OPTIONS.map((o) => o.value).filter((v) => v === t || form.proof_types.includes(v)) : form.proof_types.filter((x) => x !== t));
  return (
    <>
      <div data-wz>
        <StepsEditor value={form.steps} onChange={(v) => set('steps', v)} error={errors.steps} disabled={locked.has('steps')} />
      </div>
      <div data-wz>
        <Field
          label="Task link (shown only after a worker starts)"
          leadingIcon="link"
          type="url"
          inputMode="url"
          value={form.task_link_url}
          onChange={(e) => set('task_link_url', e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          helper="Make sure workers can open it without requesting access."
          error={errors.task_link_url}
          disabled={locked.has('task_link_url')}
          optional
        />
      </div>
      <fieldset data-wz aria-describedby={errors.proof_requirements ? 'proof-err' : undefined} data-error-anchor={errors.proof_requirements ? '' : undefined} tabIndex={errors.proof_requirements ? -1 : undefined}>
        <legend className="mb-2 flex flex-wrap items-baseline gap-x-4 text-label-md text-fg">
          Proof required <span className="text-body-sm font-normal text-fg-tertiary">Pick what workers must submit</span>
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
    </>
  );
}

function Step3({ form, set, errors, locked, totalLabel, shortfall, addFundsHref }: { form: WizardForm; set: SetFn; errors: Record<string, string>; locked: Set<string>; totalLabel: string; shortfall: number; addFundsHref: string }) {
  const market = useQuery({
    queryKey: ['employer', 'market', form.category, form.time_per_task],
    queryFn: () => api.get<{ available: boolean; minutes: number; category_name: string; low_usd: string; high_usd: string }>('/employer/market-rates', { query: { category: form.category, time_per_task: form.time_per_task } }),
    enabled: !!form.category,
    staleTime: 300_000,
  });
  const m = market.data;
  return (
    <>
      <div data-wz className="grid gap-4 tablet:grid-cols-2 tablet:items-end">
        <CurrencyInput
          label="Reward per approved task"
          decimals={3}
          value={form.reward_usd}
          onChange={(v) => set('reward_usd', v)}
          error={errors.reward_usd}
          disabled={locked.has('reward_usd')}
          placeholder="0.180"
          helper={!errors.reward_usd ? 'From $0.010 to $10.000' : undefined}
        />
        {m?.available ? (
          <p className="self-start rounded-[12px] bg-brand-subtle px-4 py-3 text-body-sm text-fg-secondary tablet:mt-7">
            Similar {m.minutes}-minute {m.category_name} jobs pay ${m.low_usd}–${m.high_usd}.
          </p>
        ) : null}
      </div>
      <div data-wz>
        <NumberStepper label="Number of workers (slots)" value={form.slots_total} onChange={(v) => set('slots_total', v)} min={1} max={10000} presets={SLOT_PRESETS} error={errors.slots_total} />
      </div>
      <div data-wz className="grid gap-5 tablet:grid-cols-2 tablet:gap-4">
        <Select
          label="Review window"
          options={REVIEW_WINDOWS.map((r) => ({ value: String(r.value), label: r.label }))}
          value={String(form.review_window_hours)}
          onChange={(v) => set('review_window_hours', Number(v))}
          disabled={locked.has('review_window_hours')}
        />
        <Select label="Submissions per worker" options={[{ value: '1', label: 'One per worker' }]} value="1" onChange={() => undefined} />
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
      {!form.auto_approve ? (
        <p data-wz className="text-body-xs text-fg-tertiary">
          With this off, submissions stay in review until you decide. Workers may trust the job less.
        </p>
      ) : null}
      <div data-wz className="rounded-[14px] bg-brand-subtle px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-body-md text-fg-secondary">
            {form.slots_total} slots × {form.reward_usd ? formatReward(form.reward_usd) : '$0.000'}
          </p>
          <p className="font-display text-num-md tabular-nums text-fg">= {totalLabel}</p>
        </div>
        <p className="mt-1 text-body-sm text-fg-secondary">+ platform fee (if any), shown before you publish</p>
        <p className="mt-2 text-label-md text-fg-brand">Max spend if every task is approved</p>
      </div>
      {shortfall > 0 ? (
        <Alert tone="warning" action={<Button size="S" variant="secondary" href={addFundsHref}>Add funds</Button>}>
          This is more than your available balance. Add funds before publishing.
        </Alert>
      ) : null}
    </>
  );
}

function Step4({
  form,
  catName,
  totalLabel,
  hrefFor,
  confirm,
  onConfirm,
  published,
}: {
  form: WizardForm;
  catName: string;
  totalLabel: string;
  hrefFor: (n: number) => string;
  confirm: boolean;
  onConfirm: (v: boolean) => void;
  published: boolean;
}) {
  const link = form.task_link_url.replace(/^https?:\/\//, '');
  const proof = proofLabel(form.proof_types).replace(/\blink\b/, form.task_link_url.includes('spreadsheets') ? 'sheet link' : 'link');
  const sections: { title: string; step: number; rows: [string, string][] }[] = [
    {
      title: 'Basics',
      step: 1,
      rows: [
        ['Title', form.title],
        ['Category', catName],
        ['Time per task', timeLabel(form.time_per_task)],
        ['Open for', `${form.open_for_days} ${form.open_for_days === 1 ? 'day' : 'days'} · ${form.min_approval_rate ? `${form.min_approval_rate}%+ approval rate` : 'any approval rate'}`],
      ],
    },
    {
      title: 'Instructions & proof',
      step: 2,
      rows: [
        ['Steps', `${form.steps.filter((s) => s.body.trim()).length} numbered ${form.steps.filter((s) => s.body.trim()).length === 1 ? 'step' : 'steps'}`],
        ['Task link', link ? (link.length > 36 ? `${link.slice(0, 35)}…` : link) : 'No link'],
        ['Proof', proof],
      ],
    },
    {
      title: 'Budget & slots',
      step: 3,
      rows: [
        ['Reward', `${formatReward(form.reward_usd || '0')} per approved task`],
        ['Slots', `${form.slots_total} ${form.slots_total === 1 ? 'worker' : 'workers'}`],
        ['Review window', `${form.review_window_hours} hours · auto-approve ${form.auto_approve ? 'on' : 'off'}`],
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
  minutes,
  quote,
  totalLabel,
  total,
  depositBalance,
  available,
  isNew,
}: {
  step: number;
  form: WizardForm;
  catName: string;
  minutes: number;
  quote: Quote | null;
  totalLabel: string;
  total: number;
  depositBalance: string | null;
  available: number;
  isNew: boolean;
}) {
  const hasBudget = step >= 3 || !!form.reward_usd;
  const reward = form.reward_usd ? formatReward(form.reward_usd) : '—';
  const fee = quote && Number(quote.platform_fee_total_usd) > 0 ? formatMoney(quote.platform_fee_total_usd) : quote ? '$0.00' : 'Shown at checkout';
  return (
    <aside aria-label="Preview and cost" className="min-w-0 space-y-6">
      <div>
        <p className="text-overline uppercase text-fg-tertiary">How workers see it</p>
        <div className="mt-3" inert>
          <JobCard
            href="#"
            ctaLabel="View job"
            job={{
              publicId: 'preview',
              category: catName,
              title: form.title.trim() || 'Your job title',
              durationLabel: `≈ ${minutes} min`,
              proofLabel: step === 1 && !form.proof_types.length ? 'Proof not set yet' : step === 1 ? 'Proof not set yet' : proofLabel(form.proof_types),
              slotsFilled: 0,
              slotsTotal: form.slots_total,
              postedLabel: 'just now',
              rewardLabel: reward,
              isNew,
            }}
          />
        </div>
      </div>

      {step === 2 ? (
        <section aria-labelledby="wws-h" className="rounded-card border border-line bg-surface p-5 shadow-xs">
          <h3 id="wws-h" className="text-label-md text-fg">
            Workers will see
          </h3>
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
                <Row k="Reward per task" v="Set in step 3" />
                <Row k="Slots" v="Set in step 3" />
              </>
            )}
          </dl>
          <div className="mt-4 border-t border-line-subtle pt-4">
            <div className="flex items-center justify-between">
              <span className="text-label-md text-fg">Total reserved</span>
              {hasBudget && total > 0 ? (
                <span className="font-display text-num-lg tabular-nums text-fg-brand">
                  <CountUp value={total} format={(n) => money(n)} key={totalLabel} />
                </span>
              ) : (
                <span className="font-display text-num-lg text-fg-brand">—</span>
              )}
            </div>
            <p className="mt-2 text-body-xs text-fg-tertiary">
              {hasBudget && total > 0
                ? `${available < Number(depositBalance ?? available) ? "Available" : "Deposit"} after publishing: ${money(Math.max(0, available - total))}. Unused budget returns to your deposit when the job closes.`
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
