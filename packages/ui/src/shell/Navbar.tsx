'use client';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '../utils/cn';
import { Logo } from '../primitives/Logo';
import { Button } from '../primitives/Button';
import { IconButton } from '../primitives/IconButton';
import { BottomSheet } from '../overlays/BottomSheet';

export interface NavItem {
  label: string;
  href: string;
}

/** Public navigation (Figma 12:133): links mirror the canonical IA, Doc 02 §5 Navbar. */
export const PUBLIC_NAV: NavItem[] = [
  { label: 'Browse jobs', href: '/jobs' },
  { label: 'How it works', href: '/how-it-works' },
  { label: 'Referral', href: '/referral-program' },
  { label: 'Payout history', href: '/payout-history' },
  { label: 'Help center', href: '/help' },
];

export interface NavbarProps {
  items?: NavItem[];
  /** Signed-in visitors see "Open dashboard" instead of the auth buttons. */
  signedInHref?: string;
}

/** Sticky 76 px bar; Shadow/SM once the page scrolls; 64 px with menu sheet on mobile. */
export function Navbar({ items = PUBLIC_NAV, signedInHref }: NavbarProps) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname?.startsWith(`${href}/`));

  return (
    <header
      className={cn(
        'sticky top-0 z-[var(--fl-z-sticky)] border-b border-line-subtle bg-surface/95 backdrop-blur transition-shadow duration-200',
        scrolled && 'shadow-sm',
      )}
    >
      <div className="mx-auto flex h-16 max-w-container items-center gap-6 px-5 tablet:h-[72px] tablet:px-8 desktop:h-[76px] desktop:px-0">
        <NextLink href="/" aria-label="24 Freelancing home" className="rounded-md focus-visible:shadow-focus">
          <Logo height={32} className="desktop:h-9 desktop:w-auto" decorative />
        </NextLink>
        <nav aria-label="Main" className="ml-[94px] hidden items-center gap-8 desktop:flex">
          {items.map((it) => (
            <NextLink
              key={it.href}
              href={it.href}
              aria-current={isActive(it.href) ? 'page' : undefined}
              className={cn(
                'relative text-label-md transition-colors hover:text-fg',
                isActive(it.href) ? 'text-fg-brand after:absolute after:-bottom-[26px] after:left-0 after:h-0.5 after:w-full after:bg-brand' : 'text-fg-secondary',
              )}
            >
              {it.label}
            </NextLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {signedInHref ? (
            <Button href={signedInHref} size="M">
              Open dashboard
            </Button>
          ) : (
            <>
              <span className="hidden items-center gap-3 tablet:flex">
                <Button href="/login" variant="tertiary" size="M">
                  Log in
                </Button>
                <Button href="/signup" size="M" className="desktop:min-w-[160px]">
                  Create account
                </Button>
              </span>
              <span className="tablet:hidden">
                <Button href="/signup" size="S">
                  Sign up
                </Button>
              </span>
            </>
          )}
          <span className="desktop:hidden">
            <IconButton icon="menu" aria-label="Open menu" variant="ghost" tooltip={false} onClick={() => setMenuOpen(true)} />
          </span>
        </div>
      </div>
      <BottomSheet open={menuOpen} onOpenChange={setMenuOpen} title="Menu">
        <nav aria-label="Mobile" className="flex flex-col py-2">
          {items.map((it) => (
            <NextLink
              key={it.href}
              href={it.href}
              onClick={() => setMenuOpen(false)}
              className="flex h-12 items-center border-b border-line-subtle text-label-lg text-fg last:border-0"
            >
              {it.label}
            </NextLink>
          ))}
          {!signedInHref ? (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Button href="/login" variant="secondary" size="L" fullWidth>
                Log in
              </Button>
              <Button href="/signup" size="L" fullWidth>
                Create account
              </Button>
            </div>
          ) : null}
        </nav>
      </BottomSheet>
    </header>
  );
}
