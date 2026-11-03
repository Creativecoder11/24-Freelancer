/** URL ⇄ filter state for /jobs (Doc 03 §7: filter state lives in the URL). */
export interface BrowseFilters {
  q: string;
  category: string[];
  reward_min: string | null;
  time: string[];
  proof: string[];
  sort: string;
  page: number;
}

type SP = Record<string, string | string[] | undefined>;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(',') : []).filter(Boolean);

export function parseFilters(sp: SP): BrowseFilters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  return {
    q: one('q') ?? '',
    category: list(sp.category),
    reward_min: one('reward_min') ?? null,
    time: list(sp.time),
    proof: list(sp.proof),
    sort: one('sort') ?? 'newest',
    page: Math.max(1, Number(one('page') ?? 1) || 1),
  };
}

export function toQuery(f: Partial<BrowseFilters>, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.category?.length) p.set('category', f.category.join(','));
  if (f.reward_min) p.set('reward_min', f.reward_min);
  if (f.time?.length) p.set('time', f.time.join(','));
  if (f.proof?.length) p.set('proof', f.proof.join(','));
  if (f.sort && f.sort !== 'newest') p.set('sort', f.sort);
  if (f.page && f.page > 1) p.set('page', String(f.page));
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const REWARD_OPTIONS = [
  { value: '', label: 'Any reward' },
  { value: '0.10', label: '$0.10 or more' },
  { value: '0.25', label: '$0.25 or more' },
  { value: '0.50', label: '$0.50 or more' },
];
export const TIME_OPTIONS = [
  { value: 'under_5', label: 'Under 5 minutes' },
  { value: '5_15', label: '5–15 minutes' },
  { value: 'over_15', label: 'Over 15 minutes' },
];
export const PROOF_OPTIONS = [
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'link', label: 'Link' },
  { value: 'text', label: 'Text answer' },
  { value: 'file', label: 'File upload' },
];
export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'highest_reward', label: 'Highest reward' },
  { value: 'shortest_time', label: 'Shortest time' },
  { value: 'most_slots', label: 'Most slots left' },
  { value: 'ending_soon', label: 'Ending soon' },
];
