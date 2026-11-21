'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Button, Dialog, NumberStepper, cn, toast, type ActionMenuItem } from '@24f/ui';
import { formatDateTime, formatMoney, formatReward } from '@24f/shared';
import { api, ApiError, errorText, idemKey, invalidateEmployer, useJobOptions, useQueryClient, useWallet, type JobAction, type JobStatus, type PromotionKind } from './api';

export interface ActionJob {
  public_id: string;
  title: string | null;
  status: JobStatus;
  reward_usd: string | null;
  slots_total: number;
  approved: number;
  allowed_actions: JobAction[];
  /** Promotion state, when the caller has it (Job performance). */
  pinned_until?: string | null;
  topped_at?: string | null;
}

type Kind = 'pause' | 'resume' | 'close' | 'delete' | 'slots' | 'promote';

/** Promotion choices (CR-2026-11b). Prices and the Pin length come from admin settings. */
const PROMOS: { kind: PromotionKind; label: string; body: (pinHours: number) => string }[] = [
  { kind: 'combo', label: 'Combo · Pin + Top', body: (h) => `Pinned above every job for ${h} hours, then stays near the top as a Top job. Best value.` },
  { kind: 'pin', label: 'Pin', body: (h) => `Pinned above every other job for ${h} hours. Buying again adds ${h} hours.` },
  { kind: 'top', label: 'Top', body: () => 'Moves the job to the top of the job list. A newer Top from another employer goes above it.' },
];

/**
 * Job lifecycle dialogs (SCR-EMP-08 dialogs, G-07): Add slots, Pause, Resume, Close, Delete draft,
 * plus Duplicate (no dialog). Shared by My jobs rows and Job performance.
 */
export function useJobActions(opts: { onDeleted?: () => void } = {}) {
  const router = useRouter();
  const qc = useQueryClient();
  const wallet = useWallet();
  const [state, setState] = useState<{ kind: Kind; job: ActionJob } | null>(null);
  const [slots, setSlots] = useState(10);
  const [promo, setPromo] = useState<PromotionKind>('combo');
  // One key per dialog: a double click or retry replays the first purchase instead of charging twice.
  const [promoKey, setPromoKey] = useState('');
  const options = useJobOptions();
  const prices = options.data?.promotion;
  const pinHours = prices?.pin_hours ?? 24;
  const promoPrice = Number(prices ? { top: prices.top_price_usd, pin: prices.pin_price_usd, combo: prices.combo_price_usd }[promo] : 0);
  const close = () => setState(null);
  const reward = Number(state?.job.reward_usd ?? 0);
  const available = Number(wallet.data?.available_usd ?? 0);

  const m = useMutation({
    mutationFn: async ({ kind, job }: { kind: Kind; job: ActionJob }) => {
      const id = job.public_id;
      if (kind === 'pause') return api.post(`/employer/jobs/${id}/pause`, {});
      if (kind === 'resume') return api.post(`/employer/jobs/${id}/resume`, {});
      if (kind === 'close') return api.post(`/employer/jobs/${id}/close`, {});
      if (kind === 'delete') return api.delete(`/employer/jobs/${id}`);
      if (kind === 'promote')
        return api.post<{ pinned_until: string | null }>(`/employer/jobs/${id}/promote`, { kind: promo, expected_price_usd: promoPrice.toFixed(2) }, { headers: { 'Idempotency-Key': promoKey } });
      return api.post(`/employer/jobs/${id}/slots`, { add_slots: slots }, { headers: { 'Idempotency-Key': idemKey() } });
    },
    onSuccess: async (r, { kind, job }) => {
      const pinnedUntil = kind === 'promote' ? (r as { pinned_until: string | null }).pinned_until : null;
      const t = {
        pause: ['Job paused', 'Workers can’t start it until you resume.'],
        resume: ['Job resumed.', undefined],
        close: ['Job closed', 'Unused budget returned to your deposit.'],
        delete: ['Draft deleted.', undefined],
        slots: ['Slots added', job.status === 'running' ? `${formatMoney((slots * reward).toFixed(6))} more is reserved from your deposit.` : undefined],
        promote: [
          'Job promoted',
          promo === 'top' ? 'It’s now at the top of the job list.' : `Pinned until ${pinnedUntil ? formatDateTime(pinnedUntil) : `${pinHours} hours from now`}.`,
        ],
      }[kind] as [string, string | undefined];
      toast.show({ tone: 'success', title: t[0], body: t[1] });
      close();
      await invalidateEmployer(qc);
      if (kind === 'delete') opts.onDeleted?.();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'QUOTE_CHANGED') {
        toast.show({ tone: 'warning', title: 'The price changed', body: e.message });
        void options.refetch();
        return;
      }
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_BALANCE') {
        toast.show({ tone: 'danger', title: 'Not enough available balance', body: e.message, action: { label: 'Add funds', href: `/employer/wallet?add=${String(e.details.shortfall_usd ?? '10.00')}` } });
      } else toast.show({ tone: 'danger', title: 'That didn’t save', body: errorText(e) });
      void invalidateEmployer(qc);
    },
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.post<{ public_id: string; next_path: string }>(`/employer/jobs/${id}/duplicate`, {}),
    onSuccess: (r) => {
      toast.show({ tone: 'success', title: 'Draft created from this job.' });
      void invalidateEmployer(qc);
      router.push(r.next_path);
    },
    onError: (e) => toast.show({ tone: 'danger', title: 'That didn’t save', body: errorText(e) }),
  });

  const open = (kind: Kind, job: ActionJob) => {
    if (kind === 'slots') setSlots(10);
    if (kind === 'promote') {
      setPromo('combo');
      setPromoKey(idemKey());
    }
    setState({ kind, job });
  };

  /** Row-menu items per status (§SCR-EMP-07 table). */
  function menuItems(job: ActionJob): ActionMenuItem[] {
    const a = job.allowed_actions;
    const id = job.public_id;
    const items: ActionMenuItem[] = [];
    if (a.includes('continue')) items.push({ key: 'continue', label: 'Continue editing', icon: 'edit', href: `/employer/jobs/${id}/edit?step=1` });
    if (a.includes('review')) items.push({ key: 'review', label: 'Review submissions', icon: 'eye', href: `/employer/submissions?job=${id}` });
    if (a.includes('view') || (!a.includes('continue') && job.status !== 'running' && job.status !== 'paused'))
      items.push({ key: 'view', label: 'View performance', icon: 'bar-chart', href: `/employer/jobs/${id}` });
    if (a.includes('edit')) items.push({ key: 'edit', label: 'Edit job', icon: 'pen', href: `/employer/jobs/${id}/edit?step=1` });
    if (a.includes('add_slots')) items.push({ key: 'slots', label: 'Add slots', icon: 'plus', onSelect: () => open('slots', job) });
    if (a.includes('promote')) items.push({ key: 'promote', label: 'Promote job', icon: 'trending-up', onSelect: () => open('promote', job) });
    if (a.includes('pause')) items.push({ key: 'pause', label: 'Pause job', icon: 'pause', onSelect: () => open('pause', job) });
    if (a.includes('resume')) items.push({ key: 'resume', label: 'Resume job', icon: 'play', onSelect: () => open('resume', job) });
    if (a.includes('duplicate')) items.push({ key: 'dup', label: 'Duplicate', icon: 'send', onSelect: () => duplicate.mutate(id) });
    if (a.includes('close')) items.push({ key: 'close', label: 'Close job', icon: 'x-circle', tone: 'danger', divider: true, onSelect: () => open('close', job) });
    if (a.includes('delete')) items.push({ key: 'delete', label: 'Delete draft', icon: 'trash', tone: 'danger', divider: true, onSelect: () => open('delete', job) });
    return items;
  }

  const job = state?.job;
  const resumeTotal = job ? Math.max(0, job.slots_total - job.approved) * reward : 0;
  const slotsTotal = job?.status === 'running' ? slots * reward : 0;
  const slotsShort = slotsTotal > available;
  const promoShort = state?.kind === 'promote' && promoPrice > available;
  const pinnedNow = job?.pinned_until && new Date(job.pinned_until).getTime() > Date.now() ? job.pinned_until : null;
  const busy = m.isPending;
  const go = () => state && m.mutate({ kind: state.kind, job: state.job });

  const copy: Record<Kind, { title: string; body: string; cancel: string; ok: string; destructive?: boolean }> = {
    pause: { title: 'Pause this job?', body: 'Workers can’t start it while it’s paused. Work already submitted still needs your review.', cancel: 'Cancel', ok: 'Pause job' },
    resume: { title: 'Resume this job?', body: `We’ll reserve ${formatMoney(resumeTotal.toFixed(6))} from your deposit for the open slots.`, cancel: 'Cancel', ok: 'Resume job' },
    close: {
      title: 'Close this job?',
      body: 'Workers can’t start it again. Unused budget returns to your deposit. You can still review submitted work.',
      cancel: 'Keep running',
      ok: 'Close job',
      destructive: true,
    },
    delete: { title: 'Delete this draft?', body: 'This can’t be undone.', cancel: 'Cancel', ok: 'Delete draft', destructive: true },
    slots: {
      title: 'Add slots',
      body: job?.status === 'running' ? `Each extra slot reserves ${formatReward(job?.reward_usd ?? '0')} from your deposit.` : 'Budget for new slots is reserved when you resume the job.',
      cancel: 'Cancel',
      ok: `Add slots · ${formatMoney(slotsTotal.toFixed(6))}`,
    },
    promote: {
      title: 'Promote this job',
      body: 'Paid once from your available balance. Not refunded if you pause or close the job.',
      cancel: 'Cancel',
      ok: `Pay ${formatMoney(promoPrice.toFixed(2))} · ${PROMOS.find((p) => p.kind === promo)?.label.split(' · ')[0] ?? 'Promote'}`,
    },
  };
  const c = state ? copy[state.kind] : null;

  const dialogs = (
    <Dialog
      open={!!state}
      onOpenChange={(o) => !o && !busy && close()}
      type={c?.destructive ? 'destructive' : state?.kind === 'slots' || state?.kind === 'promote' ? 'form' : 'confirm'}
      title={c?.title ?? ''}
      description={c?.body}
      busy={busy}
      footer={
        c ? (
          <>
            <Button variant="secondary" onClick={() => !busy && close()}>
              {c.cancel}
            </Button>
            {(state?.kind === 'slots' && slotsShort) || promoShort ? (
              <Button href={`/employer/wallet?add=${Math.max(10, Math.ceil(((state?.kind === 'promote' ? promoPrice : slotsTotal) - available) * 100) / 100).toFixed(2)}&return=${encodeURIComponent(`/employer/jobs/${job?.public_id}`)}`}>Add funds</Button>
            ) : (
              <Button variant={c.destructive ? 'destructive' : 'primary'} onClick={go} loading={busy} loadingText="Saving…" disabled={state?.kind === 'promote' && !prices}>
                {c.ok}
              </Button>
            )}
          </>
        ) : null
      }
    >
      {state?.kind === 'slots' ? (
        <div className="space-y-3">
          <NumberStepper label="Slots to add" value={slots} onChange={setSlots} min={1} max={Math.max(1, 10000 - (job?.slots_total ?? 0))} presets={[10, 20, 50, 100]} />
          {slotsShort ? (
            <p className="rounded-[10px] bg-warning-subtle px-3 py-2 text-body-sm text-fg-warning">
              This is more than your available balance ({formatMoney(available.toFixed(6))}). Add funds first.
            </p>
          ) : null}
        </div>
      ) : null}
      {state?.kind === 'promote' ? (
        <div className="space-y-3">
          <div role="radiogroup" aria-label="Promotion" className="space-y-2">
            {PROMOS.map((p) => {
              const on = promo === p.kind;
              const price = prices ? { top: prices.top_price_usd, pin: prices.pin_price_usd, combo: prices.combo_price_usd }[p.kind] : null;
              return (
                <button
                  key={p.kind}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPromo(p.kind)}
                  className={cn(
                    'flex w-full items-start justify-between gap-3 rounded-[12px] border p-4 text-left transition-colors focus-visible:shadow-focus focus-visible:outline-none',
                    on ? 'border-[1.5px] border-line-brand bg-brand-subtle' : 'border-line bg-surface hover:border-line-strong',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-label-md text-fg">{p.label}</span>
                    <span className="mt-0.5 block text-body-xs text-fg-secondary">{p.body(pinHours)}</span>
                  </span>
                  <span className="shrink-0 font-display text-num-sm tabular-nums text-fg">{price ? formatMoney(price) : '—'}</span>
                </button>
              );
            })}
          </div>
          {pinnedNow ? <p className="text-body-xs text-fg-secondary">Pinned until {formatDateTime(pinnedNow)}. A new Pin adds {pinHours} hours.</p> : null}
          {promoShort ? (
            <p className="rounded-[10px] bg-warning-subtle px-3 py-2 text-body-sm text-fg-warning">
              This is more than your available balance ({formatMoney(available.toFixed(2))}). Add funds first.
            </p>
          ) : (
            <p className="text-body-xs text-fg-tertiary">Available balance: {formatMoney(available.toFixed(2))}</p>
          )}
        </div>
      ) : null}
    </Dialog>
  );

  return { open, menuItems, dialogs, duplicating: duplicate.isPending };
}
