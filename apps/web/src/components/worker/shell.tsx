'use client';
/**
 * Worker dashboard shell (Doc 02 §6.1.1, Figma 12:439 + 12:477). Wraps every /worker/* page in the
 * AppShell (worker mode): user from GET /me, badges from GET /worker/overview and
 * GET /notifications/unread-count, balance pill, logout through the session helper.
 *
 * Pages set a dynamic title/subtitle with `useWorkerHeader({...})`. Static defaults per route are
 * resolved here so the topbar is right on the first paint.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@24f/shared';
import { formatMoney } from '@24f/shared';
import { AppShell, toast } from '@24f/ui';
import { api } from '@/lib/api/client';
import { RequireSession, meKey, useLogout } from '@/lib/auth/session';
import { useOverview, useUnreadCount } from './data';

export interface WorkerHeader {
  title: string;
  subtitle?: string;
  /** Mobile back arrow target (detail and flow screens). */
  backHref?: string;
  /** Detail and flow screens hide the mobile tab bar and use a StickyActionBar. */
  hideTabBar?: boolean;
}

type Ctx = { set: (path: string, h: Partial<WorkerHeader> | null) => void };
const HeaderCtx = createContext<Ctx>({ set: () => undefined });

/** Override the topbar for the current page. Pass a stable object (or memoise) to avoid churn. */
export function useWorkerHeader(h: Partial<WorkerHeader> | null) {
  const { set } = useContext(HeaderCtx);
  const pathname = usePathname() ?? '';
  const key = h ? JSON.stringify(h) : '';
  useEffect(() => {
    set(pathname, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, key, set]);
}

const SUB = {
  jobs: 'Pick something that fits your time. Rewards are paid per approved task.',
  tasks: 'Everything you’ve submitted and where it stands.',
  notifications: 'Updates on your tasks, payouts and account.',
};

/** Route defaults (Figma topbar copy per frame, inventory §1.2). */
export function defaultHeader(pathname: string, me: Me): WorkerHeader {
  const p = pathname.replace(/\/$/, '');
  if (p === '/worker') return { title: `Good ${me.greeting_part}, ${me.full_name.split(' ')[0]}` };
  if (p === '/worker/jobs') return { title: 'Find jobs', subtitle: SUB.jobs };
  if (/^\/worker\/jobs\/[^/]+\/submit$/.test(p)) return { title: 'Submit proof', backHref: p.replace(/\/submit$/, ''), hideTabBar: true };
  if (/^\/worker\/jobs\/[^/]+$/.test(p)) return { title: 'Job details', backHref: '/worker/jobs', hideTabBar: true };
  if (p === '/worker/tasks') return { title: 'My tasks', subtitle: SUB.tasks };
  if (/^\/worker\/tasks\/[^/]+\/fix$/.test(p)) return { title: 'Fix & resubmit', backHref: p.replace(/\/fix$/, ''), hideTabBar: true };
  if (/^\/worker\/tasks\/[^/]+$/.test(p)) return { title: 'Task details', backHref: '/worker/tasks', hideTabBar: true };
  if (p === '/worker/notifications') return { title: 'Notifications', subtitle: SUB.notifications };
  if (p.startsWith('/worker/wallet')) return { title: 'Wallet' };
  if (p.startsWith('/worker/referral')) return { title: 'Referral' };
  if (p.startsWith('/worker/settings')) return { title: 'Settings' };
  return { title: 'Worker' };
}

function Shell({ me, children }: { me: Me; children: React.ReactNode }) {
  const pathname = usePathname() ?? '/worker';
  const logout = useLogout();
  const overview = useOverview();
  const unread = useUnreadCount();
  const [override, setOverride] = useState<{ path: string; h: Partial<WorkerHeader> } | null>(null);
  const ctx = useMemo<Ctx>(() => ({ set: (path, h) => setOverride(h ? { path, h } : null) }), []);

  const base = defaultHeader(pathname, me);
  const header = override && override.path === pathname ? { ...base, ...override.h } : base;
  const unreadN = unread.data?.by_audience.worker ?? overview.data?.badges.notifications_unread ?? me.badges.notifications_unread;
  const tasksN = overview.data?.badges.my_tasks ?? me.badges.worker_tasks;
  const balance = overview.data?.stats.available_usd ?? me.balances.worker_available_usd;

  return (
    <HeaderCtx.Provider value={ctx}>
      <AppShell
        mode="worker"
        user={{ name: me.full_name, initials: me.initials, publicId: me.public_id, avatarUrl: me.avatar_url }}
        badges={{ tasks: tasksN || undefined, notifications: unreadN || undefined }}
        onLogout={async () => {
          await logout('/login');
          toast.show({ tone: 'info', title: 'You’re signed out.' });
        }}
        header={{ title: header.title, subtitle: header.subtitle, balance: formatMoney(balance), unread: unreadN > 0, backHref: header.backHref }}
        hideTabBar={header.hideTabBar}
      >
        {me.status === 'restricted' ? <RestrictedBanner /> : null}
        {children}
      </AppShell>
    </HeaderCtx.Provider>
  );
}

function RestrictedBanner() {
  return (
    <div role="alert" className="mb-6 rounded-[14px] border border-line-warning bg-warning-subtle px-4 py-3 text-body-sm text-fg-secondary">
      <p className="text-label-md text-fg-warning">Your account is restricted</p>
      <p className="mt-0.5">
        You can sign in, but you can’t start jobs, publish or withdraw right now. Contact support to appeal.{' '}
        <NextLink href="/help#live-support" className="font-semibold text-fg-brand hover:underline">
          Contact support
        </NextLink>
      </p>
    </div>
  );
}

/** Entering /worker/* while `active_mode = employer` updates the mode (Doc 02 §6.1.1 rule 4). */
function ModeSync({ me }: { me: Me }) {
  const qc = useQueryClient();
  const sync = useMutation({
    mutationFn: () => api.patch('/me/preferences', { active_mode: 'worker' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
  useEffect(() => {
    if (me.active_mode !== 'worker' && !sync.isPending && !sync.isSuccess) sync.mutate();
  }, [me.active_mode, sync]);
  return null;
}

export function WorkerShell({ children }: { children: React.ReactNode }) {
  return (
    <RequireSession>
      {(me) => (
        <>
          <ModeSync me={me} />
          <Shell me={me}>{children}</Shell>
        </>
      )}
    </RequireSession>
  );
}
