import type { JobDetail, ProofReq } from '../api';

export type ProofType = ProofReq['proof_type'];

export interface StepItem {
  id: string;
  body: string;
}

/** Client-side wizard state (one object across the four steps). */
export interface WizardForm {
  title: string;
  category: string | null;
  time_per_task: string;
  open_for_days: number;
  eligibility: 'all_verified' | 'kyc_verified';
  min_approval_rate: number;
  steps: StepItem[];
  task_link_url: string;
  proof_types: ProofType[];
  proof_instructions: string;
  reward_usd: string;
  slots_total: number;
  review_window_hours: number;
  allow_resubmission: boolean;
  auto_approve: boolean;
  pause_on_low_deposit: boolean;
}

export const PROOF_OPTIONS: { value: ProofType; label: string }[] = [
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'link', label: 'Link' },
  { value: 'text', label: 'Text answer' },
  { value: 'file', label: 'File upload' },
];

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
export const STEP_LABELS = ['Basics', 'Instructions & proof', 'Budget & slots', 'Review & publish'];

let seq = 0;
export const newStepId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

export interface JobDefaults {
  default_review_window_hours: number;
  default_min_approval_rate: number;
  default_auto_approve: boolean;
  default_allow_resubmission: boolean;
  default_pause_on_low_deposit: boolean;
}

export function emptyForm(d?: JobDefaults | null): WizardForm {
  return {
    title: '',
    category: null,
    time_per_task: 'about_5',
    open_for_days: 7,
    eligibility: 'all_verified',
    min_approval_rate: d?.default_min_approval_rate ?? 80,
    steps: [{ id: newStepId(), body: '' }],
    task_link_url: '',
    proof_types: ['screenshot'],
    proof_instructions: '',
    reward_usd: '',
    slots_total: 40,
    review_window_hours: d?.default_review_window_hours ?? 72,
    allow_resubmission: d?.default_allow_resubmission ?? true,
    auto_approve: d?.default_auto_approve ?? true,
    pause_on_low_deposit: d?.default_pause_on_low_deposit ?? true,
  };
}

export function formFromJob(j: JobDetail): WizardForm {
  return {
    title: j.title ?? '',
    category: j.category?.slug ?? null,
    time_per_task: j.time_per_task,
    open_for_days: j.open_for_days,
    eligibility: j.eligibility,
    min_approval_rate: j.min_approval_rate,
    steps: j.steps.length ? j.steps.map((s) => ({ id: newStepId(), body: s.body })) : [{ id: newStepId(), body: '' }],
    task_link_url: j.task_link_url ?? '',
    // A draft saved from step 1 has no proof yet: keep the wizard default (Screenshot).
    proof_types: j.proof_requirements.length || j.wizard_step >= 2 ? j.proof_requirements.map((p) => p.proof_type) : ['screenshot'],
    proof_instructions: j.proof_instructions ?? '',
    reward_usd: j.reward_usd ?? '',
    slots_total: j.slots_total ?? 40,
    review_window_hours: j.review_window_hours,
    allow_resubmission: j.allow_resubmission,
    auto_approve: j.auto_approve,
    pause_on_low_deposit: j.pause_on_low_deposit,
  };
}

/** PATCH/POST body for one step (Doc 06 §5.8). */
export function payloadFor(step: number, f: WizardForm): Record<string, unknown> {
  if (step === 1)
    return {
      title: f.title.trim(),
      category: f.category,
      time_per_task: f.time_per_task,
      open_for_days: f.open_for_days,
      eligibility: f.eligibility,
      min_approval_rate: f.min_approval_rate,
    };
  if (step === 2)
    return {
      steps: f.steps.filter((s) => s.body.trim()).map((s, i) => ({ position: i + 1, body: s.body.trim() })),
      task_link_url: f.task_link_url.trim() || null,
      proof_requirements: f.proof_types.map((t) => ({ proof_type: t, title: PROOF_OPTIONS.find((o) => o.value === t)!.label, is_required: true })),
      proof_instructions: f.proof_instructions.trim() || null,
    };
  if (step === 3)
    return {
      reward_usd: f.reward_usd ? f.reward_usd : null,
      slots_total: f.slots_total,
      review_window_hours: f.review_window_hours,
      submissions_per_worker: 1,
      allow_resubmission: f.allow_resubmission,
      auto_approve: f.auto_approve,
      pause_on_low_deposit: f.pause_on_low_deposit,
    };
  return {};
}

const len = (s: string) => [...s.trim()].length;

/** Client checks mirroring VR-071…VR-085 and the §11 copy keys. */
export function validate(step: number, f: WizardForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 1) {
    if (len(f.title) < 10 || len(f.title) > 80) e.title = 'Use 10–80 characters for the title.';
    if (!f.category) e.category = 'Choose a category.';
  }
  if (step === 2) {
    const filled = f.steps.filter((s) => s.body.trim());
    if (!filled.length) e.steps = 'Add at least one step.';
    else if (filled.length > 10) e.steps = 'Add up to 10 steps.';
    else if (filled.some((s) => len(s.body) < 5 || len(s.body) > 300)) e.steps = 'Each step needs 5–300 characters.';
    if (f.task_link_url.trim() && !/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(f.task_link_url.trim())) e.task_link_url = 'Enter a full link starting with https://.';
    if (!f.proof_types.length) e.proof_requirements = 'Pick at least one proof type.';
    if (len(f.proof_instructions) < 10 || len(f.proof_instructions) > 300) e.proof_instructions = 'Describe the proof in 10–300 characters.';
  }
  if (step === 3) {
    const r = Number(f.reward_usd);
    if (!f.reward_usd || !Number.isFinite(r) || r < 0.01 || r > 10 || (f.reward_usd.split('.')[1]?.length ?? 0) > 3) e.reward_usd = 'Enter a reward from $0.010 to $10.000.';
    if (!Number.isInteger(f.slots_total) || f.slots_total < 1 || f.slots_total > 10000) e.slots_total = 'Enter between 1 and 10,000 slots.';
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

/** "Screenshot + link" (C-05). */
export function proofLabel(types: ProofType[]): string {
  if (!types.length) return 'Proof not set yet';
  return types.map((t, i) => (i === 0 ? PROOF_OPTIONS.find((o) => o.value === t)!.label : PROOF_OPTIONS.find((o) => o.value === t)!.label.toLowerCase())).join(' + ');
}
