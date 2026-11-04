'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button, Dialog, OtpInput, toast } from '@24f/ui';
import { api, ApiError, hasToken, onReauthRequired, onSessionExpired, refreshSession, setToken } from './api';

export interface Me {
  id: string;
  full_name: string;
  email: string;
  roles: string[];
  role_labels: string[];
  permissions: string[];
  totp_enrolled: boolean;
  totp_required: boolean;
  reauth_needed: boolean;
  session: { idle_minutes: number; last_active_at: string | null; expires_at: string | null };
  app_env: string;
}

interface Ctx {
  me: Me;
  can: (...keys: string[]) => boolean;
  isSuper: boolean;
  logout: () => Promise<void>;
  /** Bumped after any mutation so badges and lists refetch together (Doc 09 §5.4 rule 5). */
  tick: number;
  bump: () => void;
}

const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('useSession outside provider');
  return c;
};

/** Signs the admin out locally and on the server. */
export async function signOut() {
  await fetch('/api/v1/admin/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
  setToken(null);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [tick, setTick] = useState(0);
  const [reauth, setReauth] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [idleWarn, setIdleWarn] = useState(false);
  const [countdown, setCountdown] = useState(120);
  const lastActivity = useRef(Date.now());

  const expire = useCallback(() => {
    setToken(null);
    const next = encodeURIComponent(window.location.pathname.replace(/^\/admin/, '') + window.location.search);
    window.location.replace(`/admin/login?next=${next}&reason=session_expired`);
  }, []);

  useEffect(() => {
    onSessionExpired(expire);
    onReauthRequired(() => new Promise<boolean>((resolve) => setReauth({ resolve })));
    let alive = true;
    (async () => {
      if (!hasToken() && !(await refreshSession())) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      try {
        const r = await api<Me>('/admin/me');
        if (alive) setMe(r.data);
      } catch {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Idle warning 2 minutes before the server-side idle limit (Doc 09 §22.1).
  useEffect(() => {
    if (!me) return;
    const mark = () => {
      lastActivity.current = Date.now();
    };
    const evs = ['mousedown', 'keydown', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const t = setInterval(() => {
      const left = lastActivity.current + me.session.idle_minutes * 60_000 - Date.now();
      if (left <= 0) expire();
      else if (left <= 120_000) {
        setIdleWarn(true);
        setCountdown(Math.ceil(left / 1000));
      }
    }, 1000);
    return () => {
      clearInterval(t);
      evs.forEach((e) => window.removeEventListener(e, mark));
    };
  }, [me, expire]);

  const stay = async () => {
    lastActivity.current = Date.now();
    setIdleWarn(false);
    try {
      await api('/admin/me');
    } catch {
      /* expire handler redirects */
    }
  };

  const logout = useCallback(async () => {
    await signOut();
    window.location.replace('/admin/login?reason=signed_out');
  }, []);

  const submitReauth = async () => {
    if (!reauth) return;
    setBusy(true);
    setCodeErr(undefined);
    try {
      const r = await api<{ access_token: string }>('/admin/auth/reauth', { method: 'POST', body: { totp_code: code } });
      setToken(r.data.access_token);
      reauth.resolve(true);
      setReauth(null);
      setCode('');
    } catch (e) {
      setCodeErr(e instanceof ApiError ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!me) {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas" aria-busy="true">
        <p className="text-body-sm text-fg-tertiary">Loading the admin panel…</p>
      </div>
    );
  }
  const can = (...keys: string[]) => keys.some((k) => me.permissions.includes(k));
  return (
    <SessionCtx.Provider value={{ me, can, isSuper: me.roles.includes('super_admin'), logout, tick, bump: () => setTick((t) => t + 1) }}>
      {children}
      <Dialog
        open={!!reauth}
        onOpenChange={(o) => {
          if (!o && reauth) {
            reauth.resolve(false);
            setReauth(null);
            setCode('');
          }
        }}
        type="form"
        title="Confirm it's you"
        description="Enter the code from your authenticator app."
        busy={busy}
        footer={
          <>
            <Button variant="secondary" onClick={() => { reauth?.resolve(false); setReauth(null); setCode(''); }}>Cancel</Button>
            <Button loading={busy} disabled={code.length !== 6} disabledReasonId="reauth-hint" onClick={submitReauth}>Confirm</Button>
          </>
        }
      >
        <OtpInput value={code} onChange={setCode} onComplete={() => void submitReauth()} error={codeErr} autoFocus label="Authenticator code" />
        <p id="reauth-hint" className="sr-only">Enter all 6 digits.</p>
      </Dialog>
      <Dialog
        open={idleWarn}
        onOpenChange={(o) => !o && void stay()}
        title="Still there?"
        description={`You'll be signed out in ${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')} to protect this account.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => void logout()}>Sign out</Button>
            <Button onClick={() => void stay()}>Stay signed in</Button>
          </>
        }
      />
    </SessionCtx.Provider>
  );
}

export function useToastOnMount(msg: string | null) {
  useEffect(() => {
    if (msg) toast.info(msg);
  }, [msg]);
}
