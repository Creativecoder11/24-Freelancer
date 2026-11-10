'use client';
import { useRef } from 'react';
import { Button, JobCard, StatusBadge, StatusTracker, gsap, useGSAP, MOTION_OK, MOTION_REDUCE } from '@24f/ui';
import type { JobCardData } from '@24f/ui';
import { HandArrow } from '../HandArrow';

const HERO_JOB: JobCardData = {
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
};

/** Homepage hero (Figma 18:495). Illustration content is the designed product preview, not live data. */
export function Hero({ heroJob }: { heroJob?: JobCardData }) {
  const scope = useRef<HTMLElement>(null);
  const job = heroJob ?? HERO_JOB;

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const q = gsap.utils.selector(scope);
        gsap.set(q('[data-hero]'), { opacity: 1 });
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        tl.from(q('.hero-eyebrow'), { opacity: 0, y: 10, rotate: -2, duration: 0.5 })
          .from(q('.hero-word'), { yPercent: 110, duration: 0.7, stagger: 0.06 }, '-=0.2')
          .fromTo(q('.marker-highlight'), { '--marker-scale': 0 }, { '--marker-scale': 1, duration: 0.6, ease: 'power2.inOut' }, '-=0.25')
          .from(q('.hero-sub'), { opacity: 0, y: 16, duration: 0.5 }, '-=0.35')
          .from(q('.hero-cta > *'), { opacity: 0, y: 16, duration: 0.45, stagger: 0.08 }, '-=0.3')
          .from(q('.hero-note'), { opacity: 0, x: -10, duration: 0.4 }, '-=0.1')
          .from(q('.hero-panel'), { opacity: 0, scale: 0.96, duration: 0.8 }, 0.15)
          .from(q('.hero-job'), { opacity: 0, x: 40, rotate: 2, duration: 0.7 }, 0.45)
          .from(q('.hero-toast'), { opacity: 0, y: -16, scale: 0.9, duration: 0.5, ease: 'back.out(1.8)' }, 0.85)
          .from(q('.hero-submission'), { opacity: 0, y: 40, duration: 0.7 }, 0.75)
          .from(q('.hero-submission li'), { opacity: 0, y: 8, duration: 0.35, stagger: 0.14 }, 1.1)
          .from(q('.hero-chip'), { opacity: 0, scale: 0.6, duration: 0.55, ease: 'back.out(2)' }, 1.6)
          .from(q('.hero-stamp-note'), { opacity: 0, duration: 0.4 }, 1.4);
        // Gentle idle float on the preview cards.
        gsap.to(q('.hero-job'), { y: -6, duration: 3, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.6 });
        gsap.to(q('.hero-toast'), { y: 5, duration: 2.6, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 2 });
        gsap.to(q('.hero-chip'), { y: -4, duration: 2.2, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 2.4 });
      });
      mm.add(MOTION_REDUCE, () => gsap.set('[data-hero]', { opacity: 1 }));
      return () => mm.revert();
    },
    { scope },
  );

  return (
    <section ref={scope} className="mx-auto grid max-w-container gap-12 px-5 pb-16 pt-10 tablet:px-8 desktop:grid-cols-[560px_600px] desktop:justify-between desktop:gap-10 desktop:px-0 desktop:pb-12 desktop:pt-[72px]">
      <div data-hero className="relative desktop:pt-10">
        <p className="hero-eyebrow font-hand text-hand-note text-fg-brand">small and tasks, honest pay — that’s the whole idea</p>
        <h1 className="mt-3 font-display text-[44px] font-extrabold leading-[52px] tracking-[-1.3px] text-fg tablet:text-display-xl desktop:text-display-2xl">
          {[['Turn', 'spare', 'minutes'], ['into', 'verified']].map((line, li) => (
            <span key={li} className="desktop:block">
              {line.map((w) => (
                <span key={w} className="inline-block overflow-hidden pb-1 align-bottom">
                  <span className="hero-word inline-block">{w}&nbsp;</span>
                </span>
              ))}
            </span>
          ))}
          <span className="inline-block overflow-hidden pb-1 align-bottom">
            <span className="hero-word marker-highlight inline-block">earnings.</span>
          </span>
        </h1>
        <p className="hero-sub mt-6 max-w-[520px] text-body-lg text-fg-secondary">
          Pick a task, follow clear steps and submit proof. Track every review and payout in one place — no guessing when you get paid.
        </p>
        <div className="hero-cta mt-8 flex flex-wrap gap-3">
          <Button href="/jobs" size="L" className="min-w-[168px]">
            Find jobs
          </Button>
          <Button href="/signup?role=employer" size="L" variant="secondary" className="min-w-[160px]">
            Post a job
          </Button>
        </div>
        <div className="hero-note mt-5 flex items-start gap-2 pl-10 text-fg-brand">
          <HandArrow className="h-10 w-20 -scale-y-100 text-fg-brand" />
          <p className="mt-6 font-hand text-hand-sm">no sign-up needed to browse</p>
        </div>
      </div>

      <div data-hero className="hero-panel relative mx-auto h-[600px] w-full max-w-[600px] overflow-hidden rounded-[32px] bg-muted tablet:h-[656px] desktop:overflow-visible">
        <div className="hero-job absolute left-5 top-8 w-[calc(100%-40px)] max-w-[352px] tablet:left-10 tablet:top-10">
          <JobCard job={job} href={`/jobs/${job.publicId}`} className="shadow-lg" />
        </div>
        <div className="hero-toast absolute right-5 top-4 flex w-[190px] items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-2.5 shadow-lg tablet:right-6 tablet:top-6">
          <div>
            <p className="text-label-sm text-fg">Withdrawal paid</p>
            <p className="text-body-xs text-fg-tertiary">$10.00 · just now</p>
          </div>
        </div>
        <p className="hero-stamp-note absolute right-8 top-[300px] hidden rotate-[-4deg] text-center font-hand text-hand-sm text-fg-brand tablet:block">
          every step gets a<br />time-stamp
        </p>
        <div className="hero-submission absolute bottom-24 left-5 right-5 rounded-card border border-line bg-surface p-5 shadow-lg tablet:left-10 tablet:right-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-label-md text-fg">Your submission</p>
              <p className="text-body-xs text-fg-tertiary">Categorize 20 product photos</p>
            </div>
            <StatusBadge tone="success" label="Approved" />
          </div>
          <StatusTracker
            className="mt-4"
            steps={[
              { label: 'Submitted', sub: 'Oct 26, 10:12', state: 'done' },
              { label: 'In review', sub: 'Oct 26, 14:40', state: 'done' },
              { label: 'Approved', sub: 'Oct 26, 14:40', state: 'done' },
              { label: 'Paid to balance', sub: 'Oct 26, 14:40', state: 'done' },
            ]}
          />
        </div>
        <div className="hero-chip absolute bottom-8 right-6 rounded-full bg-success-bright px-4 py-2 text-label-md text-fg-inverse shadow-md tablet:right-10">
          +$0.180 added to your balance
        </div>
      </div>
    </section>
  );
}
