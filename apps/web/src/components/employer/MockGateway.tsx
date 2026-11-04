'use client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Icon, Logo, Skeleton, cn } from '@24f/ui';
import { formatBdt, formatDateTime, formatMoney } from '@24f/shared';
import { api, errorText } from './api';

interface MockInfo {
  ref: string;
  status: string;
  method: string;
  method_label: string;
  amount_usd: string;
  charge_amount_bdt: string | null;
  fx_rate: string | null;
  merchant: string;
  payer: string | null;
  expires_at: string | null;
  return_path: string;
}

/**
 * Dev-only hosted checkout for PAYMENTS_MODE=mock (Doc 06 §7.1). "Pay" fires the same signed
 * webhook a real provider would, then returns to the deposit status page.
 */
export function MockGateway({ refId }: { refId: string }) {
  const info = useQuery({ queryKey: ['mock-gateway', refId], queryFn: () => api.get<MockInfo>(`/dev/mock-gateway/${refId}`, { auth: false }), retry: false });
  const [err, setErr] = useState<string | null>(null);
  const complete = useMutation({
    mutationFn: (outcome: 'paid' | 'failed' | 'cancelled') => api.post<{ return_path: string }>(`/dev/mock-gateway/${refId}/complete`, { outcome }, { auth: false }),
    onSuccess: (r) => window.location.assign(r.return_path),
    onError: (e) => setErr(errorText(e)),
  });
  const d = info.data;
  const open = d && (d.status === 'initiated' || d.status === 'pending');
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-canvas px-5 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-4 flex items-center justify-between">
          <Logo height={28} />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-subtle px-3 py-1 text-label-sm font-semibold text-fg-warning">
            <Icon name="alert-triangle" size={14} />
            Test payment
          </span>
        </div>
        <div className="rounded-card border border-line bg-surface p-6 shadow-md">
          {info.isLoading ? (
            <div aria-busy="true" aria-label="Loading payment">
              <Skeleton height={20} width="50%" />
              <Skeleton height={40} width="60%" className="mt-4" />
              <Skeleton height={120} radius={12} className="mt-6" />
            </div>
          ) : !d ? (
            <EmptyState compact icon="alert-circle" title="We can’t find that payment session." body="Start a new deposit from your wallet." action={<Button href="/employer/wallet">Back to wallet</Button>} />
          ) : (
            <>
              <p className="text-body-sm text-fg-secondary">Pay {d.merchant}</p>
              <p className="mt-1 font-display text-num-2xl tabular-nums text-fg">{formatMoney(d.amount_usd)}</p>
              {d.charge_amount_bdt ? <p className="text-body-sm text-fg-secondary">{formatBdt(d.charge_amount_bdt)} at {d.fx_rate ? `৳${d.fx_rate}` : 'today’s rate'}</p> : null}
              <dl className="mt-6 space-y-2 rounded-[12px] bg-subtle px-4 py-3 text-body-sm">
                {[
                  ['Method', d.method_label],
                  ['Payer', d.payer ?? '—'],
                  ['Reference', d.ref],
                  ['Expires', formatDateTime(d.expires_at)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-fg-secondary">{k}</dt>
                    <dd className="text-right font-semibold text-fg">{v}</dd>
                  </div>
                ))}
              </dl>
              {err ? <p role="alert" className="mt-4 text-body-sm text-fg-danger">{err}</p> : null}
              {open ? (
                <div className="mt-6 space-y-3">
                  <Button fullWidth size="L" loading={complete.isPending && complete.variables === 'paid'} loadingText="Paying…" onClick={() => complete.mutate('paid')}>
                    Pay {formatMoney(d.amount_usd)}
                  </Button>
                  <div className="grid grid-cols-2 gap-3">
                    <Button variant="secondary" loading={complete.isPending && complete.variables === 'failed'} onClick={() => complete.mutate('failed')}>
                      Simulate failure
                    </Button>
                    <Button variant="secondary" loading={complete.isPending && complete.variables === 'cancelled'} onClick={() => complete.mutate('cancelled')}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={cn('mt-6 rounded-[12px] px-4 py-3 text-body-sm', 'bg-info-subtle text-fg-info')}>
                  This payment is {d.status}.{' '}
                  <a href={d.return_path} className="font-semibold underline">
                    See the status
                  </a>
                </div>
              )}
            </>
          )}
        </div>
        <p className="mt-4 text-center text-body-xs text-fg-tertiary">Local test gateway. No real money moves.</p>
      </div>
    </main>
  );
}
