import NextLink from 'next/link';
import { Icon } from '../utils/icons';

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-body-sm text-fg-tertiary">
        {items.map((it, i) => (
          <li key={it.label} className="inline-flex max-w-[260px] items-center gap-1.5">
            {i > 0 ? <Icon name="chevron-right" size={14} /> : null}
            {it.href ? (
              <NextLink href={it.href} className="hover:text-fg-brand">
                {it.label}
              </NextLink>
            ) : (
              <span aria-current="page" className="truncate text-fg-secondary">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
