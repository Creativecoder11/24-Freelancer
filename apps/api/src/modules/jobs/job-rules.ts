import { z } from 'zod';
import Decimal from 'decimal.js';
import type { Job, JobProofRequirement, JobStep } from '@24f/db';

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
}

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
    wizard_step: z.number().int().min(1).max(4).optional(),
    title: z.string().max(200).nullish(),
    category: z.string().max(40).nullish(),
    time_per_task: z.enum(TIME_PER_TASK_VALUES).optional(),
    open_for_days: z.number().int().optional(),
    eligibility: z.enum(['all_verified', 'kyc_verified']).optional(),
    min_approval_rate: z.number().int().optional(),
    steps: z.array(z.object({ position: z.number().int().optional(), body: z.string().max(1000) })).max(20).optional(),
    task_link_url: z.string().max(2048).nullish(),
    proof_requirements: z.array(proofReq).max(4).optional(),
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

export type JobFull = Job & { jobSteps: JobStep[]; jobProofRequirements: JobProofRequirement[]; category: { slug: string; name: string } | null };

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

export function validateStep(step: number, j: JobFull, lim: JobLimits): Errors {
  const e: Errors = {};
  if (step === 1) {
    if (len(j.title) < 10 || len(j.title) > 80) add(e, 'title', 'Use 10–80 characters for the title.');
    if (!j.categoryId) add(e, 'category', 'Choose a category.');
    if (!lim.openForDays.includes(j.openForDays)) add(e, 'open_for_days', 'Choose how long the job stays open.');
    if (!lim.minApprovalRates.includes(j.minApprovalRate)) add(e, 'min_approval_rate', 'Choose a minimum approval rate.');
  }
  if (step === 2) {
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
    if (len(j.proofInstructions) < 10 || len(j.proofInstructions) > 300) add(e, 'proof_instructions', 'Describe the proof in 10–300 characters.');
  }
  if (step === 3) {
    const r = j.rewardUsd ? new Decimal(j.rewardUsd.toString()) : null;
    if (!r || r.lt(lim.rewardMin) || r.gt(lim.rewardMax) || r.decimalPlaces() > 3)
      add(e, 'reward_usd', `Enter a reward between $${new Decimal(lim.rewardMin).toFixed(3)} and $${new Decimal(lim.rewardMax).toFixed(3)}.`);
    if (!j.slotsTotal || j.slotsTotal < lim.slotsMin || j.slotsTotal > lim.slotsMax)
      add(e, 'slots_total', `Enter between ${lim.slotsMin} and ${lim.slotsMax.toLocaleString('en-US')} slots.`);
    if (!lim.reviewWindows.includes(j.reviewWindowHours)) add(e, 'review_window_hours', 'Choose 24, 48 or 72 hours.');
    if (j.submissionsPerWorker !== 1) add(e, 'submissions_per_worker', 'Each worker can submit once.');
  }
  return e;
}

export function firstIncompleteStep(j: JobFull, lim: JobLimits): number | null {
  for (const s of [1, 2, 3]) if (Object.keys(validateStep(s, j, lim)).length) return s;
  return null;
}

/** Content screen (D-12, BR-092). Pure over title, steps, proof instructions and link. */
export function screenContent(
  j: JobFull,
  lists: { blockTerms: string[]; blockDomains: string[]; shorteners: string[]; watchTerms: string[] },
): { result: 'ok' | 'flag' | 'block'; reason?: string; hits: string[] } {
  const text = [j.title, ...j.jobSteps.map((s) => s.body), j.proofInstructions ?? ''].join('\n');
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
