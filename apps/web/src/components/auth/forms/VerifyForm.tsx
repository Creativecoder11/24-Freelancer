'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatMSs, formatMmSs, type AuthenticatedResponse, type OtpChallengeResponse, type PasswordResetTokenResponse } from '@24f/shared';
import { Alert, Button, OtpInput, toast } from '@24f/ui';
import { api, ApiError } from '@/lib/api/client';
import { readChallenge, setPrefill, storeChallenge, type StoredChallenge } from '@/lib/auth/challenge';
import { ephemeral } from '@/lib/auth/ephemeral';
import { useSignedIn } from '@/lib/auth/session';
import { safeNext } from '@/lib/next-param';
import { useCountdown } from '@/lib/use-countdown';
import { AuthHeading, BackLink } from '../AuthShell';

const SIGN_IN_PURPOSES = new Set(['signup', 'login', 'new_device']);

/** SCR-AUTH-05 OTP verification (Figma 27:619): 10:00 expiry countdown, 60 s resend timer. */
export function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const purpose = params.get('purpose');
  const signedIn = useSignedIn();
  const [challenge, setChallenge] = useState<StoredChallenge | null>(null);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [dead, setDead] = useState(false); // expired, locked or used: Verify off, resend on
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const submitted = useRef<string | null>(null);

  useEffect(() => {
    const c = readChallenge();
    if (!c || !purpose || c.purpose !== purpose) {
      router.replace(purpose === 'password_reset' ? '/forgot-password' : '/login');
      return;
    }
    setChallenge(c);
    setResendAt(new Date(c.resend_available_at).getTime());
    setReady(true);
  }, [purpose, router]);

  const expiresLeft = useCountdown(challenge?.expires_at);
  const resendLeft = useCountdown(resendAt);
  const expired = ready && expiresLeft <= 0;

  async function verify(value: string) {
    if (!challenge || submitting || dead || expired) return;
    if (!/^\d{6}$/.test(value)) {
      setError('Enter all 6 digits.');
      return;
    }
    if (submitted.current === value) return;
    submitted.current = value;
    setSubmitting(true);
    setError(null);
    setAlert(null);
    try {
      const body: Record<string, unknown> = { challenge_id: challenge.challenge_id, code: value };
      if (SIGN_IN_PURPOSES.has(challenge.purpose) && challenge.keep_signed_in !== undefined) body.keep_signed_in = challenge.keep_signed_in;
      if (challenge.purpose === 'password_reset') {
        const res = await api.post<PasswordResetTokenResponse>('/auth/otp/verify', body, { auth: false });
        ephemeral.setReset(res);
        router.replace('/reset-password');
        return;
      }
      const res = await api.post<AuthenticatedResponse>('/auth/otp/verify', body, { auth: false });
      try {
        sessionStorage.removeItem('fl_otp_challenge');
      } catch {
        /* ignore */
      }
      signedIn(res, safeNext(params.get('next')) ?? challenge.next ?? null);
    } catch (err) {
      submitted.current = null;
      setSubmitting(false);
      if (!(err instanceof ApiError)) return setAlert('Something went wrong on our side. Try again in a moment.');
      switch (err.code) {
        case 'OTP_INVALID':
          setError(err.message);
          break;
        case 'OTP_EXPIRED': {
          const reason = (err.details as { reason?: string }).reason;
          setDead(true);
          setError(reason === 'locked' ? err.message : 'This code expired. Request a new one.');
          setResendAt(Date.now()); // resend enabled
          break;
        }
        case 'RATE_LIMITED':
          setAlert('Too many requests. Try again in a few minutes.');
          break;
        case 'ACCOUNT_SUSPENDED':
          setAlert('This account is suspended. Contact support to appeal.');
          break;
        case 'ACCOUNT_CLOSED':
          setAlert('This account was closed.');
          break;
        default:
          setAlert(err.message);
      }
    }
  }

  async function resend() {
    if (!challenge || resending || resendLeft > 0) return;
    setResending(true);
    setAlert(null);
    try {
      const res = await api.post<OtpChallengeResponse>('/auth/otp/resend', { challenge_id: challenge.challenge_id }, { auth: false });
      const next = storeChallenge({ ...res, purpose: challenge.purpose }, { ...challenge, ...res, purpose: challenge.purpose });
      setChallenge(next);
      setResendAt(new Date(res.resend_available_at).getTime());
      setCode('');
      setError(null);
      setDead(false);
      submitted.current = null;
      toast.show({ tone: 'success', title: 'New code sent', body: 'Check your messages.' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'OTP_RESEND_TOO_SOON') {
        const secs = Number((err.details as { retry_after_seconds?: number }).retry_after_seconds ?? 60);
        setResendAt(Date.now() + secs * 1000);
      } else if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
        setAlert('You’ve requested too many codes. Try again in an hour.');
      } else if (err instanceof ApiError && err.code === 'OTP_EXPIRED') {
        setAlert('This code has expired. Start again.');
      } else {
        setAlert(err instanceof ApiError ? err.message : 'We couldn’t send the code. Try again in a moment.');
      }
    } finally {
      setResending(false);
    }
  }

  if (!ready || !challenge) return null;
  const isEmail = challenge.destination_masked.includes('@');
  const back = challenge.back ?? (challenge.purpose === 'password_reset' ? '/forgot-password' : '/login');
  const blocked = dead || expired;

  return (
    <>
      <BackLink href={back} onClick={() => challenge.identifier && setPrefill(challenge.identifier)}>
        {isEmail ? 'Change email' : 'Change number'}
      </BackLink>
      <div className="mt-5 tablet:mt-8">
        <AuthHeading
          title="Enter the 6-digit code"
          sub={
            <>
              We sent it to <span className="whitespace-nowrap">{challenge.destination_masked}</span>.{' '}
              {expired ? 'This code expired. Request a new one.' : <>It expires in <span className="tabular-nums">{formatMmSs(expiresLeft)}</span>.</>}
            </>
          }
        />
      </div>
      <form
        noValidate
        className="mt-4 flex flex-col tablet:mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void verify(code);
        }}
      >
        {alert ? (
          <Alert tone="danger" className="mb-4">
            {alert}
          </Alert>
        ) : null}
        <OtpInput
          value={code}
          onChange={(v) => {
            setCode(v);
            if (error && !dead) setError(null);
          }}
          onComplete={(v) => void verify(v)}
          error={error ?? undefined}
          disabled={submitting}
          autoFocus
        />
        <p className="mt-6 flex flex-wrap items-center gap-x-1.5 text-body-sm text-fg-secondary" aria-live="polite">
          Didn’t get it?
          {resendLeft > 0 ? (
            <span className="text-label-md text-fg-disabled tabular-nums">Resend in {formatMSs(resendLeft)}</span>
          ) : (
            <button
              type="button"
              onClick={() => void resend()}
              disabled={resending}
              className="relative rounded-[4px] text-label-md text-fg-brand hover:underline underline-offset-2 focus-visible:shadow-focus disabled:text-fg-disabled before:absolute before:-inset-3 before:content-['']"
            >
              {resending ? 'Sending…' : 'Resend code'}
            </button>
          )}
        </p>
        <Button type="submit" size="L" fullWidth className="mt-7" loading={submitting} loadingText="Verifying…" disabled={blocked}>
          Verify
        </Button>
      </form>
      <div className="mt-8 rounded-[12px] bg-warning-subtle px-[14px] py-3 text-body-sm text-fg">
        Never share this code. 24 Freelancing staff will never ask for it by phone, chat or Facebook.
      </div>
    </>
  );
}
