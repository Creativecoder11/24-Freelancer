import type { Metadata } from 'next';
import NextLink from 'next/link';
import { Accordion, Button, Icon } from '@24f/ui';
import type { Faq, HelpArticleRow, HelpTopic, PublicConfig } from '@24f/shared';
import { apiTry } from '@/lib/api/server';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';
import { Markdown } from '@/components/public/Markdown';
import { HelpSearch } from '@/components/public/help/HelpSearch';
import { PayoutStatusNote, StillNeedHelp } from '@/components/public/help/HelpWidgets';

export const metadata: Metadata = {
  title: 'Help center & FAQ',
  description: 'Answers about tasks, proof, payouts, withdrawals, employers and the referral program — plus live support when you need a person.',
};

const POPULAR = ['Minimum withdrawal', 'Rejected task', 'Verify account', 'Post a job'];

type Props = { searchParams: Promise<{ q?: string }> };

/** SCR-PUB-06 Help center & FAQ (Figma 23:1389). */
export default async function HelpPage({ searchParams }: Props) {
  const { q: rawQ = '' } = await searchParams;
  const q = rawQ.trim().slice(0, 100);
  const [topics, faqs, config, results] = await Promise.all([
    apiTry<HelpTopic[]>('/public/help/topics', 300),
    apiTry<Faq[]>('/public/faqs?placement=help', 300),
    apiTry<PublicConfig>('/public/config', 300),
    q ? apiTry<HelpArticleRow[]>(`/public/help/articles?q=${encodeURIComponent(q)}`, 60) : null,
  ]);
  const visibleTopics = (topics?.data ?? []).filter((t) => t.article_count > 0);
  const topicTitle = (slug: string) => topics?.data.find((t) => t.slug === slug)?.title ?? '';

  return (
    <MarketingMotion>
      <section className="bg-inverse">
        <div className="mx-auto max-w-container px-5 pb-14 pt-12 tablet:px-8 desktop:px-0 desktop:pb-[72px] desktop:pt-[72px]">
          <div data-reveal>
            <p className="text-overline uppercase text-fg-brand-inverse">Help center</p>
            <h1 className="mt-3 font-display text-[40px] font-extrabold leading-[48px] tracking-[-1.2px] text-fg-inverse tablet:text-display-xl">How can we help?</h1>
          </div>
          <div data-reveal className="mt-6 max-w-[720px]">
            <HelpSearch initial={q} />
          </div>
          <div data-reveal-group className="mt-4 flex flex-wrap items-center gap-2">
            <span data-reveal-item className="mr-1 text-body-sm text-fg-inverse-secondary">
              Popular:
            </span>
            {POPULAR.map((p) => (
              <NextLink
                data-reveal-item
                key={p}
                href={`/help?q=${encodeURIComponent(p)}`}
                scroll={false}
                className="inline-flex h-9 items-center rounded-full border border-line-inverse bg-inverse-raised px-4 text-label-sm text-fg-inverse transition-colors hover:bg-brand focus-visible:outline-none focus-visible:shadow-focus-inverse"
              >
                {p}
              </NextLink>
            ))}
          </div>
        </div>
      </section>

      {q ? (
        <section id="results" aria-labelledby="help-results-h" className="mx-auto max-w-container px-5 pt-12 tablet:px-8 desktop:px-0">
          <h2 id="help-results-h" className="font-display text-h3 text-fg">
            Results for “{q}”
          </h2>
          {!results ? (
            <div role="alert" className="mt-6 rounded-xl border border-line bg-surface px-6 py-10 text-center">
              <p className="text-h5 text-fg">We couldn’t load this</p>
              <p className="mt-1 text-body-sm text-fg-secondary">Check your connection and try again.</p>
              <Button href={`/help?q=${encodeURIComponent(q)}`} variant="secondary" size="M" className="mt-4">
                Try again
              </Button>
            </div>
          ) : results.data.length === 0 ? (
            <div className="mt-6 rounded-xl border border-line bg-surface px-6 py-12 text-center">
              <p className="text-h5 text-fg">No articles found</p>
              <p className="mt-1 text-body-sm text-fg-secondary">Try other words, or message us.</p>
              <Button href="/about#contact" variant="secondary" size="M" className="mt-4">
                Contact us
              </Button>
            </div>
          ) : (
            <ul data-reveal-group className="mt-6 divide-y divide-line-subtle overflow-hidden rounded-xl border border-line bg-surface">
              {results.data.map((a) => (
                <li data-reveal-item key={a.slug} className="group relative flex items-center justify-between gap-4 px-5 py-4 hover:bg-subtle tablet:px-6">
                  <div className="min-w-0">
                    <NextLink href={`/help/${a.topic_slug}/${a.slug}`} className="text-label-lg text-fg after:absolute after:inset-0 focus-visible:outline-none group-focus-within:after:shadow-focus">
                      {a.title}
                    </NextLink>
                    <p className="mt-0.5 text-body-sm text-fg-tertiary">
                      {topicTitle(a.topic_slug)}
                      {a.summary ? ` · ${a.summary}` : ''}
                    </p>
                  </div>
                  <Icon name="arrow-right" size={20} className="shrink-0 text-fg-tertiary transition-transform group-hover:translate-x-1 group-hover:text-fg-brand" />
                </li>
              ))}
            </ul>
          )}
          <NextLink href="/help" scroll={false} className="mt-4 inline-flex items-center gap-1 text-label-md text-fg-brand hover:underline">
            <Icon name="arrow-left" size={16} /> All help topics
          </NextLink>
        </section>
      ) : (
        <section aria-label="Help topics" className="mx-auto max-w-container px-5 pt-12 tablet:px-8 desktop:px-0 desktop:pt-12">
          {!topics ? (
            <p role="alert" className="rounded-xl border border-line bg-surface px-6 py-8 text-center text-body-sm text-fg-secondary">
              We couldn’t load this. Check your connection and try again.
            </p>
          ) : (
            <ul data-reveal-group className="grid gap-4 tablet:grid-cols-2 tablet:gap-6 desktop:grid-cols-3">
              {visibleTopics.map((t) => (
                <li data-reveal-item key={t.slug}>
                  <NextLink
                    href={`/help/${t.slug}`}
                    className="group flex h-full min-h-[172px] flex-col rounded-xl border border-line bg-surface p-6 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-line-brand hover:shadow-md focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span>
                        <span className="block text-label-lg text-fg">{t.title}</span>
                        <span className="block text-body-xs text-fg-tertiary">
                          {t.article_count} {t.article_count === 1 ? 'article' : 'articles'}
                        </span>
                      </span>
                      <Icon name="arrow-right" size={20} className="mt-0.5 shrink-0 text-fg-secondary transition-transform duration-200 group-hover:translate-x-1 group-hover:text-fg-brand" />
                    </span>
                    <span className="mt-6 block text-body-sm text-fg-secondary">{t.description}</span>
                  </NextLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className={`mx-auto mb-24 mt-16 grid max-w-container gap-8 px-5 tablet:px-8 desktop:mt-[72px] desktop:px-0 ${q ? 'desktop:grid-cols-2 desktop:items-start' : 'desktop:grid-cols-[760px_416px] desktop:justify-between'}`}>
        {!q ? (
          <section aria-labelledby="top-q-h">
            <h2 id="top-q-h" data-reveal className="font-display text-[28px] font-bold leading-9 text-fg tablet:text-h2">
              Top questions
            </h2>
            <div data-reveal className="mt-6">
              {faqs && faqs.data.length ? (
                <Accordion variant="cards" className="space-y-3" items={faqs.data.map((f) => ({ q: f.question, a: <Markdown>{f.answer_md}</Markdown> }))} />
              ) : (
                <p className="text-body-sm text-fg-tertiary">Questions will appear here soon.</p>
              )}
            </div>
          </section>
        ) : null}
        {q ? (
          <>
            <StillNeedHelp config={config?.data ?? null} id="live-support" />
            <PayoutStatusNote />
          </>
        ) : (
          <div className="space-y-5 desktop:pt-[64px]">
            <StillNeedHelp config={config?.data ?? null} id="live-support" />
            <PayoutStatusNote />
          </div>
        )}
      </div>
    </MarketingMotion>
  );
}
