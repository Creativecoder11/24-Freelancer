'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
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
  session: { last_active_at: string | null; expires_at: string | null };
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
      <div className="grid min-h-dvh place-items-center bg-surface" aria-busy="true">
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
    </SessionCtx.Provider>
  );
}

export function useToastOnMount(msg: string | null) {
  useEffect(() => {
    if (msg) toast.info(msg);
  }, [msg]);
}
