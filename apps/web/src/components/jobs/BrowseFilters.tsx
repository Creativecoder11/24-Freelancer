'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BottomSheet, Button, Checkbox, Icon, LinkButton, RadioGroup } from '@24f/ui';
import type { PublicCategory } from '@24f/shared';
import { PROOF_OPTIONS, REWARD_OPTIONS, TIME_OPTIONS, toQuery, type BrowseFilters } from './query';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

function toggle(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Panel({ draft, setDraft, categories, facets }: { draft: BrowseFilters; setDraft: (f: BrowseFilters) => void; categories: PublicCategory[]; facets: Record<string, number> }) {
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="text-label-md text-fg">Category</legend>
        <div className="mt-3 space-y-2.5">
          {categories.map((c) => (
            <Checkbox
              key={c.slug}
              label={c.name}
              count={facets[c.slug] ?? 0}
              checked={draft.category.includes(c.slug)}
              onChange={() => setDraft({ ...draft, category: toggle(draft.category, c.slug) })}
            />
          ))}
        </div>
      </fieldset>
      <RadioGroup
        legend="Reward per task"
        name="reward_min"
        value={draft.reward_min ?? ''}
        onChange={(v) => setDraft({ ...draft, reward_min: v || null })}
        options={REWARD_OPTIONS}
      />
      <fieldset>
        <legend className="text-label-md text-fg">Time to complete</legend>
        <div className="mt-3 space-y-2.5">
          {TIME_OPTIONS.map((o) => (
            <Checkbox key={o.value} label={o.label} checked={draft.time.includes(o.value)} onChange={() => setDraft({ ...draft, time: toggle(draft.time, o.value) })} />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-label-md text-fg">Proof type</legend>
        <div className="mt-3 space-y-2.5">
          {PROOF_OPTIONS.map((o) => (
            <Checkbox key={o.value} label={o.label} checked={draft.proof.includes(o.value)} onChange={() => setDraft({ ...draft, proof: toggle(draft.proof, o.value) })} />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** Filters sidebar (Figma 20:516). Draft state + live "Show N jobs" count; applies on click. Mobile: bottom sheet. */
export function BrowseFilters({ applied, categories }: { applied: BrowseFilters; categories: PublicCategory[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState(applied);
  const [count, setCount] = useState<number | null>(null);
  const [facets, setFacets] = useState<Record<string, number>>({});
  const [sheet, setSheet] = useState(false);

  useEffect(() => setDraft(applied), [applied]);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/public/jobs${toQuery({ ...draft, page: 1 }, { count_only: 'true' })}`, { signal: ctrl.signal }).then((r) => r.json());
        setCount(res.meta?.total ?? 0);
        setFacets(res.meta?.facets?.category ?? {});
      } catch {
        /* aborted */
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [draft]);

  const apply = () => {
    setSheet(false);
    router.push(`/jobs${toQuery({ ...draft, page: 1 })}`, { scroll: false });
  };
  const clear = () => {
    const empty = { ...draft, category: [], reward_min: null, time: [], proof: [], page: 1 };
    setDraft(empty);
    router.push(`/jobs${toQuery({ q: draft.q, sort: draft.sort })}`, { scroll: false });
  };
  const label = count === null ? 'Show jobs' : `Show ${count} ${count === 1 ? 'job' : 'jobs'}`;

  return (
    <>
      <aside className="hidden h-fit rounded-card border border-line bg-surface p-6 shadow-xs desktop:block" aria-label="Filters">
        <div className="mb-6 flex items-center justify-between">
          <p className="inline-flex items-center gap-2 text-label-lg text-fg">
            <Icon name="filter" size={20} /> Filters
          </p>
          <LinkButton onClick={clear}>Clear all</LinkButton>
        </div>
        <Panel draft={draft} setDraft={setDraft} categories={categories} facets={facets} />
        <Button fullWidth className="mt-8" onClick={apply}>
          {label}
        </Button>
      </aside>
      <div className="desktop:hidden">
        <Button variant="secondary" leadingIcon="filter" onClick={() => setSheet(true)}>
          Filters
        </Button>
        <BottomSheet
          open={sheet}
          onOpenChange={setSheet}
          title="Filters"
          footer={
            <div className="grid grid-cols-[120px_1fr] gap-3">
              <Button variant="tertiary" size="L" onClick={clear}>
                Clear all
              </Button>
              <Button size="L" onClick={apply}>
                {label}
              </Button>
            </div>
          }
        >
          <Panel draft={draft} setDraft={setDraft} categories={categories} facets={facets} />
        </BottomSheet>
      </div>
    </>
  );
}
