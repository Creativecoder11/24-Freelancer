import type { Metadata } from 'next';
import { Button } from '@24f/ui';
import type { PublicConfig } from '@24f/shared';
import { apiTry } from '@/lib/api/server';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';
import { AudienceToggle } from '@/components/public/how/AudienceToggle';
import { WorkerTimeline } from '@/components/public/how/WorkerTimeline';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'Simple tasks, clear rules, tracked payouts. See how workers earn in five steps and how employers get many small tasks done at once.',
};

const EMPLOYER_STEPS = [
  ['01', 'Describe the job', 'Title, category, numbered steps and the exact proof you need.'],
  ['02', 'Set budget & slots', 'Reward per task × number of workers. You see the total before publishing.'],
  ['03', 'Review submissions', 'Approve good work in bulk. Rejections need a short reason.'],
  ['04', 'Track spending', 'See approvals, remaining budget and performance per job.'],
];

/** SCR-PUB-05 How it works (Figma 23:1141). */
export default async function HowItWorksPage() {
  const config = await apiTry<PublicConfig>('/public/config', 300);
  const windows = config?.data.job_options.review_window_hours ?? [72];
  const defaultWindow = windows.includes(72) ? 72 : (windows[windows.length - 1] ?? 72);

  const rules = [
    ['Review window', `Employers review within the window shown on each job (${defaultWindow} hours by default).`],
    ['Fix and resubmit', 'A rejection always includes a reason. Fix it and resubmit while slots are open.'],
    ['Fair outcomes', 'Unreviewed work is approved automatically when the window ends.'],
  ];

  return (
    <MarketingMotion>
      <header className="border-b border-line-subtle">
        <div className="mx-auto flex max-w-container flex-col gap-8 px-5 pb-10 pt-12 tablet:px-8 desktop:flex-row desktop:items-end desktop:justify-between desktop:px-0 desktop:pb-14 desktop:pt-16">
          <div data-reveal className="max-w-[760px]">
            <p className="text-overline uppercase text-fg-brand">How it works</p>
            <h1 className="mt-3 font-display text-[36px] font-extrabold leading-[44px] tracking-[-1.2px] text-fg tablet:text-display-xl">
              Simple tasks, clear rules, tracked payouts
            </h1>
            <p className="mt-5 max-w-[640px] text-body-md text-fg-secondary">
              Whether you want to earn or need work done, every step is visible — what’s required, what it costs and where your money is.
            </p>
          </div>
          <div data-reveal className="shrink-0">
            <AudienceToggle />
          </div>
        </div>
      </header>

      <section id="workers" aria-labelledby="workers-h" className="mx-auto max-w-container scroll-mt-24 px-5 pt-14 tablet:px-8 desktop:px-0 desktop:pt-16">
        <div data-reveal>
          <h2 id="workers-h" className="font-display text-[28px] font-bold leading-9 text-fg tablet:text-h2">
            For workers
          </h2>
          <p className="mt-2 text-body-md text-fg-secondary">From sign-up to cash-out in five steps.</p>
        </div>
        <WorkerTimeline />
      </section>

      <section id="employers" aria-labelledby="employers-h" className="mx-auto mt-20 max-w-container scroll-mt-24 px-5 tablet:px-8 desktop:px-0">
        <div data-reveal>
          <h2 id="employers-h" className="font-display text-[28px] font-bold leading-9 text-fg tablet:text-h2">
            For employers
          </h2>
          <p className="mt-2 text-body-md text-fg-secondary">Publish once, get the work done by many people.</p>
        </div>
        <ol data-reveal-group className="mt-8 grid gap-4 tablet:grid-cols-2 tablet:gap-6 desktop:grid-cols-4">
          {EMPLOYER_STEPS.map(([n, t, b]) => (
            <li data-reveal-item key={t} className="min-h-[164px] rounded-xl border border-line bg-surface p-6 transition-shadow duration-200 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-h5 text-fg">{t}</h3>
                <span aria-hidden className="font-display text-num-md text-fg-tertiary">
                  {n}
                </span>
              </div>
              <p className="mt-3 text-body-sm text-fg-secondary">{b}</p>
            </li>
          ))}
        </ol>
        <div
          data-reveal
          className="mt-6 flex flex-col gap-4 rounded-xl bg-brand-subtle px-6 py-5 tablet:flex-row tablet:items-center tablet:justify-between desktop:min-h-[88px]"
        >
          <div>
            <p className="text-label-sm text-fg-brand">Total cost</p>
            <p className="mt-1 font-display text-num-md text-fg">
              Reward per task <span className="px-1 text-fg-brand">×</span> Number of slots <span className="px-1 text-fg-brand">+</span> Platform fee (shown before you publish)
            </p>
          </div>
          <Button href="/signup?role=employer" size="M" className="shrink-0 self-start tablet:self-auto">
            Post a job
          </Button>
        </div>
      </section>

      <section aria-labelledby="rules-h" className="mx-auto mt-20 max-w-container px-5 tablet:px-8 desktop:px-0">
        <h2 id="rules-h" data-reveal className="font-display text-[28px] font-bold leading-9 text-fg tablet:text-h2">
          Review rules everyone can see
        </h2>
        <ul data-reveal-group className="mt-8 grid gap-4 tablet:gap-6 desktop:grid-cols-3">
          {rules.map(([t, b]) => (
            <li data-reveal-item key={t} className="min-h-[132px] rounded-xl border border-line bg-surface p-6">
              <h3 className="text-h5 text-fg">{t}</h3>
              <p className="mt-2 text-body-sm text-fg-secondary">{b}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto mb-24 mt-24 max-w-container px-5 tablet:px-8 desktop:px-0">
        <div
          data-reveal
          className="flex flex-col gap-8 overflow-hidden rounded-2xl bg-inverse px-8 py-10 tablet:flex-row tablet:items-center tablet:justify-between tablet:px-12 desktop:min-h-[180px]"
        >
          <div>
            <h2 className="font-display text-[28px] font-bold leading-9 text-fg-inverse">Ready to try your first task?</h2>
            <p className="mt-2 text-body-md text-fg-inverse-secondary">It’s free to join. Pick a job that fits the time you have.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button href="/jobs" size="L" className="min-w-[168px]">
              Find jobs
            </Button>
            <Button href="/signup?role=employer" size="L" variant="secondary" className="min-w-[160px]">
              Post a job
            </Button>
          </div>
        </div>
      </section>
    </MarketingMotion>
  );
}
