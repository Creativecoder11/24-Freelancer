/** URL ⇄ filter state for /worker/jobs (Doc 02 §6.4.2; Doc 06 §5.6 GET /worker/jobs). */
import { JOB_SORT, PROOF_TYPE, PUBLIC_CATEGORY_SLUGS, TIME_BUCKET, CATEGORY_SLUG, type JobSort } from '@24f/shared';

export interface WorkerJobFilters {
  q: string;
  chip: string;
  category: string[];
  reward_min: string | null;
  reward_max: string | null;
  time: string[];
  proof: string[];
  only_open: boolean;
  hide_done: boolean;
  sort: JobSort;
  page: number;
}

export const DEFAULT_FILTERS: WorkerJobFilters = {
  q: '',
  chip: 'all',
  category: [],
  reward_min: null,
  reward_max: null,
  time: [],
  proof: [],
  only_open: true,
  hide_done: true,
  sort: 'newest',
  page: 1,
};

const list = (v: string | null) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const bool = (v: string | null, def: boolean) => (v === null ? def : v === '1' || v === 'true');

export function parseFilters(sp: URLSearchParams): WorkerJobFilters {
  const sort = sp.get('sort') ?? 'newest';
  return {
    q: sp.get('q') ?? '',
    chip: sp.get('chip') ?? 'all',
    category: list(sp.get('category')).filter((c) => (PUBLIC_CATEGORY_SLUGS as readonly string[]).includes(c)),
    reward_min: sp.get('reward_min'),
    reward_max: sp.get('reward_max'),
    time: list(sp.get('time')).filter((t) => (TIME_BUCKET.values as readonly string[]).includes(t)),
    proof: list(sp.get('proof')).filter((t) => (PROOF_TYPE.values as readonly string[]).includes(t)),
    only_open: bool(sp.get('only_open'), true),
    hide_done: bool(sp.get('hide_done'), true),
    sort: ((JOB_SORT.values as readonly string[]).includes(sort) ? sort : 'newest') as JobSort,
    page: Math.max(1, Number(sp.get('page') ?? 1) || 1),
  };
}

/** Query string without the leading "?" (only non-default values). */
export function toQs(f: Partial<WorkerJobFilters>, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.chip && f.chip !== 'all') p.set('chip', f.chip);
  if (f.category?.length) p.set('category', f.category.join(','));
  if (f.reward_min) p.set('reward_min', f.reward_min);
  if (f.reward_max) p.set('reward_max', f.reward_max);
  if (f.time?.length) p.set('time', f.time.join(','));
  if (f.proof?.length) p.set('proof', f.proof.join(','));
  if (f.only_open === false) p.set('only_open', '0');
  if (f.hide_done === false) p.set('hide_done', '0');
  if (f.sort && f.sort !== 'newest') p.set('sort', f.sort);
  if (f.page && f.page > 1) p.set('page', String(f.page));
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

/** Number of drawer filters applied (for the Filters button pill). */
export function activeCount(f: WorkerJobFilters): number {
  return (
    f.category.length +
    f.time.length +
    f.proof.length +
    (f.reward_min || f.reward_max ? 1 : 0) +
    (f.only_open ? 0 : 1) +
    (f.hide_done ? 0 : 1)
  );
}

export const CHIP_ORDER = ['data-entry', 'surveys', 'website-testing', 'app-testing', 'writing', 'image-tagging', 'social-media', 'research'] as const;
export const categoryLabel = (slug: string) => (CATEGORY_SLUG.labels as Record<string, string>)[slug] ?? slug;

export const SORT_OPTIONS = JOB_SORT.values.map((v) => ({ value: v, label: JOB_SORT.labels[v] }));
export const TIME_OPTIONS = TIME_BUCKET.values.map((v) => ({ value: v, label: TIME_BUCKET.labels[v] }));
export const PROOF_OPTIONS = PROOF_TYPE.values.map((v) => ({ value: v, label: PROOF_TYPE.labels[v] }));

/** Reward slider: $0.01 to $0.40+, step $0.01; the top knob at max means no upper limit (C-17). */
export const REWARD_MIN = 0.01;
export const REWARD_MAX = 0.4;
export const REWARD_DEFAULT_LO = 0.1;
