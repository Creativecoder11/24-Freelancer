import { Link } from '@24f/ui';
import type { Faq, JobCard, PublicCategory, PublicConfig } from '@24f/shared';
import { apiTry } from '@/lib/api/server';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';
import { Hero } from '@/components/marketing/home/Hero';
import { LiveJobBoard } from '@/components/marketing/home/LiveJobBoard';
import { StepsToggle } from '@/components/marketing/home/StepsToggle';
import { Audience, FaqSection, FinalCta, Promises, ReferralBand, SectionHeader, Trust } from '@/components/marketing/home/Sections';

export const revalidate = 60;

/** SCR-PUB-01 Homepage (Figma 18:477). */
export default async function HomePage() {
  const [jobs, cats, faqs, config] = await Promise.all([
    apiTry<JobCard[], { total: number }>('/public/jobs?per_page=6'),
    apiTry<PublicCategory[]>('/public/categories'),
    apiTry<Faq[]>('/public/faqs?placement=home'),
    apiTry<PublicConfig>('/public/config', 300),
  ]);
  const rate = Number(config?.data.referral.task_rate ?? '0.05');

  return (
    <MarketingMotion>
      <Hero />
      <div className="mt-12 desktop:mt-12">
        <Promises />
      </div>

      <section className="mx-auto mt-24 max-w-container px-5 tablet:px-8 desktop:px-0">
        <SectionHeader
          overline="Live job board"
          title="Open jobs right now"
          body="Every job shows the reward, how long it takes and the proof the employer needs — before you open it."
          action={
            <Link href="/jobs" variant="arrow">
              See all jobs
            </Link>
          }
        />
        <LiveJobBoard initial={jobs?.data ?? []} categories={cats?.data ?? []} total={jobs?.meta?.total ?? 0} />
      </section>

      <section className="mx-auto mt-24 max-w-container px-5 tablet:px-8 desktop:px-0">
        <SectionHeader overline="How it works" title="Four steps, whichever side you’re on" />
        <StepsToggle />
      </section>

      <div className="mt-24">
        <Audience />
      </div>
      <div className="mt-24">
        <Trust />
      </div>
      <div className="mt-24">
        <ReferralBand rate={rate} />
      </div>
      <div className="mt-24">
        <FaqSection faqs={faqs?.data ?? []} />
      </div>
      <div className="mb-24 mt-24">
        <FinalCta />
      </div>
    </MarketingMotion>
  );
}
