'use client';
/** Shared worker-screen building blocks (cards, back link, employer trust card, errors). */
import NextLink from 'next/link';
import { useRef } from 'react';
import type { EmployerTrust } from '@24f/shared';
import { formatYearMonth } from '@24f/shared';
import { Avatar, Button, EmptyState, Icon, cn, gsap, useGSAP, MOTION_OK } from '@24f/ui';
import type { ApiError } from '@/lib/api/client';

/** Surface card: radius 16, 1 px border, Shadow/XS (Figma section cards). */
export function Panel({ children, className, as: As = 'section', ...rest }: { children: React.ReactNode; className?: string; as?: 'section' | 'div' | 'aside' } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cn('rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6', className)} {...rest}>
      {children}
    </As>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <NextLink href={href} className="hidden items-center gap-2 rounded-[4px] text-label-md text-fg-secondary hover:text-fg focus-visible:shadow-focus focus-visible:outline-none tablet:inline-flex">
      <Icon name="arrow-left" size={16} />
      {children}
    </NextLink>
  );
}

/** Mobile-only page heading (the topbar shows the logo on top-level mobile screens). */
export function MobileTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5 tablet:hidden">
      <h2 className="font-display text-h2 text-fg">{title}</h2>
      {subtitle ? <p className="mt-1 text-body-sm text-fg-tertiary">{subtitle}</p> : null}
    </div>
  );
}

/** `common.error.load` region (Doc 02 §11.2) with "Try again". */
export function LoadError({ error, onRetry, title = 'We couldn’t load this', body = 'Check your connection and try again.', className }: { error?: ApiError | null; onRetry: () => void; title?: string; body?: string; className?: string }) {
  const forbidden = error?.status === 403;
  return (
    <div role="alert" className={cn('rounded-card border border-line bg-surface', className)}>
      <EmptyState
        icon="alert-triangle"
        title={forbidden ? 'You don’t have access to this page.' : title}
        body={forbidden ? undefined : error?.status === 429 ? 'Too many tries. Wait a moment, then try again.' : body}
        action={
          forbidden ? undefined : (
            <Button variant="secondary" size="M" leadingIcon="refresh" onClick={onRetry}>
              Try again
            </Button>
          )
        }
      />
    </div>
  );
}

/** Employer trust card (Figma 13:479). */
export function EmployerCard({ employer, className }: { employer: EmployerTrust; className?: string }) {
  const stats: [string, string][] = [
    [employer.approval_rate_pct !== null ? `${employer.approval_rate_pct}%` : '—', 'Approval rate'],
    [employer.avg_review_hours !== null ? `${employer.avg_review_hours} h` : '—', 'Avg. review'],
    [String(employer.jobs_posted), 'Jobs posted'],
  ];
  return (
    <Panel className={cn('p-5', className)} aria-label="Employer">
      <div className="flex items-center gap-3">
        <Avatar initials={employer.initials} size="L" tone="accent" name={employer.business_name} />
        <div className="min-w-0">
          <p className="truncate text-label-lg text-fg">{employer.business_name}</p>
          <p className="text-body-xs text-fg-tertiary">
            {employer.employer_verified ? 'Verified employer' : 'Employer'}
            {employer.since ? ` · since ${formatYearMonth(employer.since)}` : ''}
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2">
        {stats.map(([v, k]) => (
          <div key={k} className="flex flex-col-reverse rounded-[12px] bg-subtle px-2 py-3 text-center">
            <dt className="text-body-xs text-fg-tertiary">{k}</dt>
            <dd className="font-display text-num-sm font-semibold text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-body-xs text-fg-tertiary">Rejections must include a reason.</p>
    </Panel>
  );
}

/** Label/value rows (reward card, job summary). */
export function Rows({ rows, className }: { rows: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn('space-y-3 text-body-sm', className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <dt className="text-fg-secondary">{k}</dt>
          <dd className="text-right text-label-md text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Small bounce on the element when `on` flips to true (checklist ticks). */
export function useTickBounce<T extends HTMLElement>(on: boolean, from = 0.6) {
  const ref = useRef<T>(null);
  const first = useRef(true);
  useGSAP(
    () => {
      if (first.current) {
        first.current = false;
        return;
      }
      if (!on || !ref.current) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(ref.current, { scale: from }, { scale: 1, duration: 0.45, ease: 'back.out(3)', clearProps: 'transform' });
      });
      return () => mm.revert();
    },
    { dependencies: [on] },
  );
  return ref;
}

/** Gentle repeating pulse while `active` (countdown in its last 5 minutes). */
export function usePulse<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  useGSAP(
    () => {
      if (!active || !ref.current) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.to(ref.current, { scale: 1.06, opacity: 0.75, duration: 0.6, ease: 'sine.inOut', yoyo: true, repeat: -1, transformOrigin: 'center' });
      });
      return () => mm.revert();
    },
    { dependencies: [active] },
  );
  return ref;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** "docs.google.com/spreadsheets/d/…" display form of a URL. */
export function shortUrl(u: string, max = 52): string {
  const s = u.replace(/^https?:\/\//, '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
