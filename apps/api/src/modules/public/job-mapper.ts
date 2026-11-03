import type { CategorySlug, JobCard, ProofType } from '@24f/shared';

const PROOF_SHORT: Record<ProofType, string> = { screenshot: 'Screenshot', link: 'Link', text: 'Text answer', file: 'File upload' };

/** C-05: display label is the joined proof types, e.g. "Screenshot + link". */
export function proofLabel(types: ProofType[]): string {
  if (!types.length) return 'Proof not set yet';
  return types.map((t, i) => (i === 0 ? PROOF_SHORT[t] : PROOF_SHORT[t].toLowerCase())).join(' + ');
}

export interface JobRowRaw {
  public_id: string;
  title: string;
  category_slug: string | null;
  category_name: string | null;
  business_name: string;
  employer_verified: boolean;
  reward_usd: string;
  display_minutes: number;
  proof_types: ProofType[];
  slots_total: number;
  slots_left: number;
  published_at: Date | null;
  ends_at: Date | null;
}

export function toJobCard(r: JobRowRaw, newBadgeMinutes: number): JobCard {
  const published = r.published_at ? new Date(r.published_at) : null;
  return {
    public_id: r.public_id,
    title: r.title,
    category: r.category_slug ? { slug: r.category_slug as CategorySlug, name: r.category_name ?? '' } : null,
    employer: { business_name: r.business_name, employer_verified: r.employer_verified },
    is_new: !!published && Date.now() - published.getTime() <= newBadgeMinutes * 60_000,
    reward_usd: Number(r.reward_usd).toFixed(3),
    display_minutes: r.display_minutes,
    proof_types: r.proof_types,
    proof_label: proofLabel(r.proof_types),
    slots_total: r.slots_total,
    slots_filled: r.slots_total - r.slots_left,
    slots_left: r.slots_left,
    published_at: published?.toISOString() ?? null,
    ends_at: r.ends_at ? new Date(r.ends_at).toISOString() : null,
  };
}
