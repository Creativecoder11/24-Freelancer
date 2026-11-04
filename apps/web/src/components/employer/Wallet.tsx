'use client';
import NextLink from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Icon, Skeleton, StatCard, StatusBadge, cn, sanitizeAmount, toast, useStaggerIn } from '@24f/ui';
import { formatDate, formatMoney } from '@24f/shared';
import { apiFetch, api, ApiError, errorText, idemKey, useWallet, type WalletSummary } from './api';
import { useEmployerHeader } from './shell';
import { ErrorPanel } from './common';

type Method = WalletSummary['add_funds']['methods'][number]['method'];
const METHOD_TILES: { method: Method; label: string; sub: string }[] = [
  { method: 'crypto', label: 'Crypto', sub: 'USDT · BTC · others' },
  { method: 'mobile_wallet', label: 'Mobile wallet', sub: 'bKash · Nagad' },
  { method: 'card', label: 'Card', sub: 'Visa · Mastercard' },
];

/** SCR-WAL-05 Employer wallet: Add funds (Figma 42:1206). */
export function EmployerWallet() {
  useEmployerHeader({ title: 'Wallet', subtitle: 'Fund your jobs. You only spend when you approve work.' });
  const w = useWallet();
  if (w.isError) return <ErrorPanel onRetry={() => w.refetch()} />;
  if (!w.data)
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading wallet">
        <div className="grid gap-4 tablet:grid-cols-3">
          <Skeleton.StatCard />
          <Skeleton.StatCard />
          <Skeleton.StatCard />
        </div>
        <Skeleton height={560} radius={16} />
      </div>
    );
  return <Body w={w.data} />;
}

function Body({ w }: { w: WalletSummary }) {
  const sp = useSearchParams();
  const formRef = useRef<HTMLElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const af = w.add_funds;
  const methods = METHOD_TILES.map((t) => ({ ...t, cfg: af.methods.find((m) => m.method === t.method) }));
  const prefill = sp.get('add');
  const returnTo = sp.get('return');
  const methodParam = sp.get('method') as Method | null;
  const [method, setMethod] = useState<Method>(() => (methodParam && af.methods.some((m) => m.method === methodParam) ? methodParam : (af.default_method as Method)));
  const cfg = af.methods.find((m) => m.method === method);
  const [sub, setSub] = useState<string | null>(cfg?.sub_providers[0] ?? null);
  useEffect(() => setSub(af.methods.find((m) => m.method === method)?.sub_providers[0] ?? null), [method, af.methods]);
  const initial = prefill && /^\d+(\.\d{1,2})?$/.test(prefill) ? Math.max(Number(prefill), Number(af.min_usd)).toFixed(2) : af.default_amount_usd;
  const [amount, setAmount] = useState(initial);
  const [other, setOther] = useState(af.presets_usd.includes(initial) ? '' : initial);
  const [error, setError] = useState<string | null>(null);
  const root = useStaggerIn<HTMLDivElement>([], { selector: '[data-stagger]' });

  useEffect(() => {
    if (prefill || returnTo) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [prefill, returnTo]);

  const n = Number(amount);
  const min = Number(af.min_usd);
  const max = Math.min(Number(af.max_usd), Number(af.remaining_daily_usd), method === 'card' ? Number(af.card_max_usd) : Infinity);
  const validate = () => {
    if (!amount || !/^\d+(\.\d{1,2})?$/.test(amount) || !Number.isFinite(n)) return 'Enter an amount in dollars, like 25.00.';
    if (n < min || n > max) return `Enter between ${formatMoney(af.min_usd)} and ${formatMoney(max.toFixed(2))}.`;
    return null;
  };

  const deposits = useQuery({
    queryKey: ['employer', 'deposits'],
    queryFn: () => apiFetch<{ ref: string; created_at: string; method_label: string; amount_usd: string; status: string }[]>('/deposits', { query: { per_page: 5 } }),
  });

  const start = useMutation({
    mutationFn: () =>
      api.post<{ ref: string; checkout_url: string }>(
        '/deposits',
        { method, sub_provider: method === 'mobile_wallet' ? (sub ?? undefined) : undefined, amount_usd: n.toFixed(2), return_to: returnTo ?? undefined },
        { headers: { 'Idempotency-Key': idemKey() } },
      ),
    onSuccess: (r) => {
      window.location.assign(r.checkout_url);
    },
    onError: (e) => {
      if (e instanceof ApiError && ['AMOUNT_BELOW_MINIMUM', 'AMOUNT_ABOVE_MAXIMUM', 'DAILY_LIMIT_EXCEEDED', 'AMOUNT_PRECISION', 'VALIDATION_FAILED'].includes(e.code)) {
        setError(errorText(e));
        return;
      }
      toast.show({ tone: 'danger', title: 'We couldn’t reach the payment provider', body: e instanceof ApiError && e.code !== 'PROVIDER_UNAVAILABLE' ? e.message : 'You weren’t charged. Try again or pick another method.' });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    setError(err);
    if (err) return amountRef.current?.focus();
    start.mutate();
  };

  const after = Number(w.deposit_balance_usd) + (Number.isFinite(n) ? n : 0);
  const paused = af.deposits_paused || w.account_status !== 'active';

  return (
    <div ref={root} className="space-y-6">
      <div className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-3 desktop:gap-6">
        <div data-stagger>
          <StatCard
            type="balance"
            label="Deposit balance"
            value={formatMoney(w.deposit_balance_usd)}
            countUp
            meta={`Reserved for running jobs: ${formatMoney(w.reserved_usd)}`}
            action={{
              label: 'Add funds',
              onClick: () => {
                formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setTimeout(() => amountRef.current?.focus({ preventScroll: true }), 300);
              },
            }}
            className="h-full"
          />
        </div>
        <div data-stagger>
          <StatCard
            type="default"
            label="Available for new jobs"
            value={formatMoney(w.available_usd)}
            countUp
            badge={w.available_state === 'ready' ? { label: 'Ready', tone: 'success' } : { label: 'Add funds', tone: 'warning' }}
            meta="Balance minus reserved budget"
            className="h-full"
          />
        </div>
        <div data-stagger className="tablet:col-span-2 desktop:col-span-1">
          <StatCard
            type="trend"
            label="Spent this month"
            value={formatMoney(w.spent_this_month_usd)}
            valueTone="success"
            countUp
            trendPercent={w.spent_trend_percent}
            meta={`${w.approved_this_month_tasks} approved ${w.approved_this_month_tasks === 1 ? 'task' : 'tasks'}`}
            className="h-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 desktop:grid-cols-[minmax(0,720px)_minmax(0,360px)] desktop:justify-between [&>*]:min-w-0">
        <section ref={formRef} data-stagger aria-labelledby="af-h" className="scroll-mt-28 rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-8">
          <h2 id="af-h" className="font-display text-h4 text-fg">
            Add funds
          </h2>
          <p className="mt-1 text-body-sm text-fg-secondary">Deposits fund your jobs. Unused budget stays in your deposit.</p>
          {paused ? (
            <p role="status" className="mt-4 rounded-[12px] bg-warning-subtle px-4 py-3 text-body-sm text-fg-warning">
              {af.deposits_paused ? 'Deposits are paused right now. Try again later.' : 'Deposits are paused on your account. Contact support.'}
            </p>
          ) : null}
          <form onSubmit={submit} noValidate className="mt-6 space-y-6">
            <fieldset>
              <legend className="mb-2 text-label-md text-fg">Payment method</legend>
              <div className="grid gap-3 tablet:grid-cols-3">
                {methods.map((m) => {
                  const on = method === m.method;
                  const off = !m.cfg;
                  return (
                    <label
                      key={m.method}
                      className={cn(
                        'relative flex min-h-[72px] flex-col justify-center rounded-[12px] border p-4 transition-colors has-[:focus-visible]:shadow-focus',
                        off ? 'cursor-not-allowed border-line bg-muted' : on ? 'cursor-pointer border-[1.5px] border-line-brand bg-brand-subtle' : 'cursor-pointer border-line bg-surface hover:border-line-strong',
                      )}
                    >
                      <input type="radio" name="method" className="sr-only" checked={on} disabled={off} onChange={() => setMethod(m.method)} aria-describedby={off ? `m-${m.method}-off` : undefined} />
                      <span className={cn('text-label-md', off ? 'text-fg-disabled' : 'text-fg')}>{m.label}</span>
                      <span className="mt-0.5 text-body-xs text-fg-tertiary">{m.cfg?.sublabel ?? m.sub}</span>
                      {off ? (
                        <span id={`m-${m.method}-off`} className="mt-1 text-body-xs text-fg-tertiary">
                          Not available right now.
                        </span>
                      ) : null}
                      {on ? (
                        <span aria-hidden className="absolute right-3 top-3 grid size-5 place-items-center rounded-full bg-brand text-fg-on-brand">
                          <Icon name="check" size={12} strokeWidth={3} />
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
              {cfg && cfg.sub_providers.length > 1 ? (
                <div role="radiogroup" aria-label="Wallet" className="mt-3 flex flex-wrap gap-2">
                  {cfg.sub_providers.map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={sub === p}
                      onClick={() => setSub(p)}
                      className={cn('h-9 rounded-full px-4 text-label-md transition-colors focus-visible:shadow-focus focus-visible:outline-none', sub === p ? 'bg-inverse text-fg-inverse' : 'border border-line bg-surface text-fg hover:border-line-strong')}
                    >
                      {p === 'bkash' ? 'bKash' : p === 'nagad' ? 'Nagad' : p}
                    </button>
                  ))}
                </div>
              ) : null}
            </fieldset>

            <fieldset aria-describedby={error ? 'amount-err' : undefined}>
              <legend className="mb-2 text-label-md text-fg">Amount</legend>
              <div className="grid grid-cols-4 gap-2 tablet:grid-cols-[repeat(4,100px)_minmax(0,1fr)] tablet:gap-3">
                {af.presets_usd.map((p) => {
                  const on = !other && amount === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setAmount(p);
                        setOther('');
                        setError(null);
                      }}
                      className={cn(
                        'h-12 rounded-[10px] border text-label-md tabular-nums transition-colors focus-visible:shadow-focus focus-visible:outline-none',
                        on ? 'border-[1.5px] border-line-brand bg-brand-subtle text-fg-brand' : 'border-line bg-surface text-fg hover:border-line-strong',
                      )}
                    >
                      ${Number(p).toFixed(0)}
                    </button>
                  );
                })}
                <label className="col-span-4 tablet:col-span-1">
                  <span className="sr-only">Other amount in US dollars</span>
                  <span className={cn('flex h-12 items-center gap-1 rounded-[10px] border bg-surface px-4 focus-within:border-line-brand focus-within:shadow-focus', error ? 'border-line-danger' : other ? 'border-line-brand' : 'border-line')}>
                    {other ? <span className="text-body-md text-fg-secondary">$</span> : null}
                    <input
                      ref={amountRef}
                      inputMode="decimal"
                      autoComplete="off"
                      value={other}
                      placeholder="Other amount"
                      aria-invalid={error ? true : undefined}
                      onChange={(e) => {
                        const v = sanitizeAmount(e.target.value, 2);
                        setOther(v);
                        setAmount(v || af.default_amount_usd);
                        setError(null);
                      }}
                      className="min-w-0 flex-1 bg-transparent text-body-md tabular-nums text-fg outline-none placeholder:text-fg-tertiary"
                    />
                  </span>
                </label>
              </div>
              {error ? (
                <p id="amount-err" className="mt-1.5 flex items-center gap-1 text-body-xs text-fg-danger">
                  <Icon name="alert-circle" size={14} />
                  {error}
                </p>
              ) : (
                <p className="mt-1.5 text-body-xs text-fg-tertiary">
                  {formatMoney(af.min_usd)} to {formatMoney(max.toFixed(2))} per deposit
                </p>
              )}
            </fieldset>

            <dl className="rounded-[14px] bg-subtle px-5 py-4 text-body-sm">
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-fg-secondary">Deposit</dt>
                <dd className="font-semibold tabular-nums text-fg">{Number.isFinite(n) ? formatMoney(n.toFixed(2)) : '—'}</dd>
              </div>
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-fg-secondary">Processing fee</dt>
                <dd className="text-right font-semibold text-fg">Shown by payment provider</dd>
              </div>
              {cfg?.deposit_fx_rate && method !== 'crypto' ? (
                <div className="flex justify-between gap-3 py-1.5">
                  <dt className="text-fg-secondary">You pay</dt>
                  <dd className="font-semibold tabular-nums text-fg">≈ ৳{Math.ceil(n * Number(cfg.deposit_fx_rate) || 0).toLocaleString('en-US')}</dd>
                </div>
              ) : null}
              <div className="mt-1.5 flex justify-between gap-3 border-t border-line pt-3">
                <dt className="text-label-md text-fg">Added to your balance</dt>
                <dd className="text-label-md tabular-nums text-fg-brand">{Number.isFinite(n) ? formatMoney(n.toFixed(2)) : '—'}</dd>
              </div>
              <p className="mt-3 text-body-xs text-fg-tertiary">Balance after deposit: {formatMoney(after.toFixed(2))}</p>
            </dl>

            <p className="rounded-[12px] bg-brand-subtle px-4 py-3.5 text-body-sm text-fg-secondary">
              Deposits are non-withdrawable and used for jobs. See the{' '}
              <NextLink href="/legal/refund" className="font-semibold text-fg-brand underline-offset-2 hover:underline">
                Refund policy
              </NextLink>{' '}
              for exceptions. You’re redirected to the provider to pay securely.
            </p>

            <Button type="submit" size="L" fullWidth loading={start.isPending} loadingText="Redirecting…" disabled={paused} disabledReasonId="dep-paused">
              Continue to payment · {Number.isFinite(n) && n > 0 ? formatMoney(n.toFixed(2)) : '$0.00'}
            </Button>
            <span id="dep-paused" className="sr-only">
              Deposits are paused.
            </span>
          </form>
        </section>

        <div className="space-y-6">
          <section data-stagger aria-labelledby="how-h" className="rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6">
            <h2 id="how-h" className="text-h5 text-fg">
              How your deposit is used
            </h2>
            <ol className="mt-4 space-y-5">
              {[
                ['When you publish', 'The job’s max budget is reserved (reward × slots).'],
                ['When you approve', 'The reward moves to the worker.'],
                ['When a job closes', 'Any unused reserve returns to your deposit.'],
              ].map(([t, b], i) => (
                <li key={t} className="flex gap-4">
                  <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-subtle text-label-sm font-semibold text-fg-brand">
                    {i + 1}
                  </span>
                  <span>
                    <span className="block text-label-md text-fg">{t}</span>
                    <span className="mt-0.5 block text-body-sm text-fg-secondary">{b}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section data-stagger aria-labelledby="dep-h" className="rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6">
            <div className="flex items-center justify-between">
              <h2 id="dep-h" className="text-h5 text-fg">
                Recent deposits
              </h2>
              <NextLink href="/employer/wallet/transactions" className="text-label-md font-semibold text-fg-brand hover:underline">
                Transactions
              </NextLink>
            </div>
            {deposits.isLoading ? (
              <Skeleton height={120} radius={12} className="mt-4" />
            ) : !deposits.data?.data.length ? (
              <p className="mt-4 text-body-sm text-fg-secondary">No deposits yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line-subtle">
                {deposits.data.data.map((dp) => (
                  <li key={dp.ref}>
                    <NextLink href={`/employer/wallet/deposits/${dp.ref}`} className="flex items-center gap-3 py-3 hover:opacity-80">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-label-md text-fg">{dp.method_label}</span>
                        <span className="block text-body-xs text-fg-tertiary">
                          {formatDate(dp.created_at)} · {dp.ref}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block text-label-md tabular-nums text-fg">{formatMoney(dp.amount_usd)}</span>
                        <StatusBadge enum="deposit_status" code={dp.status} className="mt-1" />
                      </span>
                    </NextLink>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
