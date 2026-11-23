import { z } from 'zod';
import Decimal from 'decimal.js';
import type { Job, JobProofRequirement, JobStep } from '@24f/db';
import { COUNTRY_NAMES, jobZone, zoneCountries } from '@24f/shared';

/** Wizard field rules (Doc 04 §5.4, VR-071…VR-085). Settings ranges are passed in. */
export interface JobLimits {
  rewardMin: string;
  rewardMax: string;
  slotsMin: number;
  slotsMax: number;
  openForDays: number[];
  minApprovalRates: number[];
  reviewWindows: number[];
  shorteners: string[];
  /** Minimum worker payout per job (slots × reward). */
  minSpendUsd: string;
  scheduleMaxDays: number;
}

/** Most screenshots one submission can require. */
export const MAX_SCREENSHOTS = 5;

export const TIME_MINUTES: Record<string, number> = { about_2: 2, about_5: 5, about_10: 10, about_15: 15, about_30: 30, about_60: 60 };
export const TIME_PER_TASK_VALUES = ['about_2', 'about_5', 'about_10', 'about_15', 'about_30', 'about_60'] as const;
export const PROOF_TYPES = ['screenshot', 'link', 'text', 'file'] as const;

const proofReq = z.object({
  proof_type: z.enum(PROOF_TYPES),
  title: z.string().trim().min(1).max(80),
  field_label: z.string().trim().max(60).nullish(),
  helper: z.string().trim().max(200).nullish(),
  is_required: z.boolean().optional(),
});

/** Body for POST /employer/jobs and PATCH /employer/jobs/{publicId}. Field rules are checked per step. */
export const jobWriteSchema = z
  .object({
    expected_version: z.number().int().optional(),
    wizard_step: z.number().int().min(1).max(5).optional(),
    title: z.string().max(200).nullish(),
    category: z.string().max(40).nullish(),
    subcategory: z.string().max(60).nullish(),
    target_zone: z.string().max(30).optional(),
    /** "Show in" picks inside the zone. Empty = the whole zone. */
    target_countries: z.array(z.string().max(2)).max(200).optional(),
    excluded_countries: z.array(z.string().max(2)).max(200).optional(),
    note: z.string().max(1000).nullish(),
    thumbnail_upload_id: z.string().uuid().nullish(),
    starts_at: z.string().datetime({ offset: true }).nullish(),
    boost_days: z.number().int().min(0).max(30).optional(),
    time_per_task: z.enum(TIME_PER_TASK_VALUES).optional(),
    open_for_days: z.number().int().optional(),
    eligibility: z.enum(['all_verified', 'kyc_verified']).optional(),
    min_approval_rate: z.number().int().optional(),
    steps: z.array(z.object({ position: z.number().int().optional(), body: z.string().max(1000) })).max(20).optional(),
    task_link_url: z.string().max(2048).nullish(),
    proof_requirements: z.array(proofReq).max(8).optional(),
    proof_instructions: z.string().max(1000).nullish(),
    reward_usd: z.union([z.string(), z.number()]).transform((v) => String(v)).nullish(),
    slots_total: z.number().int().nullish(),
    review_window_hours: z.number().int().optional(),
    submissions_per_worker: z.number().int().optional(),
    allow_resubmission: z.boolean().optional(),
    auto_approve: z.boolean().optional(),
    pause_on_low_deposit: z.boolean().optional(),
    extend_days: z.number().int().optional(),
    confirm_total_reserved_usd: z.string().optional(),
  })
  .strict();
export type JobWrite = z.infer<typeof jobWriteSchema>;

export type JobFull = Job & {
  jobSteps: JobStep[];
  jobProofRequirements: JobProofRequirement[];
  category: { slug: string; name: string } | null;
  subcategory: { slug: string; name: string } | null;
  /** Active subcategories of the chosen category (subcategory is required when there are any). */
  categorySubcount?: number;
};

type Errors = Record<string, string[]>;
const add = (e: Errors, k: string, m: string) => ((e[k] ??= []).push(m), e);
const len = (s: string | null | undefined) => [...(s ?? '').trim()].length;

function isHttpsUrl(u: string) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Wizard steps (change request Nov 2026): 1 Location, 2 Category, 3 Job information,
 * 4 Budget & settings, 5 Review & publish. Steps 1–4 have field rules.
 */
export function validateStep(step: number, j: JobFull, lim: JobLimits): Errors {
  const e: Errors = {};
  if (step === 1) {
    const zone = jobZone(j.targetZone);
    if (!zone) add(e, 'target_zone', 'Choose where workers can be.');
    else {
      const allowed = new Set(zoneCountries(zone.slug));
      if (j.targetCountries.some((c) => !allowed.has(c))) add(e, 'target_countries', 'Only show the job in countries inside the selected zone.');
      if (j.excludedCountries.some((c) => !allowed.has(c))) add(e, 'excluded_countries', 'Only hide countries inside the selected zone.');
      const shown = j.targetCountries.length ? j.targetCountries : [...allowed];
      if (shown.length && shown.every((c) => j.excludedCountries.includes(c))) add(e, 'excluded_countries', 'Keep at least one country open.');
    }
  }
  if (step === 2) {
    if (!j.categoryId) add(e, 'category', 'Choose a category.');
    // Jobs published before subcategories existed keep working without one.
    else if (j.status === 'draft' && (j.categorySubcount ?? 0) > 0 && !j.subcategoryId) add(e, 'subcategory', 'Choose a subcategory.');
  }
  if (step === 3) {
    if (len(j.title) < 10 || len(j.title) > 80) add(e, 'title', 'Use 10–80 characters for the title.');
    if (len(j.note) > 300) add(e, 'note', 'Keep the note under 300 characters.');
    const steps = j.jobSteps;
    if (steps.length < 1 || steps.length > 10) add(e, 'steps', 'Add 1–10 steps.');
    steps.forEach((s, i) => {
      if (len(s.body) < 5 || len(s.body) > 300) add(e, `steps.${i}.body`, 'Each step needs 5–300 characters.');
    });
    if (j.taskLinkUrl) {
      if (!isHttpsUrl(j.taskLinkUrl)) add(e, 'task_link_url', 'Enter a full link starting with https://.');
      else {
        const host = new URL(j.taskLinkUrl).hostname.toLowerCase();
        if (lim.shorteners.some((d) => host === d || host.endsWith('.' + d))) add(e, 'task_link_url', "Short links aren't allowed. Paste the full link.");
      }
    }
    if (j.jobProofRequirements.length < 1) add(e, 'proof_requirements', 'Choose at least one type of proof.');
    if (j.jobProofRequirements.filter((p) => p.proofType === 'screenshot').length > MAX_SCREENSHOTS) add(e, 'proof_requirements', `Ask for at most ${MAX_SCREENSHOTS} screenshots.`);
    if (len(j.proofInstructions) < 10 || len(j.proofInstructions) > 300) add(e, 'proof_instructions', 'Describe the proof in 10–300 characters.');
  }
  if (step === 4) {
    const r = j.rewardUsd ? new Decimal(j.rewardUsd.toString()) : null;
    if (!r || r.lt(lim.rewardMin) || r.gt(lim.rewardMax) || r.decimalPlaces() > 3)
      add(e, 'reward_usd', `Enter a reward between $${new Decimal(lim.rewardMin).toFixed(3)} and $${new Decimal(lim.rewardMax).toFixed(3)}.`);
    if (!j.slotsTotal || j.slotsTotal < lim.slotsMin || j.slotsTotal > lim.slotsMax)
      add(e, 'slots_total', `Enter between ${lim.slotsMin} and ${lim.slotsMax.toLocaleString('en-US')} slots.`);
    else if (r && r.mul(j.slotsTotal).lt(lim.minSpendUsd))
      add(e, 'slots_total', `Minimum spend is $${new Decimal(lim.minSpendUsd).toFixed(2)}. Add workers or raise the reward.`);
    if (j.status === 'draft' && !lim.openForDays.includes(j.openForDays)) add(e, 'open_for_days', 'Choose how long the job stays open.');
    if (!lim.minApprovalRates.includes(j.minApprovalRate)) add(e, 'min_approval_rate', 'Choose a minimum approval rate.');
    if (!lim.reviewWindows.includes(j.reviewWindowHours)) add(e, 'review_window_hours', 'Choose 24, 48 or 72 hours.');
    if (j.submissionsPerWorker !== 1) add(e, 'submissions_per_worker', 'Each worker can submit once.');
    if (j.status === 'draft') {
      if (j.startsAt) {
        const ms = j.startsAt.getTime() - Date.now();
        if (ms < 5 * 60_000) add(e, 'starts_at', 'Pick a start time at least 5 minutes from now, or leave it empty to start at once.');
        else if (ms > lim.scheduleMaxDays * 86_400_000) add(e, 'starts_at', `Schedule up to ${lim.scheduleMaxDays} days ahead.`);
      }
    }
  }
  return e;
}

export function firstIncompleteStep(j: JobFull, lim: JobLimits): number | null {
  for (const s of [1, 2, 3, 4]) if (Object.keys(validateStep(s, j, lim)).length) return s;
  return null;
}

/** Valid ISO country codes for "hide countries". */
export function isKnownCountry(c: string) {
  return Object.prototype.hasOwnProperty.call(COUNTRY_NAMES, c);
}

/** Content screen (D-12, BR-092). Pure over title, steps, proof instructions and link. */
export function screenContent(
  j: JobFull,
  lists: { blockTerms: string[]; blockDomains: string[]; shorteners: string[]; watchTerms: string[] },
): { result: 'ok' | 'flag' | 'block'; reason?: string; hits: string[] } {
  const text = [j.title, j.note ?? '', ...j.jobSteps.map((s) => s.body), j.proofInstructions ?? ''].join('\n');
  const urls = [...text.matchAll(/https?:\/\/[^\s)]+/gi)].map((m) => m[0]);
  if (j.taskLinkUrl) urls.push(j.taskLinkUrl);
  const hostOf = (u: string) => {
    try {
      return new URL(u).hostname.toLowerCase();
    } catch {
      return '';
    }
  };
  const wordHit = (t: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
  for (const t of lists.blockTerms) if (wordHit(t)) return { result: 'block', reason: `it mentions “${t}”, which isn't allowed`, hits: [t] };
  for (const u of urls) {
    const h = hostOf(u);
    if (lists.blockDomains.some((d) => h === d || h.endsWith('.' + d))) return { result: 'block', reason: `links to ${h} aren't allowed`, hits: [h] };
    if (lists.shorteners.some((d) => h === d || h.endsWith('.' + d))) return { result: 'block', reason: 'short links hide where workers are sent', hits: [h] };
  }
  const hits = lists.watchTerms.filter((t) => wordHit(t));
  const stepUrls = [...j.jobSteps.map((s) => s.body).join('\n').matchAll(/https?:\/\//gi)].length;
  if (stepUrls > 3) hits.push('many_urls');
  return { result: hits.length ? 'flag' : 'ok', hits };
}

/** C-05 proof label: "Screenshot + link". */
const PROOF_SHORT: Record<string, string> = { screenshot: 'Screenshot', link: 'Link', text: 'Text answer', file: 'File upload' };
export function proofLabel(types: string[]): string {
  if (!types.length) return 'Proof not set yet';
  return types.map((t, i) => (i === 0 ? PROOF_SHORT[t] : PROOF_SHORT[t]!.toLowerCase())).join(' + ');
}
