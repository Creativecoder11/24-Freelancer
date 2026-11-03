'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActiveFilterPill, Search, Select } from '@24f/ui';
import type { PublicCategory } from '@24f/shared';
import { PROOF_OPTIONS, SORT_OPTIONS, TIME_OPTIONS, toQuery, type BrowseFilters } from './query';

export function BrowseSearch({ applied }: { applied: BrowseFilters }) {
  const router = useRouter();
  const [q, setQ] = useState(applied.q);
  const go = (v: string) => router.push(`/jobs${toQuery({ ...applied, q: v, page: 1 })}`, { scroll: false });
  return (
    <div className="mt-8 grid gap-3 tablet:grid-cols-[1fr_240px] desktop:grid-cols-[880px_296px] desktop:items-end desktop:gap-6">
      <Search
        label="Search jobs"
        placeholder="Search jobs — e.g. survey, data entry, app test"
        value={q}
        onValueChange={(v) => {
          setQ(v);
          go(v);
        }}
        onSubmit={go}
      />
      <Select
        label="Sort by"
        options={SORT_OPTIONS}
        value={applied.sort}
        onChange={(v) => router.push(`/jobs${toQuery({ ...applied, sort: v, page: 1 })}`, { scroll: false })}
      />
    </div>
  );
}

/** Removable pills for applied filters (Figma 20:602). */
export function ActiveFilters({ applied, categories }: { applied: BrowseFilters; categories: PublicCategory[] }) {
  const router = useRouter();
  const nav = (f: BrowseFilters) => router.push(`/jobs${toQuery({ ...f, page: 1 })}`, { scroll: false });
  const pills: { label: string; next: BrowseFilters }[] = [
    ...applied.category.map((c) => ({ label: categories.find((x) => x.slug === c)?.name ?? c, next: { ...applied, category: applied.category.filter((x) => x !== c) } })),
    ...(applied.reward_min ? [{ label: `$${applied.reward_min} or more`, next: { ...applied, reward_min: null } }] : []),
    ...applied.time.map((t) => ({ label: TIME_OPTIONS.find((o) => o.value === t)?.label ?? t, next: { ...applied, time: applied.time.filter((x) => x !== t) } })),
    ...applied.proof.map((t) => ({ label: PROOF_OPTIONS.find((o) => o.value === t)?.label ?? t, next: { ...applied, proof: applied.proof.filter((x) => x !== t) } })),
  ];
  if (!pills.length) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {pills.map((p) => (
        <ActiveFilterPill key={p.label} label={p.label} onRemove={() => nav(p.next)} />
      ))}
    </div>
  );
}
