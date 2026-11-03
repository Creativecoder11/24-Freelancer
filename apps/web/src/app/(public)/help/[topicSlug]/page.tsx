import type { Metadata } from 'next';
import NextLink from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs, Icon } from '@24f/ui';
import type { HelpArticleRow, HelpTopic, PublicConfig } from '@24f/shared';
import { apiTry } from '@/lib/api/server';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';
import { PayoutStatusNote, StillNeedHelp } from '@/components/public/help/HelpWidgets';

export const revalidate = 300;

type Props = { params: Promise<{ topicSlug: string }> };

async function getTopic(slug: string) {
  const topics = await apiTry<HelpTopic[]>('/public/help/topics', 300);
  return topics?.data.find((t) => t.slug === slug) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const topic = await getTopic((await params).topicSlug);
  return topic ? { title: `${topic.title} · Help center`, description: topic.description } : { title: 'Help topic not found' };
}

/** SCR-PUB-ND1 topic list view (`/help/[topicSlug]`). */
export default async function HelpTopicPage({ params }: Props) {
  const { topicSlug } = await params;
  const [topic, articles, config] = await Promise.all([
    getTopic(topicSlug),
    apiTry<HelpArticleRow[]>(`/public/help/articles?topic=${encodeURIComponent(topicSlug)}`, 300),
    apiTry<PublicConfig>('/public/config', 300),
  ]);
  if (!topic) notFound();
  const list = articles?.data ?? [];

  return (
    <MarketingMotion>
      <div className="mx-auto mb-24 max-w-container px-5 pt-8 tablet:px-8 desktop:px-0 desktop:pt-10">
        <div data-reveal>
          <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Help center', href: '/help' }, { label: topic.title }]} />
          <h1 className="mt-4 font-display text-[32px] font-bold leading-10 tracking-[-0.8px] text-fg tablet:text-h1">{topic.title}</h1>
          <p className="mt-2 max-w-[760px] text-body-md text-fg-secondary">{topic.description}</p>
        </div>
        <div className="mt-10 grid gap-8 desktop:grid-cols-[760px_416px] desktop:justify-between">
          <section aria-label={`${topic.title} articles`}>
            {list.length ? (
              <ul data-reveal-group className="divide-y divide-line-subtle overflow-hidden rounded-xl border border-line bg-surface">
                {list.map((a) => (
                  <li data-reveal-item key={a.slug} className="group relative flex items-center justify-between gap-4 px-5 py-4 hover:bg-subtle tablet:px-6">
                    <div className="min-w-0">
                      <NextLink href={`/help/${topicSlug}/${a.slug}`} className="text-label-lg text-fg after:absolute after:inset-0 focus-visible:outline-none group-focus-within:after:shadow-focus">
                        {a.title}
                      </NextLink>
                      {a.summary ? <p className="mt-0.5 text-body-sm text-fg-tertiary">{a.summary}</p> : null}
                    </div>
                    <Icon name="arrow-right" size={20} className="shrink-0 text-fg-tertiary transition-transform group-hover:translate-x-1 group-hover:text-fg-brand" />
                  </li>
                ))}
              </ul>
            ) : (
              <div data-reveal className="rounded-xl border border-line bg-surface px-6 py-12 text-center">
                <p className="text-h5 text-fg">No articles found</p>
                <p className="mt-1 text-body-sm text-fg-secondary">Try other words, or message us.</p>
              </div>
            )}
            <NextLink href="/help" className="mt-6 inline-flex items-center gap-1 text-label-md text-fg-brand hover:underline">
              <Icon name="arrow-left" size={16} /> All help topics
            </NextLink>
          </section>
          <div className="space-y-5">
            <StillNeedHelp config={config?.data ?? null} />
            <PayoutStatusNote />
          </div>
        </div>
      </div>
    </MarketingMotion>
  );
}
