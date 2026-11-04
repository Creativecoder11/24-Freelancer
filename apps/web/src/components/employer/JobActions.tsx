'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Button, Dialog, NumberStepper, toast, type ActionMenuItem } from '@24f/ui';
import { formatMoney, formatReward } from '@24f/shared';
import { api, ApiError, errorText, idemKey, invalidateEmployer, useQueryClient, useWallet, type JobAction, type JobStatus } from './api';

export interface ActionJob {
  public_id: string;
  title: string | null;
  status: JobStatus;
  reward_usd: string | null;
  slots_total: number;
  approved: number;
  allowed_actions: JobAction[];
}

type Kind = 'pause' | 'resume' | 'close' | 'delete' | 'slots';

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
      return api.post(`/employer/jobs/${id}/slots`, { add_slots: slots }, { headers: { 'Idempotency-Key': idemKey() } });
    },
    onSuccess: async (_r, { kind, job }) => {
      const t = {
        pause: ['Job paused', 'Workers can’t start it until you resume.'],
        resume: ['Job resumed.', undefined],
        close: ['Job closed', 'Unused budget returned to your deposit.'],
        delete: ['Draft deleted.', undefined],
        slots: ['Slots added', job.status === 'running' ? `${formatMoney((slots * reward).toFixed(6))} more is reserved from your deposit.` : undefined],
      }[kind] as [string, string | undefined];
      toast.show({ tone: 'success', title: t[0], body: t[1] });
      close();
      await invalidateEmployer(qc);
      if (kind === 'delete') opts.onDeleted?.();
    },
    onError: (e) => {
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
  };
  const c = state ? copy[state.kind] : null;

  const dialogs = (
    <Dialog
      open={!!state}
      onOpenChange={(o) => !o && !busy && close()}
      type={c?.destructive ? 'destructive' : state?.kind === 'slots' ? 'form' : 'confirm'}
      title={c?.title ?? ''}
      description={c?.body}
      busy={busy}
      footer={
        c ? (
          <>
            <Button variant="secondary" onClick={() => !busy && close()}>
              {c.cancel}
            </Button>
            {state?.kind === 'slots' && slotsShort ? (
              <Button href={`/employer/wallet?add=${Math.max(10, Math.ceil((slotsTotal - available) * 100) / 100).toFixed(2)}&return=${encodeURIComponent(`/employer/jobs/${job?.public_id}`)}`}>Add funds</Button>
            ) : (
              <Button variant={c.destructive ? 'destructive' : 'primary'} onClick={go} loading={busy} loadingText="Saving…">
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
    </Dialog>
  );

  return { open, menuItems, dialogs, duplicating: duplicate.isPending };
}
