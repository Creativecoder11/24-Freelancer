import type { Metadata } from 'next';
import type { PublicConfig } from '@24f/shared';
import { apiTry } from '@/lib/api/server';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';
import { Promises } from '@/components/marketing/home/Sections';
import { ChannelList, type Channel } from '@/components/public/Channels';
import { ContactForm } from '@/components/public/about/ContactForm';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'About & contact',
  description:
    '24 Freelancing is a microtask marketplace that connects clients with workers worldwide. Learn what we stand for, or send us a message.',
};

const VALUES = [
  ['Resources & reach', 'Influencers and resources to get campaigns seen by the right people.'],
  ['Creative solutions', 'Flexible ways to split big goals into small, checkable tasks.'],
  ['A dedicated team', 'People behind live support who handle payouts and disputes.'],
  ['In budget and on time', 'Employers set the budget; workers see the reward before they start.'],
];

const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

/** SCR-PUB-08 About & contact (Figma 24:1573). */
export default async function AboutPage() {
  const config = (await apiTry<PublicConfig>('/public/config', 300))?.data ?? null;
  const social = config?.social;
  const channels: Channel[] = [
    { title: 'Live support', description: 'Fastest for task and payment questions', action: 'Open chat', href: 'chat' },
    ...(social?.facebook_page ? [{ title: 'Facebook page', description: shortUrl(social.facebook_page), action: 'Visit', href: social.facebook_page }] : []),
    ...(social?.facebook_group ? [{ title: 'Facebook group', description: 'Community questions and updates', action: 'Join', href: social.facebook_group }] : []),
    ...(social?.youtube ? [{ title: 'YouTube', description: 'Guides and walkthroughs', action: 'Watch', href: social.youtube }] : []),
  ];
  const address = config?.company.registered_address;

  return (
    <MarketingMotion>
      <section className="mx-auto grid max-w-container gap-10 px-5 pb-12 pt-12 tablet:px-8 desktop:grid-cols-[760px_376px] desktop:justify-between desktop:px-0 desktop:pb-12 desktop:pt-[72px]">
        <div data-reveal>
          <p className="text-overline uppercase text-fg-brand">About 24 Freelancing</p>
          <h1 className="mt-3 font-display text-[36px] font-extrabold leading-[44px] tracking-[-1.2px] text-fg tablet:text-display-xl">
            A marketplace for small tasks and the people who do them
          </h1>
          <p className="mt-6 max-w-[760px] text-body-lg text-fg-secondary">
            24 Freelancing is a freelancing, outsourcing and crowdsourcing marketplace that connects clients with workers worldwide. Small gigs — surveys, image
            categorization, testing and content tasks — get done quickly, and workers are credited soon after review.
          </p>
        </div>
        <figure data-parallax="0.1" className="self-start desktop:mt-3">
          <div data-reveal className="bg-highlight-soft px-6 py-6 shadow-md desktop:rotate-[-2deg]">
            <blockquote className="font-hand text-hand-note text-fg">Small tasks deserve fair, clear rules — and someone who answers when you ask.</blockquote>
            <figcaption className="mt-3 font-hand text-hand-sm text-fg-brand">— the 24 Freelancing team</figcaption>
          </div>
        </figure>
      </section>

      <Promises />

      <section aria-labelledby="values-h" className="mx-auto mt-16 max-w-container px-5 tablet:px-8 desktop:px-0">
        <h2 id="values-h" data-reveal className="font-display text-[28px] font-bold leading-9 text-fg tablet:text-h2">
          What we stand for
        </h2>
        <ul data-reveal-group className="mt-6 grid gap-4 tablet:grid-cols-2 tablet:gap-6 desktop:grid-cols-4">
          {VALUES.map(([t, b]) => (
            <li data-reveal-item key={t} className="min-h-[148px] rounded-xl border border-line bg-surface p-6 transition-shadow duration-200 hover:shadow-md">
              <h3 className="text-label-lg text-fg">{t}</h3>
              <p className="mt-2 text-body-sm text-fg-secondary">{b}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="contact" aria-labelledby="contact-h" className="mx-auto mb-24 mt-16 max-w-container scroll-mt-24 px-5 tablet:px-8 desktop:px-0">
        <div data-reveal>
          <h2 id="contact-h" className="font-display text-[28px] font-bold leading-9 text-fg tablet:text-h2">
            Contact us
          </h2>
          <p className="mt-2 max-w-[760px] text-body-md text-fg-secondary">
            Questions about a task, a payment or your account? Send us a message or use live support for the fastest reply.
          </p>
        </div>
        <div className="mt-6 grid gap-6 desktop:grid-cols-[760px_416px] desktop:justify-between">
          <div data-reveal className="relative rounded-2xl border border-line bg-surface p-5 shadow-xs tablet:p-8">
            <ContactForm />
          </div>
          <aside data-reveal aria-labelledby="ways-h" className="self-start rounded-2xl border border-line bg-surface p-5 shadow-xs tablet:p-6">
            <h3 id="ways-h" className="font-display text-h4 text-fg">
              Other ways to reach us
            </h3>
            <ChannelList channels={channels} className="mt-5" />
            {address ? (
              <div className="mt-5 rounded-lg border border-line p-4">
                <p className="text-label-md text-fg">Registered address</p>
                {config?.company.legal_name ? <p className="mt-1 text-body-sm text-fg">{config.company.legal_name}</p> : null}
                <p className="mt-1 whitespace-pre-line text-body-sm text-fg-secondary">{address}</p>
              </div>
            ) : null}
          </aside>
        </div>
      </section>
    </MarketingMotion>
  );
}
