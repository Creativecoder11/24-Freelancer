'use client';
/**
 * SCR-WRK-02 Find jobs (Figma 28:834, mobile 47:837) + SCR-WRK-03 drawer (`?filters=open`).
 * Search, sort, chips and pager apply immediately and sync to the URL. Refetch every 60 s.
 */
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { formatCount } from '@24f/shared';
import { Alert, Button, EmptyState, FilterChip, FilterChipGroup, Icon, JobCard, Pagination, Search, Select, Skeleton, cn, useStaggerIn } from '@24f/ui';
import { useMe } from '@/lib/auth/session';
import { toCardData } from '@/lib/jobs';
import { useWorkerJobs } from '../data';
import { LoadError } from '../ui';
import { FiltersDrawer } from './FiltersDrawer';
import { CHIP_ORDER, SORT_OPTIONS, activeCount, categoryLabel, parseFilters, toQs, type WorkerJobFilters } from './query';

function ago(at: number, now: number) {
  const s = Math.floor((now - at) / 1000);
  if (s < 60) return 'Updated just now';
  const m = Math.floor(s / 60);
  return `Updated ${m} min ago`;
}

export function JobsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const f = useMemo(() => parseFilters(new URLSearchParams(sp.toString())), [sp]);
  const drawerOpen = sp.get('filters') === 'open';
  const apiQs = toQs(f);
  const q = useWorkerJobs(apiQs);
  const me = useMe();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const go = (next: Partial<WorkerJobFilters>, extra: Record<string, string> = {}) => {
    const qs = toQs({ ...f, page: 1, ...next }, extra);
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  };
  const setDrawer = (open: boolean) => go({ page: f.page }, open ? { filters: 'open' } : {});

  const data = q.data;
  const counts = data?.meta.counts;
  const total = data?.meta.total ?? 0;
  const gridRef = useStaggerIn<HTMLDivElement>([apiQs, data?.data.length ?? 0]);
  const hasInterests = (me.data?.interests.length ?? 1) > 0;
  const nActive = activeCount(f);
  const filtered = nActive > 0 || !!f.q || f.chip !== 'all';

  return (
    <div>
      <div className="mb-5 tablet:hidden">
        <h2 className="font-display text-h2 text-fg">Find jobs</h2>
        <p className="mt-1 text-body-sm text-fg-tertiary">{data ? `${formatCount(counts?.all ?? total)} open · paid per approved task` : ' '}</p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 desktop:gap-4">
        <Search
          label="Search jobs"
          placeholder="Search jobs — e.g. survey, data entry, app test"
          value={f.q}
          onValueChange={(v) => v !== f.q && go({ q: v })}
          className="min-w-0 flex-1"
        />
        <div className="hidden w-[240px] shrink-0 tablet:block">
          <Select label="Sort" compact={{ inlineLabel: 'Sort:' }} options={SORT_OPTIONS} value={f.sort} onChange={(v) => go({ sort: v })} />
        </div>
        <span className="hidden shrink-0 tablet:block">
        <Button variant="secondary" size="L" leadingIcon="filter" onClick={() => setDrawer(true)} aria-haspopup="dialog">
          Filters
          {nActive ? <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-label-sm text-fg-on-brand">{nActive}</span> : null}
        </Button>
        </span>
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-label={nActive ? `Filters, ${nActive} applied` : 'Filters'}
          className="relative grid size-[52px] shrink-0 place-items-center rounded-[12px] border border-line bg-surface text-fg focus-visible:shadow-focus focus-visible:outline-none tablet:hidden"
        >
          <Icon name="filter" size={20} />
          {nActive ? <span aria-hidden className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-brand text-label-sm text-fg-on-brand">{nActive}</span> : null}
        </button>
      </div>

      {/* Category chips */}
      <FilterChipGroup label="Category" className="mt-4">
        <FilterChip label="All" count={counts?.all} selected={f.chip === 'all'} onClick={() => go({ chip: 'all' })} />
        {hasInterests || f.chip === 'for_you' ? <FilterChip label="For you" count={counts?.for_you} selected={f.chip === 'for_you'} onClick={() => go({ chip: 'for_you' })} /> : null}
        {CHIP_ORDER.map((c) => (
          <FilterChip key={c} label={categoryLabel(c)} count={counts?.[c]} selected={f.chip === c} onClick={() => go({ chip: c })} />
        ))}
      </FilterChipGroup>

      {/* Result meta */}
      <div className="mt-4 flex items-center justify-between text-body-sm">
        <p className="text-label-md text-fg" aria-live="polite">
          {data ? `${formatCount(total)} ${total === 1 ? 'job' : 'jobs'} open` : ' '}
        </p>
        <p className="text-fg-tertiary">{data ? ago(data.at, now) : ''}</p>
      </div>

      {/* Grid */}
      <div className="mt-4">
        {q.isError && !data ? (
          <LoadError error={q.error} onRetry={() => q.refetch()} title="We couldn’t load jobs" />
        ) : !data ? (
          <div className="grid gap-4 tablet:grid-cols-2 tablet:gap-6 desktop:grid-cols-3" aria-busy="true">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton.JobCard key={i} />
            ))}
          </div>
        ) : data.data.length ? (
          <div ref={gridRef} className={cn('grid gap-4 tablet:grid-cols-2 tablet:gap-6 desktop:grid-cols-3', q.isFetching && q.isPlaceholderData && 'opacity-60')}>
            {data.data.map((j) => (
              <JobCard
                key={j.public_id}
                job={toCardData(j, now)}
                href={`/worker/jobs/${j.public_id}`}
                ctaLabel={j.my_state === 'in_progress' ? 'Continue' : j.my_state === 'done' ? 'View task' : 'View job'}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-card border border-line bg-surface">
            {f.chip === 'for_you' && nActive === 0 && !f.q ? (
              <EmptyState
                icon="search"
                title="No jobs match your interests right now"
                body="See everything that’s open."
                action={
                  <Button variant="secondary" onClick={() => go({ chip: 'all' })}>
                    Show all jobs
                  </Button>
                }
              />
            ) : filtered ? (
              <EmptyState
                icon="search"
                title="No jobs match these filters"
                body="Try fewer filters or a broader search. New jobs are posted throughout the day."
                action={
                  <Button variant="secondary" onClick={() => router.replace(pathname, { scroll: false })}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon="briefcase"
                title="No open jobs right now"
                body="New jobs are posted throughout the day. We’ll tell you when one fits."
                action={
                  <Button variant="secondary" href="/worker/notifications">
                    Notification settings
                  </Button>
                }
              />
            )}
          </div>
        )}
      </div>

      {data && data.meta.total_pages > 1 ? (
        <Pagination
          className="mt-6"
          page={data.meta.page}
          totalPages={data.meta.total_pages}
          total={data.meta.total}
          perPage={data.meta.per_page}
          hrefFor={(p) => {
            const qs = toQs({ ...f, page: p });
            return `${pathname}${qs ? `?${qs}` : ''}`;
          }}
        />
      ) : null}

      <Alert tone="info" className="mt-6">
        Tip: jobs you start reserve a slot for a limited time. Finish and submit before it expires so the slot isn’t released.
      </Alert>

      <FiltersDrawer open={drawerOpen} onOpenChange={setDrawer} applied={f} facets={data?.meta.facets} onApply={(next) => go(next)} />
    </div>
  );
}
