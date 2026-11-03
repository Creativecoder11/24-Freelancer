/**
 * Response shapes (Doc 06). Field names are snake_case on the wire. Money fields are
 * decimal strings; timestamps are ISO-8601 UTC strings.
 */
import type {
  ActiveMode,
  CategorySlug,
  CloseBlocker,
  ContactTopic,
  JobAvailability,
  KycDocumentType,
  KycStatus,
  OtpChannel,
  OtpPurpose,
  PayoutMethodType,
  ProofType,
  UploadPurpose,
  UploadStatus,
  UserStatus,
} from './enums';

/** Success envelope (Doc 06 §1.6). */
export interface ApiEnvelope<T, M = Record<string, unknown>> {
  data: T;
  meta?: M;
  serverTime: string;
}

/** List metadata (Doc 06 §1.7). */
export interface ListMeta {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  has_more: boolean;
  counts?: Record<string, number>;
  facets?: Record<string, Record<string, number>>;
  applied_filters?: Record<string, unknown>;
  next_cursor?: string | null;
}

export interface CursorMeta {
  total: number;
  per_page: number;
  next_cursor: string | null;
  has_more: boolean;
  counts?: Record<string, number>;
}

// ----- Auth -----

export interface OtpChallengeResponse {
  challenge_id: string;
  purpose: OtpPurpose;
  channel?: OtpChannel;
  destination_masked: string;
  expires_at: string;
  resend_available_at: string;
}

export interface SessionUser {
  public_id: string;
  full_name: string;
  active_mode: ActiveMode;
  onboarding_step: number;
  next_path: string;
}

export interface AuthenticatedResponse {
  result: 'authenticated';
  access_token: string;
  expires_in: number;
  user: SessionUser;
}

export interface OtpRequiredResponse extends OtpChallengeResponse {
  result: 'otp_required';
}

export type LoginResponse = AuthenticatedResponse | OtpRequiredResponse;

export interface PasswordResetTokenResponse {
  reset_token: string;
  reset_token_expires_at: string;
  identifier_masked: string;
}

export interface OtpTokenResponse {
  otp_token: string;
  otp_token_expires_at: string;
}

export interface RefreshResponse {
  access_token: string;
  expires_in: number;
}

// ----- Me -----

export interface MeRestriction {
  kind: 'restricted' | 'suspended';
  public_message: string | null;
  ends_at: string | null;
  can_appeal: boolean;
}

export interface Me {
  public_id: string;
  full_name: string;
  name_masked: string;
  initials: string;
  avatar_url: string | null;
  email: string | null;
  email_verified_at: string | null;
  phone_masked: string | null;
  phone_verified_at: string | null;
  country_code: string;
  status: UserStatus;
  restriction: MeRestriction | null;
  active_mode: ActiveMode;
  default_mode: ActiveMode | null;
  email_digest_enabled: boolean;
  two_step_enabled: boolean;
  withdrawal_password_required: boolean;
  password_changed_at: string | null;
  kyc_status: KycStatus;
  kyc_verified_at: string | null;
  referral_code: string | null;
  referral_link: string | null;
  interests: CategorySlug[];
  interest_time: string | null;
  interest_device: string | null;
  onboarding_step: number;
  onboarding_completed_at: string | null;
  setup_card_dismissed_at: string | null;
  has_worker_profile: boolean;
  has_employer_profile: boolean;
  employer: { business_name: string; initials: string; employer_verified: boolean } | null;
  balances: { worker_available_usd: string; employer_deposit_total_usd: string };
  badges: { worker_tasks: number; employer_submissions: number; notifications_unread: number };
  greeting_part: 'morning' | 'afternoon' | 'evening';
  livechat_identity_hash: string | null;
  terms_reaccept_required: boolean;
}

export interface SessionRow {
  id: string;
  device_label: string;
  city: string | null;
  is_current: boolean;
  last_active_at: string;
}

export interface CloseBlockerRow {
  code: CloseBlocker;
  message: string;
  action_path: string;
}

export interface KycState {
  status: KycStatus;
  document_type: KycDocumentType | null;
  document_last4: string | null;
  submitted_at: string | null;
  review_due_at: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  can_submit: boolean;
}

// ----- Uploads -----

export interface PresignResponse {
  upload_id: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expires_at: string;
  status: UploadStatus;
}

export interface UploadRecord {
  upload_id: string;
  purpose?: UploadPurpose;
  status: UploadStatus;
  filename: string;
  size_bytes: number;
  mime_type?: string;
  width_px?: number | null;
  height_px?: number | null;
  thumbnail_url?: string | null;
  url?: string | null;
  rejection_reason: string | null;
}

// ----- Public -----

export interface CategoryRef {
  slug: CategorySlug;
  name: string;
}

export interface JobCard {
  public_id: string;
  title: string;
  category: CategoryRef | null;
  employer: { business_name: string; employer_verified: boolean };
  is_new: boolean;
  reward_usd: string;
  display_minutes: number;
  proof_types: ProofType[];
  proof_label: string;
  slots_total: number;
  slots_filled: number;
  slots_left: number;
  published_at: string | null;
  ends_at: string | null;
}

export interface JobDetailPublic {
  public_id: string;
  title: string;
  category: CategoryRef | null;
  is_new: boolean;
  availability: JobAvailability;
  reward_usd: string;
  display_minutes: number;
  display_minutes_is_average: boolean;
  proof_label: string;
  proof_types: ProofType[];
  slots_total: number;
  slots_left: number;
  slots_filled: number;
  published_at: string | null;
  ends_at: string | null;
  steps: { position: number; body: string }[];
  proof_requirements: { position: number; proof_type: ProofType; title: string; helper: string | null }[];
  rules: { allowed: string[]; not_allowed: string[] };
  terms: { review_window_hours: number; auto_approve: boolean; allow_resubmission: boolean; rejections_need_reason: boolean };
  employer: {
    business_name: string;
    initials: string;
    logo_url: string | null;
    employer_verified: boolean;
    since: string | null;
    approval_rate_pct: number | null;
    avg_review_hours: number | null;
    jobs_posted: number;
  };
}

export interface PublicCategory {
  slug: CategorySlug;
  name: string;
  open_jobs: number;
  avg_reward_usd: string | null;
}

export interface PublicConfig {
  referral: { enabled: boolean; task_rate: string; deposit_rate: string };
  features: {
    public_payout_history_enabled: boolean;
    live_chat_enabled: boolean;
    maintenance_mode: boolean;
    deposits_paused: boolean;
    withdrawals_paused: boolean;
  };
  banner_text: string | null;
  countries: { code: string; name: string }[];
  industries: string[];
  social: { facebook_page: string | null; facebook_group: string | null; youtube: string | null };
  company: { legal_name: string | null; registered_address: string | null };
  support: { hours_text: string | null; live_chat_provider: string | null };
  job_options: {
    open_for_days: number[];
    min_approval_rate: number[];
    review_window_hours: number[];
    reward_min_usd: string;
    reward_max_usd: string;
    reward_step_usd: string;
    slots_min: number;
    slots_max: number;
  };
  slot_hold_minutes: number;
  platform_fee_percent: string;
  deposit: { methods_enabled: string[]; presets_usd: string[]; min_usd: string; max_usd: string };
  legal_versions: { terms: string | null; privacy: string | null };
  otp: { length: number; ttl_minutes: number; resend_seconds: number };
}

export interface HelpTopic {
  slug: string;
  title: string;
  description: string;
  contact_topic: ContactTopic | null;
  article_count: number;
}

export interface HelpArticleRow {
  slug: string;
  topic_slug: string;
  title: string;
  summary: string | null;
  popular_label: string | null;
}

export interface HelpArticle {
  slug: string;
  topic: { slug: string; title: string };
  title: string;
  body_md: string;
  updated_at: string;
}

export interface Faq {
  id: string;
  question: string;
  answer_md: string;
  sort_order: number;
}

export interface LegalPage {
  slug: string;
  title: string;
  version: string;
  body_md: string;
  effective_at: string;
  versions: { version: string; effective_at: string }[];
}

export interface RecentPayout {
  name_masked: string;
  method: PayoutMethodType;
  method_label: string;
  amount_usd: string;
  paid_at_relative: string;
}
