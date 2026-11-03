'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { password, type AuthenticatedResponse } from '@24f/shared';
import { Alert, Button, Icon, PasswordField, cn, toast } from '@24f/ui';
import { api } from '@/lib/api/client';
import { applyServerError } from '@/lib/form-errors';
import { ephemeral } from '@/lib/auth/ephemeral';
import { useSignedIn } from '@/lib/auth/session';
import { AuthHeading } from '../AuthShell';

const schema = z
  .object({
    new_password: password('Your new password must meet all 4 requirements.'),
    confirm_password: z.string().min(1, 'These passwords don’t match. Retype to confirm.'),
  })
  .refine((v) => v.new_password === v.confirm_password, { message: 'These passwords don’t match. Retype to confirm.', path: ['confirm_password'] });
type Values = z.input<typeof schema>;

type ReqState = 'met' | 'unmet' | 'neutral' | 'failed';

function Requirement({ state, children }: { state: ReqState; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-body-sm text-fg-secondary">
      <Icon
        name={state === 'failed' ? 'x-circle' : state === 'met' ? 'check-circle' : 'circle'}
        size={16}
        className={cn('shrink-0', state === 'met' ? 'text-fg-success' : state === 'failed' ? 'text-fg-danger' : 'text-fg-tertiary')}
      />
      <span className={state === 'failed' ? 'text-fg-danger' : undefined}>{children}</span>
      <span className="sr-only">{state === 'met' ? '(met)' : state === 'failed' ? '(not met)' : ''}</span>
    </li>
  );
}

/** SCR-AUTH-04 Create a new password (Figma 26:715). Needs the in-memory reset token from /verify. */
export function ResetPasswordForm() {
  const router = useRouter();
  const signedIn = useSignedIn();
  const [token] = useState(() => ephemeral.getReset());
  const [reused, setReused] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur', reValidateMode: 'onChange', defaultValues: { new_password: '', confirm_password: '' } });
  const { register, handleSubmit, formState, watch } = form;

  useEffect(() => {
    if (!token) router.replace('/forgot-password?expired=1');
  }, [token, router]);

  const pw = watch('new_password') ?? '';
  const onSubmit = handleSubmit(async (v) => {
    const t = ephemeral.getReset();
    if (!t) return router.replace('/forgot-password?expired=1');
    setReused(false);
    try {
      const res = await api.post<AuthenticatedResponse>('/auth/password/reset', { reset_token: t.reset_token, ...v }, { auth: false });
      ephemeral.clearReset();
      toast.show({ tone: 'success', title: 'Password updated', body: 'You’re signed out on other devices.' });
      signedIn(res);
    } catch (err) {
      applyServerError(err, form, {
        PASSWORD_REUSED: () => {
          setReused(true);
          form.setError('new_password', { type: 'server', message: 'Choose a password you haven’t used for this account.' }, { shouldFocus: true });
        },
        RESET_TOKEN_EXPIRED: () => {
          ephemeral.clearReset();
          router.replace('/forgot-password?expired=1');
        },
      });
    }
  });
  if (!token) return null;
  const rootErr = formState.errors.root?.server;
  const has = (ok: boolean): ReqState => (pw ? (ok ? 'met' : 'unmet') : 'neutral');

  return (
    <>
      <AuthHeading title="Create a new password" sub={`For ${token.identifier_masked}. You’ll be signed out on other devices.`} />
      <form noValidate onSubmit={onSubmit} className="mt-6 flex flex-col">
        {rootErr ? (
          <Alert tone="danger" className="mb-6">
            {rootErr.message}
          </Alert>
        ) : null}
        <PasswordField
          label="New password"
          autoComplete="new-password"
          showStrength
          error={formState.errors.new_password?.message}
          readOnly={formState.isSubmitting}
          {...register('new_password', { onChange: () => setReused(false) })}
        />
        <div className="mt-2">
          <PasswordField
            label="Confirm new password"
            autoComplete="new-password"
            error={formState.errors.confirm_password?.message}
            readOnly={formState.isSubmitting}
            {...register('confirm_password')}
          />
        </div>
        <ul aria-label="Password requirements" className="mt-[14px] flex flex-col gap-1 rounded-[12px] bg-subtle px-4 py-3">
          <Requirement state={has(pw.length >= 8)}>At least 8 characters</Requirement>
          <Requirement state={has(/\d/.test(pw))}>Contains a number</Requirement>
          <Requirement state={has(/[^A-Za-z0-9]/.test(pw))}>Contains a symbol (! @ # …)</Requirement>
          <Requirement state={reused ? 'failed' : 'neutral'}>Doesn’t match your old password</Requirement>
        </ul>
        <Button type="submit" size="L" fullWidth className="mt-6" loading={formState.isSubmitting} loadingText="Updating…">
          Update password
        </Button>
      </form>
    </>
  );
}
