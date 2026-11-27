import type { Metadata } from 'next';
import type { Faq, PublicConfig } from '@24f/shared';
import { apiTry } from '@/lib/api/server';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';
import { Hero } from '@/components/marketing/home/Hero';
import { StepsToggle } from '@/components/marketing/home/StepsToggle';
import { Audience, FaqSection, FinalCta, Promises, ReferralBand, SectionHeader, Trust } from '@/components/marketing/home/Sections';
import { FaqJsonLd } from '@/components/seo/JsonLd';

export const metadata: Metadata = { alternates: { canonical: '/' } };

/** SCR-PUB-01 Homepage (Figma 18:477). */
export default async function HomePage() {
  const [faqs, config] = await Promise.all([
    apiTry<Faq[]>('/public/faqs?placement=home', 60),
    apiTry<PublicConfig>('/public/config', 300),
  ]);
  const rate = Number(config?.data.referral.task_rate ?? '0.05');

  return (
    <MarketingMotion>
      <FaqJsonLd faqs={faqs?.data ?? []} />
      <Hero />
      <div className="mt-12 desktop:mt-12">
        <Promises />
      </div>

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
