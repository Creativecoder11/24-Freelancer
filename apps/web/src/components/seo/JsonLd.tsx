import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, abs } from '@/lib/site';

/**
 * schema.org structured data. Search engines and AI assistants read it to describe the site
 * (name, logo, what it is, site search, FAQ answers). `<` is escaped so CMS text can't close the tag.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}

export const ORG_ID = `${SITE_URL}/#organization`;

/** Organization + WebSite (with a jobs search box) — on every public page. */
export function SiteJsonLd() {
  return (
    <JsonLd
      data={[
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          '@id': ORG_ID,
          name: SITE_NAME,
          alternateName: ['24Freelancing', '24 Freelancer'],
          url: SITE_URL,
          logo: abs('/icon.svg'),
          description: SITE_DESCRIPTION,
          areaServed: 'Worldwide',
          sameAs: ['https://facebook.com/24freelancing', 'https://facebook.com/groups/24freelancing', 'https://youtube.com/@24freelancing'],
        },
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          '@id': `${SITE_URL}/#website`,
          name: SITE_NAME,
          url: SITE_URL,
          description: SITE_DESCRIPTION,
          publisher: { '@id': ORG_ID },
          inLanguage: 'en',
          potentialAction: {
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/jobs?q={search_term_string}` },
            'query-input': 'required name=search_term_string',
          },
        },
      ]}
    />
  );
}

/** FAQPage from published FAQ answers (home page, help center). */
export function FaqJsonLd({ faqs }: { faqs: { question: string; answer_md: string }[] }) {
  const items = faqs.filter((f) => f.answer_md.trim());
  if (!items.length) return null;
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer_md } })),
      }}
    />
  );
}

/** Breadcrumbs for nested pages (help articles, job details). */
export function BreadcrumbJsonLd({ items }: { items: { name: string; path: string }[] }) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.path) })),
      }}
    />
  );
}
