'use client';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Icon, Skeleton, Spinner, StatusBadge, cn, gsap, prefersReducedMotion, toast, type IconName } from '@24f/ui';
import { formatDateTime, formatMoney } from '@24f/shared';
import { api, ApiError, ek, invalidateEmployer, useQueryClient, type DepositDetail } from './api';
import { useEmployerHeader } from './shell';
import { ErrorPanel } from './common';

const POLL_MS = 5_000;
const POLL_FOR_MS = 120_000;

/** SCR-WAL-ND2 Deposit return page (`/employer/wallet/deposits/[ref]`, G-11). Polls while pending. */
export function DepositStatus({ refId }: { refId: string }) {
  useEmployerHeader({ title: 'Deposit', subtitle: refId, backHref: '/employer/wallet' });
  const qc = useQueryClient();
  const started = useRef(Date.now());
  const q = useQuery({
    queryKey: ek.deposit(refId),
    queryFn: () => api.get<DepositDetail>(`/deposits/${refId}`),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return (s === 'pending' || s === 'initiated') && Date.now() - started.current < POLL_FOR_MS ? POLL_MS : false;
    },
  });
  const status = q.data?.status;
  const prev = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (status && prev.current && prev.current !== status) void invalidateEmployer(qc);
    if (status === 'completed' && prev.current === undefined) void invalidateEmployer(qc);
    prev.current = status;
  }, [status, qc]);

  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!card.current || !q.data || prefersReducedMotion()) return;
    gsap.fromTo(card.current.querySelector('[data-icon]'), { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.45, ease: 'back.out(2)' });
  }, [q.data?.message_key]);

  if (q.isError)
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <div className="mx-auto max-w-[520px] rounded-card border border-line bg-surface">
        <EmptyState icon="alert-circle" title="We can’t find that deposit." action={<Button href="/employer/wallet">Back to wallet</Button>} />
      </div>
    ) : (
      <ErrorPanel onRetry={() => q.refetch()} />
    );
  if (!q.data)
    return (
      <div className="mx-auto max-w-[520px] rounded-card border border-line bg-surface p-8" aria-busy="true" aria-label="Loading deposit">
        <Skeleton width={56} height={56} radius={28} className="mx-auto" />
        <Skeleton height={24} width="70%" className="mx-auto mt-6" />
        <Skeleton height={16} width="50%" className="mx-auto mt-3" />
      </div>
    );
  const d = q.data;
  const v = view(d);
  const stillPolling = (d.status === 'pending' || d.status === 'initiated') && Date.now() - started.current < POLL_FOR_MS;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d.ref);
      toast.show({ tone: 'success', title: 'Copied' });
    } catch {
      toast.show({ tone: 'danger', title: 'Couldn’t copy', body: 'Select the text and copy it yourself.' });
    }
  };
  const retry = d.retry_url ?? `/employer/wallet?add=${d.amount_usd}&method=${d.method}`;
  return (
    <div ref={card} className="mx-auto max-w-[520px] rounded-card border border-line bg-surface p-6 text-center shadow-sm tablet:p-8" aria-live="polite">
      <span data-icon className={cn('mx-auto grid size-14 place-items-center rounded-full', v.tile)}>
        {v.icon === 'loader' ? <Spinner size={24} label="Confirming" /> : <Icon name={v.icon} size={24} />}
      </span>
      <h2 className="mt-5 font-display text-h3 text-fg">{v.title}</h2>
      <p className="mt-2 text-body-md text-fg-secondary">{v.body}</p>
      <dl className="mt-6 space-y-2 rounded-[14px] bg-subtle px-5 py-4 text-left text-body-sm">
        <Row k="Amount" v={formatMoney(d.amount_usd)} />
        {d.credited_amount_usd ? <Row k="Added to balance" v={formatMoney(d.credited_amount_usd)} /> : null}
        <Row k="Method" v={d.method_label} />
        {d.charge_amount_bdt ? <Row k="BDT Amount" v={`৳${d.charge_amount_bdt}`} /> : null}
        {d.trx_id ? <Row k="bKash TrxID" v={<span className="font-mono font-bold text-fg-brand">{d.trx_id}</span>} /> : null}
        {d.sender_number ? <Row k="Sender Number" v={d.sender_number} /> : null}
        <Row k="Status" v={<StatusBadge enum="deposit_status" code={d.status} />} />
        {d.failure_reason ? <Row k="Decline reason" v={<span className="font-medium text-fg-danger">{d.failure_reason}</span>} /> : null}
        <Row k="Started" v={formatDateTime(d.created_at)} />
        <Row
          k="Reference"
          v={
            <span className="inline-flex items-center gap-1.5">
              {d.ref}
              <button type="button" onClick={() => void copy()} aria-label={`Copy reference ${d.ref}`} className="grid size-7 place-items-center rounded-[6px] text-fg-tertiary hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none">
                <Icon name="copy" size={14} />
              </button>
            </span>
          }
        />
        {d.status === 'completed' ? <Row k="Deposit balance" v={formatMoney(d.balance.deposit_balance_usd)} /> : null}
      </dl>
      {stillPolling ? <p className="mt-3 text-body-xs text-fg-tertiary">Checking every few seconds…</p> : null}
      <div className="mt-6 flex flex-col-reverse gap-3 tablet:flex-row tablet:justify-center">
        {d.status === 'completed' ? (
          <>
            <Button variant="secondary" href="/employer/wallet">
              Back to wallet
            </Button>
            <Button href={d.return_to ?? '/employer/jobs/new'}>{d.return_to ? 'Continue where you left off' : 'Post a job'}</Button>
          </>
        ) : ['failed', 'cancelled', 'expired'].includes(d.status) ? (
          <>
            <Button variant="secondary" href="/employer/wallet">
              Back to wallet
            </Button>
            <Button href={retry}>Try again</Button>
          </>
        ) : (
          <>
            {d.checkout_url ? (
              <Button variant="secondary" href={d.checkout_url}>
                Return to payment
              </Button>
            ) : null}
            <Button variant="secondary" href="/employer/wallet">
              Back to wallet
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-secondary">{k}</dt>
      <dd className="text-right font-semibold tabular-nums text-fg">{v}</dd>
    </div>
  );
}

function view(d: DepositDetail): { title: string; body: string; icon: IconName | 'loader'; tile: string } {
  const amt = formatMoney(d.credited_amount_usd ?? d.amount_usd);
  switch (d.message_key) {
    case 'completed':
      return { title: `${amt} added to your balance`, body: 'You can use it for new jobs now.', icon: 'check-circle', tile: 'bg-success-subtle text-fg-success' };
    case 'underpaid':
      return {
        title: 'We received less than expected',
        body: `We received ${formatMoney(d.amount_received_usd ?? '0')} of ${formatMoney(d.amount_usd)}. ${formatMoney(d.credited_amount_usd ?? '0')} was added to your balance.`,
        icon: 'alert-triangle',
        tile: 'bg-warning-subtle text-fg-warning',
      };
    case 'overpaid':
      return {
        title: 'We received more than expected',
        body: `We received ${formatMoney(d.amount_received_usd ?? '0')}. ${formatMoney(d.credited_amount_usd ?? '0')} was added to your balance.`,
        icon: 'info',
        tile: 'bg-info-subtle text-fg-info',
      };
    case 'failed':
      return { title: 'Payment failed', body: 'You weren’t charged. Try again or pick another method.', icon: 'x-circle', tile: 'bg-danger-subtle text-fg-danger' };
    case 'cancelled':
      return { title: 'Payment cancelled', body: 'Nothing was charged.', icon: 'x-circle', tile: 'bg-muted text-fg-secondary' };
    case 'expired':
      return { title: 'This payment expired', body: 'Start a new deposit to add funds.', icon: 'clock', tile: 'bg-muted text-fg-secondary' };
    case 'refunded':
      return { title: 'This deposit was refunded', body: 'The amount went back to your payment method.', icon: 'rotate', tile: 'bg-info-subtle text-fg-info' };
    default:
      return { title: 'Verifying your payment', body: 'Admin is manually verifying your payment. Your balance will be credited as soon as verified.', icon: 'loader', tile: 'bg-brand-subtle text-fg-brand' };
  }
}

