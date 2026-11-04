'use client';
/** SCR-WAL-04 Withdrawal history (Figma 42:927) with the detail panel (42:1164). */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { formatDate, formatDateTime, formatMoney } from '@24f/shared';
import { Alert, Button, Drawer, EmptyState, Icon, LinkButton, Pagination, Skeleton, StatusBadge, Tabs, Dialog, cn, toast, useStaggerIn } from '@24f/ui';
import { useWorkerHeader } from '@/components/worker/shell';
import { LoadError } from '@/components/worker/ui';
import { apiFetch, ApiError } from '@/lib/api/client';
import { newIdemKey, useInvalidateWallet, useWithdrawal, useWithdrawals, type WithdrawalDetail, type WithdrawalRow } from './api';

const HEADER = { title: 'Withdrawal history', subtitle: 'Every payout request, from requested to paid.', backHref: '/worker/wallet' };
type Tab = 'all' | 'processing' | 'paid' | 'rejected';
const TABS: Tab[] = ['all', 'processing', 'paid', 'rejected'];

function useIsDesktop() {
  const [d, setD] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1280px)');
    const f = () => setD(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return d;
}

export function WithdrawalsPage() {
  useWorkerHeader(HEADER);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'all') as Tab;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const refParam = params.get('ref');
  const qs = new URLSearchParams({ tab, page: String(page), per_page: '10' });
  const list = useWithdrawals(qs);
  const desktop = useIsDesktop();
  const rows = list.data?.data ?? [];
  // First row auto-selected on desktop (Doc 02 SCR-WAL-04).
  const selected = refParam ?? (desktop ? (rows[0]?.ref ?? null) : null);
  const detail = useWithdrawal(selected);
  const listRef = useStaggerIn<HTMLDivElement>([list.data?.meta.page, tab, rows.length]);
  const warned = useRef<string | null>(null);

  useEffect(() => {
    if (refParam && detail.error instanceof ApiError && detail.error.status === 404 && warned.current !== refParam) {
      warned.current = refParam;
      toast.show({ tone: 'warning', title: 'We couldn’t find that withdrawal.' });
      setParam({ ref: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.error, refParam]);

  const setParam = (p: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(p)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };
  const counts = list.data?.meta.counts;

  return (
    <div className="mx-auto grid w-full max-w-[1104px] gap-6 desktop:grid-cols-[minmax(0,720px)_360px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Tabs
          label="Withdrawal status"
          panelId="wd-panel"
          value={tab}
          onChange={(v) => setParam({ tab: v === 'all' ? null : v, page: null, ref: null })}
          tabs={[
            { value: 'all', label: 'All', count: counts?.all },
            { value: 'processing', label: 'Processing', count: counts?.processing },
            { value: 'paid', label: 'Paid', count: counts?.paid },
            { value: 'rejected', label: 'Rejected', count: counts?.rejected },
          ]}
        />
        <div id="wd-panel" role="tabpanel">
          {list.isError ? (
            <LoadError error={list.error} onRetry={() => list.refetch()} />
          ) : !list.data ? (
            <div className="rounded-card border border-line bg-surface p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton.TableRow key={i} columns={5} />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-card border border-line bg-surface">
              {counts?.all ? (
                <EmptyState compact icon="inbox" title="Nothing in this list." />
              ) : (
                <EmptyState
                  icon="wallet"
                  title="No withdrawals yet"
                  body="When you request a payout, you can follow it here from requested to paid."
                  action={
                    <Button size="M" href="/worker/wallet/withdraw">
                      Withdraw
                    </Button>
                  }
                />
              )}
            </div>
          ) : (
            <div ref={listRef} className={cn('overflow-hidden rounded-card border border-line bg-surface shadow-xs transition-opacity', list.isPlaceholderData && 'opacity-60')}>
              <table className="hidden w-full text-left tablet:table">
                <caption className="sr-only">Withdrawals</caption>
                <thead>
                  <tr className="border-b border-line-subtle bg-subtle">
                    {['Date', 'Method', 'Amount', 'Received', 'Status'].map((h) => (
                      <th key={h} scope="col" className={cn('px-5 py-4 text-overline uppercase text-fg-tertiary', (h === 'Amount' || h === 'Received') && 'text-right')}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {rows.map((r) => (
                    <WdRow key={r.ref} r={r} selected={r.ref === selected} onSelect={() => setParam({ ref: r.ref })} />
                  ))}
                </tbody>
              </table>
              <ul className="divide-y divide-line-subtle tablet:hidden">
                {rows.map((r) => (
                  <li key={r.ref}>
                    <button type="button" onClick={() => setParam({ ref: r.ref })} className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left focus-visible:shadow-focus focus-visible:outline-none">
                      <span className="min-w-0">
                        <span className="block text-label-md text-fg">{r.method_label}</span>
                        <span className="block text-body-xs text-fg-tertiary">
                          {r.destination_masked} · {formatDateTime(r.requested_at)}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className="text-label-md tabular-nums text-fg">{formatMoney(r.amount_usd)}</span>
                        <StatusBadge enum="withdrawal_status" code={r.status} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {list.data && list.data.meta.total > 0 ? (
          <Pagination page={page} totalPages={list.data.meta.total_pages} total={list.data.meta.total} perPage={10} itemLabel="withdrawals" hrefFor={(p) => `${pathname}?${new URLSearchParams({ ...(tab !== 'all' ? { tab } : {}), page: String(p) })}`} />
        ) : null}
      </div>

      {desktop ? (
        <aside aria-label="Withdrawal details" className="h-fit rounded-card border border-line bg-surface p-6 shadow-xs desktop:sticky desktop:top-[100px]">
          {selected ? <DetailBody q={detail} onChanged={() => list.refetch()} /> : <EmptyState compact icon="wallet" title="Select a withdrawal" body="Its timeline and reference show here." />}
        </aside>
      ) : (
        <Drawer open={!!refParam} onOpenChange={(o) => !o && setParam({ ref: null })} title={refParam ? `Withdrawal · ${refParam}` : 'Withdrawal'} width={360}>
          {refParam ? <DetailBody q={detail} hideEyebrow onChanged={() => list.refetch()} /> : null}
        </Drawer>
      )}
    </div>
  );
}

function WdRow({ r, selected, onSelect }: { r: WithdrawalRow; selected: boolean; onSelect: () => void }) {
  return (
    <tr
      tabIndex={0}
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect())}
      className={cn('h-16 cursor-pointer text-body-md text-fg outline-none transition-colors hover:bg-subtle focus-visible:bg-brand-subtle', selected && 'bg-brand-subtle hover:bg-brand-subtle')}
    >
      <td className="whitespace-nowrap px-5 text-fg-secondary tabular-nums">{formatDateTime(r.requested_at)}</td>
      <td className="px-5">
        <span className="block text-label-md">{r.method_label}</span>
        <span className="block text-body-xs text-fg-tertiary tabular-nums">{r.destination_masked}</span>
      </td>
      <td className="whitespace-nowrap px-5 text-right text-label-md tabular-nums">{formatMoney(r.amount_usd)}</td>
      <td className="whitespace-nowrap px-5 text-right text-fg-secondary tabular-nums">{r.received_label}</td>
      <td className="px-5">
        <StatusBadge enum="withdrawal_status" code={r.status} />
      </td>
    </tr>
  );
}

function DetailBody({ q, hideEyebrow, onChanged }: { q: ReturnType<typeof useWithdrawal>; hideEyebrow?: boolean; onChanged: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (q.isError) return <p className="text-body-sm text-fg-tertiary">We couldn’t load this withdrawal.</p>;
  if (!q.data) {
    return (
      <div aria-busy="true">
        <Skeleton width={160} height={12} />
        <Skeleton width={120} height={36} className="mt-3" />
        <Skeleton height={140} className="mt-6" />
      </div>
    );
  }
  const d = q.data;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d.ref);
      toast.show({ tone: 'success', title: 'Copied' });
    } catch {
      toast.show({ tone: 'danger', title: 'Couldn’t copy', body: 'Select the text and copy it yourself.' });
    }
  };
  const fail = d.status === 'rejected' || d.status === 'failed';
  return (
    <div>
      {!hideEyebrow ? <p className="text-overline uppercase text-fg-tertiary">Withdrawal · {d.ref}</p> : null}
      <p className="mt-2 font-display text-num-xl text-fg tabular-nums">{formatMoney(d.amount_usd)}</p>
      <p className="mt-1 text-body-md text-fg-secondary">
        {d.receive_label} to {d.method_label} {d.destination_masked}
      </p>
      <StatusBadge enum="withdrawal_status" code={d.status} className="mt-3" />
      {fail || d.status === 'cancelled' ? (
        <Alert tone={fail ? 'danger' : 'info'} className="mt-4" title={d.status === 'cancelled' ? 'Cancelled by you' : d.status === 'failed' ? 'Payment failed' : 'Withdrawal rejected'}>
          {d.reason_text ? `${d.reason_text} ` : ''}
          {formatMoney(d.amount_usd)} went back to your balance{d.refunded_at ? ` on ${formatDate(d.refunded_at)}` : ''}.
        </Alert>
      ) : null}
      {d.hold_until && d.status === 'requested' ? (
        <Alert tone="warning" className="mt-4">
          We’re reviewing this request for your security. It may take up to 24 hours longer.
        </Alert>
      ) : null}
      <div className="my-5 border-t border-line-subtle" />
      <ol className="relative space-y-6" aria-label="Timeline">
        {d.timeline.map((t, i) => {
          const done = t.state === 'done' || t.state === 'current';
          return (
            <li key={t.status + i} className="relative flex gap-4">
              {i < d.timeline.length - 1 ? <span aria-hidden className={cn('absolute left-[5px] top-4 h-[calc(100%+10px)] w-0.5', d.timeline[i + 1]!.state === 'done' || d.timeline[i + 1]!.state === 'current' ? 'bg-brand' : 'bg-line')} /> : null}
              <span aria-hidden className={cn('relative mt-1.5 size-3 shrink-0 rounded-full', t.state === 'failed' ? 'bg-danger' : done ? 'bg-brand' : 'border-2 border-brand bg-surface')} />
              <div>
                <p className="text-label-md text-fg">{t.label}</p>
                <p className="text-body-sm text-fg-secondary">
                  {t.at ? `${t.note && t.status === 'processing' ? `${t.note} ` : ''}${formatDateTime(t.at)}` : (t.note ?? '')}
                </p>
                {t.at && t.note && t.status !== 'processing' ? <p className="text-body-xs text-fg-tertiary">{t.note}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="my-5 border-t border-line-subtle" />
      <dl className="space-y-3 text-body-md">
        {[
          ['Fee', formatMoney(d.fee_usd)],
          ['Rate', d.fx_rate_label],
          ['Reference', d.ref],
          ...(d.provider_trx_id ? [['Transaction ID', d.provider_trx_id]] : []),
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-fg-secondary">{k}</dt>
            <dd className="text-label-md text-fg tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        {d.cancellable ? (
          <Button variant="secondary" size="M" onClick={() => setConfirm(true)}>
            Cancel request
          </Button>
        ) : null}
        <LinkButton onClick={copy} className="inline-flex items-center gap-1.5">
          <Icon name="copy" size={16} />
          Copy reference
        </LinkButton>
      </div>
      <CancelDialog detail={confirm ? d : null} onClose={() => setConfirm(false)} onDone={() => (q.refetch(), onChanged())} />
    </div>
  );
}

function CancelDialog({ detail, onClose, onDone }: { detail: WithdrawalDetail | null; onClose: () => void; onDone: () => void }) {
  const invalidate = useInvalidateWallet();
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdemKey('wdc'));
  const run = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await apiFetch(`/withdrawals/${detail.ref}/cancel`, { method: 'POST', body: {}, headers: { 'Idempotency-Key': key.current } });
      toast.show({ tone: 'success', title: 'Withdrawal cancelled', body: `${formatMoney(detail.amount_usd)} is back in your balance.` });
      key.current = newIdemKey('wdc');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'WITHDRAWAL_NOT_CANCELLABLE') toast.show({ tone: 'warning', title: 'It’s already processing, so it can’t be cancelled.' });
      else toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Try again in a moment.' });
    } finally {
      setBusy(false);
      invalidate();
      onDone();
      onClose();
    }
  };
  return (
    <Dialog
      open={!!detail}
      onOpenChange={(o) => !o && onClose()}
      type="destructive"
      title="Cancel this withdrawal?"
      description={detail ? `${formatMoney(detail.amount_usd)} goes back to your available balance.` : undefined}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep request
          </Button>
          <Button variant="destructive" onClick={run} loading={busy}>
            Cancel request
          </Button>
        </>
      }
    />
  );
}
