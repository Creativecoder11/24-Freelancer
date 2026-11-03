'use client';
import { useRef, useState, useTransition } from 'react';
import NextLink from 'next/link';
import { Breadcrumbs, Button, JobRow, LoadingRegion, Search, Skeleton, TabPanel, Tabs, gsap, useGSAP, MOTION_OK } from '@24f/ui';
import { formatMoney, type JobCard, type PublicCategory } from '@24f/shared';
import { toRowData } from '@/lib/jobs';
import { searchJobsAction, type SearchMeta } from '@/lib/api/public-actions';

const MIN_Q = 2;

type State = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; jobs: JobCard[]; meta: SearchMeta };

function syncUrl(q: string, tab: string) {
  const qs = new URLSearchParams();
  if (q.length >= MIN_Q) qs.set('q', q);
  if (q.length >= MIN_Q && tab !== 'all') qs.set('tab', tab);
  const path = q.length >= MIN_Q ? `/jobs/search?${qs}` : '/jobs/categories';
  if (`${window.location.pathname}${window.location.search}` !== path) window.history.replaceState(null, '', path);
}

/** SCR-PUB-04 (Figma 21:1053): category directory with live keyword search, category tabs and cursor "Load more". */
export function CategorySearch({
  categories,
  initialQuery,
  initialTab,
  initial,
  initialCounts,
}: {
  categories: PublicCategory[];
  initialQuery: string;
  initialTab: string;
  initial: { jobs: JobCard[]; meta: SearchMeta } | null;
  initialCounts: { total: number; counts: Record<string, number> } | null;
}) {
  const [q, setQ] = useState(initialQuery);
  const [tab, setTab] = useState(initialTab);
  const [allCounts, setAllCounts] = useState(initialCounts);
  const [state, setState] = useState<State>(initial ? { status: 'ready', ...initial } : initialQuery.length >= MIN_Q ? { status: 'error' } : { status: 'idle' });
  const [moreLoading, startMore] = useTransition();
  const req = useRef(0);
  const list = useRef<HTMLUListElement>(null);
  const now = Date.now();

  async function run(nextQ: string, nextTab: string) {
    syncUrl(nextQ, nextTab);
    if (nextQ.length < MIN_Q) {
      req.current++;
      setState({ status: 'idle' });
      setAllCounts(null);
      return;
    }
    const id = ++req.current;
    setState({ status: 'loading' });
    const [res, all] = await Promise.all([
      searchJobsAction({ q: nextQ, category: nextTab }),
      // Tab counts always come from the unfiltered query.
      nextTab === 'all' ? Promise.resolve(null) : allCounts && nextQ === q ? Promise.resolve(null) : searchJobsAction({ q: nextQ }),
    ]);
    if (id !== req.current) return;
    if (!res.ok) return setState({ status: 'error' });
    setState({ status: 'ready', jobs: res.data, meta: res.meta });
    if (nextTab === 'all') setAllCounts({ total: res.meta.total, counts: res.meta.counts });
    else if (all && all.ok) setAllCounts({ total: all.meta.total, counts: all.meta.counts });
  }

  function onQuery(v: string) {
    const next = v.trim();
    if (next === q) return;
    setQ(next);
    setTab('all');
    void run(next, 'all');
  }

  function onTab(v: string) {
    setTab(v);
    void run(q, v);
  }

  function loadMore() {
    if (state.status !== 'ready' || !state.meta.next_cursor) return;
    const cursor = state.meta.next_cursor;
    const before = state.jobs.length;
    startMore(async () => {
      const res = await searchJobsAction({ q, category: tab, cursor });
      if (!res.ok) return;
      setState((s) => (s.status === 'ready' ? { status: 'ready', jobs: [...s.jobs, ...res.data], meta: res.meta } : s));
      requestAnimationFrame(() => {
        const items = list.current?.querySelectorAll(':scope > li');
        if (!items) return;
        const added = Array.from(items).slice(before);
        gsap.matchMedia().add(MOTION_OK, () => {
          gsap.fromTo(added, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.05, ease: 'power2.out' });
        });
        (added[0]?.querySelector('a') as HTMLElement | null)?.focus({ preventScroll: true });
      });
    });
  }

  // Stagger rows each time a new result set lands.
  useGSAP(
    () => {
      if (state.status !== 'ready' || !list.current) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(list.current!.querySelectorAll(':scope > li'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.05, ease: 'power2.out' });
      });
      return () => mm.revert();
    },
    { dependencies: [state.status === 'ready' ? state.meta : null] },
  );

  const searching = q.length >= MIN_Q;
  const catName = (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug;
  const tabs = allCounts
    ? [
        { value: 'all', label: 'All', count: allCounts.total },
        ...Object.entries(allCounts.counts)
          .filter(([, n]) => n > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([slug, n]) => ({ value: slug, label: catName(slug), count: n })),
      ]
    : [{ value: 'all', label: 'All' }];

  return (
    <>
      <header className="border-b border-line-subtle">
        <div className="mx-auto max-w-container px-5 pb-6 pt-8 tablet:px-8 desktop:px-0 desktop:pt-10">
          <div data-reveal>
            <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Browse jobs', href: '/jobs' }, { label: 'Categories' }]} />
            <h1 className="mt-4 font-display text-[32px] font-bold leading-10 tracking-[-0.8px] text-fg tablet:text-h1">Find work by category</h1>
            <p className="mt-2 text-body-md text-fg-secondary">Pick a category to see open jobs, or search across all of them.</p>
          </div>
          <div data-reveal className="mt-4">
            <Search size="L" label="Search jobs" placeholder="Search jobs — e.g. “survey”" value={q} onValueChange={onQuery} onSubmit={onQuery} debounceMs={300} />
          </div>
        </div>
      </header>

      <section aria-labelledby="all-cats" className="mx-auto max-w-container px-5 pt-10 tablet:px-8 desktop:px-0 desktop:pt-12">
        <h2 id="all-cats" data-reveal className="font-display text-h3 text-fg">
          All categories
        </h2>
        <ul data-reveal-group className="mt-5 grid grid-cols-2 gap-3 tablet:gap-6 desktop:grid-cols-4">
          {categories.map((c) => {
            const active = searching && tab === c.slug;
            return (
              <li data-reveal-item key={c.slug}>
                <NextLink
                  href={`/jobs?category=${c.slug}`}
                  aria-current={active ? 'true' : undefined}
                  className={`group flex h-full min-h-[88px] flex-col justify-center gap-1 rounded-card border px-4 py-3 transition-[background-color,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-brand hover:bg-brand-subtle focus-visible:outline-none focus-visible:shadow-focus tablet:flex-row tablet:items-end tablet:justify-between tablet:gap-3 tablet:px-4 ${active ? 'border-line-brand bg-brand-subtle' : 'border-line bg-surface'}`}
                >
                  <span className="min-w-0">
                    <span className="block text-label-lg text-fg">{c.name}</span>
                    <span className="mt-0.5 block text-body-sm text-fg-secondary">
                      {c.open_jobs} open {c.open_jobs === 1 ? 'job' : 'jobs'}
                    </span>
                  </span>
                  {c.avg_reward_usd ? <span className="shrink-0 text-body-xs text-fg-tertiary">Avg. {formatMoney(c.avg_reward_usd)} per task</span> : null}
                </NextLink>
              </li>
            );
          })}
        </ul>
      </section>

      {searching ? (
        <section aria-labelledby="results-h" className="mx-auto mt-16 max-w-container px-5 tablet:px-8 desktop:mt-[88px] desktop:px-0">
          <h2 id="results-h" className="font-display text-h3 text-fg">
            Results for “{q}”
          </h2>
          <p className="mt-1 text-body-md text-fg-tertiary" aria-live="polite">
            {state.status === 'ready'
              ? `${state.meta.total} ${state.meta.total === 1 ? 'job' : 'jobs'} · sorted by newest`
              : state.status === 'loading'
                ? 'Searching…'
                : ' '}
          </p>
          <Tabs label="Results by category" tabs={tabs} value={tab} onChange={onTab} panelId="search-results" className="mt-5" />
          <TabPanel id="search-results" className="mt-4">
            {state.status === 'loading' ? (
              <LoadingRegion label="Loading results">
                <div className="overflow-hidden rounded-card border border-line">
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton.JobRow key={i} />
                  ))}
                </div>
              </LoadingRegion>
            ) : state.status === 'error' ? (
              <div role="alert" className="rounded-card border border-line bg-surface px-6 py-10 text-center">
                <p className="text-h5 text-fg">We couldn’t load this</p>
                <p className="mt-1 text-body-sm text-fg-secondary">Check your connection and try again.</p>
                <Button variant="secondary" size="M" className="mt-4" onClick={() => run(q, tab)}>
                  Try again
                </Button>
              </div>
            ) : state.status === 'ready' && state.jobs.length === 0 ? (
              <div className="rounded-card border border-line bg-surface px-6 py-12 text-center">
                <p className="text-h5 text-fg">No results for “{q}”</p>
                <p className="mt-1 text-body-sm text-fg-secondary">Try what you’ll do (“tag photos”) or a proof type (“screenshot”).</p>
                <Button variant="secondary" size="M" className="mt-4" onClick={() => onQuery('')}>
                  Clear search
                </Button>
              </div>
            ) : state.status === 'ready' ? (
              <>
                <ul ref={list} aria-busy={moreLoading} className="divide-y divide-line-subtle overflow-hidden rounded-card border border-line bg-surface shadow-xs">
                  {state.jobs.map((j) => (
                    <JobRow key={j.public_id} job={toRowData(j, now)} href={`/jobs/${j.public_id}`} />
                  ))}
                </ul>
                {state.meta.has_more ? (
                  <div className="mt-6 flex justify-center">
                    <Button variant="secondary" size="M" className="w-[200px]" loading={moreLoading} loadingText="Loading…" onClick={loadMore}>
                      Load more results
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </TabPanel>
        </section>
      ) : null}

      <div className="mx-auto mb-24 mt-6 max-w-container px-5 tablet:px-8 desktop:px-0">
        <p data-reveal className={`rounded-card bg-brand-subtle px-4 py-4 text-body-md text-fg ${searching ? '' : 'mt-10'}`}>
          Tip: search by what you’ll do (“transcribe”, “tag photos”) or by proof type (“screenshot”). Results update as you type.
        </p>
      </div>
    </>
  );
}
