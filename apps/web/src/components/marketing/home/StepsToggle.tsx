'use client';
import { useRef, useState } from 'react';
import { Icon, Link, SegmentedControl, gsap, useGSAP } from '@24f/ui';

const STEPS = {
  earn: [
    ['01', 'Create a free account', 'Sign up with email or phone. Verification may be required before your first withdrawal.'],
    ['02', 'Pick a job that fits', 'Filter by category, reward and time. Every job lists the exact proof the employer needs.'],
    ['03', 'Do it, then submit proof', 'Follow the numbered steps and upload a screenshot, link or text answer.'],
    ['04', 'Get approved & paid', 'Approved rewards land in your balance. Withdraw once you reach the minimum.'],
  ],
  hire: [
    ['01', 'Describe the job', 'Title, category, numbered steps and the exact proof you need.'],
    ['02', 'Set budget & slots', 'Reward per task × number of workers. You see the total before publishing.'],
    ['03', 'Review submissions', 'Approve good work in bulk. Rejections need a short reason.'],
    ['04', 'Track spending', 'See approvals, remaining budget and performance per job.'],
  ],
} as const;

/** How it works (Figma 19:668) with the earn/hire toggle (G-16 fills the "hire" state). */
export function StepsToggle() {
  const [mode, setMode] = useState<'earn' | 'hire'>('earn');
  const grid = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      gsap.fromTo(grid.current!.children, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.06, ease: 'power2.out' });
    },
    { dependencies: [mode], scope: grid },
  );
  return (
    <>
      <div className="mt-6 flex flex-col gap-6 tablet:flex-row tablet:items-end tablet:justify-between desktop:-mt-12 desktop:justify-end">
        <SegmentedControl
          label="Audience"
          kind="tabs"
          value={mode}
          onChange={(v) => setMode(v as 'earn' | 'hire')}
          options={[
            { value: 'earn', label: 'I want to earn' },
            { value: 'hire', label: 'I want to hire' },
          ]}
          className="w-[280px]"
        />
      </div>
      <div ref={grid} className="mt-10 grid gap-6 tablet:grid-cols-2 desktop:grid-cols-4">
        {STEPS[mode].map(([n, t, b], i) => (
          <div key={t} className="relative min-h-[192px] rounded-card border border-line bg-surface p-6 shadow-xs">
            <p className="font-display text-num-xl text-fg-brand">{n}</p>
            <h3 className="mt-4 text-h5 text-fg">{t}</h3>
            <p className="mt-2 text-body-sm text-fg-secondary">{b}</p>
            {i < 3 ? (
              <Icon name="arrow-right" size={20} className="absolute -right-[22px] top-1/2 hidden -translate-y-1/2 text-fg-tertiary desktop:block" />
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-3 rounded-[14px] bg-brand-subtle px-6 py-4 text-body-sm text-fg-secondary tablet:flex-row tablet:items-center tablet:justify-between">
        <p>Hiring instead? Post a job in four steps — set the reward and slots, review proof, approve the work you accept.</p>
        <Link href="/signup?role=employer" variant="arrow">
          Post a job
        </Link>
      </div>
    </>
  );
}
