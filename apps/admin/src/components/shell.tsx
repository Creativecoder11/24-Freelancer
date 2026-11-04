'use client';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ArrowDownCircle, ArrowUpCircle, BadgeCheck, BarChart3, BookOpen, FileText, Flag, Gift, History, Inbox, Layers, LayoutDashboard, ListChecks, Menu, Scale, Send, Settings, ShieldCheck, UserCog, Users, type LucideIcon,
} from 'lucide-react';
import { ActionMenu, Alert, Avatar, Drawer, IconButton, Logo, Search, cn, gsap, initialsFrom, toast, useGSAP, MOTION_OK } from '@24f/ui';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/hooks';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  perms: string[];
  badge?: string;
  exact?: boolean;
}

/** Sidebar groups (Doc 09 §3.4). Items show only when the role's permissions allow. */
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'OVERVIEW', items: [{ label: 'Dashboard', href: '/', icon: LayoutDashboard, perms: ['dashboard.read'], exact: true }] },
  {
    group: 'PEOPLE',
    items: [
      { label: 'Users', href: '/users', icon: Users, perms: ['users.read_masked', 'users.read'] },
      { label: 'KYC review', href: '/kyc', icon: ShieldCheck, perms: ['kyc.read_status', 'kyc.read'], badge: 'kyc_pending' },
      { label: 'Employer verification', href: '/employers/verification', icon: BadgeCheck, perms: ['employers.verify'], badge: 'employer_verification' },
    ],
  },
  {
    group: 'MARKETPLACE',
    items: [
      { label: 'Jobs', href: '/jobs', icon: Layers, perms: ['jobs.read'], badge: 'flagged_jobs' },
      { label: 'Submissions', href: '/submissions', icon: ListChecks, perms: ['submissions.read'], badge: 'escalated_submissions' },
      { label: 'Disputes', href: '/disputes', icon: Scale, perms: ['disputes.read', 'disputes.resolve'], badge: 'disputes_open' },
      { label: 'Job reports', href: '/reports', icon: Flag, perms: ['reports.read'], badge: 'reports_open', exact: true },
    ],
  },
  {
    group: 'MONEY',
    items: [
      { label: 'Deposits', href: '/deposits', icon: ArrowDownCircle, perms: ['deposits.read_masked', 'deposits.read'], badge: 'deposits_pending_approval' },
      { label: 'Withdrawals', href: '/withdrawals', icon: ArrowUpCircle, perms: ['withdrawals.read_masked', 'withdrawals.read'], badge: 'withdrawals_requested' },
      { label: 'Ledger', href: '/ledger', icon: BookOpen, perms: ['ledger.read', 'ledger.read_aggregate'], badge: 'adjustments_pending' },
      { label: 'Referrals', href: '/referrals', icon: Gift, perms: ['referrals.read', 'referrals.read_aggregate'] },
      { label: 'Reports', href: '/reports/financial', icon: BarChart3, perms: ['reports.financial', 'reports.operational'] },
    ],
  },
  {
    group: 'SUPPORT AND CONTENT',
    items: [
      { label: 'Support messages', href: '/support/messages', icon: Inbox, perms: ['support.reply'], badge: 'support_new' },
      { label: 'Content', href: '/content', icon: FileText, perms: ['content.write'] },
      { label: 'Broadcast', href: '/notifications/broadcast', icon: Send, perms: ['broadcast.send'] },
    ],
  },
  {
    group: 'SYSTEM',
    items: [
      { label: 'Settings', href: '/settings', icon: Settings, perms: ['settings.read', 'payout_configs.read'] },
      { label: 'Admin users', href: '/admins', icon: UserCog, perms: ['admins.manage'] },
      { label: 'Audit log', href: '/audit-log', icon: History, perms: ['audit.read'] },
    ],
  },
];

function active(pathname: string, it: NavItem) {
  const p = pathname.replace(/^\/admin/, '') || '/';
  if (it.exact) return p === it.href;
  return p === it.href || p.startsWith(`${it.href}/`);
}

interface Dashboard {
  queues: Record<string, number>;
  alerts: { severity: string; code: string; message: string; link: string }[];
}

function Sidebar({ queues, onNavigate }: { queues: Record<string, number>; onNavigate?: () => void }) {
  const { me, can, logout } = useSession();
  const pathname = usePathname() ?? '';
  return (
    <div className="flex h-full flex-col bg-surface px-4 pb-4 pt-6">
      <NextLink href="/" className="flex items-center gap-2 px-2" aria-label="Admin dashboard" onClick={onNavigate}>
        <Logo decorative height={30} />
        <span className="rounded-[6px] bg-inverse px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-inverse">Admin</span>
      </NextLink>
      <nav aria-label="Admin" className="adm-scroll mt-5 min-h-0 flex-1 overflow-y-auto">
        {NAV.map((g) => {
          const items = g.items.filter((i) => can(...i.perms));
          if (!items.length) return null;
          return (
            <div key={g.group} className="mb-4">
              <p className="px-3 pb-1.5 text-overline uppercase text-fg-tertiary">{g.group}</p>
              <ul className="space-y-0.5">
                {items.map((it) => {
                  const on = active(pathname, it);
                  const n = it.badge ? (queues[it.badge] ?? 0) : 0;
                  const Icon = it.icon;
                  return (
                    <li key={it.href}>
                      <NextLink
                        href={it.href}
                        onClick={onNavigate}
                        aria-current={on ? 'page' : undefined}
                        className={cn('relative flex h-10 items-center gap-3 rounded-[10px] px-3 text-label-md transition-colors', on ? 'bg-brand-subtle text-fg-brand' : 'text-fg-secondary hover:bg-subtle hover:text-fg')}
                      >
                        {on ? <span aria-hidden className="absolute -left-4 top-1.5 h-7 w-[3px] rounded-r-full bg-brand" /> : null}
                        <Icon size={18} aria-hidden />
                        <span className="flex-1 truncate">{it.label}</span>
                        {n > 0 ? (
                          <span className={cn('min-w-6 rounded-full px-1.5 text-center text-label-sm leading-5 tabular-nums', on ? 'bg-brand text-fg-on-brand' : 'bg-muted text-fg-secondary')}>
                            {n > 99 ? '99+' : n}
                            <span className="sr-only"> waiting</span>
                          </span>
                        ) : null}
                      </NextLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="flex items-center gap-3 border-t border-line-subtle px-1 pt-4">
        <Avatar initials={initialsFrom(me.full_name)} size="M" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-label-md text-fg">{me.full_name}</p>
          <p className="truncate text-body-xs text-fg-tertiary">{me.role_labels[0]}</p>
        </div>
        <IconButton icon="log-out" aria-label="Sign out" variant="ghost" size="S" onClick={() => void logout()} />
      </div>
    </div>
  );
}

const HeaderCtx = createContext<{ set: (t: { title: string; subtitle?: string }) => void }>({ set: () => undefined });

/** Sets the topbar title and subtitle for the current screen. */
export function usePageHeader(title: string, subtitle?: string) {
  const { set } = useContext(HeaderCtx);
  useEffect(() => {
    set({ title, subtitle });
    document.title = `${title} · 24F Admin`;
  }, [title, subtitle, set]);
}

/** Global search routing on the ID pattern (Doc 09 §3.2). */
function routeFor(q: string): string | null {
  const s = q.trim().toUpperCase();
  if (/^\d{6}$/.test(s)) return `/users/${s}`;
  if (/^[A-Z]{2}-\d{4,}$/.test(s)) {
    const pfx = s.slice(0, 3);
    const map: Record<string, string> = { 'SB-': `/submissions?ref=${s}`, 'DS-': `/disputes?ref=${s}`, 'WD-': `/withdrawals?ref=${s}`, 'DP-': `/deposits?ref=${s}`, 'TX-': `/ledger?ref=${s}` };
    return map[pfx] ?? `/jobs/${s}`;
  }
  return null;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { me, can, logout, tick } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [header, setHeader] = useState<{ title: string; subtitle?: string }>({ title: 'Dashboard' });
  const [q, setQ] = useState('');
  const dash = useApi<Dashboard>(can('dashboard.read') ? '/admin/dashboard' : null, { t: tick }, { pollMs: 60_000 });
  const queues = dash.data?.queues ?? {};
  const content = useRef<HTMLDivElement>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const up = () => setOffline(!navigator.onLine);
    up();
    window.addEventListener('online', up);
    window.addEventListener('offline', up);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', up);
    };
  }, []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(content.current, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' });
      });
      return () => mm.revert();
    },
    { dependencies: [pathname], scope: content },
  );

  const search = (v: string) => {
    const dest = routeFor(v);
    if (dest) {
      const needs: Record<string, string[]> = { '/users': ['users.read_masked', 'users.read'], '/jobs': ['jobs.read'], '/submissions': ['submissions.read'], '/disputes': ['disputes.read', 'disputes.resolve'], '/withdrawals': ['withdrawals.read_masked', 'withdrawals.read'], '/deposits': ['deposits.read_masked', 'deposits.read'], '/ledger': ['ledger.read'] };
      const base = '/' + dest.split(/[/?]/)[1];
      if (needs[base] && !can(...needs[base]!)) return toast.error("Your role can't do this.");
      router.push(dest);
    } else if (can('users.read_masked', 'users.read')) {
      sessionStorage.setItem('adm:user-q', v);
      router.push('/users?from=search');
    } else toast.error("Your role can't do this.");
    setQ('');
  };

  const onDashboard = (pathname ?? '/').replace(/^\/admin/, '') === '' || (pathname ?? '/').replace(/^\/admin/, '') === '/';
  const shellAlerts = onDashboard ? [] : (dash.data?.alerts ?? []).filter((a) => ['fx_stale', 'fx_stale_soon', 'recon_critical', 'paused_withdrawals', 'paused_deposits', 'banner_live'].includes(a.code));
  const isProd = me.app_env === 'production';

  return (
    <HeaderCtx.Provider value={{ set: setHeader }}>
      <div className="min-h-dvh bg-canvas desktop:pl-64">
        {!isProd ? <div className="sticky top-0 z-[60] bg-warning py-0.5 text-center text-label-sm font-semibold text-fg desktop:pl-0">STAGING — test money only</div> : null}
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-line-subtle desktop:block">
          <Sidebar queues={queues} />
        </aside>
        <Drawer open={drawer} onOpenChange={setDrawer} title="Navigation" side="left" width={360} sheetOnMobile={false}>
          <div className="-mx-6 -my-6 h-[calc(100dvh-80px)]">
            <Sidebar queues={queues} onNavigate={() => setDrawer(false)} />
          </div>
        </Drawer>
        <header className="sticky top-0 z-30 border-b border-line-subtle bg-canvas/90 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 tablet:px-8 desktop:h-[76px] desktop:px-10">
            <span className="desktop:hidden">
              <IconButton icon="menu" aria-label="Open navigation" variant="ghost" tooltip={false} onClick={() => setDrawer(true)} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-h4 text-fg tablet:text-h3">{header.title}</h1>
              {header.subtitle ? <p className="hidden truncate text-body-sm text-fg-tertiary laptop:block">{header.subtitle}</p> : null}
            </div>
            <div className="hidden w-[320px] laptop:block">
              <Search size="M" value={q} onValueChange={setQ} onSubmit={search} label="Global search" placeholder="Find by ID or reference" />
            </div>
            <ActionMenu
              label="Account"
              trigger={
                <button type="button" className="rounded-full focus-visible:shadow-focus" aria-label="Account menu">
                  <Avatar initials={initialsFrom(me.full_name)} size="M" />
                </button>
              }
              items={[
                { key: 'who', label: `${me.full_name} · ${me.email}`, disabled: true, disabledReason: 'Signed in' },
                { key: 'roles', label: `Your roles: ${me.role_labels.join(', ')}`, disabled: true, disabledReason: 'Read only' },
                { key: 'out', label: 'Sign out', icon: 'log-out', onSelect: () => void logout(), divider: true },
              ]}
            />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[1440px] px-4 py-6 tablet:px-8 desktop:px-10 desktop:pb-10 desktop:pt-8">
          {offline ? <Alert tone="warning" className="mb-4" title="You're offline">Actions are paused until your connection is back.</Alert> : null}
          {shellAlerts.length ? (
            <div className="mb-5 space-y-2">
              {shellAlerts.map((a) => (
                <Alert key={a.code} tone={a.severity === 'critical' ? 'danger' : a.severity === 'info' ? 'info' : 'warning'} action={a.link ? <NextLink className="text-label-md text-fg-brand hover:underline" href={a.link}>Open</NextLink> : null}>
                  {a.message}
                </Alert>
              ))}
            </div>
          ) : null}
          <div className="mb-4 laptop:hidden">
            <Alert tone="info">To take action, use a screen at least 1024 px wide.</Alert>
          </div>
          <div ref={content}>{children}</div>
        </main>
      </div>
    </HeaderCtx.Provider>
  );
}

/** Hides write controls below 1024 px (Doc 09 §23). */
export function WriteOnly({ children }: { children: React.ReactNode }) {
  return <span className="hidden laptop:contents">{children}</span>;
}

export { Menu };
