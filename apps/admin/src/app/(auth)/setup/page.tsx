'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { Alert, Button, Logo, OtpInput, PasswordField, WizardStepper } from '@24f/ui';
import { setToken } from '@/lib/api';

async function call(path: string, body: unknown, bearer?: string | null) {
  const r = await fetch(`/api/v1${path}`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body ?? {}) });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error?.message ?? 'Something went wrong.'), { code: j.error?.code, fields: j.error?.fields });
  return j.data;
}

/** SCR-ADM-01 setup steps: set password, then enrol the authenticator (Doc 09 §6, §19). */
function Setup() {
  const sp = useSearchParams();
  const router = useRouter();
  const link = sp.get('token');
  const [step, setStep] = useState<'set_password' | 'enrol_totp'>(sp.get('step') === 'enrol_totp' ? 'enrol_totp' : 'set_password');
  const [setup, setSetup] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    document.title = 'Set up your account · 24F Admin';
    setSetup(sessionStorage.getItem('adm:setup'));
  }, []);

  useEffect(() => {
    if (step !== 'enrol_totp' || !setup || secret) return;
    call('/admin/auth/totp/enrol', {}, setup)
      .then(async (d: { otpauth_url: string; secret: string }) => {
        setSecret(d.secret);
        setQr(await QRCode.toDataURL(d.otpauth_url, { margin: 1, width: 200 }));
      })
      .catch((e) => setErr(e.message));
  }, [step, setup, secret]);

  const savePassword = async () => {
    setErr(undefined);
    if (pw.length < 12) return setErr('Use at least 12 characters with upper and lower case letters, a number and a symbol.');
    if (pw !== pw2) return setErr("The passwords don't match.");
    setBusy(true);
    try {
      const d = await call('/admin/auth/set-password', { new_password: pw, ...(link ? { token: link } : {}) }, link ? null : setup);
      if (d.next === 'enrol_totp') {
        sessionStorage.setItem('adm:setup', d.setup_token);
        setSetup(d.setup_token);
        setStep('enrol_totp');
      } else router.replace('/login?reason=signed_out');
    } catch (e) {
      const x = e as { code?: string; message: string; fields?: Record<string, string[]> };
      setErr(x.code === 'RESET_TOKEN_EXPIRED' ? 'This link has expired. Ask a super admin to send a new one.' : (x.fields?.new_password?.[0] ?? x.message));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (v = code) => {
    setBusy(true);
    setErr(undefined);
    try {
      const d = await call('/admin/auth/totp/confirm', { totp_code: v }, setup);
      sessionStorage.removeItem('adm:setup');
      setToken(d.access_token);
      router.replace('/');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-[20px] border border-line bg-surface p-6 shadow-md tablet:p-8">
          <WizardStepper steps={['Set your password', 'Set up your authenticator']} current={step === 'set_password' ? 1 : 2} />
          {err ? <Alert tone="danger" className="mt-4">{err}</Alert> : null}
          {step === 'set_password' ? (
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void savePassword();
              }}
            >
              <h1 className="font-display text-h4 text-fg">Set your password</h1>
              <PasswordField label="New password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} helper="At least 12 characters, with upper and lower case, a number and a symbol." showStrength />
              <PasswordField label="Confirm password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
              <Button type="submit" fullWidth size="L" loading={busy}>
                Save password
              </Button>
            </form>
          ) : (
            <div className="mt-5 space-y-4">
              <h1 className="font-display text-h4 text-fg">Set up your authenticator</h1>
              <p className="text-body-sm text-fg-secondary">Scan the code with your authenticator app, then enter the 6-digit code it shows.</p>
              {qr ? <img src={qr} alt="QR code for your authenticator app" width={200} height={200} className="mx-auto rounded-[12px] border border-line" /> : <div className="mx-auto size-[200px] animate-pulse rounded-[12px] bg-muted" />}
              {secret ? (
                <p className="text-center text-body-xs text-fg-tertiary">
                  Or enter this key: <span className="adm-mono select-all text-fg">{secret}</span>
                </p>
              ) : null}
              <OtpInput value={code} onChange={setCode} onComplete={(v) => void confirm(v)} label="Authenticator code" />
              <Button fullWidth size="L" loading={busy} onClick={() => void confirm()}>
                Finish setup
              </Button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function SetupPage() {
  return (
    <Suspense>
      <Setup />
    </Suspense>
  );
}
