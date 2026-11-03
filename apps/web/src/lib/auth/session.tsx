'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedResponse, Me } from '@24f/shared';
import { Spinner } from '@24f/ui';
import { api, ApiError, getAccessToken, hasSessionHint, logout, setAccessToken } from '@/lib/api/client';
import { postAuthPath, safeNext } from '@/lib/next-param';

export const meKey = ['me'] as const;

/** GET /me for the signed-in user. Disabled for guests (no hint and no token). */
export function useMe(opts: { enabled?: boolean } = {}) {
  const [canAsk, setCanAsk] = useState(false);
  useEffect(() => setCanAsk(hasSessionHint() || !!getAccessToken()), []);
  return useQuery<Me, ApiError>({
    queryKey: meKey,
    queryFn: () => api.get<Me>('/me'),
    enabled: canAsk && (opts.enabled ?? true),
    staleTime: 30_000,
    retry: (n, e) => !(e instanceof ApiError && e.status > 0 && e.status < 500) && n < 2,
  });
}

/** Stores the access token from a sign-in response and drops cached user data. */
export function useSignedIn() {
  const qc = useQueryClient();
  const router = useRouter();
  return (res: AuthenticatedResponse, next?: string | null) => {
    setAccessToken(res.access_token, res.expires_in);
    qc.removeQueries({ queryKey: meKey });
    router.replace(postAuthPath(res.user, next));
  };
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return async (to = '/login') => {
    await logout();
    qc.clear();
    router.replace(to);
  };
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas" aria-busy="true">
      <Spinner size={24} label="Loading" />
    </div>
  );
}

/**
 * Client guard for signed-in routes (Doc 03 §2.5). Middleware already redirects guests without
 * the `fl_session` hint; this handles a stale hint or an expired session.
 */
export function RequireSession({ children }: { children: (me: Me) => React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const failed = me.isError && me.error.status > 0 && me.error.status < 500;
  useEffect(() => {
    const guest = !hasSessionHint() && !getAccessToken();
    if (guest || failed) {
      const next = safeNext(pathname);
      const qs = new URLSearchParams();
      if (next) qs.set('next', next);
      if (failed) qs.set('reason', me.error?.code === 'ACCOUNT_SUSPENDED' ? 'suspended' : me.error?.code === 'ACCOUNT_CLOSED' ? 'closed' : 'session_expired');
      router.replace(`/login${qs.size ? `?${qs}` : ''}`);
    }
  }, [failed, me.error, pathname, router]);
  if (!me.data) return <FullPageSpinner />;
  return <>{children(me.data)}</>;
}

/** Signed-in users opening /login or /signup go to `next` or their overview (Doc 02 §6.1.5). */
export function GuestOnlyGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const me = useMe();
  useEffect(() => {
    if (!me.data) return;
    const m = me.data;
    const nextPath = m.onboarding_completed_at ? (m.active_mode === 'employer' ? '/employer' : '/worker') : '/onboarding/role';
    router.replace(postAuthPath({ next_path: nextPath, active_mode: m.active_mode }, params.get('next')));
  }, [me.data, params, router]);
  return <>{children}</>;
}
