import { cn } from '../utils/cn';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
  /** Shown as the card title on mobile. */
  primary?: boolean;
  hideOnMobile?: boolean;
}

/** Table on ≥ tablet, stacked cards on mobile (Doc 02 §12: tables → cards). */
export function DataTable<T>({ columns, rows, rowKey, caption, empty, className, selectedKey }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; caption: string; empty?: React.ReactNode; className?: string; selectedKey?: string }) {
  if (!rows.length) return <div className={className}>{empty}</div>;
  const primary = columns.find((c) => c.primary) ?? columns[0]!;
  return (
    <div className={cn('overflow-hidden rounded-card border border-line bg-surface shadow-xs', className)}>
      <table className="hidden w-full text-left tablet:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line-subtle bg-subtle">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-5 py-3 text-overline uppercase text-fg-tertiary', c.align === 'right' && 'text-right', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {rows.map((r) => (
            <tr key={rowKey(r)} className={cn('text-body-sm text-fg transition-colors hover:bg-subtle', selectedKey === rowKey(r) && 'bg-brand-subtle')}>
              {columns.map((c) => (
                <td key={c.key} className={cn('px-5 py-4 align-middle', c.align === 'right' && 'text-right tabular-nums', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-line-subtle tablet:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="px-4 py-4">
            <div className="text-label-md text-fg">{primary.cell(r)}</div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {columns
                .filter((c) => c !== primary && !c.hideOnMobile)
                .map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-body-xs text-fg-tertiary">{c.header}</dt>
                    <dd className={cn('text-body-sm text-fg', c.align === 'right' && 'text-right tabular-nums')}>{c.cell(r)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
