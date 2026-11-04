'use client';
/**
 * Employer API (Doc 06 §5.8–§5.13): response types and TanStack Query hooks.
 * Shapes mirror apps/api/src/modules/{employer,jobs,review,deposits,employer-wallet}.
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, apiFetch, ApiError } from '@/lib/api/client';

export type JobStatus = 'draft' | 'running' | 'paused' | 'completed' | 'cancelled' | 'suspended';
export type JobAction = 'continue' | 'duplicate' | 'delete' | 'review' | 'edit' | 'add_slots' | 'pause' | 'resume' | 'close' | 'view';
export type ReasonCode = 'proof_incomplete' | 'steps_not_followed' | 'wrong_or_copied' | 'link_not_accessible' | 'other';

export interface Overview {
  greeting: string;
  business_name: string;
  subtitle_counts: { waiting: number; running_jobs: number };
  stats: {
    deposit_balance_usd: string;
    reserved_usd: string;
    available_usd: string;
    waiting_for_review: number;
    waiting_jobs: number;
    oldest_waiting_submitted_at: string | null;
    spent_this_month_usd: string;
    spent_trend_percent: number | null;
    approved_this_month_tasks: number;
  };
  alerts: {
    decision_needed: { visible: boolean; count: number };
    low_deposit: { visible: boolean; available_usd: string; approvals_covered: number | null; paused_jobs: number };
  };
  quick_actions: { review_waiting: number; deposit_balance_usd: string };
  running_jobs: RunningJob[];
  latest_submissions: { ref: string; worker_name_masked: string; worker_initials: string; submitted_at: string; job_title: string; job_public_id: string; unit_cost_usd: string }[];
  badges: { submissions: number; notifications_unread: number };
}

export interface RunningJob {
  public_id: string;
  status: JobStatus;
  pause_reason: string | null;
  paused_at: string | null;
  title: string;
  to_review: number;
  approved: number;
  slots_total: number;
  slots_left: number;
  spent_usd: string;
  budget_total_usd: string;
  ends_at: string | null;
}

export interface Spending {
  range: '7d' | '30d' | '90d';
  total_usd: string;
  total_tasks: number;
  y_max_usd: string;
  y_ticks_usd: string[];
  bars: { label: string; date: string; amount_usd: string; tasks: number }[];
}

export interface JobListRow {
  public_id: string;
  title: string | null;
  category: { slug: string; name: string } | null;
  status: JobStatus;
  pause_reason: string | null;
  close_reason: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  paused_at: string | null;
  closed_at: string | null;
  ends_at: string | null;
  wizard_step: number;
  approved: number;
  slots_total: number;
  slots_left: number;
  to_review: number;
  spent_usd: string;
  budget_total_usd: string;
  reward_usd: string | null;
  allowed_actions: JobAction[];
}
export interface JobListMeta {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  has_more: boolean;
  tab: string;
  counts: { running: number; paused: number; completed: number; drafts: number };
}

export interface ProofReq {
  id?: string;
  position?: number;
  proof_type: 'screenshot' | 'link' | 'text' | 'file';
  title: string;
  field_label?: string | null;
  helper?: string | null;
  is_required?: boolean;
}

export interface JobDetail {
  public_id: string;
  status: JobStatus;
  pause_reason: string | null;
  close_reason: string | null;
  wizard_step: number;
  first_incomplete_step: number | null;
  version: number;
  title: string | null;
  category: { slug: string; name: string } | null;
  time_per_task: string;
  open_for_days: number;
  eligibility: 'all_verified' | 'kyc_verified';
  min_approval_rate: number;
  steps: { position: number; body: string }[];
  task_link_url: string | null;
  proof_requirements: ProofReq[];
  proof_instructions: string | null;
  reward_usd: string | null;
  slots_total: number | null;
  review_window_hours: number;
  submissions_per_worker: number;
  allow_resubmission: boolean;
  auto_approve: boolean;
  pause_on_low_deposit: boolean;
  platform_fee_percent: string;
  published_at: string | null;
  ends_at: string | null;
  created_at: string;
  has_submissions: boolean;
  locked_fields: string[];
  counts: { approved: number; to_review: number; needs_fix: number; rejected: number; active_reservations: number };
  preview: { is_new: boolean; display_minutes: number; proof_label: string; slots_left: number };
  allowed_actions: JobAction[];
}

export interface Quote {
  reward_usd: string;
  slots_total: number;
  fee_per_task_usd: string;
  platform_fee_percent: string;
  unit_cost_usd: string;
  max_spend_usd: string;
  platform_fee_total_usd: string;
  total_reserved_usd: string;
  total_reserved_exact_usd: string;
  available_usd: string;
  available_after_usd: string;
  deposit_balance_usd: string;
  shortfall_usd: string;
  can_publish: boolean;
  blockers: string[];
  first_incomplete_step: number | null;
}

export interface Performance {
  job: {
    public_id: string;
    title: string;
    status: JobStatus;
    pause_reason: string | null;
    close_reason: string | null;
    published_at: string | null;
    paused_at: string | null;
    ends_at: string | null;
    reward_usd: string;
    slots_total: number;
    slots_left: number;
    allowed_actions: JobAction[];
  };
  kpis: { to_review: number; approved: number; rejected: number; spent_usd: string; budget_left_usd: string; budget_total_usd: string; avg_review_hours: number | null };
  chart: { days: { date: string; label: string; approved: number; rejected: number; waiting: number }[]; y_max: number };
  funnel: { opened: number; started: number; submitted: number; approved: number; opened_to_submitted_percent: string | null };
  rejection_reasons: { code: ReasonCode; label: string; count: number }[];
  settings: { reward_usd: string; slots_total: number; review_window_hours: number; auto_approve: boolean; allow_resubmission: boolean; pause_on_low_deposit: boolean; open_for_days: number };
  review_cta: { visible: boolean; waiting: number; oldest_submitted_at: string | null; auto_approve_at: string | null };
}

export interface SubRow {
  ref: string;
  job_public_id: string;
  job_title: string;
  worker_name_masked: string;
  worker_initials: string;
  status: 'in_review' | 'approved' | 'needs_fix' | 'rejected';
  sub_label: string | null;
  submitted_at: string;
  decided_at: string | null;
  review_due_at: string;
  preview: string | null;
  proof_label: string;
  duplicate_suspected: boolean;
  attempt_no: number;
  dispute_open: boolean;
  unit_cost_usd: string;
  decision_source: 'employer' | 'auto' | 'admin' | null;
}
export interface SubListMeta {
  total: number;
  per_page: number;
  next_cursor: string | null;
  has_more: boolean;
  tab: string;
  counts: { to_review: number; approved: number; rejected: number };
  header: { job_public_id: string | null; job_title: string | null; waiting: number; jobs_waiting: number; auto_approve_at: string | null };
  job_options: { public_id: string; title: string; waiting: number; status: JobStatus }[];
}
export interface ProofItem {
  proof_type: 'screenshot' | 'link' | 'text' | 'file';
  title: string;
  link_url: string | null;
  text_value: string | null;
  link_check_status: string | null;
  file: { id: string; url: string | null; thumbnail_url: string | null; filename: string; size_bytes: number; mime_type: string; purged: boolean } | null;
}
export interface SubDetail {
  ref: string;
  status: SubRow['status'];
  job: { public_id: string; title: string; allow_resubmission: boolean; auto_approve: boolean; status: JobStatus; proof_label: string };
  worker: { name_masked: string; initials: string; approval_rate_pct: number | null; tasks_done: number };
  submitted_at: string;
  first_submitted_at: string;
  review_due_at: string;
  pager: { position: number | null; of: number; prev_ref: string | null; next_ref: string | null };
  unit_cost_usd: string;
  attempt: { attempt_no: number; worker_note: string | null; change_note: string | null; submitted_at: string; proof_items: ProofItem[] } | null;
  previous_attempts: { attempt_no: number; worker_note: string | null; submitted_at: string; decision: string | null; reason_label: string | null; reason_text: string | null; proof_items: ProofItem[] }[];
  auto_check: { state: string; summary: string; items: { check: string; result: string }[] } | null;
  duplicate_suspected: boolean;
  can_allow_fix: boolean;
  fix_default: boolean;
  decision: { decided_at: string; decision_source: string | null; reason_code: string | null; reason_label: string | null; reason_text: string | null; fix_allowed: boolean | null; resubmit_deadline: string | null } | null;
  dispute: { ref: string; status: string; opened_at: string | null } | null;
}

export interface WalletSummary {
  deposit_balance_usd: string;
  reserved_usd: string;
  available_usd: string;
  available_state: 'ready' | 'add_funds';
  spent_this_month_usd: string;
  spent_trend_percent: number | null;
  approved_this_month_tasks: number;
  account_status: string;
  add_funds: {
    methods: { method: 'crypto' | 'mobile_wallet' | 'card'; label: string; sublabel: string; sub_providers: string[]; charge_currency: string; deposit_fx_rate: string | null; available?: boolean }[];
    default_method: string;
    presets_usd: string[];
    default_amount_usd: string;
    min_usd: string;
    max_usd: string;
    remaining_daily_usd: string;
    card_max_usd: string;
    deposits_paused: boolean;
  };
}

export interface TxRow {
  ref: string;
  occurred_at: string;
  type: string;
  type_label: string;
  description: string;
  amount_usd: string;
  amount_label: string;
  amount_style: 'credit' | 'debit' | 'neutral';
  balance_usd: string;
  job_public_id: string | null;
  grouped_count: number;
  grouped_refs: string[];
}
export interface TxMeta {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  has_more: boolean;
  summary: { deposited_this_month_usd: string; spent_on_approvals_usd: string; returned_to_deposit_usd: string };
  types_present: string[];
}

export interface DepositDetail {
  ref: string;
  status: 'initiated' | 'pending' | 'completed' | 'failed' | 'cancelled' | 'expired' | 'refunded';
  method: string;
  method_label: string;
  amount_usd: string;
  amount_received_usd: string | null;
  credited_amount_usd: string | null;
  charge_amount_bdt: string | null;
  message_key: string;
  failure_reason: string | null;
  return_to: string | null;
  balance: { deposit_balance_usd: string; available_usd: string };
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
  checkout_url: string | null;
  retry_url: string | null;
}

export interface Notification {
  id: string;
  category: 'tasks' | 'payments' | 'referrals' | 'system';
  type: string;
  title: string;
  body: string;
  link_path: string | null;
  is_mandatory: boolean;
  read_at: string | null;
  created_at: string;
}

// ------------------------------------------------------------------ keys

export const ek = {
  overview: ['employer', 'overview'] as const,
  spending: (r: string) => ['employer', 'spending', r] as const,
  jobs: (tab: string, q: string, page: number) => ['employer', 'jobs', tab, q, page] as const,
  job: (id: string) => ['employer', 'job', id] as const,
  perf: (id: string) => ['employer', 'perf', id] as const,
  subs: (job: string, tab: string) => ['employer', 'subs', job, tab] as const,
  sub: (ref: string) => ['employer', 'sub', ref] as const,
  wallet: ['employer', 'wallet'] as const,
  txns: (k: string) => ['employer', 'txns', k] as const,
  deposit: (ref: string) => ['employer', 'deposit', ref] as const,
  categories: ['employer', 'categories'] as const,
  notifications: (tab: string) => ['employer', 'notifications', tab] as const,
};

/** After any money-moving action: refresh everything that shows balances or counts. */
export function invalidateEmployer(qc: QueryClient) {
  return Promise.all([qc.invalidateQueries({ queryKey: ['employer'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
}

export function useOverview() {
  return useQuery({ queryKey: ek.overview, queryFn: () => api.get<Overview>('/employer/overview') });
}
export function useSpending(range: '7d' | '30d' | '90d') {
  return useQuery({ queryKey: ek.spending(range), queryFn: () => api.get<Spending>('/employer/overview/spending', { query: { range } }), placeholderData: (p) => p });
}
export function useWallet() {
  return useQuery({ queryKey: ek.wallet, queryFn: () => api.get<WalletSummary>('/employer/wallet') });
}
export function useCategories() {
  return useQuery({ queryKey: ek.categories, queryFn: () => api.get<{ slug: string; name: string }[]>('/employer/job-categories'), staleTime: 3_600_000 });
}
export function useJob(id: string | null) {
  return useQuery({ queryKey: ek.job(id ?? ''), queryFn: () => api.get<JobDetail>(`/employer/jobs/${id}`), enabled: !!id });
}
export function useJobs(tab: string, q: string, page: number) {
  return useQuery({
    queryKey: ek.jobs(tab, q, page),
    queryFn: () => apiFetch<JobListRow[], JobListMeta>('/employer/jobs', { query: { tab, q, page, per_page: 10 } }),
    placeholderData: (p) => p,
  });
}
export function usePerformance(id: string) {
  return useQuery({ queryKey: ek.perf(id), queryFn: () => api.get<Performance>(`/employer/jobs/${id}/performance`) });
}

export { useQueryClient, ApiError, api, apiFetch };

/** Idempotency key for money-moving calls (Doc 06 §1.10). */
export function idemKey() {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** First message for a failed call (field error or envelope message). */
export function errorText(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (e instanceof ApiError) {
    const f = Object.values(e.fields)[0]?.[0];
    return f ?? e.message ?? fallback;
  }
  return fallback;
}
