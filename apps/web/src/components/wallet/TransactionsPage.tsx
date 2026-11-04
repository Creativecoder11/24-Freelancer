'use client';
/** SCR-WAL-ND1 Worker full ledger (G-10, Doc 08 BR-WLD-03): filters, 20 per page, CSV export. */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { formatMoney } from '@24f/shared';
import { Button, Field, Pagination, Search, Select, Skeleton, cn, toast } from '@24f/ui';
import { useWorkerHeader } from '@/components/worker/shell';
import { LoadError } from '@/components/worker/ui';
import { API_BASE, getAccessToken, refreshAccessToken } from '@/lib/api/client';
import { useTransactions } from './api';
import { TxEmpty, TxList } from './parts';

const HEADER = { title: 'Transactions', subtitle: 'Every reward, commission and payout on your balance.', backHref: '/worker/wallet' };
const TYPES = [
  { value: 'all', label: 'All types' },
  { value: 'task_reward', label: 'Task reward' },
  { value: 'referral_commission', label: 'Referral' },
  { value: 'withdrawal', label: 'Withdrawal' },
  { value: 'withdrawal_reversal', label: 'Refunded' },
  { value: 'adjustment', label: 'Adjustment' },
];
const RANGES = [
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_90_days', label: 'Last 90 days' },
  { value: 'this_year', label: 'This year' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

export function TransactionsPage() {
  useWorkerHeader(HEADER);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const type = params.get('type') ?? 'all';
  const range = params.get('range') ?? 'last_30_days';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [exporting, setExporting] = useState(false);

  const set = (p: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(p)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
    if (!('page' in p)) next.delete('page');
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  const customReady = range !== 'custom' || (from && to);
  const qs = new URLSearchParams({ type, range, page: String(page), per_page: '20', ...(q ? { q } : {}), ...(range === 'custom' && from && to ? { from, to } : {}) });
  const list = useTransactions(customReady ? qs : new URLSearchParams({ type, range: 'last_30_days', page: '1', per_page: '20' }));

  const exportCsv = async () => {
    setExporting(true);
    try {
      const token = getAccessToken() ?? (await refreshAccessToken());
      const e = new URLSearchParams(qs);
      e.set('format', 'csv');
      e.delete('page');
      e.delete('per_page');
      const res = await fetch(`${API_BASE}/worker/wallet/transactions?${e}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'transactions.csv';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.show({ tone: 'danger', title: 'Export failed', body: 'Choose a date range of up to 1 year and try again.' });
    } finally {
      setExporting(false);
    }
  };

  const m = list.data?.meta;
  return (
    <div className="mx-auto flex w-full max-w-[1104px] flex-col gap-6">
      {m ? (
        <div className="grid grid-cols-2 gap-4 tablet:max-w-[560px]">
          <div className="rounded-card border border-line bg-surface p-5 shadow-xs">
            <p className="text-body-sm text-fg-secondary">Added in this view</p>
            <p className="mt-1 font-display text-num-lg text-fg-success tabular-nums">{formatMoney(m.summary.credited_usd)}</p>
          </div>
          <div className="rounded-card border border-line bg-surface p-5 shadow-xs">
            <p className="text-body-sm text-fg-secondary">Withdrawn in this view</p>
            <p className="mt-1 font-display text-num-lg text-fg tabular-nums">{formatMoney(m.summary.withdrawn_usd)}</p>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 tablet:flex-row tablet:flex-wrap tablet:items-end">
        <Select label="Type" options={TYPES} value={type} onChange={(v) => set({ type: v === 'all' ? null : v })} className="tablet:w-[200px]" />
        <Select label="Date range" options={RANGES} value={range} onChange={(v) => set({ range: v === 'last_30_days' ? null : v, ...(v !== 'custom' ? { from: null, to: null } : {}) })} className="tablet:w-[200px]" />
        {range === 'custom' ? (
          <>
            <Field label="From" type="date" value={from} onChange={(e) => set({ from: e.target.value })} wrapperClassName="tablet:w-[170px]" />
            <Field label="To" type="date" value={to} onChange={(e) => set({ to: e.target.value })} wrapperClassName="tablet:w-[170px]" />
          </>
        ) : null}
        <div className="min-w-0 tablet:flex-1">
          <Search value={q} onValueChange={(v) => (setQ(v), set({ q: v }))} placeholder="Search by job or reference" label="Search transactions" />
        </div>
        <Button variant="secondary" size="M" leadingIcon="download" onClick={exportCsv} loading={exporting} className="tablet:h-12">
          Export CSV
        </Button>
      </div>
      {list.isError ? (
        <LoadError error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data ? (
        <div className="rounded-card border border-line bg-surface p-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton.TableRow key={i} columns={6} />
          ))}
        </div>
      ) : (
        <div className={cn('transition-opacity', list.isPlaceholderData && 'opacity-60')}>
          <TxList rows={list.data.data} showBalance caption="Transactions" empty={<TxEmpty action={type !== 'all' || q || range !== 'all' ? <Button size="M" variant="secondary" onClick={() => (setQ(''), router.replace(pathname))}>Clear filters</Button> : <Button size="M" href="/worker/jobs">Find jobs</Button>} />} />
        </div>
      )}
      {m && m.total > 0 ? <Pagination page={page} totalPages={m.total_pages} total={m.total} perPage={20} itemLabel="transactions" hrefFor={(p) => { const n = new URLSearchParams(params.toString()); n.set('page', String(p)); return `${pathname}?${n}`; }} /> : null}
    </div>
  );
}
