import { formatRelative, formatReward, type JobCard } from '@24f/shared';
import type { JobCardData, JobRowData } from '@24f/ui';

export function toCardData(j: JobCard, now = Date.now()): JobCardData {
  return {
    publicId: j.public_id,
    category: j.category?.name ?? 'Other',
    title: j.title,
    durationLabel: `≈ ${j.display_minutes} min`,
    proofLabel: j.proof_label,
    slotsFilled: j.slots_filled,
    slotsTotal: j.slots_total,
    postedLabel: `posted ${formatRelative(j.published_at, now)}`,
    rewardLabel: formatReward(j.reward_usd),
    isNew: j.is_new,
  };
}

export function toRowData(j: JobCard, now = Date.now()): JobRowData {
  return {
    publicId: j.public_id,
    title: j.title,
    category: j.category?.name ?? 'Other',
    employer: j.employer.business_name,
    ageLabel: formatRelative(j.published_at, now),
    slotsFilled: j.slots_filled,
    slotsTotal: j.slots_total,
    rewardLabel: formatReward(j.reward_usd),
  };
}
