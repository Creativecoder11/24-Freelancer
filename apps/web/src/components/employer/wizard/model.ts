import { zoneCountries } from '@24f/shared';
import type { JobDetail, ProofReq } from '../api';

export type ProofType = ProofReq['proof_type'];

export interface StepItem {
  id: string;
  body: string;
}

/** Client-side wizard state (one object across the five steps). */
export interface WizardForm {
  // 1 · Location
  target_zone: string;
  excluded_countries: string[];
  // 2 · Category
  category: string | null;
  subcategory: string | null;
  // 3 · Job information
  title: string;
  note: string;
  time_per_task: string;
  steps: StepItem[];
  task_link_url: string;
  proof_types: ProofType[];
  /** Screenshots each worker uploads when Screenshot is a proof type (1–5). */
  screenshot_count: number;
  proof_instructions: string;
  thumbnail_upload_id: string | null;
  /** Display only (existing image on the job). */
  thumbnail_url: string | null;
  // 4 · Budget & settings
  reward_usd: string;
  slots_total: number;
  open_for_days: number;
  eligibility: 'all_verified' | 'kyc_verified';
  min_approval_rate: number;
  review_window_hours: number;
  allow_resubmission: boolean;
  auto_approve: boolean;
  pause_on_low_deposit: boolean;
  boost_days: number;
  /** `<input type="datetime-local">` value, '' = start at publish. */
  starts_at: string;
}

export const PROOF_OPTIONS: { value: ProofType; label: string }[] = [
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'link', label: 'Link' },
  { value: 'text', label: 'Text answer' },
  { value: 'file', label: 'File upload' },
];

export const MAX_SCREENSHOTS = 5;
export const OPEN_FOR = [1, 3, 7, 14, 30];
export const APPROVAL_RATES = [
  { value: 0, label: 'Any' },
  { value: 60, label: '60% or higher' },
  { value: 70, label: '70% or higher' },
  { value: 80, label: '80% or higher' },
  { value: 90, label: '90% or higher' },
  { value: 95, label: '95% or higher' },
];
export const REVIEW_WINDOWS = [
  { value: 72, label: '72 hours (default)' },
  { value: 48, label: '48 hours' },
  { value: 24, label: '24 hours' },
];
export const SLOT_PRESETS = [20, 40, 100, 200];
export const STEP_LABELS = ['Location', 'Category', 'Job information', 'Budget & settings', 'Review & publish'];
export const STEP_COUNT = STEP_LABELS.length;
/** Last step with fields (the one before Review). */
export const LAST_FORM_STEP = STEP_COUNT - 1;

let seq = 0;
export const newStepId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

export interface JobDefaults {
  default_review_window_hours: number;
  default_min_approval_rate: number;
  default_auto_approve: boolean;
  default_allow_resubmission: boolean;
  default_pause_on_low_deposit: boolean;
}

/** Extra context for checks that depend on server data. */
export interface ValidateCtx {
  /** The chosen category has subcategories. */
  subcategoryRequired?: boolean;
  minSpendUsd?: number;
  scheduleMaxDays?: number;
}

export function emptyForm(d?: JobDefaults | null): WizardForm {
  return {
    target_zone: 'international',
    excluded_countries: [],
    category: null,
    subcategory: null,
    title: '',
    note: '',
    time_per_task: 'about_5',
    steps: [{ id: newStepId(), body: '' }],
    task_link_url: '',
    proof_types: ['screenshot'],
    screenshot_count: 1,
    proof_instructions: '',
    thumbnail_upload_id: null,
    thumbnail_url: null,
    reward_usd: '',
    slots_total: 40,
    open_for_days: 7,
    eligibility: 'all_verified',
    min_approval_rate: d?.default_min_approval_rate ?? 80,
    review_window_hours: d?.default_review_window_hours ?? 72,
    allow_resubmission: d?.default_allow_resubmission ?? true,
    auto_approve: d?.default_auto_approve ?? true,
    pause_on_low_deposit: d?.default_pause_on_low_deposit ?? true,
    boost_days: 0,
    starts_at: '',
  };
}

/** ISO → `YYYY-MM-DDTHH:mm` in the browser's time zone (for datetime-local). */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formFromJob(j: JobDetail): WizardForm {
  const reqTypes = j.proof_requirements.map((p) => p.proof_type);
  const shots = reqTypes.filter((t) => t === 'screenshot').length;
  return {
    target_zone: j.target_zone || 'international',
    excluded_countries: j.excluded_countries ?? [],
    category: j.category?.slug ?? null,
    subcategory: j.subcategory?.slug ?? null,
    title: j.title ?? '',
    note: j.note ?? '',
    time_per_task: j.time_per_task,
    steps: j.steps.length ? j.steps.map((s) => ({ id: newStepId(), body: s.body })) : [{ id: newStepId(), body: '' }],
    task_link_url: j.task_link_url ?? '',
    // A draft that hasn't reached Job information yet has no proof: keep the default (Screenshot).
    proof_types: j.proof_requirements.length || j.wizard_step >= 3 ? PROOF_OPTIONS.map((o) => o.value).filter((v) => reqTypes.includes(v)) : ['screenshot'],
    screenshot_count: Math.max(1, Math.min(MAX_SCREENSHOTS, shots || 1)),
    proof_instructions: j.proof_instructions ?? '',
    thumbnail_upload_id: j.thumbnail_upload_id,
    thumbnail_url: j.thumbnail_url,
    reward_usd: j.reward_usd ?? '',
    slots_total: j.slots_total ?? 40,
    open_for_days: j.open_for_days,
    eligibility: j.eligibility,
    min_approval_rate: j.min_approval_rate,
    review_window_hours: j.review_window_hours,
    allow_resubmission: j.allow_resubmission,
    auto_approve: j.auto_approve,
    pause_on_low_deposit: j.pause_on_low_deposit,
    boost_days: j.boost_days ?? 0,
    starts_at: isoToLocalInput(j.starts_at),
  };
}

/** Proof requirement rows: one per type, except N rows for N screenshots. */
export function proofRequirements(f: Pick<WizardForm, 'proof_types' | 'screenshot_count'>) {
  return f.proof_types.flatMap((t) => {
    const label = PROOF_OPTIONS.find((o) => o.value === t)!.label;
    if (t !== 'screenshot' || f.screenshot_count <= 1) return [{ proof_type: t, title: label, is_required: true }];
    return Array.from({ length: f.screenshot_count }, (_, i) => ({ proof_type: t, title: `Screenshot ${i + 1}`, is_required: true }));
  });
}

/** PATCH/POST body for one step (Doc 06 §5.8, five-step wizard). */
export function payloadFor(step: number, f: WizardForm): Record<string, unknown> {
  if (step === 1) return { target_zone: f.target_zone, excluded_countries: f.excluded_countries };
  if (step === 2) return { category: f.category, subcategory: f.subcategory };
  if (step === 3)
    return {
      title: f.title.trim(),
      note: f.note.trim() || null,
      time_per_task: f.time_per_task,
      steps: f.steps.filter((s) => s.body.trim()).map((s, i) => ({ position: i + 1, body: s.body.trim() })),
      task_link_url: f.task_link_url.trim() || null,
      proof_requirements: proofRequirements(f),
      proof_instructions: f.proof_instructions.trim() || null,
      thumbnail_upload_id: f.thumbnail_upload_id,
    };
  if (step === 4)
    return {
      reward_usd: f.reward_usd ? f.reward_usd : null,
      slots_total: f.slots_total,
      open_for_days: f.open_for_days,
      eligibility: f.eligibility,
      min_approval_rate: f.min_approval_rate,
      review_window_hours: f.review_window_hours,
      submissions_per_worker: 1,
      allow_resubmission: f.allow_resubmission,
      auto_approve: f.auto_approve,
      pause_on_low_deposit: f.pause_on_low_deposit,
      boost_days: f.boost_days,
      starts_at: f.starts_at ? new Date(f.starts_at).toISOString() : null,
    };
  return {};
}

/** Fields a published job can't change (boost is charged and the start fixed at publish). */
export function publishedPayload(step: number, f: WizardForm) {
  const p = payloadFor(step, f);
  if (step === 4) {
    delete p.boost_days;
    delete p.starts_at;
    delete p.open_for_days;
  }
  return p;
}

const len = (s: string) => [...s.trim()].length;

/** Client checks mirroring the server step rules (job-rules.ts) and the §11 copy keys. */
export function validate(step: number, f: WizardForm, ctx: ValidateCtx = {}): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 1) {
    const all = zoneCountries(f.target_zone);
    if (!all.length) e.target_zone = 'Choose where workers can be.';
    else if (f.excluded_countries.length >= all.length) e.excluded_countries = 'Keep at least one country open.';
  }
  if (step === 2) {
    if (!f.category) e.category = 'Choose a category.';
    else if (ctx.subcategoryRequired && !f.subcategory) e.subcategory = 'Choose a subcategory.';
  }
  if (step === 3) {
    if (len(f.title) < 10 || len(f.title) > 80) e.title = 'Use 10–80 characters for the title.';
    if (len(f.note) > 300) e.note = 'Keep the note under 300 characters.';
    const filled = f.steps.filter((s) => s.body.trim());
    if (!filled.length) e.steps = 'Add at least one step.';
    else if (filled.length > 10) e.steps = 'Add up to 10 steps.';
    else if (filled.some((s) => len(s.body) < 5 || len(s.body) > 300)) e.steps = 'Each step needs 5–300 characters.';
    if (f.task_link_url.trim() && !/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(f.task_link_url.trim())) e.task_link_url = 'Enter a full link starting with https://.';
    if (!f.proof_types.length) e.proof_requirements = 'Pick at least one proof type.';
    if (len(f.proof_instructions) < 10 || len(f.proof_instructions) > 300) e.proof_instructions = 'Describe the proof in 10–300 characters.';
  }
  if (step === 4) {
    const r = Number(f.reward_usd);
    if (!f.reward_usd || !Number.isFinite(r) || r < 0.01 || r > 10 || (f.reward_usd.split('.')[1]?.length ?? 0) > 3) e.reward_usd = 'Enter a reward from $0.010 to $10.000.';
    if (!Number.isInteger(f.slots_total) || f.slots_total < 1 || f.slots_total > 10000) e.slots_total = 'Enter between 1 and 10,000 slots.';
    else if (!e.reward_usd && ctx.minSpendUsd && r * f.slots_total < ctx.minSpendUsd - 1e-9)
      e.slots_total = `Minimum spend is $${ctx.minSpendUsd.toFixed(2)}. Add workers or raise the reward.`;
    if (f.starts_at) {
      const ms = new Date(f.starts_at).getTime() - Date.now();
      if (!Number.isFinite(ms) || ms < 5 * 60_000) e.starts_at = 'Pick a start time at least 5 minutes from now, or leave it empty to start at once.';
      else if (ctx.scheduleMaxDays && ms > ctx.scheduleMaxDays * 86_400_000) e.starts_at = `Schedule up to ${ctx.scheduleMaxDays} days ahead.`;
    }
  }
  return e;
}

/** Map server field keys (steps.0.body) onto form keys. */
export function serverFieldErrors(fields: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    const key = k.startsWith('steps') ? 'steps' : k;
    if (!out[key] && v[0]) out[key] = v[0];
  }
  return out;
}

/** "Screenshot + link" (C-05); "3 screenshots + link" when several are required. */
export function proofLabel(types: ProofType[], screenshots = 1): string {
  if (!types.length) return 'Proof not set yet';
  return types
    .map((t, i) => {
      const l = t === 'screenshot' && screenshots > 1 ? `${screenshots} screenshots` : PROOF_OPTIONS.find((o) => o.value === t)!.label;
      return i === 0 ? l.charAt(0).toUpperCase() + l.slice(1) : l.toLowerCase();
    })
    .join(' + ');
}
