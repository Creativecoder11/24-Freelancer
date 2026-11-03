import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert, Breadcrumbs, Link } from '@24f/ui';
import { formatDate, type LegalPage } from '@24f/shared';
import { ApiRequestError, apiGet } from '@/lib/api/server';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';
import { Markdown, headingsOf } from '@/components/public/Markdown';

export const revalidate = 300;

const DOCS = {
  terms: 'Terms & conditions',
  privacy: 'Privacy policy',
  refund: 'Refund policy',
  cancellation: 'Cancellation policy',
} as const;
type Slug = keyof typeof DOCS;

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return Object.keys(DOCS).map((slug) => ({ slug }));
}

async function getDoc(slug: Slug): Promise<LegalPage | null> {
  try {
    return (await apiGet<LegalPage>(`/public/legal/${slug}`, 300)).data;
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!(slug in DOCS)) return {};
  const title = DOCS[slug as Slug];
  return { title, description: `${title} for 24 Freelancing — the rules that apply to workers, employers and payments on the platform.` };
}

/** SCR-PUB-ND2..ND5 Legal pages (G-15, D-17). Shows `pub.legal.pending` until the client supplies text. */
export default async function LegalDocPage({ params }: Props) {
  const { slug } = await params;
  if (!(slug in DOCS)) notFound();
  const doc = await getDoc(slug as Slug);
  const title = doc?.title ?? DOCS[slug as Slug];
  const toc = doc ? headingsOf(doc.body_md) : [];

  return (
    <MarketingMotion>
      <div className="mx-auto mb-24 max-w-container px-5 pt-8 tablet:px-8 desktop:px-0 desktop:pt-10">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: title }]} />
        <div className="mt-6 grid gap-10 desktop:grid-cols-[760px_320px] desktop:justify-between">
          <article className="min-w-0">
            <header data-reveal className="border-b border-line-subtle pb-6">
              <h1 className="font-display text-[32px] font-bold leading-10 tracking-[-0.8px] text-fg tablet:text-h1">{title}</h1>
              {doc ? <p className="mt-2 text-body-sm text-fg-tertiary">Last updated {formatDate(doc.effective_at)}</p> : null}
            </header>
            {doc ? (
              <div data-reveal className="mt-8">
                <Markdown>{doc.body_md}</Markdown>
              </div>
            ) : (
              <div data-reveal className="mt-8">
                <Alert tone="info" title="Content pending" action={<Link href="/about#contact">Contact us</Link>}>
                  This page is being finalised. Contact us if you need this information.
                </Alert>
              </div>
            )}
          </article>
          <aside className="hidden desktop:block">
            <nav aria-label="Legal documents" className="sticky top-24 space-y-8">
              {toc.length > 1 ? (
                <div>
                  <p className="text-overline uppercase text-fg-tertiary">On this page</p>
                  <ul className="mt-3 space-y-1 border-l border-line">
                    {toc.map((h) => (
                      <li key={h.id}>
                        <a
                          href={`#${h.id}`}
                          className={`-ml-px block border-l-2 border-transparent py-1 text-body-sm text-fg-secondary hover:border-line-brand hover:text-fg-brand ${h.level === 3 ? 'pl-7' : 'pl-4'}`}
                        >
                          {h.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div>
                <p className="text-overline uppercase text-fg-tertiary">Legal</p>
                <ul className="mt-3 space-y-1">
                  {(Object.keys(DOCS) as Slug[]).map((s) => (
                    <li key={s}>
                      <a
                        href={`/legal/${s}`}
                        aria-current={s === slug ? 'page' : undefined}
                        className={`block rounded-md px-3 py-2 text-body-sm ${s === slug ? 'bg-brand-subtle font-semibold text-fg-brand' : 'text-fg-secondary hover:bg-subtle hover:text-fg'}`}
                      >
                        {DOCS[s]}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </nav>
          </aside>
        </div>
      </div>
    </MarketingMotion>
  );
}
