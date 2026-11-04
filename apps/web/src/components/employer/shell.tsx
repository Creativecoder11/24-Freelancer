'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell, type TopbarProps } from '@24f/ui';
import { formatMoney } from '@24f/shared';
import { api } from '@/lib/api/client';
import { RequireSession, meKey, useLogout } from '@/lib/auth/session';

export interface EmployerHeader {
  title: string;
  subtitle?: string;
  backHref?: string;
  /** Flow/detail screens pin a sticky action bar instead of the tab bar on mobile. */
  hideTabBar?: boolean;
}

const HeaderCtx = createContext<(h: EmployerHeader) => void>(() => undefined);

/** Sets the topbar title/subtitle for the current employer page. */
export function useEmployerHeader(h: EmployerHeader) {
  const set = useContext(HeaderCtx);
  const key = JSON.stringify(h);
  useEffect(() => {
    set(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, set]);
}

/** Fallback titles until a page sets its own (and for routes owned by other areas, e.g. Settings). */
function defaultHeader(path: string): EmployerHeader {
  if (path.startsWith('/employer/settings')) return { title: 'Settings', subtitle: 'Your business profile, job defaults and account.' };
  if (path.startsWith('/employer/notifications')) return { title: 'Notifications' };
  if (path.startsWith('/employer/wallet')) return { title: 'Wallet' };
  if (path.startsWith('/employer/submissions')) return { title: 'Review submissions' };
  if (path.startsWith('/employer/jobs/new')) return { title: 'Post a job' };
  if (path.startsWith('/employer/jobs')) return { title: 'My jobs' };
  return { title: 'Overview' };
}

/**
 * Employer dashboard shell (Doc 02 §6.1.1): AppShell in employer mode with live badges and the
 * balance pill from GET /me. Entering /employer while `active_mode = worker` switches the mode
 * (rule 4).
 */
export function EmployerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/employer';
  const [header, setHeader] = useState<EmployerHeader>(() => defaultHeader(pathname));
  useEffect(() => setHeader(defaultHeader(pathname)), [pathname]);
  const logout = useLogout();
  const qc = useQueryClient();
  const sync = useMutation({
    mutationFn: () => api.patch('/me/preferences', { active_mode: 'employer' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
  const setter = useMemo(() => (h: EmployerHeader) => setHeader(h), []);

  return (
    <RequireSession>
      {(me) => (
        <ModeSync needed={me.active_mode !== 'employer'} onSync={() => sync.mutate()}>
          <HeaderCtx.Provider value={setter}>
            <AppShell
              mode="employer"
              user={{
                name: me.employer?.business_name ?? me.full_name,
                initials: me.employer?.initials ?? me.initials,
                publicId: me.public_id,
                avatarUrl: me.employer ? null : me.avatar_url,
              }}
              badges={{ submissions: me.badges.employer_submissions || undefined, notifications: me.badges.notifications_unread || undefined }}
              onLogout={() => void logout('/login')}
              hideTabBar={header.hideTabBar}
              header={
                {
                  title: header.title,
                  subtitle: header.subtitle,
                  backHref: header.backHref,
                  balance: formatMoney(me.balances.employer_deposit_total_usd),
                  unread: me.badges.notifications_unread > 0,
                } satisfies Omit<TopbarProps, 'mode' | 'user' | 'onLogout' | 'onOpenMenu'>
              }
            >
              {children}
            </AppShell>
          </HeaderCtx.Provider>
        </ModeSync>
      )}
    </RequireSession>
  );
}

function ModeSync({ needed, onSync, children }: { needed: boolean; onSync: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (needed) onSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed]);
  return <>{children}</>;
}
