import type { Metadata } from 'next';
import NextLink from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Breadcrumbs, Icon } from '@24f/ui';
import { formatDate, type HelpArticle, type HelpArticleRow, type PublicConfig } from '@24f/shared';
import { ApiRequestError, apiGet, apiTry } from '@/lib/api/server';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';
import { Markdown } from '@/components/public/Markdown';
import { StillNeedHelp } from '@/components/public/help/HelpWidgets';
import { WasThisHelpful } from '@/components/public/help/WasThisHelpful';

export const revalidate = 300;

type Props = { params: Promise<{ topicSlug: string; articleSlug: string }> };

async function getArticle(slug: string) {
  try {
    return (await apiGet<HelpArticle>(`/public/help/articles/${encodeURIComponent(slug)}`, 300)).data;
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = await getArticle((await params).articleSlug).catch(() => null);
  return a ? { title: `${a.title} · Help center`, description: a.body_md.replace(/[#*_`>\[\]()]/g, '').slice(0, 155) } : { title: 'Help article' };
}

/** SCR-PUB-ND1 Help article (`/help/[topicSlug]/[articleSlug]`). */
export default async function HelpArticlePage({ params }: Props) {
  const { topicSlug, articleSlug } = await params;
  const article = await getArticle(articleSlug);
  if (!article) notFound();
  if (article.topic.slug !== topicSlug) redirect(`/help/${article.topic.slug}/${article.slug}`);
  const [siblings, config] = await Promise.all([
    apiTry<HelpArticleRow[]>(`/public/help/articles?topic=${encodeURIComponent(article.topic.slug)}`, 300),
    apiTry<PublicConfig>('/public/config', 300),
  ]);
  const others = (siblings?.data ?? []).filter((a) => a.slug !== article.slug);

  return (
    <MarketingMotion>
      <div className="mx-auto mb-24 max-w-container px-5 pt-8 tablet:px-8 desktop:px-0 desktop:pt-10">
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/' },
            { label: 'Help center', href: '/help' },
            { label: article.topic.title, href: `/help/${article.topic.slug}` },
            { label: article.title },
          ]}
        />
        <div className="mt-6 grid gap-10 desktop:grid-cols-[760px_416px] desktop:justify-between">
          <article>
            <header data-reveal>
              <h1 className="font-display text-[32px] font-bold leading-10 tracking-[-0.8px] text-fg tablet:text-h1">{article.title}</h1>
              <p className="mt-2 text-body-sm text-fg-tertiary">Updated {formatDate(article.updated_at)}</p>
            </header>
            <div data-reveal className="mt-8">
              <Markdown>{article.body_md}</Markdown>
            </div>
            <WasThisHelpful slug={article.slug} />
          </article>
          <aside className="space-y-5">
            {others.length ? (
              <section data-reveal aria-labelledby="more-h" className="rounded-xl border border-line bg-surface p-5 tablet:p-7">
                <h2 id="more-h" className="font-display text-h4 text-fg">
                  More in {article.topic.title}
                </h2>
                <ul className="mt-4 space-y-1">
                  {others.map((a) => (
                    <li key={a.slug}>
                      <NextLink href={`/help/${a.topic_slug}/${a.slug}`} className="group flex items-center justify-between gap-3 rounded-md px-2 py-2.5 text-body-sm text-fg hover:bg-subtle hover:text-fg-brand focus-visible:outline-none focus-visible:shadow-focus">
                        {a.title}
                        <Icon name="chevron-right" size={16} className="shrink-0 text-fg-tertiary group-hover:text-fg-brand" />
                      </NextLink>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <StillNeedHelp config={config?.data ?? null} />
          </aside>
        </div>
      </div>
    </MarketingMotion>
  );
}
