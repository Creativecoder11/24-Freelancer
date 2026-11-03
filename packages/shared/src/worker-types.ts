/**
 * Worker app response shapes (Doc 06 §5.6, §5.7, §5.15). snake_case on the wire, money as
 * decimal strings (rewards 3 dp, balances 2 dp), timestamps ISO-8601 UTC.
 */
import type {

  DecisionSource,
  DisputeStatus,
  KycStatus,
  NotificationCategory,
  NotificationPrefKey,
  ProofType,
  RejectionReasonCode,
  ReservationStatus,
  SubmissionEventType,
  SubmissionStatus,
} from './enums';
import type { CategoryRef, JobCard, UploadRecord } from './types';

export type EligibilityState = 'eligible' | 'approval_rate' | 'kyc_required';
export type MyJobState = 'not_started' | 'in_progress' | 'done';

export interface WorkerJobCard extends JobCard {
  eligibility_state: EligibilityState;
  my_state: MyJobState;
}

export interface WaitingTask {
  ref: string;
  job_title: string;
  employer_name: string;
  reward_usd: string;
  status: SubmissionStatus;
  submitted_at: string;
  review_due_at: string | null;
}

export type ActivityKind = 'approved' | 'withdrawal_paid' | 'needs_fix' | 'rejected' | 'submitted' | 'referral' | 'resubmitted';

export interface ActivityItem {
  kind: ActivityKind;
  title: string;
  description: string;
  occurred_at: string;
  link_path: string | null;
}

export interface ActiveReservationRef {
  id: string;
  job_public_id: string;
  job_title: string;
  expires_at: string;
}

export interface WorkerOverview {
  greeting: string;
  subtitle_counts: { tasks_in_review: number; new_matching_jobs: number };
  stats: {
    available_usd: string;
    pending_review_usd: string;
    pending_review_tasks: number;
    show_usually_reviewed_24h: boolean;
    approved_this_month_usd: string;
    approved_this_month_tasks: number;
    approved_trend_percent: number | null;
  };
  quick_actions: { open_jobs: number; needs_fix: number; available_usd: string; referral_task_percent: number };
  recommended: { based_on: string[]; more_interests: number; jobs: WorkerJobCard[] };
  approval: { rate_percent: number | null; approved_30d: number; rejected_30d: number; decisions_needed: number };
  recent_activity: ActivityItem[];
  waiting_for_review: { total: number; items: WaitingTask[] };
  nudges: {
    setup_card_visible: boolean;
    setup: { account_created: boolean; interests_done: boolean; payout_method_done: boolean; starter_task_done: boolean };
    kyc_required_before_withdrawal: boolean;
    kyc_status: KycStatus;
    add_email_nudge: boolean;
    no_payout_method: boolean;
    active_reservation: ActiveReservationRef | null;
  };
  badges: { my_tasks: number; notifications_unread: number };
}

export type StartState =
  | 'can_start'
  | 'in_progress'
  | 'full'
  | 'paused'
  | 'closed'
  | 'already_done'
  | 'not_eligible'
  | 'restricted'
  | 'own_job'
  | 'verify_required';

export interface ReservationDraft {
  proof_items: { proof_requirement_id: string; link_url: string | null; text_value: string | null; upload_id: string | null }[];
  worker_note: string | null;
  attestation: boolean;
  rev?: number;
}

export interface WorkerReservation {
  id: string;
  job_public_id?: string;
  status: ReservationStatus;
  started_at: string;
  expires_at: string;
  steps_checked: number[];
  draft: ReservationDraft | null;
  draft_saved_at?: string | null;
  /** Upload records referenced by the draft, so another device can restore thumbnails (FR-SUB-003). */
  draft_uploads?: Record<string, UploadRecord>;
}

export interface WorkerProofRequirement {
  id: string;
  position: number;
  proof_type: ProofType;
  title: string;
  field_label: string | null;
  helper: string | null;
  is_required: boolean;
}

export interface EmployerTrust {
  business_name: string;
  initials: string;
  employer_verified: boolean;
  since: string | null;
  approval_rate_pct: number | null;
  avg_review_hours: number | null;
  jobs_posted: number;
}

export interface WorkerJobDetail {
  public_id: string;
  title: string;
  category: CategoryRef | null;
  is_new: boolean;
  job_status: 'running' | 'paused' | 'completed' | 'cancelled' | 'suspended';
  reward_usd: string;
  display_minutes: number;
  proof_label: string;
  proof_types: ProofType[];
  slots_total: number;
  slots_left: number;
  slots_filled: number;
  published_at: string | null;
  ends_at: string | null;
  start_state: StartState;
  ineligible: { reason: 'approval_rate' | 'kyc_required'; required_rate: number | null; your_rate: number | null } | null;
  reservation: WorkerReservation | null;
  /** The last ended reservation when there is no active one (G-08 "Slot expired"). */
  last_reservation: { status: ReservationStatus; ended_at: string | null } | null;
  task_link_url: string | null;
  steps: { position: number; body: string }[];
  proof_requirements: WorkerProofRequirement[];
  proof_instructions: string | null;
  rules: { allowed: string[]; not_allowed: string[] };
  terms: { review_window_hours: number; auto_approve: boolean; allow_resubmission: boolean; rejections_need_reason: boolean };
  employer: EmployerTrust;
  submission_ref: string | null;
  submission_status: SubmissionStatus | null;
  slot_hold_minutes: number;
}

export interface StartJobResponse {
  reservation: WorkerReservation;
  task_link_url: string | null;
  slots_left: number;
}

export interface ReleaseResponse {
  id: string;
  status: ReservationStatus;
  released_at: string;
  job_slots_left: number;
}

export interface ProgressResponse {
  id: string;
  steps_checked: number[];
  draft_saved_at: string | null;
  expires_at: string;
  rev: number | null;
}

export interface SubmitResponse {
  ref: string;
  status: SubmissionStatus;
  attempt_no: number;
  reward_usd: string;
  submitted_at: string;
  review_due_at: string;
  auto_approve: boolean;
  warnings: { field: string; message: string }[];
}

export interface WorkerTaskRow {
  ref: string;
  job_public_id: string;
  job_title: string;
  employer_name: string;
  reward_usd: string;
  status: SubmissionStatus;
  submitted_at: string;
  review_due_at: string | null;
  waiting_for_employer: boolean;
  rejection_reason_text: string | null;
  resubmit_deadline: string | null;
  fix_allowed: boolean | null;
  dispute_open: boolean;
}

export interface WorkerTaskSummary {
  pending_review_usd: string;
  pending_review_tasks: number;
  approved_this_month_usd: string;
  approved_this_month_tasks: number;
  approved_trend_percent: number | null;
  approval_rate_percent: number | null;
  approved_30d: number;
  rejected_30d: number;
  decisions_needed: number;
}

export interface ProofItemView {
  proof_type: ProofType;
  title: string;
  proof_requirement_id: string;
  link_url: string | null;
  text_value: string | null;
  file: { upload_id: string; filename: string; size_bytes: number; url: string | null; thumbnail_url: string | null } | null;
}

export interface WorkerDispute {
  ref: string;
  status: DisputeStatus;
  submission_ref: string;
  disputed_decision: SubmissionStatus;
  worker_statement: string;
  evidence: { upload_id: string; filename: string; size_bytes: number; url: string | null; thumbnail_url: string | null }[];
  opened_at: string;
  sla_due_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  can_withdraw: boolean;
}

export type TrackerStage = 'submitted' | 'in_review' | 'approved' | 'needs_fix' | 'rejected' | 'paid_to_balance';

export interface WorkerSubmissionDetail {
  ref: string;
  status: SubmissionStatus;
  decision_source: DecisionSource | null;
  job: {
    public_id: string;
    title: string;
    category: CategoryRef | null;
    review_window_hours: number;
    auto_approve: boolean;
    status: string;
    employer: EmployerTrust;
  };
  reward_usd: string;
  first_submitted_at: string;
  last_submitted_at: string;
  review_due_at: string | null;
  decided_at: string | null;
  paid_ledger_ref: string | null;
  rejection: {
    reason_code: RejectionReasonCode | null;
    reason_label: string | null;
    reason_text: string | null;
    fix_allowed: boolean;
    resubmit_deadline: string | null;
    decided_at: string | null;
  } | null;
  tracker: { stage: TrackerStage; state: 'done' | 'current' | 'pending' | 'failed'; at?: string | null; due_at?: string | null }[];
  attempts: {
    attempt_no: number;
    submitted_at: string;
    worker_note: string | null;
    change_note: string | null;
    decision: SubmissionStatus | null;
    decided_at: string | null;
    proof_items: ProofItemView[];
  }[];
  proof_requirements: WorkerProofRequirement[];
  activity: { event_type: SubmissionEventType; label: string; occurred_at: string }[];
  dispute: WorkerDispute | null;
  can_resubmit: boolean;
  resubmissions_left: number;
  can_dispute: boolean;
  dispute_deadline: string | null;
}

export interface ResubmitResponse {
  ref: string;
  status: SubmissionStatus;
  attempt_no: number;
  last_submitted_at: string;
  review_due_at: string;
}

export interface DisputeCreated {
  ref: string;
  status: DisputeStatus;
  submission_ref: string;
  opened_at: string;
  sla_due_at: string;
}

export interface JobReportCreated {
  id: string;
  status: string;
  created_at: string;
}

// ----- Notifications -----

export interface NotificationRow {
  id: string;
  category: NotificationCategory;
  type: string;
  title: string;
  body: string;
  link_path: string | null;
  is_mandatory: boolean;
  read_at: string | null;
  created_at: string;
}

export interface NotificationsMeta {
  total: number;
  per_page: number;
  next_cursor: string | null;
  has_more: boolean;
  counts: Record<'all' | NotificationCategory, number>;
  unread: number;
}

export interface UnreadCount {
  unread: number;
  by_audience: { worker: number; employer: number };
}

export interface NotificationPreferenceRow {
  pref_key: NotificationPrefKey;
  label: string;
  helper?: string | null;
  in_app_enabled: boolean;
  email_enabled: boolean;
  is_locked: boolean;
}

export interface NotificationPreferences {
  worker: NotificationPreferenceRow[];
  employer: NotificationPreferenceRow[];
}


