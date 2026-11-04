'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, Field, Logo, OtpInput, PasswordField, gsap, useGSAP, MOTION_OK } from '@24f/ui';
import { ApiError, refreshSession, setToken } from '@/lib/api';

/** SCR-ADM-01 Admin sign-in (Doc 09 §6). */
function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'creds' | 'totp'>('creds');
  const [errs, setErrs] = useState<{ email?: string; password?: string; totp?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const reason = sp.get('reason');
  const nextRaw = sp.get('next') ?? '/';
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/';

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.fromTo(card.current, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
    });
    return () => mm.revert();
  });

  useEffect(() => {
    document.title = 'Admin sign-in · 24F Admin';
    // Already signed in → straight to the panel.
    if (!reason) void refreshSession().then((ok) => ok && router.replace(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (totp?: string) => {
    const e: typeof errs = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) e.email = 'Enter a valid email.';
    if (!password) e.password = 'Enter your password.';
    setErrs(e);
    if (e.email || e.password) return;
    setBusy(true);
    try {
      const r = await fetch('/api/v1/admin/auth/login', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password, totp_code: totp ?? (step === 'totp' ? code : undefined) }) });
      const j = await r.json();
      if (!r.ok) {
        const err = new ApiError(r.status, j.error?.code, j.error?.message);
        throw err;
      }
      const d = j.data as { access_token: string; next: string | null };
      if (d.next) {
        sessionStorage.setItem('adm:setup', d.access_token);
        router.push(`/setup?step=${d.next}`);
        return;
      }
      setToken(d.access_token);
      router.replace(next);
    } catch (err) {
      const ae = err as ApiError;
      if (ae.code === 'ADMIN_TOTP_REQUIRED') {
        setStep('totp');
        setErrs({});
      } else if (ae.code === 'ADMIN_TOTP_INVALID') setErrs({ totp: "That code isn't right. Check your authenticator app." });
      else if (ae.code === 'INVALID_CREDENTIALS') setErrs({ form: "That email or password isn't right." });
      else if (ae.code === 'TOO_MANY_ATTEMPTS') setErrs({ form: 'Too many attempts. Try again in 15 minutes.' });
      else if (ae.code === 'ACCOUNT_SUSPENDED') setErrs({ form: 'This admin account is disabled. Contact a super admin.' });
      else if (ae.code === 'ADMIN_FORBIDDEN') setBlocked(true);
      else setErrs({ form: 'Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div ref={card} className="w-full max-w-[400px]">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-[20px] border border-line bg-surface p-6 shadow-md tablet:p-8">
          {blocked ? (
            <Alert tone="danger" title="This network isn't allowed.">Connect through the office network or VPN.</Alert>
          ) : (
            <>
              <h1 className="font-display text-h3 text-fg">Admin sign-in</h1>
              <p className="mt-1 text-body-sm text-fg-secondary">Staff only. Access is logged.</p>
              {reason === 'session_expired' ? <Alert tone="warning" className="mt-4">Your session ended. Sign in to continue.</Alert> : null}
              {reason === 'signed_out' ? <Alert tone="info" className="mt-4">You&apos;re signed out.</Alert> : null}
              {errs.form ? <Alert tone="danger" className="mt-4">{errs.form}</Alert> : null}
              <form
                className="mt-5 space-y-4"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <Field label="Work email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={errs.email} disabled={step === 'totp'} />
                <PasswordField label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errs.password} disabled={step === 'totp'} />
                {step === 'totp' ? (
                  <div>
                    <p className="mb-2 text-label-md text-fg">Authenticator code</p>
                    <OtpInput value={code} onChange={setCode} onComplete={(v) => void submit(v)} error={errs.totp} autoFocus label="Authenticator code" />
                  </div>
                ) : null}
                <Button type="submit" size="L" fullWidth loading={busy}>
                  Sign in
                </Button>
              </form>
              <p className="mt-5 text-body-xs text-fg-tertiary">Forgot your password or lost your authenticator? Ask a super admin to reset it.</p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
