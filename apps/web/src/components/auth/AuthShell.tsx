import NextLink from 'next/link';
import { Icon, Logo, cn } from '@24f/ui';
import { BrandPanel, type BrandPanelContent } from './BrandPanel';

export interface AuthShellProps {
  /** Top-right prompt + link ("New here?" "Create an account"). Moves to the bottom on mobile. */
  switchLink?: { prompt: string; label: string; href: string };
  brand: BrandPanelContent;
  /** Figma y of the first content element at 1440×1024 (header ends at 84). */
  desktopTop: number;
  /** Legal line pinned near the bottom on tablet and desktop (Sign in). */
  legal?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Auth shell (Doc 02 §6.1.3): white form column (Logo x64 y48, form 400 wide centred) and the navy
 * brand panel on the right at ≥ 1280. Tablet hides the panel and centres the form. Mobile: full
 * width with a 20 px gutter, switch link at the bottom (Figma 46:764).
 */
export function AuthShell({ switchLink, brand, desktopTop, legal, children }: AuthShellProps) {
  return (
    <div className="flex min-h-dvh bg-surface">
      <div className="relative flex min-h-dvh w-full min-w-0 flex-col desktop:w-1/2">
        <header className="flex items-center justify-between gap-4 px-5 pt-5 tablet:pl-16 tablet:pr-[34px] tablet:pt-12">
          <NextLink href="/" aria-label="24 Freelancing home" className="rounded-[6px] focus-visible:shadow-focus">
            <Logo decorative />
          </NextLink>
          {switchLink ? (
            <p className="hidden text-body-sm text-fg-secondary tablet:block">
              {switchLink.prompt}{' '}
              <NextLink href={switchLink.href} className="text-label-md text-fg-brand hover:underline underline-offset-2 focus-visible:shadow-focus rounded-[4px]">
                {switchLink.label}
              </NextLink>
            </p>
          ) : null}
        </header>
        <main id="main" className="flex flex-1 flex-col px-5 pb-10 tablet:px-8">
          <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col pt-9 tablet:pt-[var(--auth-top)]" style={{ ['--auth-top' as string]: `${Math.max(24, desktopTop - 84)}px` }}>
            {children}
          </div>
          {switchLink ? (
            <p className="mt-10 text-center text-body-md text-fg-secondary tablet:hidden">
              {switchLink.prompt}{' '}
              <NextLink href={switchLink.href} className="text-label-lg text-fg-brand">
                {switchLink.label}
              </NextLink>
            </p>
          ) : null}
          {legal ? <div className={cn('mx-auto mt-10 hidden w-full max-w-[400px] pb-6 text-center text-body-xs text-fg-tertiary tablet:block')}>{legal}</div> : null}
        </main>
      </div>
      <aside className="sticky top-0 hidden h-dvh w-1/2 desktop:block">
        <BrandPanel content={brand} />
      </aside>
    </div>
  );
}

/** H1 + subtitle block used by every auth form (Heading/H1, Body/LG; Body/MD on mobile). */
export function AuthHeading({ title, sub, subSize = 'lg' }: { title: string; sub?: React.ReactNode; subSize?: 'lg' | 'md' }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-h1 text-fg">{title}</h1>
      {sub ? <p className={cn('text-body-md text-fg-secondary', subSize === 'lg' && 'tablet:text-body-lg')}>{sub}</p> : null}
    </div>
  );
}

/** "← Back to sign in" (Figma 26:671): 20 px arrow, Label/MD secondary. */
export function BackLink({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <NextLink
      href={href}
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-2 self-start rounded-[6px] text-label-md text-fg-secondary hover:text-fg focus-visible:shadow-focus tablet:min-h-6"
    >
      <Icon name="arrow-left" size={20} />
      {children}
    </NextLink>
  );
}
