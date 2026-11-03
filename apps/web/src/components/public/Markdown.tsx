import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import NextLink from 'next/link';

/** Stable heading ids for the legal contents list. */
export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function textOf(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: React.ReactNode } }).props.children);
  return '';
}

/** Extract `##`/`###` headings from markdown for a contents list. */
export function headingsOf(md: string): { level: 2 | 3; text: string; id: string }[] {
  return md
    .split('\n')
    .map((l) => l.match(/^(#{2,3})\s+(.+?)\s*#*$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ level: m[1]!.length as 2 | 3, text: m[2]!.replace(/[*_`]/g, ''), id: slugify(m[2]!.replace(/[*_`]/g, '')) }));
}

const components: Components = {
  h1: ({ children }) => <h2 className="mt-10 font-display text-h3 text-fg first:mt-0">{children}</h2>,
  h2: ({ children }) => (
    <h2 id={slugify(textOf(children))} className="mt-10 scroll-mt-24 font-display text-h3 text-fg first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 id={slugify(textOf(children))} className="mt-8 scroll-mt-24 font-display text-h4 text-fg first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => <h4 className="mt-6 text-h5 text-fg">{children}</h4>,
  p: ({ children }) => <p className="mt-4 text-body-md text-fg-secondary first:mt-0">{children}</p>,
  ul: ({ children }) => <ul className="mt-4 list-disc space-y-2 pl-6 text-body-md text-fg-secondary marker:text-fg-tertiary">{children}</ul>,
  ol: ({ children }) => <ol className="mt-4 list-decimal space-y-2 pl-6 text-body-md text-fg-secondary marker:text-fg-tertiary">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="mt-4 rounded-r-lg border-l-4 border-line-brand bg-brand-subtle px-4 py-3">{children}</blockquote>,
  code: ({ children }) => <code className="rounded-xs bg-muted px-1 py-0.5 text-[0.9em] text-fg">{children}</code>,
  hr: () => <hr className="my-8 border-line-subtle" />,
  table: ({ children }) => (
    <div className="mt-4 overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-body-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-line bg-subtle px-4 py-2 text-label-sm text-fg">{children}</th>,
  td: ({ children }) => <td className="border-b border-line-subtle px-4 py-2 text-fg-secondary">{children}</td>,
  a: ({ href = '', children }) =>
    href.startsWith('/') ? (
      <NextLink href={href} className="font-medium text-fg-brand underline underline-offset-2 hover:no-underline">
        {children}
      </NextLink>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-fg-brand underline underline-offset-2 hover:no-underline">
        {children}
      </a>
    ),
  img: () => null,
};

/**
 * Safe markdown for CMS content (help articles, legal pages). Raw HTML is never rendered
 * (no rehype-raw) and react-markdown's default urlTransform strips javascript: URLs.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
