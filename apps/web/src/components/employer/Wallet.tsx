'use client';
import NextLink from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Icon, Skeleton, StatCard, StatusBadge, cn, sanitizeAmount, toast, useStaggerIn } from '@24f/ui';
import { formatDate, formatMoney } from '@24f/shared';
import { apiFetch, api, ApiError, errorText, idemKey, useWallet, type ManualChannel, type ManualChannelId, type WalletSummary } from './api';
import { useEmployerHeader } from './shell';
import { ErrorPanel } from './common';

/** A manual rail (bKash, Nagad, Rocket, Binance Pay, USDT on TRC20/BEP20/ERC20) or the card gateway if an admin turns it on. */
type Choice = ManualChannelId | 'card';

/** SCR-WAL-05 Employer wallet: Add funds (Figma 42:1206). */
export function EmployerWallet() {
  useEmployerHeader({ title: 'Wallet', subtitle: 'Fund your jobs. You only spend when you approve work.' });
  const w = useWallet();
  if (w.isError) return <ErrorPanel onRetry={() => w.refetch()} />;
  if (!w.data)
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading wallet">
        <div className="grid gap-4 tablet:grid-cols-2">
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
  const cardOn = af.methods.some((m) => m.method === 'card');
  const tiles: { id: Choice; label: string; sub: string }[] = [
    ...af.manual_channels.map((c) => ({ id: c.channel as Choice, label: c.label, sub: c.subtitle })),
    ...(cardOn ? [{ id: 'card' as Choice, label: 'Card', sub: 'Visa · Mastercard' }] : []),
  ];
  const prefill = sp.get('add');
  const returnTo = sp.get('return');
  // ?method= from a retry link: a channel, or a method group (pick its first channel).
  const param = sp.get('method');
  const [choice, setChoice] = useState<Choice | null>(() => {
    const byParam = tiles.find((t) => t.id === param) ?? af.manual_channels.find((c) => c.group === param);
    const id = byParam ? ('id' in byParam ? byParam.id : byParam.channel) : (af.default_channel ?? tiles[0]?.id ?? null);
    return id as Choice | null;
  });
  const ch: ManualChannel | null = af.manual_channels.find((c) => c.channel === choice) ?? null;
  const initial = prefill && /^\d+(\.\d{1,2})?$/.test(prefill) ? Math.max(Number(prefill), Number(af.min_usd)).toFixed(2) : af.default_amount_usd;
  const [amount, setAmount] = useState(initial);
  const [other, setOther] = useState(af.presets_usd.includes(initial) ? '' : initial);
  const [senderNumber, setSenderNumber] = useState('');
  const [trxId, setTrxId] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ sender_number?: string; trx_id?: string }>({});
  useEffect(() => {
    setFieldErr({});
    setCopied(false);
  }, [choice]);
  const root = useStaggerIn<HTMLDivElement>([], { selector: '[data-stagger]' });

  useEffect(() => {
    if (prefill || returnTo) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [prefill, returnTo]);

  const n = Number(amount);
  const min = Number(af.min_usd);
  const max = Math.min(Number(af.max_usd), Number(af.remaining_daily_usd), choice === 'card' ? Number(af.card_max_usd) : Infinity);
  // What the employer actually sends: BDT at the deposit rate (rounded up), or USD 1:1 in USDT.
  const sendLabel = ch ? (ch.currency === 'BDT' ? `৳${Math.ceil(n * Number(ch.deposit_fx_rate ?? 0) || 0).toLocaleString('en-US')}` : `${Number.isFinite(n) ? n.toFixed(2) : '0.00'} USDT`) : null;
  const validate = () => {
    if (!amount || !/^\d+(\.\d{1,2})?$/.test(amount) || !Number.isFinite(n)) return 'Enter an amount in dollars, like 25.00.';
    if (n < min || n > max) return `Enter between ${formatMoney(af.min_usd)} and ${formatMoney(max.toFixed(2))}.`;
    return null;
  };
  const validateManual = () => {
    if (!ch) return {};
    const e: { sender_number?: string; trx_id?: string } = {};
    if (!senderNumber.trim()) e.sender_number = `Enter ${ch.sender_label.replace(/^Your /, 'your ').replace(/ \(sender\)$/, '')}.`;
    if (!trxId.trim()) e.trx_id = `Enter the ${ch.ref_label}.`;
    return e;
  };

  const deposits = useQuery({
    queryKey: ['employer', 'deposits'],
    queryFn: () => apiFetch<{ ref: string; created_at: string; method_label: string; amount_usd: string; status: string }[]>('/deposits', { query: { per_page: 5 } }),
  });

  const start = useMutation({
    mutationFn: () =>
      api.post<{ ref: string; checkout_url: string }>(
        '/deposits',
        ch
          ? { channel: ch.channel, amount_usd: n.toFixed(2), return_to: returnTo ?? undefined, sender_number: senderNumber.trim(), trx_id: trxId.trim().toUpperCase() }
          : { method: 'card', amount_usd: n.toFixed(2), return_to: returnTo ?? undefined },
        { headers: { 'Idempotency-Key': idemKey() } },
      ),
    onSuccess: (r) => {
      window.location.assign(r.checkout_url);
    },
    onError: (e) => {
      // Manual rails: the server checks the sender account and reference format and reuse.
      if (e instanceof ApiError && (e.fields.sender_number || e.fields.trx_id)) {
        setFieldErr({ sender_number: e.fields.sender_number?.[0], trx_id: e.fields.trx_id?.[0] });
        return;
      }
      if (e instanceof ApiError && ['AMOUNT_BELOW_MINIMUM', 'AMOUNT_ABOVE_MAXIMUM', 'DAILY_LIMIT_EXCEEDED', 'AMOUNT_PRECISION', 'VALIDATION_FAILED'].includes(e.code)) {
        setError(errorText(e));
        return;
      }
      if (e instanceof ApiError && e.code === 'DUPLICATE_PROVIDER_TXN') {
        setFieldErr({ trx_id: e.message });
        return;
      }
      if (ch) toast.show({ tone: 'danger', title: 'We couldn’t submit your deposit', body: e instanceof ApiError ? e.message : 'Check your connection and try again.' });
      else toast.show({ tone: 'danger', title: 'We couldn’t reach the payment provider', body: e instanceof ApiError && e.code !== 'PROVIDER_UNAVAILABLE' ? e.message : 'You weren’t charged. Try again or pick another method.' });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    setError(err);
    if (err) return amountRef.current?.focus();
    const fe = validateManual();
    setFieldErr(fe);
    if (fe.sender_number || fe.trx_id) return;
    start.mutate();
  };

  const after = Number(w.available_usd) + (Number.isFinite(n) ? n : 0);
  const amountLabel = Number.isFinite(n) && n > 0 ? formatMoney(n.toFixed(2)) : '$0.00';
  const paused = af.deposits_paused || w.account_status !== 'active' || !choice;

  return (
    <div ref={root} className="space-y-6">
      <div className="grid gap-4 tablet:grid-cols-2 desktop:gap-6">
        <div data-stagger>
          <StatCard
            type="balance"
            label="Balance"
            value={formatMoney(w.available_usd)}
            countUp
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

      <div className="grid grid-cols-1 gap-6 desktop:grid-cols-[minmax(0,1fr)_minmax(0,360px)] [&>*]:min-w-0">
        <section ref={formRef} data-stagger aria-labelledby="af-h" className="scroll-mt-28 rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-8">
          <h2 id="af-h" className="font-display text-h4 text-fg">
            Add funds
          </h2>
          <p className="mt-1 text-body-sm text-fg-secondary">Deposits fund your jobs. Budget for unused slots comes back to your balance when the job closes or ends.</p>
          {paused ? (
            <p role="status" className="mt-4 rounded-[12px] bg-warning-subtle px-4 py-3 text-body-sm text-fg-warning">
              {af.deposits_paused ? 'Deposits are paused right now. Try again later.' : 'Deposits are paused on your account. Contact support.'}
            </p>
          ) : null}
          <form onSubmit={submit} noValidate className="mt-6 space-y-6">
            <fieldset>
              <legend className="mb-2 text-label-md text-fg">Payment method</legend>
              {tiles.length ? (
                <div className="grid grid-cols-2 gap-3 tablet:grid-cols-3">
                  {tiles.map((t) => {
                    const on = choice === t.id;
                    return (
                      <label
                        key={t.id}
                        className={cn(
                          'relative flex min-h-[72px] cursor-pointer flex-col justify-center rounded-[12px] border p-4 transition-colors has-[:focus-visible]:shadow-focus',
                          on ? 'border-[1.5px] border-line-brand bg-brand-subtle' : 'border-line bg-surface hover:border-line-strong',
                        )}
                      >
                        <input type="radio" name="method" className="sr-only" checked={on} onChange={() => setChoice(t.id)} />
                        <span className="text-label-md text-fg">{t.label}</span>
                        <span className="mt-0.5 text-body-xs text-fg-tertiary">{t.sub}</span>
                        {on ? (
                          <span aria-hidden className="absolute right-3 top-3 grid size-5 place-items-center rounded-full bg-brand text-fg-on-brand">
                            <Icon name="check" size={12} strokeWidth={3} />
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p role="status" className="rounded-[12px] bg-warning-subtle px-4 py-3 text-body-sm text-fg-warning">
                  No payment method is available right now. Contact support to add funds.
                </p>
              )}
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

            {ch ? (
              <div className="space-y-4 rounded-[14px] border border-line-brand/40 bg-brand-subtle/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-label-md text-fg">
                    Send to our {ch.account_label}
                    {ch.account_type ? <span className="font-normal text-fg-secondary"> · {ch.account_type}</span> : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(ch.account);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="flex items-center gap-1.5 rounded-[8px] bg-brand px-3 py-1.5 text-label-sm text-fg-on-brand transition-opacity hover:opacity-90 focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    <Icon name="copy" size={14} />
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-[10px] border border-line bg-surface p-3">
                  <span className={cn('min-w-0 break-all font-mono font-bold text-fg', ch.account.length > 20 ? 'text-body-md' : 'text-h4 tracking-wider')}>{ch.account}</span>
                  <span className="text-body-sm text-fg-secondary">
                    Send exactly <span className="font-semibold tabular-nums text-fg">{sendLabel}</span>
                  </span>
                </div>
                <p className="text-body-xs text-fg-secondary">{ch.instructions}</p>

                <div className="grid gap-3 tablet:grid-cols-2">
                  <label className="block min-w-0">
                    <span className="mb-1 block text-label-sm text-fg">{ch.sender_label}</span>
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder={ch.sender_placeholder}
                      value={senderNumber}
                      aria-invalid={fieldErr.sender_number ? true : undefined}
                      aria-describedby={fieldErr.sender_number ? 'sender-err' : undefined}
                      onChange={(e) => {
                        setSenderNumber(e.target.value);
                        setFieldErr((f) => ({ ...f, sender_number: undefined }));
                      }}
                      className={cn('h-11 w-full rounded-[10px] border bg-surface px-3 font-mono text-body-sm outline-none focus:border-line-brand focus:shadow-focus', fieldErr.sender_number ? 'border-line-danger' : 'border-line')}
                    />
                    {fieldErr.sender_number ? <span id="sender-err" className="mt-1 block text-body-xs text-fg-danger">{fieldErr.sender_number}</span> : null}
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1 block text-label-sm text-fg">{ch.ref_label}</span>
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder={ch.ref_placeholder}
                      value={trxId}
                      aria-invalid={fieldErr.trx_id ? true : undefined}
                      aria-describedby={fieldErr.trx_id ? 'trx-err' : undefined}
                      onChange={(e) => {
                        setTrxId(e.target.value.toUpperCase());
                        setFieldErr((f) => ({ ...f, trx_id: undefined }));
                      }}
                      className={cn('h-11 w-full rounded-[10px] border bg-surface px-3 font-mono text-body-sm uppercase outline-none focus:border-line-brand focus:shadow-focus', fieldErr.trx_id ? 'border-line-danger' : 'border-line')}
                    />
                    {fieldErr.trx_id ? <span id="trx-err" className="mt-1 block text-body-xs text-fg-danger">{fieldErr.trx_id}</span> : null}
                  </label>
                </div>
              </div>
            ) : null}

            <dl className="rounded-[14px] bg-subtle px-5 py-4 text-body-sm">
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-fg-secondary">Deposit</dt>
                <dd className="font-semibold tabular-nums text-fg">{Number.isFinite(n) ? formatMoney(n.toFixed(2)) : '—'}</dd>
              </div>
              {ch ? (
                <div className="flex justify-between gap-3 py-1.5">
                  <dt className="text-fg-secondary">You send{ch.currency === 'BDT' ? ` (1 USD = ৳${Number(ch.deposit_fx_rate).toFixed(0)})` : ''}</dt>
                  <dd className="font-semibold tabular-nums text-fg">{sendLabel}</dd>
                </div>
              ) : (
                <div className="flex justify-between gap-3 py-1.5">
                  <dt className="text-fg-secondary">Processing fee</dt>
                  <dd className="text-right font-semibold text-fg">Shown by payment provider</dd>
                </div>
              )}
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
              for exceptions. {ch ? 'We check your payment and add it to your balance, usually within a few hours.' : 'You’re redirected to the provider to pay securely.'}
            </p>

            <Button type="submit" size="L" fullWidth loading={start.isPending} loadingText={ch ? 'Submitting…' : 'Redirecting…'} disabled={paused} disabledReasonId="dep-paused">
              {/* Phone: short label so it fits on one line. Tablet+: the full label. */}
              <span className="tablet:hidden">{ch ? `I’ve sent ${amountLabel} · Submit` : `Pay ${amountLabel}`}</span>
              <span className="hidden tablet:inline">{ch ? `I’ve sent it · Submit ${ch.label} deposit · ${amountLabel}` : `Continue to payment · ${amountLabel}`}</span>
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
                ['When you publish', 'The job’s full budget is deducted from your balance (reward × slots).'],
                ['When you approve', 'The reward moves to the worker.'],
                ['When a job closes or ends', 'Budget for unused slots comes back to your balance.'],
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
