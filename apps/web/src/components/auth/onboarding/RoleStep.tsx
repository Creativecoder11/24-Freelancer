'use client';
import { useState } from 'react';
import type { ActiveMode, Me } from '@24f/shared';
import { Button, cn, toast } from '@24f/ui';
import { OnboardingShell, SAVE_FAILED, useOnboardingStep } from './OnboardingShell';

const ROLES: { value: ActiveMode; title: string; body: string; bullets: string[] }[] = [
  {
    value: 'worker',
    title: 'I want to earn',
    body: 'Find small tasks, submit proof and get paid to your balance.',
    bullets: ['Browse jobs by reward and time', 'Track every review', 'Withdraw once you reach the minimum'],
  },
  {
    value: 'employer',
    title: 'I want to hire',
    body: 'Post jobs, set a budget and get work done by many people at once.',
    bullets: ['Set reward, slots and proof rules', 'Review proof before you approve', 'See full cost before publishing'],
  },
];

/** SCR-AUTH-06 Role selection (Figma 27:678). */
export function RoleStep() {
  return (
    <OnboardingShell right={<span>Step 1 of 3</span>}>
      {(me) => <RoleForm me={me} />}
    </OnboardingShell>
  );
}

function RoleForm({ me }: { me: Me }) {
  const [role, setRole] = useState<ActiveMode>(me.active_mode);
  const step = useOnboardingStep();
  const onKey = (e: React.KeyboardEvent) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      setRole((r) => (r === 'worker' ? 'employer' : 'worker'));
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus());
    }
  };
  return (
    <div className="mx-auto flex max-w-[848px] flex-col items-center">
      <div data-onb aria-hidden className="mt-10 flex gap-2 tablet:mt-[108px]">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('h-1 w-[72px] rounded-full tablet:w-[104px]', i === 1 ? 'bg-brand' : 'bg-muted')} />
        ))}
      </div>
      <h1 data-onb className="mt-8 text-center font-display text-h2 text-fg tablet:mt-10 tablet:text-h1">
        How do you want to use 24 Freelancing?
      </h1>
      <p data-onb className="mt-2 text-center text-body-md text-fg-secondary tablet:text-body-lg">
        Pick one to start. You can switch between earning and hiring any time from the sidebar.
      </p>
      <div data-onb role="radiogroup" aria-label="How do you want to use 24 Freelancing?" onKeyDown={onKey} className="mt-8 grid w-full gap-4 tablet:mt-[52px] tablet:grid-cols-2 tablet:gap-8">
        {ROLES.map((r) => {
          const sel = role === r.value;
          return (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={sel}
              tabIndex={sel ? 0 : -1}
              onClick={() => setRole(r.value)}
              className={cn(
                'relative flex min-h-[260px] flex-col rounded-[24px] p-6 text-left transition-[background-color,border-color,box-shadow] duration-[120ms] focus-visible:outline-none focus-visible:shadow-focus tablet:min-h-[312px]',
                sel ? 'border-2 border-line-brand bg-brand-subtle shadow-md tablet:p-[28px]' : 'border border-line bg-surface hover:border-line-strong tablet:p-[30px]',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'absolute right-6 top-6 size-6 rounded-full bg-surface tablet:right-8 tablet:top-9',
                  sel ? 'border-[7px] border-line-brand' : 'border-[1.5px] border-line-strong',
                )}
              />
              <span className="pr-10 font-display text-h3 text-fg">{r.title}</span>
              <span className="mt-2 max-w-[344px] text-body-md text-fg-secondary">{r.body}</span>
              <span className="mt-8 flex flex-col gap-4 tablet:mt-8">
                {r.bullets.map((b) => (
                  <span key={b} className="text-body-sm text-fg">
                    {b}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <Button
        data-onb
        size="L"
        className="mt-8 w-full tablet:mt-11 tablet:w-[320px]"
        loading={step.isPending}
        loadingText="Saving…"
        onClick={() => step.mutate({ step: 'role', role }, { onError: () => toast.show(SAVE_FAILED) })}
      >
        {role === 'employer' ? 'Continue as employer' : 'Continue as worker'}
      </Button>
      <p data-onb className="mt-4 text-center text-body-sm text-fg-tertiary">
        Not sure? Most people start by earning.
      </p>
    </div>
  );
}
