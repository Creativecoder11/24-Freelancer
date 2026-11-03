'use client';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Icon, type IconName } from '../utils/icons';
import { Logo } from '../primitives/Logo';
import { Avatar } from '../primitives/Avatar';
import { IconButton } from '../primitives/IconButton';
import { ModeSwitch } from '../forms/SegmentedControl';
import { Drawer } from '../overlays/Drawer';
import { ActionMenu } from '../overlays/ActionMenu';
import { gsap, useGSAP, MOTION_OK } from '../motion/gsap';

export type AppMode = 'worker' | 'employer';

export interface AppNavItem {
  label: string;
  href: string;
  icon: IconName;
  badge?: number;
  /** Match nested routes (default true). */
  exact?: boolean;
}

export interface AppUser {
  name: string;
  initials: string;
  publicId: string;
  avatarUrl?: string | null;
}

/** Sidebar navs per mode (Figma 12:439; Canonical §9). Badge values are injected by the app. */
export function appNav(mode: AppMode, badges: { tasks?: number; submissions?: number; notifications?: number } = {}): AppNavItem[] {
  return mode === 'worker'
    ? [
        { label: 'Overview', href: '/worker', icon: 'dashboard', exact: true },
        { label: 'Find jobs', href: '/worker/jobs', icon: 'search' },
        { label: 'My tasks', href: '/worker/tasks', icon: 'list-checks', badge: badges.tasks },
        { label: 'Wallet', href: '/worker/wallet', icon: 'wallet' },
        { label: 'Referral', href: '/worker/referral', icon: 'gift' },
        { label: 'Notifications', href: '/worker/notifications', icon: 'bell', badge: badges.notifications },
        { label: 'Settings', href: '/worker/settings', icon: 'settings' },
      ]
    : [
        { label: 'Overview', href: '/employer', icon: 'dashboard', exact: true },
        { label: 'Post a job', href: '/employer/jobs/new', icon: 'plus-circle' },
        { label: 'My jobs', href: '/employer/jobs', icon: 'briefcase' },
        { label: 'Submissions', href: '/employer/submissions', icon: 'inbox', badge: badges.submissions },
        { label: 'Wallet', href: '/employer/wallet', icon: 'wallet' },
        { label: 'Notifications', href: '/employer/notifications', icon: 'bell', badge: badges.notifications },
        { label: 'Settings', href: '/employer/settings', icon: 'settings' },
      ];
}

function isActive(pathname: string, item: AppNavItem, all: AppNavItem[]) {
  if (item.exact) return pathname === item.href;
  if (pathname === item.href) return true;
  if (!pathname.startsWith(`${item.href}/`)) return false;
  // Prefer the most specific match (/employer/jobs/new beats /employer/jobs).
  return !all.some((o) => o !== item && o.href.length > item.href.length && (pathname === o.href || pathname.startsWith(`${o.href}/`)));
}

/** Dashboard sidebar (Figma 12:439): logo, role switch, section, nav, help card, user block. */
export function Sidebar({ mode, items, user, onLogout, className, onNavigate }: { mode: AppMode; items: AppNavItem[]; user: AppUser; onLogout: () => void; className?: string; onNavigate?: () => void }) {
  const pathname = usePathname() ?? '';
  return (
    <div className={cn('flex h-full flex-col bg-surface px-4 pb-4 pt-6', className)}>
      <NextLink href={mode === 'worker' ? '/worker' : '/employer'} className="px-2" aria-label="24 Freelancing dashboard">
        <Logo decorative />
      </NextLink>
      <ModeSwitch mode={mode} workerHref="/worker" employerHref="/employer" className="mt-6 w-full" />
      <p className="mt-6 px-3 text-overline uppercase text-fg-tertiary">{mode === 'worker' ? 'Earn' : 'Hire'}</p>
      <nav aria-label="Dashboard" className="mt-2">
        <ul className="space-y-1">
          {items.map((it) => {
            const active = isActive(pathname, it, items);
            return (
              <li key={it.href}>
                <NextLink
                  href={it.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex h-11 items-center gap-3 rounded-[10px] px-3 text-label-md transition-colors',
                    active ? 'bg-brand-subtle text-fg-brand' : 'text-fg-secondary hover:bg-subtle hover:text-fg',
                  )}
                >
                  {active ? <span aria-hidden className="absolute -left-4 top-2 h-7 w-[3px] rounded-r-full bg-brand" /> : null}
                  <Icon name={it.icon} size={20} />
                  <span className="flex-1">{it.label}</span>
                  {it.badge ? (
                    <span className={cn('min-w-6 rounded-full px-2 text-center text-label-sm leading-6', active ? 'bg-brand text-fg-on-brand' : 'bg-muted text-fg-secondary')}>
                      {it.badge}
                      <span className="sr-only"> new</span>
                    </span>
                  ) : null}
                </NextLink>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-auto space-y-4 pt-6">
        <div className="rounded-[14px] bg-subtle p-4">
          <p className="text-label-md text-fg">Need help?</p>
          <p className="mt-0.5 text-body-xs text-fg-tertiary">Chat with live support</p>
          <NextLink href="/help#live-support" className="mt-2 inline-block text-label-sm font-semibold text-fg-brand hover:underline">
            Open live support
          </NextLink>
        </div>
        <div className="flex items-center gap-3 border-t border-line-subtle px-1 pt-4">
          <Avatar initials={user.initials} src={user.avatarUrl} size="M" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-label-md text-fg">{user.name}</p>
            <p className="truncate text-body-xs text-fg-tertiary">
              {mode === 'worker' ? 'Worker' : 'Employer'} · ID {user.publicId}
            </p>
          </div>
          <IconButton icon="log-out" aria-label="Log out" variant="ghost" size="S" onClick={onLogout} />
        </div>
      </div>
    </div>
  );
}

export interface TopbarProps {
  title: string;
  subtitle?: string;
  balance?: string;
  mode: AppMode;
  unread?: boolean;
  user: AppUser;
  onLogout: () => void;
  onOpenMenu?: () => void;
  /** Mobile detail screens show a back arrow instead of the logo. */
  backHref?: string;
}

/** Page header (Figma 12:477): title/subtitle, balance pill → Wallet, bell → Notifications, avatar menu (G-12). */
export function Topbar({ title, subtitle, balance, mode, unread, user, onLogout, onOpenMenu, backHref }: TopbarProps) {
  const base = mode === 'worker' ? '/worker' : '/employer';
  const other = mode === 'worker' ? 'employer' : 'worker';
  return (
    <header className="sticky top-0 z-[var(--fl-z-sticky)] border-b border-line-subtle bg-canvas/90 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-5 tablet:h-[72px] tablet:px-8 desktop:h-[76px] desktop:px-10">
        {onOpenMenu ? (
          <span className="hidden tablet:block desktop:hidden">
            <IconButton icon="menu" aria-label="Open navigation" variant="ghost" tooltip={false} onClick={onOpenMenu} />
          </span>
        ) : null}
        {backHref ? (
          <span className="tablet:hidden">
            <IconButton icon="arrow-left" aria-label="Back" variant="ghost" tooltip={false} href={backHref} />
          </span>
        ) : (
          <NextLink href={base} className="tablet:hidden" aria-label="Dashboard">
            <Logo height={28} decorative />
          </NextLink>
        )}
        <div className={cn('min-w-0 flex-1', backHref ? '' : 'hidden tablet:block')}>
          <h1 className="truncate font-display text-h4 text-fg tablet:text-h3">{title}</h1>
          {subtitle ? <p className="hidden truncate text-body-sm text-fg-tertiary desktop:block">{subtitle}</p> : null}
        </div>
        <div className="ml-auto flex items-center gap-2 tablet:gap-3">
          {balance ? (
            <NextLink
              href={`${base}/wallet`}
              className={cn(
                'hidden h-9 items-center rounded-full px-3 font-display text-num-sm tabular-nums tablet:inline-flex',
                mode === 'worker' ? 'bg-success-subtle text-fg-success' : 'bg-brand-subtle text-fg-brand',
              )}
            >
              {balance}
              <span className="sr-only"> balance, open wallet</span>
            </NextLink>
          ) : null}
          <IconButton icon="bell" aria-label={unread ? 'Notifications, unread' : 'Notifications'} variant="secondary" dot={unread} href={`${base}/notifications`} tooltip={false} />
          <ActionMenu
            label="Account"
            trigger={
              <button type="button" className="rounded-full focus-visible:shadow-focus" aria-label="Account menu">
                <Avatar initials={user.initials} src={user.avatarUrl} size="M" />
              </button>
            }
            items={[
              { key: 'settings', label: 'Profile & settings', icon: 'user', href: `${base}/settings` },
              { key: 'switch', label: `Switch to ${other === 'employer' ? 'Employer' : 'Worker'}`, icon: 'refresh', href: `/${other}` },
              { key: 'help', label: 'Help center', icon: 'help', href: '/help' },
              { key: 'logout', label: 'Log out', icon: 'log-out', onSelect: onLogout, divider: true },
            ]}
          />
        </div>
      </div>
    </header>
  );
}

const TABS: Record<AppMode, AppNavItem[]> = {
  worker: [
    { label: 'Home', href: '/worker', icon: 'dashboard', exact: true },
    { label: 'Jobs', href: '/worker/jobs', icon: 'search' },
    { label: 'Tasks', href: '/worker/tasks', icon: 'list-checks' },
    { label: 'Wallet', href: '/worker/wallet', icon: 'wallet' },
    { label: 'Profile', href: '/worker/settings', icon: 'user' },
  ],
  employer: [
    { label: 'Home', href: '/employer', icon: 'dashboard', exact: true },
    { label: 'Jobs', href: '/employer/jobs', icon: 'briefcase' },
    { label: 'Review', href: '/employer/submissions', icon: 'inbox' },
    { label: 'Wallet', href: '/employer/wallet', icon: 'wallet' },
    { label: 'Profile', href: '/employer/settings', icon: 'user' },
  ],
};

/** Mobile bottom tab bar (Figma 12:691): 5 destinations, active = brand + top indicator. */
export function MobileTabBar({ mode, badges = {} }: { mode: AppMode; badges?: Record<string, number | undefined> }) {
  const pathname = usePathname() ?? '';
  const items = TABS[mode];
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-[var(--fl-z-actionbar)] border-t border-line-subtle bg-surface pb-[env(safe-area-inset-bottom)] tablet:hidden">
      <ul className="grid grid-cols-5">
        {items.map((it) => {
          const active = isActive(pathname, it, items);
          return (
            <li key={it.href}>
              <NextLink
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className={cn('relative flex h-16 flex-col items-center justify-center gap-1 text-label-sm', active ? 'text-fg-brand' : 'text-fg-tertiary')}
              >
                {active ? <span aria-hidden className="absolute top-0 h-[3px] w-5 rounded-b-full bg-brand" /> : null}
                <span className="relative">
                  <Icon name={it.icon} size={24} />
                  {badges[it.label] ? <span className="absolute -right-1.5 -top-1 size-2 rounded-full bg-danger" aria-hidden /> : null}
                </span>
                {it.label}
              </NextLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export interface AppShellProps {
  mode: AppMode;
  user: AppUser;
  badges?: { tasks?: number; submissions?: number; notifications?: number };
  onLogout: () => void;
  header: Omit<TopbarProps, 'mode' | 'user' | 'onLogout' | 'onOpenMenu'>;
  children: React.ReactNode;
  /** Hide the mobile tab bar (detail/flow screens with a sticky action bar). */
  hideTabBar?: boolean;
}

/**
 * Signed-in layout: 256 px sidebar ≥ 1280; tablet hamburger + 288 px drawer; mobile tab bar.
 * Content fades up on route change (subtle GSAP).
 */
export function AppShell({ mode, user, badges, onLogout, header, children, hideTabBar }: AppShellProps) {
  const [drawer, setDrawer] = useState(false);
  const items = appNav(mode, badges);
  const content = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(content.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' });
      });
      return () => mm.revert();
    },
    { dependencies: [pathname], scope: content },
  );

  return (
    <div className="min-h-dvh bg-canvas desktop:pl-[var(--fl-sidebar)]">
      <aside className="fixed inset-y-0 left-0 z-[var(--fl-z-sidebar)] hidden w-[var(--fl-sidebar)] border-r border-line-subtle desktop:block">
        <Sidebar mode={mode} items={items} user={user} onLogout={onLogout} />
      </aside>
      <Drawer open={drawer} onOpenChange={setDrawer} title="Navigation" side="left" width={360} sheetOnMobile={false}>
        <Sidebar mode={mode} items={items} user={user} onLogout={onLogout} onNavigate={() => setDrawer(false)} className="-mx-5 -mt-5 px-4 pt-2" />
      </Drawer>
      <Topbar {...header} mode={mode} user={user} onLogout={onLogout} onOpenMenu={() => setDrawer(true)} />
      <main id="main" className={cn('mx-auto max-w-[1184px] px-5 py-6 tablet:px-8 tablet:py-8 desktop:px-10', !hideTabBar && 'pb-28 tablet:pb-8')}>
        <div ref={content}>{children}</div>
      </main>
      {!hideTabBar ? <MobileTabBar mode={mode} badges={{ Tasks: badges?.tasks, Review: badges?.submissions }} /> : null}
    </div>
  );
}
