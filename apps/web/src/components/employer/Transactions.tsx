'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Icon, Pagination, Search, Select, Skeleton, Tooltip, cn, toast, useStaggerIn, CountUp } from '@24f/ui';
import { formatDateTime, formatMoney } from '@24f/shared';
import { API_BASE, apiFetch, getAccessToken, refreshAccessToken } from '@/lib/api/client';
import { ek, type TxMeta, type TxRow } from './api';
import { useEmployerHeader } from './shell';
import { ErrorPanel } from './common';

const BASE_TYPES = [
  { value: 'all', label: 'All types' },
  { value: 'deposit', label: 'Deposit' },
  { value: 'job_reserve', label: 'Reserve' },
  { value: 'job_spend', label: 'Job spend' },
  { value: 'job_release', label: 'Refund' },
];
const EXTRA_TYPES = [
  { value: 'platform_fee', label: 'Platform fee' },
  { value: 'deposit_refund', label: 'Deposit refund' },
  { value: 'adjustment', label: 'Adjustment' },
];
const RANGES = [
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_90_days', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'this_year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

/** SCR-WAL-06 Transaction history (Figma 42:1425). */
export function Transactions() {
  useEmployerHeader({ title: 'Transactions', subtitle: 'Deposits, job spending and refunds.', backHref: '/employer/wallet' });
  const router = useRouter();
  const sp = useSearchParams();
  const type = sp.get('type') ?? 'all';
  const range = sp.get('range') ?? 'last_30_days';
  const q = sp.get('q') ?? '';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const query = { type, range, q: q || undefined, page, per_page: 10 };
  const tx = useQuery({
    queryKey: ek.txns(JSON.stringify(query)),
    queryFn: () => apiFetch<TxRow[], TxMeta>('/employer/wallet/transactions', { query }),
    placeholderData: (p) => p,
  });
  const href = (p: Partial<{ type: string; range: string; q: string; page: number }>) => {
    const u = new URLSearchParams();
    const t = p.type ?? type;
    const r = p.range ?? range;
    const qq = p.q ?? q;
    if (t !== 'all') u.set('type', t);
    if (r !== 'last_30_days') u.set('range', r);
    if (qq) u.set('q', qq);
    if ((p.page ?? 1) > 1) u.set('page', String(p.page));
    return `/employer/wallet/transactions${u.size ? `?${u}` : ''}`;
  };
  const go = (p: Parameters<typeof href>[0]) => router.replace(href({ page: 1, ...p }), { scroll: false });
  const meta = tx.data?.meta;
  const rows = tx.data?.data ?? [];
  const types = [...BASE_TYPES, ...EXTRA_TYPES.filter((t) => meta?.types_present.includes(t.value) || t.value === type)];
  const filtered = type !== 'all' || range !== 'last_30_days' || !!q;
  const list = useStaggerIn<HTMLTableSectionElement>([page, type, range, q, rows.length], { selector: 'tr' });
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const u = new URLSearchParams({ type, range, ...(q ? { q } : {}) });
      let token = getAccessToken() ?? (await refreshAccessToken());
      let res = await fetch(`${API_BASE}/employer/wallet/transactions/export?${u}`, { headers: { Authorization: `Bearer ${token}`, 'X-Client': 'web' }, credentials: 'include' });
      if (res.status === 401) {
        token = await refreshAccessToken();
        res = await fetch(`${API_BASE}/employer/wallet/transactions/export?${u}`, { headers: { Authorization: `Bearer ${token}`, 'X-Client': 'web' }, credentials: 'include' });
      }
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'transactions.csv';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast.show({ tone: 'success', title: 'CSV downloaded.' });
    } catch {
      toast.show({ tone: 'danger', title: 'We couldn’t create the CSV. Try again.' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 tablet:grid-cols-3 desktop:gap-6">
        <Summary label="Deposited this month" v={meta?.summary.deposited_this_month_usd} />
        <Summary label="Spent on approvals" v={meta?.summary.spent_on_approvals_usd} />
        <Summary label="Returned to deposit" v={meta?.summary.returned_to_deposit_usd} green />
      </div>

      <div className="grid grid-cols-2 gap-3 tablet:grid-cols-[200px_200px_minmax(0,1fr)] tablet:items-end desktop:grid-cols-[220px_220px_320px_minmax(0,1fr)] desktop:gap-4">
        <Select label="Type" options={types} value={type} onChange={(v) => go({ type: v })} />
        <Select label="Date range" options={RANGES} value={range} onChange={(v) => go({ range: v })} />
        <Search size="M" label="Search by job or reference" placeholder="Search by job or reference" value={q} onValueChange={(v) => go({ q: v })} className="col-span-2 tablet:col-span-1" />
        <div className="col-span-2 flex justify-end tablet:col-span-3 desktop:col-span-1">
          <Button variant="secondary" leadingIcon="download" onClick={() => void exportCsv()} loading={exporting} loadingText="Exporting…" disabled={!rows.length} disabledReasonId="export-reason" className="max-tablet:w-full">
            Export CSV
          </Button>
          <span id="export-reason" className="sr-only">
            Nothing to export for these filters.
          </span>
        </div>
      </div>

      {tx.isError ? (
        <ErrorPanel onRetry={() => tx.refetch()} />
      ) : !tx.data ? (
        <div className="rounded-card border border-line bg-surface p-4" aria-busy="true" aria-label="Loading transactions">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton.TableRow key={i} columns={6} />
          ))}
        </div>
      ) : !rows.length ? (
        <div className="rounded-card border border-line bg-surface">
          {filtered ? (
            <EmptyState compact icon="search" title="No transactions match" body="Try another type or a wider date range." action={<Button variant="secondary" href="/employer/wallet/transactions">Clear filters</Button>} />
          ) : (
            <EmptyState icon="wallet" title="No transactions yet" body="Add funds to post your first job." action={<Button href="/employer/wallet">Add funds</Button>} />
          )}
        </div>
      ) : (
        <div className={cn(tx.isFetching && 'opacity-70 transition-opacity')}>
          <div className="hidden overflow-hidden rounded-card border border-line bg-surface shadow-xs tablet:block">
            <table className="w-full text-left text-body-sm">
              <caption className="sr-only">Transactions</caption>
              <thead>
                <tr className="border-b border-line-subtle bg-subtle text-overline uppercase text-fg-tertiary">
                  <th scope="col" className="px-5 py-4">Date</th>
                  <th scope="col" className="px-3 py-4">Type</th>
                  <th scope="col" className="px-3 py-4">Description</th>
                  <th scope="col" className="px-3 py-4 text-right">Amount</th>
                  <th scope="col" className="px-3 py-4 text-right">Balance</th>
                  <th scope="col" className="px-5 py-4 max-desktop:hidden">Reference</th>
                </tr>
              </thead>
              <tbody ref={list} className="divide-y divide-line-subtle">
                {rows.map((r) => (
                  <tr key={r.ref} className="hover:bg-subtle">
                    <td className="whitespace-nowrap px-5 py-5 text-fg-secondary">{formatDateTime(r.occurred_at)}</td>
                    <td className="whitespace-nowrap px-3 py-5 text-label-md text-fg">{r.type_label}</td>
                    <td className="px-3 py-5 text-fg-secondary">{r.description}</td>
                    <td className={cn('whitespace-nowrap px-3 py-5 text-right font-semibold tabular-nums', amountTone(r))}>{r.amount_label}</td>
                    <td className="whitespace-nowrap px-3 py-5 text-right tabular-nums text-fg">{formatMoney(r.balance_usd)}</td>
                    <td className="px-5 py-5 max-desktop:hidden">
                      <RefCell r={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 tablet:hidden" aria-label="Transactions">
            {rows.map((r) => (
              <li key={r.ref} className="rounded-card border border-line bg-surface p-4 shadow-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-label-md text-fg">{r.type_label}</p>
                    <p className="mt-0.5 text-body-sm text-fg-secondary">{r.description}</p>
                  </div>
                  <p className={cn('shrink-0 font-semibold tabular-nums', amountTone(r))}>{r.amount_label}</p>
                </div>
                <div className="mt-2 flex items-center justify-between text-body-xs text-fg-tertiary">
                  <span>
                    {formatDateTime(r.occurred_at)} · {r.ref}
                  </span>
                  <span className="tabular-nums">Balance {formatMoney(r.balance_usd)}</span>
                </div>
              </li>
            ))}
          </ul>
          {meta ? (
            <div className="mt-5 flex flex-col items-center justify-between gap-3 tablet:flex-row">
              <p className="text-body-sm text-fg-secondary">
                Showing {rows.length} of {meta.total}
              </p>
              {meta.total_pages > 1 ? <Pagination page={meta.page} totalPages={meta.total_pages} total={meta.total} perPage={meta.per_page} hrefFor={(p) => href({ page: p })} hideSummary /> : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function amountTone(r: TxRow) {
  return r.amount_style === 'credit' ? 'text-fg-success' : r.amount_style === 'neutral' ? 'text-fg-secondary' : 'text-fg';
}

function RefCell({ r }: { r: TxRow }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.ref);
      toast.show({ tone: 'success', title: 'Copied' });
    } catch {
      toast.show({ tone: 'danger', title: 'Couldn’t copy', body: 'Select the text and copy it yourself.' });
    }
  };
  return (
    <span className="group inline-flex items-center gap-1.5">
      <span className="text-body-xs text-fg-tertiary">{r.ref}</span>
      {r.grouped_count > 1 ? <span className="text-body-xs text-fg-tertiary">+{r.grouped_count - 1}</span> : null}
      <Tooltip content="Copy reference" describe={false}>
        <button type="button" onClick={() => void copy()} aria-label={`Copy reference ${r.ref}`} className="grid size-7 place-items-center rounded-[6px] text-fg-tertiary opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 focus-visible:shadow-focus focus-visible:outline-none group-hover:opacity-100">
          <Icon name="copy" size={14} />
        </button>
      </Tooltip>
    </span>
  );
}

function Summary({ label, v, green }: { label: string; v?: string; green?: boolean }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-xs">
      <h2 className="text-body-sm text-fg-secondary">{label}</h2>
      <p className={cn('mt-1 font-display text-num-lg tabular-nums', green ? 'text-fg-success' : 'text-fg')}>
        {v === undefined ? <Skeleton height={32} width={100} /> : <CountUp value={Number(v)} format={(n) => formatMoney(n.toFixed(6))} />}
      </p>
    </section>
  );
}
