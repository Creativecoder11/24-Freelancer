'use client';
import NextLink from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  COOKIE_NAMES,
  countryCode,
  fullName,
  identifier,
  password,
  type OtpChallengeResponse,
  type PublicConfig,
} from '@24f/shared';
import { Alert, Button, Checkbox, Field, PasswordField, Select, SelectableCard } from '@24f/ui';
import { api } from '@/lib/api/client';
import { applyServerError } from '@/lib/form-errors';
import { storeChallenge, takePrefill } from '@/lib/auth/challenge';
import { GuestOnlyGate } from '@/lib/auth/session';
import { safeNext } from '@/lib/next-param';
import { AuthHeading } from '../AuthShell';

const REF_RE = /^[A-Z0-9]{4,12}$/;
const REF_INVALID = 'We can’t find that referral code. Check it, or continue without it.';

const schema = z.object({
  signup_role: z.enum(['worker', 'employer'], { errorMap: () => ({ message: 'Choose how you want to start.' }) }),
  full_name: fullName(),
  identifier: identifier('Enter your email or phone.'),
  password: password('Use at least 8 characters, with a number and a symbol.'),
  country_code: countryCode(),
  referral_code: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => s === '' || REF_RE.test(s), { message: REF_INVALID }),
  terms_accepted: z.boolean().refine((v) => v, { message: 'Tick the box to agree before continuing.' }),
});
type Values = z.input<typeof schema>;

function readCookie(name: string) {
  if (typeof document === 'undefined') return null;
  const hit = document.cookie.split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

/** SCR-AUTH-02 Create account (Figma 26:552). */
export function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const roleParam = params.get('role') === 'employer' ? 'employer' : 'worker';
  const [refWarning, setRefWarning] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);

  const config = useQuery({ queryKey: ['public', 'config'], queryFn: () => api.get<PublicConfig>('/public/config', { auth: false }), staleTime: 300_000 });
  const countries = (config.data?.countries?.length ? config.data.countries : [{ code: 'BD', name: 'Bangladesh' }]).map((c) => ({ value: c.code, label: c.name }));

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { signup_role: roleParam, full_name: '', identifier: '', password: '', country_code: 'BD', referral_code: '', terms_accepted: false },
  });
  const { register, handleSubmit, formState, control, setValue, watch } = form;

  // Prefill: ?ref= wins over the fl_ref cookie (BR-076); "Change email" restores the identifier.
  useEffect(() => {
    const ref = (params.get('ref') ?? readCookie(COOKIE_NAMES.referral) ?? '').trim().toUpperCase();
    if (REF_RE.test(ref)) {
      setValue('referral_code', ref);
      void checkReferral(ref);
    }
    const prefill = takePrefill();
    if (prefill) setValue('identifier', prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkReferral(raw: string) {
    const code = raw.trim().toUpperCase();
    if (!code || !REF_RE.test(code)) return setRefWarning(null);
    try {
      const r = await api.get<{ valid: boolean }>(`/public/referral-codes/${encodeURIComponent(code)}`, { auth: false });
      setRefWarning(r.valid ? null : REF_INVALID);
    } catch {
      setRefWarning(null); // non-blocking: the server ignores unknown codes
    }
  }

  const onSubmit = handleSubmit(async (v) => {
    setTaken(false);
    try {
      const body = { ...v, referral_code: v.referral_code ? v.referral_code.trim().toUpperCase() : null, terms_accepted: true };
      const res = await api.post<OtpChallengeResponse>('/auth/register', body, { auth: false });
      storeChallenge(res, { next, identifier: v.identifier, back: '/signup', keep_signed_in: true });
      router.push(`/verify?purpose=signup${next ? `&next=${encodeURIComponent(next)}` : ''}`);
    } catch (err) {
      applyServerError(err, form, {
        IDENTIFIER_TAKEN: (e) => {
          setTaken(true);
          form.setError('identifier', { type: 'server', message: e.fields.identifier?.[0] ?? 'This is already registered. Sign in instead, or reset your password.' }, { shouldFocus: true });
        },
      });
    }
  });

  const role = watch('signup_role');
  const rootErr = formState.errors.root?.server;
  const busy = formState.isSubmitting;
  return (
    <GuestOnlyGate>
      <AuthHeading title="Create your account" sub="It takes about a minute. You can switch between earning and hiring any time." subSize="md" />
      <form noValidate onSubmit={onSubmit} className="mt-4 flex flex-col">
        {rootErr ? (
          <Alert tone="danger" className="mb-4">
            {rootErr.message}
          </Alert>
        ) : null}
        <fieldset>
          <legend className="text-label-md text-fg">What brings you here?</legend>
          <div className="mt-2 grid grid-cols-2 gap-3 tablet:gap-4">
            <SelectableCard
              type="radio"
              name="signup_role"
              value="worker"
              checked={role === 'worker'}
              onChange={() => setValue('signup_role', 'worker')}
              title="I want to earn"
              subtitle="Do tasks, get paid"
              className="min-h-16"
            />
            <SelectableCard
              type="radio"
              name="signup_role"
              value="employer"
              checked={role === 'employer'}
              onChange={() => setValue('signup_role', 'employer')}
              title="I want to hire"
              subtitle="Post jobs, get work done"
              className="min-h-16"
            />
          </div>
        </fieldset>

        <div className="mt-6 flex flex-col gap-2">
          <Field label="Full name" placeholder="e.g. Nusrat Jahan" autoComplete="name" error={formState.errors.full_name?.message} readOnly={busy} {...register('full_name')} />
          <div>
            <Field
              label="Email or phone"
              placeholder="you@example.com or 01XXXXXXXXX"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              error={formState.errors.identifier?.message}
              readOnly={busy}
              {...register('identifier')}
            />
            {taken ? (
              <p className="ml-[18px] mt-1 text-body-xs">
                <NextLink href="/login" className="text-label-sm text-fg-brand hover:underline">
                  Sign in
                </NextLink>
                <span className="text-fg-tertiary"> · </span>
                <NextLink href="/forgot-password" className="text-label-sm text-fg-brand hover:underline">
                  Reset password
                </NextLink>
              </p>
            ) : null}
          </div>
          <PasswordField
            label="Password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            showStrength
            error={formState.errors.password?.message}
            readOnly={busy}
            {...register('password')}
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 tablet:gap-5">
          <Controller
            control={control}
            name="country_code"
            render={({ field }) => (
              <Select
                label="Country"
                options={countries}
                value={field.value}
                onChange={(v) => field.onChange(v)}
                searchable
                searchPlaceholder="Search countries"
                error={formState.errors.country_code?.message}
                disabled={busy}
              />
            )}
          />
          {(() => {
            const reg = register('referral_code', {
              onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
                const up = e.target.value.trim().toUpperCase();
                setValue('referral_code', up, { shouldValidate: true });
                void checkReferral(up);
              },
              onChange: () => setRefWarning(null),
            });
            return (
              <Field
                label="Referral code"
                placeholder="Optional"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={12}
                error={formState.errors.referral_code?.message ?? refWarning ?? undefined}
                readOnly={busy}
                className="uppercase placeholder:normal-case"
                {...reg}
              />
            );
          })()}
        </div>

        <Controller
          control={control}
          name="terms_accepted"
          render={({ field }) => (
            <Checkbox
              wrapperClassName="mt-3 tablet:mt-5"
              checked={!!field.value}
              onChange={(e) => field.onChange(e.target.checked)}
              onBlur={field.onBlur}
              name={field.name}
              disabled={busy}
              error={formState.errors.terms_accepted?.message}
              label={
                <>
                  I agree to the{' '}
                  <NextLink href="/legal/terms" target="_blank" rel="noopener noreferrer" className="hover:underline">
                    Terms &amp; conditions
                  </NextLink>{' '}
                  and{' '}
                  <NextLink href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="hover:underline">
                    Privacy policy
                  </NextLink>
                </>
              }
            />
          )}
        />

        <Button type="submit" size="L" fullWidth className="mt-3 tablet:mt-5" loading={busy} loadingText="Creating account…">
          Create account
        </Button>
        <p className="mt-4 text-center text-body-sm text-fg-tertiary">Next: verify your email or phone.</p>
      </form>
    </GuestOnlyGate>
  );
}
