'use client';
import { useRef } from 'react';
import { Button, Field, JobCard, StatCard, StatusTracker, Upload, gsap, useGSAP, MOTION_OK, MOTION_REDUCE } from '@24f/ui';

const noop = () => {};

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      aria-hidden
      inert
      className={`step-panel relative overflow-hidden rounded-xl border border-line bg-surface shadow-xs desktop:h-[216px] ${className}`}
    >
      {children}
    </div>
  );
}

const STEPS: { title: string; body: string; panel: React.ReactNode }[] = [
  {
    title: 'Create your account',
    body: 'Sign up with email or phone and pick “I want to earn”. You can switch to hiring later.',
    panel: (
      <Panel className="px-6 py-6 tablet:px-10">
        <Field label="Email or phone" leadingIcon="mail" value="nusrat.j@example.com" readOnly onChange={noop} />
        <Button fullWidth className="mt-6" tabIndex={-1}>
          Create account
        </Button>
      </Panel>
    ),
  },
  {
    title: 'Find a job that fits',
    body: 'Every job shows reward, time, proof and slots. Filter by category or by how long you have.',
    panel: (
      <Panel className="flex justify-center px-4 pt-0 desktop:block desktop:px-0">
        <div className="w-full max-w-[352px] desktop:absolute desktop:left-1/2 desktop:top-[-24px] desktop:-translate-x-1/2">
          <JobCard
            href="/jobs/WJ-58401"
            className="rounded-t-none border-t-0 shadow-none desktop:rounded-t-card desktop:border-t"
            job={{
              publicId: 'WJ-58401',
              category: 'Surveys',
              title: 'Answer a 5-minute grocery shopping survey',
              durationLabel: '≈ 5 min',
              proofLabel: 'Screenshot',
              slotsFilled: 61,
              slotsTotal: 120,
              postedLabel: 'posted 9 min ago',
              rewardLabel: '$0.120',
              isNew: true,
            }}
          />
        </div>
      </Panel>
    ),
  },
  {
    title: 'Do the task and submit proof',
    body: 'Follow the numbered steps, then upload the screenshot, link or answer the employer asked for.',
    panel: (
      <Panel className="p-4 tablet:p-6">
        <div className="rounded-lg border border-line bg-subtle p-3 shadow-sm">
          <Upload
            label="Proof screenshot"
            labelHidden
            accept="image/*"
            maxBytes={5_000_000}
            phase="uploaded"
            file={{ filename: 'sheet-screenshot.png', size_bytes: 1_200_000 }}
            onSelect={noop}
            onRemove={noop}
          />
        </div>
      </Panel>
    ),
  },
  {
    title: 'Track the review',
    body: 'See the review deadline. If something’s missing you’ll get a reason and can fix it.',
    panel: (
      <Panel className="px-4 py-6 tablet:px-6">
        <p className="text-label-sm font-semibold text-fg">Submission · Categorize 20 product photos</p>
        <StatusTracker
          className="mt-6"
          steps={[
            { label: 'Submitted', sub: 'Oct 26, 10:12', state: 'done' },
            { label: 'In review', sub: 'Due in 18 h', state: 'current' },
            { label: 'Approved', sub: '—', state: 'pending' },
            { label: 'Paid to balance', sub: '—', state: 'pending' },
          ]}
        />
        <p className="mt-4 text-center text-body-xs text-fg-tertiary">Employer has 18 h left to review. Auto-approved after that.</p>
      </Panel>
    ),
  },
  {
    title: 'Withdraw your earnings',
    body: 'Approved rewards land in your balance. Withdraw once you reach the minimum.',
    panel: (
      <Panel className="grid place-items-center px-4 py-6">
        <StatCard
          type="balance"
          label="Available balance"
          value="$12.48"
          meta="Pending review: $1.35"
          action={{ label: 'Withdraw' }}
          compact
          className="w-full max-w-[352px] shadow-lg"
        />
      </Panel>
    ),
  },
];

/**
 * "For workers" five-step vertical timeline (Figma 23:1141). The brand progress line is scrubbed
 * by ScrollTrigger; each circle fills as the line reaches it.
 */
export function WorkerTimeline() {
  const scope = useRef<HTMLOListElement>(null);

  useGSAP(
    () => {
      const root = scope.current!;
      const q = gsap.utils.selector(root);
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(
          q('.tl-progress'),
          { scaleY: 0 },
          { scaleY: 1, ease: 'none', scrollTrigger: { trigger: root, start: 'top 60%', end: 'bottom 60%', scrub: 0.5 } },
        );
        q('.tl-step').forEach((step) => {
          const dot = step.querySelector('.tl-fill');
          const text = step.querySelectorAll('.tl-text > *');
          const panel = step.querySelector('.step-panel');
          gsap.fromTo(
            dot,
            { scale: 0, opacity: 0 },
            { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)', scrollTrigger: { trigger: step, start: 'top 60%', toggleActions: 'play none none reverse' } },
          );
          gsap.fromTo(text, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.07, scrollTrigger: { trigger: step, start: 'top 82%', once: true } });
          gsap.fromTo(panel, { opacity: 0, x: 40, rotate: 1 }, { opacity: 1, x: 0, rotate: 0, duration: 0.7, scrollTrigger: { trigger: step, start: 'top 82%', once: true } });
        });
      });
      mm.add(MOTION_REDUCE, () => gsap.set(q('.tl-progress'), { scaleY: 1 }));
      return () => mm.revert();
    },
    { scope },
  );

  return (
    <ol ref={scope} className="relative mt-10 space-y-6">
      {/* Track + scrubbed progress line (x 151 in the 1440 frame → 31 px into the container). */}
      <span aria-hidden className="absolute bottom-8 left-[19px] top-6 w-0.5 rounded-full bg-line desktop:left-[31px]" />
      <span aria-hidden className="tl-progress absolute bottom-8 left-[19px] top-6 w-0.5 origin-top rounded-full bg-brand desktop:left-[31px]" />
      {STEPS.map((s, i) => (
        <li key={s.title} className="tl-step relative grid gap-5 pl-14 desktop:min-h-[216px] desktop:grid-cols-[1fr_600px] desktop:gap-6 desktop:pl-[88px]">
          <span aria-hidden className="absolute left-0 top-1 grid size-10 place-items-center rounded-full border-2 border-line bg-surface text-label-md text-fg-tertiary desktop:left-3 desktop:top-2">
            {i + 1}
            <span className="tl-fill absolute -inset-0.5 grid place-items-center rounded-full bg-brand text-fg-on-brand shadow-[0_0_0_6px_var(--fl-bg-brand-subtle)]">{i + 1}</span>
          </span>
          <div className="tl-text pt-1 desktop:max-w-[420px] desktop:pt-2">
            <p className="text-overline uppercase text-fg-brand">Step {i + 1}</p>
            <h3 className="mt-2 font-display text-h4 text-fg">{s.title}</h3>
            <p className="mt-3 text-body-sm text-fg-secondary">{s.body}</p>
          </div>
          {s.panel}
        </li>
      ))}
    </ol>
  );
}

