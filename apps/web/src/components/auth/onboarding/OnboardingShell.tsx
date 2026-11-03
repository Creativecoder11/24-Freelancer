'use client';
import NextLink from 'next/link';
import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@24f/shared';
import { Icon, Logo, cn, gsap, useGSAP, MOTION_OK, toast } from '@24f/ui';
import { api } from '@/lib/api/client';
import { RequireSession, meKey } from '@/lib/auth/session';

export interface OnboardingResult {
  onboarding_step: number;
  onboarding_completed_at: string | null;
  active_mode: 'worker' | 'employer';
  next_path: string;
}

/** POST /me/onboarding, then go to `next_path`. */
export function useOnboardingStep() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<OnboardingResult>('/me/onboarding', body),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: meKey });
      if (res.onboarding_completed_at) toast.show({ tone: 'success', title: 'You’re all set', body: 'Start with a job that fits your time.' });
      router.push(res.next_path);
    },
  });
}

export const SAVE_FAILED = { tone: 'danger' as const, title: 'That didn’t save', body: 'Your changes are still here. Try again.' };

/** "Skip for now" (top right): finishes onboarding and opens the overview. */
export function SkipLink({ className }: { className?: string }) {
  const step = useOnboardingStep();
  return (
    <button
      type="button"
      onClick={() => step.mutate({ step: 'skip' }, { onError: () => toast.show(SAVE_FAILED) })}
      disabled={step.isPending}
      className={cn(
        'relative rounded-[6px] text-label-md text-fg-tertiary hover:text-fg focus-visible:shadow-focus disabled:text-fg-disabled before:absolute before:-inset-3 before:content-[""]',
        className,
      )}
    >
      {step.isPending ? 'Skipping…' : 'Skip for now'}
    </button>
  );
}

/**
 * Onboarding shell (Doc 02 §6.1.4): Logo top left, step text or "Skip for now" top right, no
 * sidebar. Signed-in only. Content gets a light GSAP stagger ([data-onb]).
 */
export function OnboardingShell({ right, children }: { right?: React.ReactNode; children: (me: Me) => React.ReactNode }) {
  return (
    <RequireSession>
      {(me) => (
        <div className="min-h-dvh bg-surface">
          <header className="flex items-center justify-between gap-4 px-5 pt-5 tablet:px-16 tablet:pt-12">
            <NextLink href="/" aria-label="24 Freelancing home" className="rounded-[6px] focus-visible:shadow-focus">
              <Logo decorative />
            </NextLink>
            <div className="text-label-md text-fg-tertiary">{right}</div>
          </header>
          <Stagger>{children(me)}</Stagger>
        </div>
      )}
    </RequireSession>
  );
}

function Stagger({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const items = ref.current?.querySelectorAll('[data-onb]');
        if (items?.length) gsap.from(items, { autoAlpha: 0, y: 16, duration: 0.5, stagger: 0.06, ease: 'power2.out', clearProps: 'opacity,visibility,transform' });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <main id="main" ref={ref} className="px-5 pb-12 tablet:px-8">
      {children}
    </main>
  );
}

type ItemState = 'done' | 'current' | 'todo';

/** Setup checklist panel (Figma 27:742, 320×520). */
export function SetupChecklist({ items }: { items: { title: string; status: string; state: ItemState }[] }) {
  return (
    <aside data-onb aria-label="Your setup" className="w-full shrink-0 rounded-[24px] border border-line bg-surface p-6 desktop:min-h-[520px] desktop:w-[320px] desktop:p-[26px]">
      <h2 className="font-display text-h4 text-fg">Your setup</h2>
      <p className="text-body-sm text-fg-tertiary">About 3 minutes</p>
      <ol className="mt-5 flex flex-col gap-4 desktop:mt-7">
        {items.map((it, i) => (
          <li
            key={it.title}
            aria-current={it.state === 'current' ? 'step' : undefined}
            className={cn('flex h-20 items-center gap-3 rounded-[14px] px-3', it.state === 'current' && 'bg-brand-subtle')}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full text-label-sm',
                it.state === 'done' ? 'bg-success-bright text-fg-on-brand' : it.state === 'current' ? 'bg-brand text-fg-on-brand' : 'bg-muted text-fg-tertiary',
              )}
            >
              {it.state === 'done' ? <Icon name="check" size={16} strokeWidth={2.5} /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-label-md text-fg">{it.title}</span>
              <span className={cn('block text-body-xs', it.state === 'done' ? 'text-fg-success' : 'text-fg-tertiary')}>{it.status}</span>
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

export function workerChecklist(current: 2 | 3) {
  return [
    { title: 'Account created', status: 'Done', state: 'done' as const },
    { title: 'Your interests', status: current === 2 ? 'In progress' : 'Done', state: current === 2 ? ('current' as const) : ('done' as const) },
    { title: 'Payout method', status: current === 3 ? 'In progress' : 'Add before withdrawing', state: current === 3 ? ('current' as const) : ('todo' as const) },
    { title: 'Try a starter task', status: 'Earn your first reward', state: 'todo' as const },
  ];
}

/** Main onboarding card (Figma 27:766, 848 wide, radius 24, 40 px padding). */
export function OnboardingCard({ overline, title, sub, children }: { overline: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section data-onb className="w-full min-w-0 rounded-[24px] border border-line bg-surface p-5 shadow-xs tablet:p-10 desktop:w-[848px]">
      <p className="text-overline uppercase text-fg-brand">{overline}</p>
      <h1 className="mt-2 font-display text-h3 text-fg tablet:text-h2">{title}</h1>
      <p className="mt-2 text-body-md text-fg-secondary">{sub}</p>
      {children}
    </section>
  );
}

/** Checklist + card side by side at ≥ 1280 (1200 wide, 32 gap), stacked below. */
export function OnboardingTwoColumn({ checklist, children }: { checklist: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-6 flex w-full max-w-[1200px] flex-col-reverse gap-6 tablet:mt-10 desktop:mt-[52px] desktop:flex-row desktop:items-start desktop:gap-8">
      <div className="hidden tablet:block desktop:contents">{checklist}</div>
      {children}
    </div>
  );
}
