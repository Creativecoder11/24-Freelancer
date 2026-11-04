'use client';
/** Settings sections shared by worker and employer: Security, Notifications, Close account. */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRelative, type Me, type NotificationPreferences, type NotificationPreferenceRow, type SessionRow, type CloseBlockerRow } from '@24f/shared';
import { Alert, Button, Dialog, Field, LinkButton, PasswordField, Switch, Textarea, toast } from '@24f/ui';
import { api, apiFetch, ApiError, logout } from '@/lib/api/client';
import { meKey } from '@/lib/auth/session';
import { Section, SettingRow } from './SettingsShell';

function monthsAgo(iso: string | null) {
  if (!iso) return 'Not set yet';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'Last changed today';
  if (days < 30) return `Last changed ${days} ${days === 1 ? 'day' : 'days'} ago`;
  const m = Math.floor(days / 30);
  if (m < 12) return `Last changed ${m} ${m === 1 ? 'month' : 'months'} ago`;
  const y = Math.floor(m / 12);
  return `Last changed ${y} ${y === 1 ? 'year' : 'years'} ago`;
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export function SecuritySection({ me, withdrawalRow }: { me: Me; withdrawalRow: boolean }) {
  const qc = useQueryClient();
  const [pwOpen, setPwOpen] = useState(false);
  const [twoStepOff, setTwoStepOff] = useState(false);
  const [signOut, setSignOut] = useState(false);
  const sessions = useQuery<SessionRow[], ApiError>({ queryKey: ['me', 'sessions'], queryFn: () => api.get<SessionRow[]>('/me/sessions') });

  const twoStep = useMutation({
    mutationFn: (body: { two_step_enabled: boolean; password?: string }) => api.patch('/me/security', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meKey });
      toast.show({ tone: 'success', title: 'Changes saved.' });
    },
    onError: () => toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Try again in a moment.' }),
  });

  const others = (sessions.data ?? []).filter((s) => !s.is_current).length;
  return (
    <Section id="security" title="Security">
      <SettingRow
        title="Password"
        description={monthsAgo(me.password_changed_at)}
        control={
          <Button variant="secondary" size="S" onClick={() => setPwOpen(true)}>
            Change
          </Button>
        }
      />
      <SettingRow
        title="Two-step verification"
        description="Ask for a code when signing in on a new device"
        control={<Switch label="Two-step verification" labelHidden checked={me.two_step_enabled} disabled={twoStep.isPending} onCheckedChange={(v) => (v ? twoStep.mutate({ two_step_enabled: true }) : setTwoStepOff(true))} />}
      />
      {withdrawalRow ? (
        <SettingRow
          title="Withdrawal confirmation"
          description="Ask for your password on every withdrawal"
          control={<Switch label="Withdrawal confirmation" labelHidden checked locked lockedReason="Required for every withdrawal to protect your balance." onCheckedChange={() => undefined} />}
        />
      ) : null}
      <SettingRow
        title="Active sessions"
        description={
          sessions.isPending ? (
            'Loading…'
          ) : sessions.isError ? (
            'We couldn’t load your sessions.'
          ) : (
            <ul className="flex flex-col gap-1 tablet:flex-row tablet:flex-wrap tablet:gap-x-6">
              {(sessions.data ?? []).map((s) => (
                <li key={s.id}>
                  {s.device_label}
                  {s.city ? ` · ${s.city}` : ''} · {s.is_current ? 'this device' : formatRelative(s.last_active_at)}
                </li>
              ))}
            </ul>
          )
        }
        control={
          <LinkButton tone="danger" onClick={() => setSignOut(true)} disabled={!others}>
            Sign out others
          </LinkButton>
        }
      />
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
      <PasswordConfirmDialog
        open={twoStepOff}
        onOpenChange={setTwoStepOff}
        title="Turn off two-step verification?"
        description="You won’t be asked for a code when signing in on a new device."
        confirm="Turn off"
        destructive
        run={(password) => api.patch('/me/security', { two_step_enabled: false, password }).then(() => void qc.invalidateQueries({ queryKey: meKey }))}
      />
      <Dialog
        open={signOut}
        onOpenChange={setSignOut}
        type="confirm"
        title="Sign out other devices?"
        description="This device stays signed in."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSignOut(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  await api.post('/me/sessions/revoke-others');
                  toast.show({ tone: 'success', title: 'Other devices signed out.' });
                  void sessions.refetch();
                } catch {
                  toast.show({ tone: 'danger', title: 'That didn’t work', body: 'Try again in a moment.' });
                }
                setSignOut(false);
              }}
            >
              Sign out others
            </Button>
          </>
        }
      />
    </Section>
  );
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [v, setV] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setV({ current_password: '', new_password: '', confirm_password: '' });
      setErr({});
    }
  }, [open]);
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!v.current_password) e.current_password = 'Enter your current password.';
    if (v.new_password.length < 8 || !/\d/.test(v.new_password) || !/[^A-Za-z0-9]/.test(v.new_password)) e.new_password = 'Use at least 8 characters with a number and a symbol.';
    if (v.confirm_password !== v.new_password) e.confirm_password = 'These passwords don’t match. Retype to confirm.';
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api.post('/me/password', v);
      toast.show({ tone: 'success', title: 'Password updated', body: 'You’re signed out on other devices.' });
      onOpenChange(false);
    } catch (x) {
      if (x instanceof ApiError && Object.keys(x.fields).length) setErr(Object.fromEntries(Object.entries(x.fields).map(([k, m]) => [k, m[0]!])));
      else if (x instanceof ApiError && x.code === 'INVALID_PASSWORD') setErr({ current_password: 'That password isn’t right.' });
      else setErr({ root: x instanceof ApiError ? x.message : 'That didn’t save. Try again.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      type="form"
      title="Change password"
      busy={busy}
      dirty={!!(v.current_password || v.new_password)}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Update password
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => (e.preventDefault(), void submit())}>
        {err.root ? <Alert tone="danger">{err.root}</Alert> : null}
        <PasswordField label="Current password" autoComplete="current-password" value={v.current_password} onChange={(e) => setV({ ...v, current_password: e.target.value })} error={err.current_password} />
        <PasswordField label="New password" autoComplete="new-password" showStrength value={v.new_password} onChange={(e) => setV({ ...v, new_password: e.target.value })} error={err.new_password} />
        <PasswordField label="Confirm new password" autoComplete="new-password" value={v.confirm_password} onChange={(e) => setV({ ...v, confirm_password: e.target.value })} error={err.confirm_password} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function PasswordConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  destructive,
  run,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  confirm: string;
  destructive?: boolean;
  run: (password: string) => Promise<unknown>;
}) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) (setPw(''), setError(undefined));
  }, [open]);
  const go = async () => {
    if (!pw) return setError('Enter your account password.');
    setBusy(true);
    try {
      await run(pw);
      toast.show({ tone: 'success', title: 'Changes saved.' });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'INVALID_PASSWORD' ? 'That password isn’t right.' : e instanceof ApiError ? e.message : 'That didn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      type={destructive ? 'destructive' : 'confirm'}
      title={title}
      description={description}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={go} loading={busy}>
            {confirm}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), void go())}>
        <PasswordField label="Confirm with your password" leadingIcon="shield-check" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} error={error} />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Notifications (same data and lock as SCR-WRK-09, C-11)
// ---------------------------------------------------------------------------

export function NotificationsSection({ audience, subtitle }: { audience: 'worker' | 'employer'; subtitle?: string }) {
  const qc = useQueryClient();
  const prefs = useQuery<NotificationPreferences, ApiError>({ queryKey: ['notifications', 'preferences'], queryFn: () => api.get<NotificationPreferences>('/notifications/preferences') });
  const save = useMutation({
    mutationFn: (row: { pref_key: string; enabled: boolean }) => api.put<NotificationPreferences>('/notifications/preferences', { preferences: [row] }),
    onMutate: async (row) => {
      await qc.cancelQueries({ queryKey: ['notifications', 'preferences'] });
      const prev = qc.getQueryData<NotificationPreferences>(['notifications', 'preferences']);
      if (prev) {
        const patch = (rows: NotificationPreferenceRow[]) => rows.map((r) => (r.pref_key === row.pref_key ? { ...r, in_app_enabled: row.enabled, email_enabled: row.enabled } : r));
        qc.setQueryData(['notifications', 'preferences'], { worker: patch(prev.worker), employer: patch(prev.employer) });
      }
      return { prev };
    },
    onError: (_e, _r, ctx) => {
      if (ctx?.prev) qc.setQueryData(['notifications', 'preferences'], ctx.prev);
      toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Try again in a moment.' });
    },
    onSuccess: (data) => {
      qc.setQueryData(['notifications', 'preferences'], data);
      toast.show({ tone: 'success', title: 'Preferences saved.' });
    },
  });
  const rows = prefs.data?.[audience] ?? [];
  return (
    <Section id="notifications" title="Notifications" subtitle={subtitle}>
      {prefs.isError ? (
        <p className="text-body-sm text-fg-tertiary">
          We couldn’t load your preferences.{' '}
          <LinkButton onClick={() => prefs.refetch()}>Try again</LinkButton>
        </p>
      ) : !prefs.data ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="block h-10 rounded-[8px] bg-muted" />
          ))}
        </div>
      ) : (
        rows.map((r) => (
          <SettingRow
            key={r.pref_key}
            title={r.label}
            description={r.helper ?? (r.is_locked ? 'Payout and security alerts can’t be turned off.' : undefined)}
            control={
              <Switch
                label={r.label}
                labelHidden
                checked={r.in_app_enabled}
                locked={r.is_locked}
                lockedReason={r.is_locked ? 'Payout and security alerts can’t be turned off.' : undefined}
                onCheckedChange={(v) => save.mutate({ pref_key: r.pref_key, enabled: v })}
              />
            }
          />
        ))
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Close account (G-07)
// ---------------------------------------------------------------------------

export function CloseAccountSection({ embedded }: { embedded?: boolean }) {
  const [open, setOpen] = useState(false);
  const body = (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h3 className={embedded ? 'text-label-md text-fg' : 'font-display text-h4 text-fg'} id="close-title">
          Close account
        </h3>
        <p className="mt-1 text-body-md text-fg-secondary">Withdraw your balance first. Closing is permanent and can’t be undone.</p>
      </div>
      <Button variant="destructive" size="M" onClick={() => setOpen(true)}>
        Close account
      </Button>
      <CloseAccountDialog open={open} onOpenChange={setOpen} />
    </div>
  );
  if (embedded) return <div className="mt-6 border-t border-line-subtle pt-6">{body}</div>;
  return (
    <section id="close-account" aria-labelledby="close-title" className="scroll-mt-[100px] rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-8">
      {body}
    </section>
  );
}

function CloseAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const check = useQuery<{ can_close: boolean; blockers: CloseBlockerRow[] }, ApiError>({
    queryKey: ['me', 'close-check'],
    queryFn: () => api.post('/me/close', { dry_run: true }),
    enabled: open,
    staleTime: 0,
  });
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) (setReason(''), setPassword(''), setConfirm(''), setErr({}));
  }, [open]);
  const blockers = check.data?.blockers ?? [];
  const blocked = !check.data || blockers.length > 0;
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!password) e.password = 'Enter your account password.';
    if (confirm.trim().toUpperCase() !== 'CLOSE') e.confirm_text = 'Type CLOSE to confirm.';
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await apiFetch('/me/close', { method: 'POST', body: { dry_run: false, password, confirm_text: confirm, reason: reason || undefined } });
      await logout();
      qc.clear();
      toast.show({ tone: 'info', title: 'Your account is closed.' });
      router.replace('/');
    } catch (x) {
      if (x instanceof ApiError && x.code === 'INVALID_PASSWORD') setErr({ password: 'That password isn’t right.' });
      else if (x instanceof ApiError && x.code === 'CLOSE_BLOCKED') void check.refetch();
      else setErr({ root: x instanceof ApiError ? x.message : 'That didn’t work. Try again.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      type="destructive"
      title="Close your account?"
      description="Closing is permanent and can’t be undone."
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep my account
          </Button>
          <Button variant="destructive" onClick={submit} loading={busy} disabled={blocked}>
            Close account
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {check.isPending ? <p className="text-body-sm text-fg-tertiary">Checking your account…</p> : null}
        {blockers.length ? (
          <Alert tone="warning" title="You can’t close this account yet">
            <ul className="mt-1 space-y-1.5">
              {blockers.map((b) => (
                <li key={b.code}>
                  {b.message}{' '}
                  <a href={b.action_path} className="font-semibold text-fg-brand hover:underline">
                    Fix this
                  </a>
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {err.root ? <Alert tone="danger">{err.root}</Alert> : null}
        <fieldset disabled={blocked} className="flex flex-col gap-4 disabled:opacity-60">
          <Textarea label="Why are you leaving?" optional value={reason} onChange={(e) => setReason(e.target.value)} softMax={500} rows={3} />
          <PasswordField label="Confirm with your password" leadingIcon="shield-check" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={err.password} />
          <Field label="Type CLOSE to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={err.confirm_text} autoComplete="off" />
        </fieldset>
      </div>
    </Dialog>
  );
}
