'use client';
/**
 * SCR-WRK-03 Filters drawer (Figma 29:1146; Doc 02 §5.42). Draft state lives here; the live count
 * comes from GET /worker/jobs?…&count_only=1 (debounced 300 ms). Applied on "Show N jobs" only;
 * close, Esc and scrim discard. Mobile: full-height bottom sheet that also carries Sort.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, Divider, Drawer, RangeSlider, Select, Switch, useIsMobile } from '@24f/ui';
import { apiFetch } from '@/lib/api/client';
import type { JobsMeta } from '../data';
import { wk } from '../data';
import {
  CHIP_ORDER,
  DEFAULT_FILTERS,
  PROOF_OPTIONS,
  REWARD_MAX,
  REWARD_MIN,
  SORT_OPTIONS,
  TIME_OPTIONS,
  categoryLabel,
  toQs,
  type WorkerJobFilters,
} from './query';

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

const money = (v: number) => `$${v.toFixed(2)}`;

export function FiltersDrawer({
  open,
  onOpenChange,
  applied,
  facets,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  applied: WorkerJobFilters;
  facets: JobsMeta['facets'] | undefined;
  onApply: (f: WorkerJobFilters) => void;
}) {
  const [draft, setDraft] = useState<WorkerJobFilters>(applied);
  const isMobile = useIsMobile();
  useEffect(() => {
    if (open) setDraft(applied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const qs = useDebounced(toQs({ ...draft, page: 1 }, { count_only: '1' }), 300);
  const count = useQuery({
    queryKey: wk.jobCount(qs),
    queryFn: async () => (await apiFetch<unknown[], JobsMeta>(`/worker/jobs?${qs}`)).meta!.total,
    enabled: open,
    placeholderData: (p) => p,
    staleTime: 15_000,
  });
  const n = count.data;

  const toggle = (key: 'category' | 'time' | 'proof', v: string) =>
    setDraft((d) => ({ ...d, [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v] }));

  const lo = draft.reward_min ? Number(draft.reward_min) : REWARD_MIN;
  const hi = draft.reward_max ? Number(draft.reward_max) : REWARD_MAX;
  const nLabel = n === undefined ? 'Counting…' : `${n} ${n === 1 ? 'job' : 'jobs'} match`;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Filters"
      meta={nLabel}
      width={440}
      footer={
        <div className="w-full">
          {n === 0 ? <p className="mb-2 text-body-sm text-fg-tertiary">No jobs match. Remove a filter to see more.</p> : null}
          <div className="flex items-center gap-3">
            <Button variant="tertiary" size="L" className="w-[120px]" onClick={() => setDraft({ ...DEFAULT_FILTERS, q: draft.q, chip: draft.chip, sort: draft.sort })}>
              Clear all
            </Button>
            <Button size="L" className="flex-1" disabled={n === 0} onClick={() => onApply({ ...draft, page: 1 })}>
              {n === undefined ? 'Show jobs' : `Show ${n} ${n === 1 ? 'job' : 'jobs'}`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {isMobile ? (
          <>
            <Select label="Sort by" options={SORT_OPTIONS} value={draft.sort} onChange={(v) => setDraft((d) => ({ ...d, sort: v }))} />
            <Divider />
          </>
        ) : null}
        <fieldset>
          <legend className="text-label-md text-fg">Category</legend>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            {CHIP_ORDER.map((c) => (
              <Checkbox
                key={c}
                label={`${categoryLabel(c)}${facets?.category[c] !== undefined ? ` (${facets.category[c]})` : ''}`}
                checked={draft.category.includes(c)}
                onChange={() => toggle('category', c)}
              />
            ))}
          </div>
        </fieldset>
        <Divider />
        <fieldset>
          <legend className="text-label-md text-fg">Reward per task</legend>
          <RangeSlider
            mode="dual"
            label="Reward per task"
            labelHidden
            className="mt-4"
            min={REWARD_MIN}
            max={REWARD_MAX}
            step={0.01}
            value={[lo, hi]}
            format={(v) => (v >= REWARD_MAX ? `${money(REWARD_MAX)}+` : money(v))}
            onChange={([a, b]) =>
              setDraft((d) => ({
                ...d,
                reward_min: a <= REWARD_MIN ? null : a.toFixed(2),
                reward_max: b >= REWARD_MAX ? null : b.toFixed(2),
              }))
            }
          />
        </fieldset>
        <Divider />
        <fieldset>
          <legend className="text-label-md text-fg">Time to complete</legend>
          <div className="mt-3 space-y-2">
            {TIME_OPTIONS.map((o) => (
              <Checkbox key={o.value} label={o.label} checked={draft.time.includes(o.value)} onChange={() => toggle('time', o.value)} />
            ))}
          </div>
        </fieldset>
        <Divider />
        <fieldset>
          <legend className="text-label-md text-fg">Proof type</legend>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            {PROOF_OPTIONS.map((o) => (
              <Checkbox key={o.value} label={o.label} checked={draft.proof.includes(o.value)} onChange={() => toggle('proof', o.value)} />
            ))}
          </div>
        </fieldset>
        <Divider />
        <div className="space-y-3">
          <Switch label="Only jobs with slots open" checked={draft.only_open} onCheckedChange={(v) => setDraft((d) => ({ ...d, only_open: v }))} />
          <Switch label="Hide jobs I’ve already done" checked={draft.hide_done} onCheckedChange={(v) => setDraft((d) => ({ ...d, hide_done: v }))} />
        </div>
      </div>
    </Drawer>
  );
}
