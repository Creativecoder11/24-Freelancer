'use client';
import NextLink from 'next/link';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';
import { Button } from '../primitives/Button';

export interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  itemLabel?: string;
  hrefFor: (p: number) => string;
  /** Hide the "Showing x–y of z" text. */
  hideSummary?: boolean;
  className?: string;
}

/** First, last, current ±1 with "…" gaps (max 7 items). */
export function pageItems(page: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, page - 1, page, page + 1].filter((p) => p >= 1 && p <= total));
  if (page <= 3) [2, 3, 4].forEach((p) => set.add(p));
  if (page >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => set.add(p));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

const pagerBtn =
  'inline-flex h-9 items-center justify-center rounded-[8px] text-label-md transition-colors duration-[120ms] focus-visible:outline-none focus-visible:shadow-focus';

/** Pagination (Doc 02 §5.21): Previous/Next 100×36, items 36×36, current brand-subtle. */
export function Pagination({ page, totalPages, total, perPage, itemLabel, hrefFor, hideSummary, className }: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  const summary = `Showing ${from}–${to} of ${total}${itemLabel ? ` ${itemLabel}` : ''}`;
  const edge = (dir: 'prev' | 'next') => {
    const disabled = dir === 'prev' ? page <= 1 : page >= totalPages;
    const inner = (
      <>
        {dir === 'prev' ? <Icon name="chevron-left" size={16} /> : null}
        {dir === 'prev' ? 'Previous' : 'Next'}
        {dir === 'next' ? <Icon name="chevron-right" size={16} /> : null}
      </>
    );
    const cls = cn(pagerBtn, 'w-[100px] gap-1.5 border border-line bg-surface', disabled ? 'cursor-not-allowed text-fg-disabled' : 'text-fg-secondary hover:bg-subtle hover:border-line-strong');
    return disabled ? (
      <span aria-disabled="true" className={cls}>
        {inner}
      </span>
    ) : (
      <NextLink href={hrefFor(dir === 'prev' ? page - 1 : page + 1)} rel={dir} className={cls}>
        {inner}
      </NextLink>
    );
  };
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-4', className)}>
      {!hideSummary ? <p className="text-body-sm text-fg-tertiary">{summary}</p> : <span />}
      {totalPages > 1 ? (
        <nav aria-label="Pagination">
          <ul className="flex items-center gap-2">
            <li>{edge('prev')}</li>
            {pageItems(page, totalPages).map((p, i) =>
              p === 'gap' ? (
                <li key={`g${i}`} aria-hidden className="inline-flex size-9 items-center justify-center text-label-md text-fg-secondary">
                  …
                </li>
              ) : (
                <li key={p}>
                  <NextLink
                    href={hrefFor(p)}
                    aria-current={p === page ? 'page' : undefined}
                    aria-label={`Page ${p}`}
                    className={cn(pagerBtn, 'size-9 tabular-nums', p === page ? 'bg-brand-subtle text-fg-brand' : 'text-fg-secondary hover:bg-muted')}
                  >
                    {p}
                  </NextLink>
                </li>
              ),
            )}
            <li>{edge('next')}</li>
          </ul>
        </nav>
      ) : null}
    </div>
  );
}

export interface LoadMoreProps {
  label?: string;
  loading: boolean;
  hasMore: boolean;
  onClick: () => void;
  /** "{n} more results loaded" — announced politely. */
  announce?: string;
}

/** Load more (Doc 02 §5.21b): Secondary M "Load more results" centred, hidden when all loaded. */
export function LoadMore({ label = 'Load more results', loading, hasMore, onClick, announce }: LoadMoreProps) {
  return (
    <div className="flex flex-col items-center">
      {hasMore ? (
        <Button variant="secondary" loading={loading} onClick={onClick} className="min-w-[200px]">
          {label}
        </Button>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
