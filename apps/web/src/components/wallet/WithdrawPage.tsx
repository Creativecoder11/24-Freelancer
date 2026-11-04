'use client';
/** SCR-WAL-02 Withdraw funds (Figma 41:753, mobile 48:1238) and SCR-WAL-03 success dialog (41:989). */
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime, formatMoney, type PayoutMethodType } from '@24f/shared';
import { Alert, AmountInput, Button, Dialog, Field, OtpInput, PasswordField, SelectableCard, Skeleton, StickyActionBar, cn, toast } from '@24f/ui';
import { useWorkerHeader } from '@/components/worker/shell';
import { LoadError } from '@/components/worker/ui';
import { useMe } from '@/lib/auth/session';
import { apiFetch, ApiError } from '@/lib/api/client';
import { newIdemKey, useInvalidateWallet, usePayoutMethods, useWallet, wal, type Quote, type WithdrawalCreated } from './api';
import { ACCOUNT_HELPER, AddPayoutMethodDialog, accountError, groupPhone } from './PayoutMethodDialogs';

const HEADER = { title: 'Withdraw', subtitle: 'Send your earnings to a payout method you control.', backHref: '/worker/wallet', hideTabBar: true };

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function WithdrawPage() {
  useWorkerHeader(HEADER);
  const router = useRouter();
  const me = useMe();
  const wallet = useWallet();
  const pm = usePayoutMethods();
  const invalidate = useInvalidateWallet();

  const configs = pm.data?.meta.method_configs ?? [];
  const disabled = pm.data?.meta.disabled_methods ?? [];
  const saved = useMemo(() => (pm.data?.data ?? []).filter((m) => m.method_enabled && m.status !== 'disabled'), [pm.data]);

  const [type, setType] = useState<PayoutMethodType | null>(null);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [newAccount, setNewAccount] = useState('');
  const [amount, setAmount] = useState('10.00');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; password?: string; account?: string }>({});
  const [rateChanged, setRateChanged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<WithdrawalCreated | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [otp, setOtp] = useState<{ challenge_id: string; destination_masked: string } | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const idem = useRef(newIdemKey('wd'));

  // Default selection: the saved default method (Doc 08 §6.4.1).
  useEffect(() => {
    if (type || !pm.data) return;
    const def = saved.find((m) => m.is_default) ?? saved[0];
    const t = def?.method_type ?? configs[0]?.method_type ?? null;
    setType(t);
    setMethodId(def?.id ?? null);
    const cfg = configs.find((c) => c.method_type === t);
    if (cfg && wallet.data && Number(wallet.data.available_usd) < 10) setAmount(cfg.min_usd);
  }, [pm.data, saved, configs, type, wallet.data]);

  const cfg = configs.find((c) => c.method_type === type);
  const ofType = saved.filter((m) => m.method_type === type);
  const method = saved.find((m) => m.id === methodId) ?? null;

  const pickType = (t: PayoutMethodType) => {
    setType(t);
    const first = saved.filter((m) => m.method_type === t).sort((a, b) => Number(b.is_default) - Number(a.is_default))[0];
    setMethodId(first?.id ?? null);
    setTyping(!first);
    setNewAccount('');
    setErrors({});
  };

  // Live quote (300 ms debounce; re-quotes when it expires, BR-WDQ-01).
  const dAmount = useDebounced(amount);
  const amountOk = /^\d+(\.\d{1,2})?$/.test(dAmount) && Number(dAmount) > 0;
  const previewAccount = typing && !accountError(type ?? 'bkash', newAccount) ? newAccount.replace(/\s/g, '') : undefined;
  const quoteParams = methodId && !typing ? { payout_method_id: methodId } : type ? { method: type, account: previewAccount } : null;
  const quote = useQuery<Quote, ApiError>({
    queryKey: wal.quote(JSON.stringify({ quoteParams, a: amountOk ? dAmount : '' })),
    queryFn: async () => (await apiFetch<Quote>('/withdrawals/quote', { query: { ...quoteParams, amount: amountOk ? dAmount : undefined } })).data,
    enabled: !!quoteParams,
    retry: false,
    staleTime: 0,
  });
  const q = quote.data;
  useEffect(() => {
    if (!q) return;
    const ms = new Date(q.expires_at).getTime() - Date.now();
    const t = setTimeout(() => quote.refetch(), Math.max(ms - 5_000, 5_000));
    return () => clearTimeout(t);
  }, [q, quote]);
  const quoteErr = quote.error?.fields?.amount_usd?.[0] ?? (quote.error && quote.error.code !== 'VALIDATION_FAILED' ? quote.error.message : undefined);
  const amountError = errors.amount ?? (amountOk ? quoteErr : amount && dAmount === amount ? 'Use at most 2 decimal places.' : undefined);

  const w = wallet.data;
  const kyc = w?.kyc_status ?? 'not_submitted';
  const restricted = me.data?.status === 'restricted';
  const belowAll = !!w && !!w.min_withdrawal_usd && Number(w.available_usd) < Number(w.min_withdrawal_usd);
  const cooldownUntil = method?.in_cooldown ? method.usable_from : null;
  const gated = kyc !== 'verified' || restricted || belowAll;
  const fresh = !!q && !!q.quote_id && q.amount_usd === Number(amount).toFixed(2) && !quote.isFetching && !quote.isError;
  const canSubmit = !gated && !!method && !typing && !cooldownUntil && method.status === 'active' && fresh && !!password && !submitting;
  const amountLabel = amountOk ? formatMoney(Number(amount).toFixed(2)) : '$0.00';

  const allAmount = q?.all_amount_usd ?? w?.available_usd ?? '0.00';
  const chips = [...(cfg?.quick_amounts_usd ?? []).map((v) => ({ label: formatMoney(v), value: v })), { label: `All · ${formatMoney(allAmount)}`, value: allAmount }];
  const usdt = type === 'usdt_trc20';
  const inline = q?.receive_label && amountOk && !quoteErr ? (usdt ? q.receive_label : `≈ ${q.receive_label}`) : undefined;

  const submit = async () => {
    if (!method || !q?.quote_id) return;
    if (!password) return setErrors((s) => ({ ...s, password: 'Enter your account password.' }));
    setSubmitting(true);
    setErrors({});
    setRateChanged(false);
    try {
      const body: Record<string, string> = { payout_method_id: method.id, amount_usd: Number(amount).toFixed(2), quote_id: q.quote_id, password };
      if (otp && otpCode.length === 6) {
        body.otp_challenge_id = otp.challenge_id;
        body.otp_code = otpCode;
      }
      const r = await apiFetch<WithdrawalCreated>('/withdrawals', { method: 'POST', body, headers: { 'Idempotency-Key': idem.current } });
      setOtp(null);
      setDone(r.data);
      setPassword('');
      idem.current = newIdemKey('wd');
      invalidate();
    } catch (e) {
      if (!(e instanceof ApiError)) {
        toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Your changes are still here. Try again. Nothing was deducted.' });
      } else if (e.code === 'INVALID_PASSWORD') setErrors({ password: 'That password isn’t right. Nothing was sent.' });
      else if (e.code === 'TOO_MANY_ATTEMPTS') setErrors({ password: 'Too many attempts. Try again in 15 minutes.' });
      else if (e.code === 'QUOTE_EXPIRED') {
        setRateChanged(true);
        void quote.refetch();
      } else if (e.code === 'OTP_REQUIRED') {
        setOtp({ challenge_id: String(e.details.challenge_id), destination_masked: String(e.details.destination_masked ?? '') });
        setOtpCode('');
      } else if (e.fields.amount_usd) setErrors({ amount: e.fields.amount_usd[0] });
      else if (e.code === 'PAYOUT_METHOD_COOLDOWN' || e.code === 'PAYOUT_METHOD_INVALID' || e.code === 'METHOD_UNAVAILABLE') setErrors({ account: e.message });
      else if (e.code === 'KYC_REQUIRED' || e.code === 'ACCOUNT_RESTRICTED' || e.code === 'FEATURE_DISABLED') toast.show({ tone: 'warning', title: e.message });
      else toast.show({ tone: 'danger', title: 'That didn’t save', body: `${e.message} Nothing was deducted.` });
    } finally {
      setSubmitting(false);
    }
  };

  if (wallet.isError || pm.isError) return <LoadError error={wallet.error ?? pm.error} onRetry={() => (wallet.refetch(), pm.refetch())} />;
  if (!w || !pm.data) return <WithdrawSkeleton />;

  return (
    <div className="mx-auto grid w-full max-w-[1104px] gap-6 pb-28 desktop:grid-cols-[minmax(0,720px)_minmax(0,360px)] desktop:pb-0">
      <div className="flex min-w-0 flex-col gap-4">
        {/* Mobile balance card (48:1238) */}
        <div className="rounded-card bg-inverse px-5 py-4 tablet:hidden">
          <p className="text-body-sm text-fg-inverse-secondary">Available to withdraw</p>
          <p className="mt-1 font-display text-num-lg text-fg-inverse tabular-nums">{formatMoney(w.available_usd)}</p>
        </div>
        {kyc === 'not_submitted' || kyc === 'rejected' ? (
          <Alert
            tone="warning"
            title="Verify your identity to withdraw"
            action={
              <Button size="S" href="/worker/settings?kyc=1#verification">
                Verify identity
              </Button>
            }
          >
            Required before your first withdrawal. Your documents are only used to confirm your identity.
          </Alert>
        ) : kyc === 'pending' ? (
          <Alert tone="info" title="We’re checking your documents">
            We’ll review within 24 h and notify you.
          </Alert>
        ) : null}
        {restricted ? (
          <Alert tone="warning" title="Your account is restricted" action={<Button size="S" variant="secondary" href="/help#live-support">Contact support</Button>}>
            You can sign in, but you can’t start jobs, publish or withdraw right now. Contact support to appeal.
          </Alert>
        ) : null}
        {belowAll ? <Alert tone="info">Your balance is under the minimum for every method. Keep earning and try again.</Alert> : null}
        {rateChanged ? <Alert tone="info">The rate just changed. Check the new amount before you confirm.</Alert> : null}

        <form
          aria-label="Withdraw funds"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-6 rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-8"
        >
          <fieldset disabled={gated} className="flex min-w-0 flex-col gap-6 disabled:opacity-60">
            <legend className="mb-4 font-display text-h4 text-fg max-tablet:text-label-lg">
              <span className="hidden tablet:inline">Where should we send it?</span>
              <span className="tablet:hidden">Send to</span>
            </legend>
            <div className="-mt-2 grid grid-cols-2 gap-3 tablet:grid-cols-4">
              {configs.map((c) => (
                <SelectableCard key={c.method_type} type="radio" name="method" value={c.method_type} checked={type === c.method_type} onChange={() => pickType(c.method_type)} title={c.display_name} subtitle={c.subtitle} className="!py-3" />
              ))}
              {disabled.map((c) => (
                <SelectableCard key={c.method_type} type="radio" name="method" value={c.method_type} checked={false} onChange={() => undefined} title={c.display_name} subtitle={c.subtitle} disabled disabledReason="Not available yet" className="!py-3" />
              ))}
            </div>

            {cfg ? (
              <div className="flex flex-col gap-2">
                {ofType.length && !typing ? (
                  <>
                    <Field
                      label={cfg.account_label}
                      leadingIcon={usdt ? 'link' : 'phone'}
                      value={method?.account_masked ?? ''}
                      readOnly
                      readOnlyStyle
                      error={errors.account}
                      helper={usdt ? ACCOUNT_HELPER.usdt : ACCOUNT_HELPER.mobile}
                      labelAction={
                        <button type="button" className="text-label-sm text-fg-brand hover:underline" onClick={() => (setTyping(true), setNewAccount(''))}>
                          Use a different {usdt ? 'address' : 'number'}
                        </button>
                      }
                    />
                    {ofType.length > 1 ? (
                      <div role="radiogroup" aria-label="Saved accounts" className="flex flex-wrap gap-2">
                        {ofType.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            role="radio"
                            aria-checked={m.id === methodId}
                            onClick={() => setMethodId(m.id)}
                            className={cn('h-9 rounded-[18px] px-3 text-label-sm', m.id === methodId ? 'border-[1.5px] border-line-brand bg-brand-subtle text-fg-brand' : 'border border-line text-fg-secondary')}
                          >
                            {m.destination_label}
                            {m.is_default ? ' · Default' : ''}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {cooldownUntil ? <p className="text-body-sm text-fg-warning">You can use this {usdt ? 'address' : 'number'} from {formatDateTime(cooldownUntil)}.</p> : null}
                    {method?.status === 'pending_review' ? <p className="text-body-sm text-fg-warning">This account is being checked by our team before you can use it.</p> : null}
                  </>
                ) : (
                  <>
                    <Field
                      label={cfg.account_label}
                      leadingIcon={usdt ? 'link' : 'phone'}
                      inputMode={usdt ? 'text' : 'tel'}
                      autoComplete="off"
                      placeholder={usdt ? 'T…' : '01X XXXX XXXX'}
                      value={newAccount}
                      onChange={(e) => setNewAccount(usdt ? e.target.value.trim() : groupPhone(e.target.value))}
                      onBlur={() => newAccount && setErrors((s) => ({ ...s, account: accountError(cfg.method_type, newAccount) ?? undefined }))}
                      error={errors.account}
                      helper={usdt ? ACCOUNT_HELPER.usdt : ACCOUNT_HELPER.mobile}
                      labelAction={
                        ofType.length ? (
                          <button type="button" className="text-label-sm text-fg-brand hover:underline" onClick={() => setTyping(false)}>
                            Use saved
                          </button>
                        ) : undefined
                      }
                    />
                    <Alert
                      tone="warning"
                      action={
                        <Button size="S" variant="secondary" onClick={() => setSaveOpen(true)} disabled={!!newAccount && !!accountError(cfg.method_type, newAccount)}>
                          Save number
                        </Button>
                      }
                    >
                      New {usdt ? 'address' : 'number'}. You can withdraw to it 24 hours after saving.
                    </Alert>
                  </>
                )}
              </div>
            ) : null}

            <AmountInput
              label="Amount"
              size="L"
              decimals={2}
              suffix=""
              value={amount}
              onChange={(v) => {
                setAmount(v);
                setErrors((s) => ({ ...s, amount: undefined }));
              }}
              inlineSecondary={inline}
              error={amountError}
              chips={chips}
              availableLabel={`Available: ${formatMoney(w.available_usd)}`}
            />

            <div className="rounded-[14px] bg-subtle p-4 tablet:p-5">
              <p className="text-label-md text-fg">Good to know</p>
              <ul className="mt-3 space-y-2 text-body-md text-fg-secondary">
                <li>
                  Minimum withdrawal for {cfg?.display_name ?? 'this method'}: {formatMoney(cfg?.min_usd ?? '5.00')}
                </li>
                <li>The exchange rate is fixed when you request — not when it’s paid.</li>
                <li>You can cancel while the request is still “Requested”.</li>
              </ul>
            </div>

            <PasswordField
              label="Confirm with your password"
              leadingIcon="shield-check"
              placeholder="Enter your account password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrors((s) => ({ ...s, password: undefined }));
              }}
              error={errors.password}
              helper="Required for every withdrawal to protect your balance."
            />
          </fieldset>
          <div className="hidden tablet:block">
            <Button type="submit" size="L" fullWidth disabled={!canSubmit} loading={submitting} loadingText="Sending request…">
              Request withdrawal · {amountLabel}
            </Button>
          </div>
        </form>
      </div>

      <Summary quote={q} loading={quote.isFetching || !!quoteErr} methodLabel={method?.destination_label ?? q?.method_label ?? cfg?.display_name ?? '—'} amountLabel={amountLabel} usdt={usdt} />

      <StickyActionBar className="tablet:hidden">
        <Button size="L" fullWidth disabled={!canSubmit} loading={submitting} onClick={() => void submit()}>
          Request withdrawal · {amountLabel}
        </Button>
      </StickyActionBar>

      <Dialog
        open={!!done}
        onOpenChange={(o) => {
          if (!o) router.push('/worker/wallet');
        }}
        type="success"
        title="Withdrawal requested"
        mobile="sheet"
        description={
          done ? (
            <>
              <p>
                {formatMoney(done.amount_usd)} ({done.payout_currency === 'BDT' ? `≈ ${done.receive_label}` : done.receive_label}) is on its way to {done.destination_masked}. We’ll notify you when it’s paid — usually within 24 hours. Track it in{' '}
                <NextLink href={`/worker/wallet/withdrawals?ref=${done.ref}`} className="font-semibold text-fg-brand hover:underline">
                  Withdrawal history
                </NextLink>
                .
              </p>
              {done.warning_code === 'WITHDRAWAL_UNDER_REVIEW' ? <p className="mt-3 text-body-sm text-fg-warning">We review first withdrawals, so this one can take up to 48 hours.</p> : null}
            </>
          ) : null
        }
        footer={
          <Button size="M" onClick={() => router.push('/worker/wallet')}>
            Done
          </Button>
        }
      />

      <Dialog
        open={!!otp}
        onOpenChange={(o) => !o && setOtp(null)}
        type="form"
        title="Enter the code we sent you"
        description={otp ? `We sent a 6-digit code to ${otp.destination_masked}. It’s needed once, before your first withdrawal.` : undefined}
        busy={submitting}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOtp(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={otpCode.length !== 6} loading={submitting}>
              Confirm withdrawal
            </Button>
          </>
        }
      >
        <OtpInput value={otpCode} onChange={setOtpCode} autoFocus />
      </Dialog>

      <AddPayoutMethodDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        initialType={type ?? undefined}
        initialAccount={newAccount}
        onSaved={(m) => {
          setTyping(false);
          setMethodId(m.id);
        }}
      />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={cn('text-body-md', strong ? 'text-label-md text-fg' : 'text-fg-secondary')}>{label}</dt>
      <dd className={cn('text-right tabular-nums', strong ? '' : 'text-label-md text-fg')}>{value}</dd>
    </div>
  );
}

function Summary({ quote, loading, methodLabel, amountLabel, usdt }: { quote?: Quote; loading: boolean; methodLabel: string; amountLabel: string; usdt: boolean }) {
  const v = (s: string | null | undefined) => (loading || !s ? <Skeleton width={64} height={16} className="inline-block align-middle" /> : s);
  return (
    <aside aria-label="Summary" className="h-fit rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6 desktop:sticky desktop:top-[100px]">
      <h2 className="text-label-lg text-fg">Summary</h2>
      <dl className="mt-5 space-y-4">
        <Row label="Method" value={methodLabel} />
        <Row label="Amount" value={amountLabel} />
        <Row label="Processing fee" value={v(quote ? formatMoney(quote.fee_usd) : null)} />
        {!usdt || quote?.fx_rate !== '1.00' ? <Row label="Exchange rate" value={v(quote?.fx_rate_label)} /> : <Row label="Exchange rate" value="1 USD = 1 USDT" />}
      </dl>
      <div className="my-5 border-t border-line-subtle" />
      <dl className="space-y-4">
        <Row label="You receive" strong value={<span className="font-display text-num-lg text-fg-success">{loading || !quote?.receive_label ? <Skeleton width={90} height={28} /> : quote.receive_label}</span>} />
        <Row label="Balance after" value={v(quote ? formatMoney(quote.balance_after_usd) : null)} />
      </dl>
      <p className="mt-5 rounded-[12px] bg-brand-subtle px-3 py-4 text-label-md text-fg">{quote?.eta_text ?? 'Usually arrives within 24 hours'}</p>
    </aside>
  );
}

function WithdrawSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-[1104px] gap-6 desktop:grid-cols-[minmax(0,720px)_minmax(0,360px)]" aria-busy="true">
      <div className="rounded-card border border-line bg-surface p-8">
        <Skeleton width={260} height={24} />
        <div className="mt-6 grid grid-cols-2 gap-3 tablet:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={58} radius={14} />
          ))}
        </div>
        <Skeleton.Form fields={3} />
      </div>
      <div className="rounded-card border border-line bg-surface p-6">
        <Skeleton width={120} height={20} />
        <Skeleton height={200} className="mt-6" />
      </div>
    </div>
  );
}
