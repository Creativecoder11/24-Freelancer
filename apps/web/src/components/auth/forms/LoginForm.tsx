'use client';
import NextLink from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatMmSs, identifier, type LoginResponse, type OtpChallengeResponse } from '@24f/shared';
import { Alert, Button, Checkbox, Field, PasswordField, SegmentedControl } from '@24f/ui';
import { api } from '@/lib/api/client';
import { applyServerError } from '@/lib/form-errors';
import { storeChallenge, takePrefill } from '@/lib/auth/challenge';
import { GuestOnlyGate, useSignedIn } from '@/lib/auth/session';
import { safeNext } from '@/lib/next-param';
import { useCountdown } from '@/lib/use-countdown';
import { AuthHeading } from '../AuthShell';

const COPY = {
  invalid: 'That email, phone or password doesn’t match. Try again or reset your password.',
  suspended: 'This account is suspended. Contact support to appeal.',
  closed: 'This account was closed.',
  sessionExpired: 'You were signed out to keep your account safe. Sign in to continue.',
};

const passwordSchema = z.object({
  identifier: identifier('Enter your email or phone.'),
  password: z.string().min(1, 'Enter your password.').max(128, COPY.invalid),
  keep_signed_in: z.boolean(),
});
type PasswordValues = z.input<typeof passwordSchema>;

const otpSchema = z.object({ identifier: identifier('Enter your email or phone.') });
type OtpValues = z.input<typeof otpSchema>;

type Method = 'password' | 'otp';

/** SCR-AUTH-01 Sign in (Figma 26:477, mobile 46:764) with the one-time-code variant (G-02). */
export function LoginForm() {
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const reason = params.get('reason');
  const [method, setMethod] = useState<Method>('password');
  const [prefill, setPrefill] = useState('');
  useEffect(() => {
    const p = takePrefill();
    if (p) setPrefill(p);
  }, []);

  return (
    <GuestOnlyGate>
      <AuthHeading title="Welcome back" sub="Sign in to pick up where you left off." />
      <div className="mt-5 flex flex-col gap-6 tablet:mt-6">
        <SegmentedControl<Method>
          label="Sign-in method"
          kind="tabs"
          fullWidth
          value={method}
          onChange={setMethod}
          options={[
            { value: 'password', label: 'Password', controls: 'signin-panel' },
            { value: 'otp', label: 'One-time code', controls: 'signin-panel' },
          ]}
        />
        {reason ? (
          <Alert tone={reason === 'session_expired' ? 'info' : 'danger'}>
            {reason === 'suspended' ? COPY.suspended : reason === 'closed' ? COPY.closed : COPY.sessionExpired}
          </Alert>
        ) : null}
        <div id="signin-panel" role="tabpanel" aria-label={method === 'password' ? 'Password' : 'One-time code'}>
          {method === 'password' ? <PasswordLogin next={next} prefill={prefill} /> : <OtpLogin next={next} prefill={prefill} />}
        </div>
      </div>
      <NextLink
        href="/help"
        className="mx-auto mt-2 inline-flex min-h-11 items-center rounded-[6px] text-label-md text-fg-secondary hover:text-fg focus-visible:shadow-focus tablet:mt-5 tablet:min-h-6"
      >
        Trouble signing in? Live support
      </NextLink>
    </GuestOnlyGate>
  );
}

function PasswordLogin({ next, prefill }: { next: string | null; prefill: string }) {
  const router = useRouter();
  const signedIn = useSignedIn();
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const lockLeft = useCountdown(lockedUntil);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { identifier: '', password: '', keep_signed_in: true },
  });
  const { register, handleSubmit, formState, setValue, control } = form;
  useEffect(() => {
    if (prefill) setValue('identifier', prefill);
  }, [prefill, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const res = await api.post<LoginResponse>('/auth/login', values, { auth: false });
      if (res.result === 'otp_required') {
        const { result: _r, ...challenge } = res;
        storeChallenge(challenge as OtpChallengeResponse, { keep_signed_in: values.keep_signed_in, next, identifier: values.identifier, back: '/login' });
        router.push(`/verify?purpose=${res.purpose}${next ? `&next=${encodeURIComponent(next)}` : ''}`);
        return;
      }
      signedIn(res, next);
    } catch (err) {
      applyServerError(err, form, {
        INVALID_CREDENTIALS: () => {
          form.setError('root.server', { type: 'INVALID_CREDENTIALS', message: COPY.invalid });
          setValue('password', '');
          requestAnimationFrame(() => passwordRef.current?.focus());
        },
        TOO_MANY_ATTEMPTS: (e) => {
          const secs = Number((e.details as { retry_after_seconds?: number }).retry_after_seconds ?? 900);
          setLockedUntil(Date.now() + secs * 1000);
          form.setError('root.server', { type: 'TOO_MANY_ATTEMPTS', message: 'locked' });
        },
        ACCOUNT_SUSPENDED: () => form.setError('root.server', { type: 'ACCOUNT_SUSPENDED', message: COPY.suspended }),
        ACCOUNT_CLOSED: () => form.setError('root.server', { type: 'ACCOUNT_CLOSED', message: COPY.closed }),
      });
    }
  });

  const rootErr = formState.errors.root?.server;
  const locked = lockLeft > 0;
  const { ref: pwRef, ...pwReg } = register('password');
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col" aria-describedby={rootErr ? 'login-error' : undefined}>
      {rootErr && !(rootErr.type === 'TOO_MANY_ATTEMPTS' && !locked) ? (
        <div id="login-error" className="mb-6">
          <Alert tone="danger" action={rootErr.type === 'ACCOUNT_SUSPENDED' ? <NextLink href="/about#contact" className="text-label-md text-fg-brand hover:underline">Contact support</NextLink> : undefined}>
            {rootErr.type === 'TOO_MANY_ATTEMPTS' ? `Too many tries. Try again in ${formatMmSs(lockLeft)}, or use a one-time code.` : rootErr.message}
          </Alert>
        </div>
      ) : null}
      <div className="flex flex-col gap-6">
        <Field
          label="Email or phone"
          type="text"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          error={formState.errors.identifier?.message}
          readOnly={formState.isSubmitting}
          {...register('identifier')}
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          error={formState.errors.password?.message}
          readOnly={formState.isSubmitting}
          labelAction={
            <NextLink href="/forgot-password" className="hidden rounded-[4px] text-fg-brand hover:underline underline-offset-2 focus-visible:shadow-focus tablet:inline">
              Forgot password?
            </NextLink>
          }
          ref={(el) => {
            pwRef(el);
            passwordRef.current = el;
          }}
          {...pwReg}
        />
      </div>
      <div className="mt-[14px] flex items-center justify-between gap-3 tablet:mt-7">
        <Controller
          control={control}
          name="keep_signed_in"
          render={({ field }) => (
            <Checkbox
              checked={!!field.value}
              onChange={(e) => field.onChange(e.target.checked)}
              onBlur={field.onBlur}
              name={field.name}
              label={
                <>
                  <span className="tablet:hidden">Keep me signed in</span>
                  <span className="hidden tablet:inline">Keep me signed in on this device</span>
                </>
              }
            />
          )}
        />
        <NextLink href="/forgot-password" className="inline-flex min-h-11 items-center rounded-[4px] text-label-md text-fg-brand tablet:hidden">
          Forgot password?
        </NextLink>
      </div>
      <Button type="submit" size="L" fullWidth className="mt-[14px] tablet:mt-6" loading={formState.isSubmitting} loadingText="Signing in…" disabled={locked}>
        Sign in
      </Button>
    </form>
  );
}

function OtpLogin({ next, prefill }: { next: string | null; prefill: string }) {
  const router = useRouter();
  const form = useForm<OtpValues>({ resolver: zodResolver(otpSchema), mode: 'onBlur', reValidateMode: 'onChange', defaultValues: { identifier: prefill } });
  const { register, handleSubmit, formState } = form;
  const onSubmit = handleSubmit(async (values) => {
    try {
      const res = await api.post<OtpChallengeResponse>('/auth/login/otp', { ...values, keep_signed_in: true }, { auth: false });
      storeChallenge(res, { keep_signed_in: true, next, identifier: values.identifier, back: '/login' });
      router.push(`/verify?purpose=login${next ? `&next=${encodeURIComponent(next)}` : ''}`);
    } catch (err) {
      applyServerError(err, form);
    }
  });
  const rootErr = formState.errors.root?.server;
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      {rootErr ? (
        <Alert tone="danger">{rootErr.message}</Alert>
      ) : null}
      <Field
        label="Email or phone"
        type="text"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        helper="We’ll send you a 6-digit code. It expires after 10 minutes."
        error={formState.errors.identifier?.message}
        readOnly={formState.isSubmitting}
        {...register('identifier')}
      />
      <Button type="submit" size="L" fullWidth loading={formState.isSubmitting} loadingText="Sending…">
        Send code
      </Button>
    </form>
  );
}

