'use client';
import { useRouter } from 'next/navigation';
import { ActiveFilterPill } from '@24f/ui';
import type { PublicCategory } from '@24f/shared';
import { PROOF_OPTIONS, TIME_OPTIONS, toQuery, type BrowseFilters } from './query';

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
