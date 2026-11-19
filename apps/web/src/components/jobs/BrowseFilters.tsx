'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Checkbox, Icon, Popover, RadioGroup, Search, Select, cn } from '@24f/ui';
import type { PublicCategory } from '@24f/shared';
import { PROOF_OPTIONS, REWARD_OPTIONS, SORT_OPTIONS, TIME_OPTIONS, toQuery, type BrowseFilters } from './query';

function toggle(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** One compact filter: a pill button that opens a small popover. Changes apply immediately. */
function FilterMenu({
  label,
  active,
  count,
  onClear,
  children,
}: {
  label: string;
  active: boolean;
  count?: number;
  onClear: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border pl-4 pr-3 text-label-md transition-colors duration-[120ms] focus-visible:shadow-focus focus-visible:outline-none',
          active ? 'border-line-brand bg-brand-subtle text-fg-brand' : 'border-line bg-surface text-fg hover:border-line-strong',
        )}
      >
        {label}
        {count ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-label-sm text-fg-on-brand">{count}</span>
        ) : null}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
      </button>
      <Popover open={open} onOpenChange={setOpen} anchorRef={ref} id={id} role="dialog" aria-label={`${label} filter`} className="w-[280px]">
        <div className="max-h-[360px] overflow-y-auto p-4">{children}</div>
        {active ? (
          <div className="flex justify-end border-t border-line-subtle px-4 py-2.5">
            <button type="button" onClick={onClear} className="rounded-[6px] text-label-md text-fg-brand hover:underline focus-visible:shadow-focus focus-visible:outline-none">
              Clear
            </button>
          </div>
        ) : null}
      </Popover>
    </>
  );
}

/**
 * Compact filter bar for /jobs: Category · Reward · Time · Proof dropdowns + Sort.
 * Every change updates the URL right away (filter state lives in the URL, Doc 03 §7).
 */
export function BrowseFilters({ applied, categories, facets }: { applied: BrowseFilters; categories: PublicCategory[]; facets: Record<string, number> }) {
  const router = useRouter();
  // Local copy so checkboxes respond instantly while the server re-renders the list.
  const [f, setF] = useState(applied);
  useEffect(() => setF(applied), [applied]);
  // Search text is kept apart and never re-synced from the server, so a slow
  // response can't overwrite what the user is still typing.
  const [q, setQ] = useState(applied.q);

  const go = (patch: Partial<BrowseFilters>) => {
    const next = { ...f, q, ...patch, page: 1 };
    setF(next);
    router.replace(`/jobs${toQuery(next)}`, { scroll: false });
  };
  const search = (v: string) => {
    if (v === q) return;
    setQ(v);
    go({ q: v });
  };

  const nActive = f.category.length + (f.reward_min ? 1 : 0) + f.time.length + f.proof.length;
  const rewardLabel = f.reward_min ? REWARD_OPTIONS.find((o) => o.value === f.reward_min)?.label ?? `$${f.reward_min}+` : 'Reward';

  // Desktop: one row — filters · search (fills the gap) · sort.
  // Below desktop: search on its own row, then filters + sort.
  return (
    <div className="flex flex-col gap-3 desktop:flex-row desktop:items-center desktop:gap-4">
      <div className="min-w-0 desktop:order-2 desktop:flex-1">
        <Search label="Search jobs" placeholder="Search jobs — e.g. survey" value={q} onValueChange={search} />
      </div>
      <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between desktop:contents">
      <div
        role="group"
        aria-label="Filters"
        className="-mx-5 flex shrink-0 items-center gap-2 overflow-x-auto px-5 py-1 [scrollbar-width:none] tablet:mx-0 tablet:flex-wrap tablet:overflow-visible tablet:px-0 desktop:order-1 desktop:flex-nowrap [&::-webkit-scrollbar]:hidden"
      >
        <span className="mr-1 hidden items-center gap-1.5 text-label-md text-fg-secondary tablet:inline-flex">
          <Icon name="filter" size={16} /> Filter
        </span>
        <FilterMenu label="Category" active={f.category.length > 0} count={f.category.length} onClear={() => go({ category: [] })}>
          <fieldset>
            <legend className="sr-only">Category</legend>
            <div className="space-y-2.5">
              {categories.map((c) => (
                <Checkbox
                  key={c.slug}
                  label={c.name}
                  count={facets[c.slug] ?? 0}
                  checked={f.category.includes(c.slug)}
                  onChange={() => go({ category: toggle(f.category, c.slug) })}
                />
              ))}
            </div>
          </fieldset>
        </FilterMenu>
        <FilterMenu label={rewardLabel} active={!!f.reward_min} onClear={() => go({ reward_min: null })}>
          <RadioGroup legend="Reward per task" legendHidden name="reward_min" value={f.reward_min ?? ''} onChange={(v) => go({ reward_min: v || null })} options={REWARD_OPTIONS} />
        </FilterMenu>
        <FilterMenu label="Time" active={f.time.length > 0} count={f.time.length} onClear={() => go({ time: [] })}>
          <fieldset>
            <legend className="sr-only">Time to complete</legend>
            <div className="space-y-2.5">
              {TIME_OPTIONS.map((o) => (
                <Checkbox key={o.value} label={o.label} checked={f.time.includes(o.value)} onChange={() => go({ time: toggle(f.time, o.value) })} />
              ))}
            </div>
          </fieldset>
        </FilterMenu>
        <FilterMenu label="Proof" active={f.proof.length > 0} count={f.proof.length} onClear={() => go({ proof: [] })}>
          <fieldset>
            <legend className="sr-only">Proof type</legend>
            <div className="space-y-2.5">
              {PROOF_OPTIONS.map((o) => (
                <Checkbox key={o.value} label={o.label} checked={f.proof.includes(o.value)} onChange={() => go({ proof: toggle(f.proof, o.value) })} />
              ))}
            </div>
          </fieldset>
        </FilterMenu>
        {nActive ? (
          <button
            type="button"
            onClick={() => go({ category: [], reward_min: null, time: [], proof: [] })}
            className="ml-1 shrink-0 whitespace-nowrap rounded-[6px] text-label-md text-fg-brand hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            Clear all
          </button>
        ) : null}
      </div>
      <div className="shrink-0 tablet:w-[240px] desktop:order-3">
        <Select label="Sort" compact={{ inlineLabel: 'Sort:' }} options={SORT_OPTIONS} value={f.sort} onChange={(v) => go({ sort: v })} />
      </div>
      </div>
    </div>
  );
}
