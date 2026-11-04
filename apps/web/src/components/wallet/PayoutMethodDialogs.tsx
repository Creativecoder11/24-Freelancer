'use client';
/**
 * Payout method dialogs (G-04, Doc 08 §6.3): Add (or Edit = add the new account, then remove the
 * old one), Make default and Remove. Every action re-asks for the password (G-V6).
 */
import { useEffect, useState } from 'react';
import { payoutAccountValid, formatDateTime, type PayoutMethodType } from '@24f/shared';
import { Alert, Button, Checkbox, Dialog, Field, PasswordField, SelectableCard, toast } from '@24f/ui';
import { api, apiFetch, ApiError } from '@/lib/api/client';
import { useInvalidateWallet, usePayoutMethods, type PayoutMethod } from './api';

const ACCOUNT_ERROR: Record<PayoutMethodType, string> = {
  bkash: 'Enter an 11-digit bKash personal number, like 01712345569.',
  nagad: 'Enter an 11-digit Nagad personal number, like 01512345105.',
  rocket: 'Enter your 11-digit Rocket number (or 12-digit Rocket account).',
  usdt_trc20: 'Enter a TRC20 address. It starts with T and has 34 characters.',
};

export const ACCOUNT_HELPER: Record<'mobile' | 'usdt', string> = {
  mobile: 'Payments to a wrong number can’t be reversed. Double-check it.',
  usdt: 'TRC20 only. Payments to a wrong address can’t be reversed.',
};

/** "017 1234 5569" grouping while typing (Doc 08 §6.4.2 display format). */
export function groupPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 12);
  return [d.slice(0, 3), d.slice(3, 7), d.slice(7)].filter(Boolean).join(' ');
}

export function accountError(method: PayoutMethodType, raw: string): string | null {
  const v = method === 'usdt_trc20' ? raw.trim() : raw.replace(/[\s-]/g, '');
  if (!v) return 'Enter the account number.';
  return payoutAccountValid(method, v) ? null : ACCOUNT_ERROR[method];
}

function passwordError(e: unknown) {
  if (e instanceof ApiError && e.code === 'INVALID_PASSWORD') return 'That password isn’t right.';
  if (e instanceof ApiError && e.code === 'TOO_MANY_ATTEMPTS') return 'Too many attempts. Try again in 15 minutes or reset your password.';
  return null;
}

export function AddPayoutMethodDialog({
  open,
  onOpenChange,
  replace,
  onSaved,
  initialType,
  initialAccount,
}: {
  initialType?: PayoutMethodType;
  initialAccount?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Edit mode: the saved method being replaced (its type is preselected). */
  replace?: PayoutMethod | null;
  onSaved?: (m: PayoutMethod) => void;
}) {
  const methods = usePayoutMethods();
  const invalidate = useInvalidateWallet();
  const configs = methods.data?.meta.method_configs ?? [];
  const disabled = methods.data?.meta.disabled_methods ?? [];
  const [type, setType] = useState<PayoutMethodType>('bkash');
  const [account, setAccount] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ account?: string; password?: string; root?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType(replace?.method_type ?? initialType ?? configs[0]?.method_type ?? 'bkash');
    setAccount(initialAccount ?? '');
    setPassword('');
    setMakeDefault(!!replace?.is_default || (methods.data?.data.length ?? 0) === 0);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cfg = configs.find((c) => c.method_type === type);
  const atLimit = !replace && (methods.data?.data.length ?? 0) >= (methods.data?.meta.limit ?? 5);

  const submit = async () => {
    const accErr = accountError(type, account);
    const next = { account: accErr ?? undefined, password: password ? undefined : 'Enter your account password.' };
    setErrors(next);
    if (next.account || next.password) return;
    setBusy(true);
    try {
      const created = await api.post<PayoutMethod>('/payout-methods', { method_type: type, account: account.trim(), is_default: makeDefault, password });
      if (replace) await apiFetch(`/payout-methods/${replace.id}`, { method: 'DELETE', body: { password } }).catch(() => undefined);
      invalidate();
      toast.show({
        tone: 'success',
        title: replace ? 'Payout method updated' : 'Payout method added',
        body: created.in_cooldown ? `You can withdraw to it from ${formatDateTime(created.usable_from)}.` : `${created.destination_label} is ready to use.`,
      });
      onSaved?.(created);
      onOpenChange(false);
    } catch (e) {
      const pw = passwordError(e);
      if (pw) setErrors({ password: pw });
      else if (e instanceof ApiError && e.fields.account) setErrors({ account: e.fields.account[0] });
      else setErrors({ root: e instanceof ApiError ? e.message : 'That didn’t save. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      type="form"
      title={replace ? 'Change payout method' : 'Add a payout method'}
      description={replace ? 'The new account replaces the old one. You can withdraw to it 24 hours after saving.' : undefined}
      busy={busy}
      dirty={!!account || !!password}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} loadingText="Saving…" disabled={atLimit}>
            {replace ? 'Save method' : 'Add method'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {atLimit ? <Alert tone="warning">You can save up to 5 payout methods. Remove one first.</Alert> : null}
        {errors.root ? <Alert tone="danger">{errors.root}</Alert> : null}
        <fieldset>
          <legend className="mb-2 text-label-md text-fg">Method</legend>
          <div className="grid grid-cols-2 gap-2">
            {configs.map((c) => (
              <SelectableCard
                key={c.method_type}
                type="radio"
                name="pm-type"
                value={c.method_type}
                checked={type === c.method_type}
                onChange={() => {
                  setType(c.method_type);
                  setErrors({});
                }}
                title={c.display_name}
                subtitle={c.subtitle}
                disabled={!!replace && replace.method_type !== c.method_type}
                className="!p-3"
              />
            ))}
            {disabled.map((c) => (
              <SelectableCard key={c.method_type} type="radio" name="pm-type" value={c.method_type} checked={false} onChange={() => undefined} title={c.display_name} subtitle={c.subtitle} disabled disabledReason="Not available yet" className="!p-3" />
            ))}
          </div>
        </fieldset>
        <Field
          label={cfg?.account_label ?? 'Account number'}
          leadingIcon={type === 'usdt_trc20' ? 'link' : 'phone'}
          inputMode={type === 'usdt_trc20' ? 'text' : 'tel'}
          autoComplete="off"
          placeholder={type === 'usdt_trc20' ? 'T…' : '01X XXXX XXXX'}
          value={account}
          onChange={(e) => setAccount(type === 'usdt_trc20' ? e.target.value.trim() : groupPhone(e.target.value))}
          onBlur={() => account && setErrors((s) => ({ ...s, account: accountError(type, account) ?? undefined }))}
          error={errors.account}
          helper={type === 'usdt_trc20' ? ACCOUNT_HELPER.usdt : ACCOUNT_HELPER.mobile}
        />
        <Checkbox label="Make this my default" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
        <PasswordField
          label="Confirm with your password"
          leadingIcon="shield-check"
          placeholder="Enter your account password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Password-confirmed action dialog used for Make default and Remove. */
export function PayoutMethodActionDialog({
  method,
  action,
  onOpenChange,
}: {
  method: PayoutMethod | null;
  action: 'default' | 'remove';
  onOpenChange: (o: boolean) => void;
}) {
  const invalidate = useInvalidateWallet();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [root, setRoot] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPassword('');
    setError(undefined);
    setRoot(undefined);
  }, [method, action]);

  const run = async () => {
    if (!method) return;
    if (!password) return setError('Enter your account password.');
    setBusy(true);
    try {
      if (action === 'default') {
        await api.patch(`/payout-methods/${method.id}`, { is_default: true, password });
        toast.show({ tone: 'success', title: 'Default method updated', body: `${method.destination_label} is now your default.` });
      } else {
        await apiFetch(`/payout-methods/${method.id}`, { method: 'DELETE', body: { password } });
        toast.show({ tone: 'success', title: 'Payout method removed' });
      }
      invalidate();
      onOpenChange(false);
    } catch (e) {
      const pw = passwordError(e);
      if (pw) setError(pw);
      else if (e instanceof ApiError && e.code === 'PAYOUT_METHOD_IN_USE') setRoot('A withdrawal to this method is still on its way. Remove it after that finishes.');
      else setRoot(e instanceof ApiError ? e.message : 'That didn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = action === 'remove';
  return (
    <Dialog
      open={!!method}
      onOpenChange={onOpenChange}
      type={remove ? 'destructive' : 'confirm'}
      title={remove ? 'Remove this payout method?' : 'Make this your default?'}
      description={method ? (remove ? `${method.destination_label} will no longer appear when you withdraw.` : `${method.destination_label} will be selected first when you withdraw.`) : undefined}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {remove ? 'Keep it' : 'Cancel'}
          </Button>
          <Button variant={remove ? 'destructive' : 'primary'} onClick={run} loading={busy}>
            {remove ? 'Remove' : 'Make default'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {root ? <Alert tone="danger">{root}</Alert> : null}
        <PasswordField label="Confirm with your password" leadingIcon="shield-check" placeholder="Enter your account password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
      </form>
    </Dialog>
  );
}
