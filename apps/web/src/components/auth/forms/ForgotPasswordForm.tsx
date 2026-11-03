'use client';
import NextLink from 'next/link';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { identifier, type OtpChallengeResponse } from '@24f/shared';
import { Alert, Button, Field } from '@24f/ui';
import { api } from '@/lib/api/client';
import { applyServerError } from '@/lib/form-errors';
import { storeChallenge, takePrefill } from '@/lib/auth/challenge';
import { AuthHeading, BackLink } from '../AuthShell';

const schema = z.object({ identifier: identifier('Enter the email or phone you signed up with.') });
type Values = z.input<typeof schema>;

/** SCR-AUTH-03 Forgot password (Figma 26:659). Same response for any identifier (no enumeration). */
export function ForgotPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const expired = params.get('expired') === '1';
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur', reValidateMode: 'onChange', defaultValues: { identifier: '' } });
  const { register, handleSubmit, formState, setValue } = form;
  useEffect(() => {
    const p = takePrefill();
    if (p) setValue('identifier', p);
  }, [setValue]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      const res = await api.post<OtpChallengeResponse>('/auth/password/forgot', v, { auth: false });
      storeChallenge(res, { identifier: v.identifier, back: '/forgot-password' });
      router.push('/verify?purpose=password_reset');
    } catch (err) {
      applyServerError(err, form);
    }
  });
  const rootErr = formState.errors.root?.server;

  return (
    <>
      <BackLink href="/login">Back to sign in</BackLink>
      <div className="mt-5 tablet:mt-8">
        <AuthHeading title="Reset your password" sub="Enter the email or phone you signed up with. We’ll send you a one-time code." />
      </div>
      <form noValidate onSubmit={onSubmit} className="mt-6 flex flex-col tablet:mt-8">
        {expired && !rootErr ? (
          <Alert tone="danger" className="mb-6">
            That reset session expired. Request a new code.
          </Alert>
        ) : null}
        {rootErr ? (
          <Alert tone="danger" className="mb-6">
            {rootErr.message}
          </Alert>
        ) : null}
        <Field
          label="Email or phone"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          helper="The code expires after 10 minutes."
          error={formState.errors.identifier?.message}
          readOnly={formState.isSubmitting}
          {...register('identifier')}
        />
        <Button type="submit" size="L" fullWidth className="mt-6" loading={formState.isSubmitting} loadingText="Sending…">
          Send code
        </Button>
      </form>
      <div className="mt-8 rounded-[12px] bg-info-subtle px-[14px] py-3 text-body-sm text-fg">
        No access to that email or phone anymore?{' '}
        <NextLink href="/about?topic=account#contact" className="font-semibold text-fg-brand hover:underline">
          Contact live support
        </NextLink>{' '}
        — we’ll verify your identity another way.
      </div>
    </>
  );
}
