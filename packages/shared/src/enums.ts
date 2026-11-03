/**
 * Canonical enums (00a Canonical Reference §7, §16.5; Doc 05 §2).
 *
 * Code values are the snake_case values stored in the database and sent on the wire.
 * UI labels are the exact Figma copy. Badge tones follow the Design System badge rule.
 * Components map code → label/tone through these tables and never hard-code labels.
 */

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface EnumMeta<T extends string> {
  readonly values: readonly T[];
  readonly labels: Readonly<Record<T, string>>;
  readonly tones?: Readonly<Record<T, BadgeTone>>;
}

function defineEnum<const T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
  tones?: Record<T, BadgeTone>,
): EnumMeta<T> {
  return Object.freeze({ values, labels: Object.freeze(labels), tones: tones ? Object.freeze(tones) : undefined });
}

/** Type guard: is `v` one of the enum's code values? */
export function isEnumValue<T extends string>(meta: EnumMeta<T>, v: unknown): v is T {
  return typeof v === 'string' && (meta.values as readonly string[]).includes(v);
}

/** Label for a code value, falling back to the raw code for values added later (clients tolerate new values). */
export function enumLabel<T extends string>(meta: EnumMeta<T>, v: T | string | null | undefined): string {
  if (v == null) return '—';
  return (meta.labels as Record<string, string>)[v] ?? String(v);
}

/** Badge tone for a code value; neutral when unknown or when the enum has no tones. */
export function enumTone<T extends string>(meta: EnumMeta<T>, v: T | string | null | undefined): BadgeTone {
  if (v == null || !meta.tones) return 'neutral';
  return (meta.tones as Record<string, BadgeTone>)[v] ?? 'neutral';
}

// ---------------------------------------------------------------------------
// §3 / §6 Modes, roles, actors, account status
// ---------------------------------------------------------------------------

export const ACTIVE_MODE = defineEnum(['worker', 'employer'] as const, { worker: 'Worker', employer: 'Employer' });
export type ActiveMode = (typeof ACTIVE_MODE.values)[number];

export const ACTOR_TYPE = defineEnum(['user', 'admin', 'system'] as const, { user: 'User', admin: 'Admin', system: 'System' });
export type ActorType = (typeof ACTOR_TYPE.values)[number];

export const ADMIN_ROLE = defineEnum(
  ['super_admin', 'ops_admin', 'finance_admin', 'moderator', 'support_agent', 'analyst'] as const,
  {
    super_admin: 'Super admin',
    ops_admin: 'Operations admin',
    finance_admin: 'Finance admin',
    moderator: 'Moderator',
    support_agent: 'Support agent',
    analyst: 'Analyst',
  },
);
export type AdminRole = (typeof ADMIN_ROLE.values)[number];

export const USER_STATUS = defineEnum(
  ['active', 'restricted', 'suspended', 'closed'] as const,
  { active: 'Active', restricted: 'Restricted', suspended: 'Suspended', closed: 'Closed' },
  { active: 'success', restricted: 'warning', suspended: 'danger', closed: 'neutral' },
);
export type UserStatus = (typeof USER_STATUS.values)[number];

export const RESTRICTION_KIND = defineEnum(['restricted', 'suspended'] as const, { restricted: 'Restricted', suspended: 'Suspended' });
export type RestrictionKind = (typeof RESTRICTION_KIND.values)[number];

export const APPEAL_STATUS = defineEnum(
  ['open', 'under_review', 'upheld', 'denied'] as const,
  { open: 'Open', under_review: 'Under review', upheld: 'Upheld', denied: 'Denied' },
  { open: 'warning', under_review: 'info', upheld: 'success', denied: 'danger' },
);
export type AppealStatus = (typeof APPEAL_STATUS.values)[number];

// ---------------------------------------------------------------------------
// §7.1 Jobs
// ---------------------------------------------------------------------------

export const JOB_STATUS = defineEnum(
  ['draft', 'running', 'paused', 'completed', 'cancelled', 'suspended'] as const,
  {
    draft: 'Draft',
    running: 'Running',
    paused: 'Paused',
    completed: 'Completed',
    cancelled: 'Cancelled',
    suspended: 'Suspended by admin',
  },
  { draft: 'neutral', running: 'success', paused: 'warning', completed: 'neutral', cancelled: 'neutral', suspended: 'danger' },
);
export type JobStatus = (typeof JOB_STATUS.values)[number];

export const PAUSE_REASON = defineEnum(['employer', 'low_deposit', 'admin'] as const, {
  employer: 'Paused by you',
  low_deposit: 'Paused · low deposit',
  admin: 'Paused by 24 Freelancing',
});
export type PauseReason = (typeof PAUSE_REASON.values)[number];

export const CLOSE_REASON = defineEnum(['slots_filled', 'expired', 'employer_closed', 'admin_closed'] as const, {
  slots_filled: 'All slots filled',
  expired: 'Ended',
  employer_closed: 'Closed by you',
  admin_closed: 'Closed by 24 Freelancing',
});
export type CloseReason = (typeof CLOSE_REASON.values)[number];

/** Public job availability (Doc 06 §5.5 job detail). */
export const JOB_AVAILABILITY = defineEnum(
  ['open', 'paused', 'full', 'closed'] as const,
  { open: 'Open', paused: 'Paused', full: 'All slots are taken', closed: 'Closed' },
  { open: 'success', paused: 'warning', full: 'neutral', closed: 'neutral' },
);
export type JobAvailability = (typeof JOB_AVAILABILITY.values)[number];

// ---------------------------------------------------------------------------
// §7.2 Reservations
// ---------------------------------------------------------------------------

export const RESERVATION_STATUS = defineEnum(
  ['active', 'submitted', 'released', 'expired', 'cancelled'] as const,
  { active: 'In progress', submitted: 'Submitted', released: 'Released', expired: 'Expired', cancelled: 'Cancelled' },
  { active: 'brand', submitted: 'info', released: 'neutral', expired: 'neutral', cancelled: 'neutral' },
);
export type ReservationStatus = (typeof RESERVATION_STATUS.values)[number];

// ---------------------------------------------------------------------------
// §7.3 Submissions
// ---------------------------------------------------------------------------

export const SUBMISSION_STATUS = defineEnum(
  ['in_review', 'approved', 'needs_fix', 'rejected'] as const,
  { in_review: 'In review', approved: 'Approved', needs_fix: 'Needs fix', rejected: 'Rejected' },
  { in_review: 'warning', approved: 'success', needs_fix: 'danger', rejected: 'danger' },
);
export type SubmissionStatus = (typeof SUBMISSION_STATUS.values)[number];

/** Employer review tabs (A-08): the Rejected tab holds needs_fix and rejected. */
export const SUBMISSION_EMPLOYER_LABEL: Readonly<Record<SubmissionStatus, string>> = Object.freeze({
  in_review: 'To review',
  approved: 'Approved',
  needs_fix: 'Fix requested',
  rejected: 'Final',
});

export const DECISION_SOURCE = defineEnum(['employer', 'auto', 'admin'] as const, {
  employer: 'Employer',
  auto: 'Auto-approved',
  admin: '24 Freelancing',
});
export type DecisionSource = (typeof DECISION_SOURCE.values)[number];

export const SUBMISSION_EVENT_TYPE = defineEnum(
  [
    'job_opened', 'slot_reserved', 'steps_updated', 'draft_saved', 'slot_released', 'slot_expired',
    'reservation_cancelled', 'submitted', 'resubmitted', 'approved', 'auto_approved', 'needs_fix', 'rejected',
    'fix_window_expired', 'dispute_opened', 'dispute_resolved', 'escalated', 'paid_to_balance',
  ] as const,
  {
    job_opened: 'Opened the job',
    slot_reserved: 'Started job · slot reserved',
    steps_updated: 'Steps updated',
    draft_saved: 'Draft saved',
    slot_released: 'Slot released',
    slot_expired: 'Slot expired',
    reservation_cancelled: 'Reservation cancelled',
    submitted: 'Submitted',
    resubmitted: 'Resubmitted',
    approved: 'Approved',
    auto_approved: 'Auto-approved',
    needs_fix: 'Needs fix',
    rejected: 'Rejected',
    fix_window_expired: 'Fix window ended',
    dispute_opened: 'Dispute opened',
    dispute_resolved: 'Dispute resolved',
    escalated: 'Escalated',
    paid_to_balance: 'Paid to balance',
  },
);
export type SubmissionEventType = (typeof SUBMISSION_EVENT_TYPE.values)[number];

export const REJECTION_REASON_CODE = defineEnum(
  ['proof_incomplete', 'steps_not_followed', 'wrong_or_copied', 'link_not_accessible', 'other'] as const,
  {
    proof_incomplete: 'Proof incomplete',
    steps_not_followed: 'Steps not followed',
    wrong_or_copied: 'Wrong or copied answer',
    link_not_accessible: 'Link not accessible',
    other: 'Other',
  },
);
export type RejectionReasonCode = (typeof REJECTION_REASON_CODE.values)[number];

// ---------------------------------------------------------------------------
// §7.4 Disputes
// ---------------------------------------------------------------------------

export const DISPUTE_STATUS = defineEnum(
  ['open', 'under_review', 'resolved_worker', 'resolved_employer', 'withdrawn'] as const,
  {
    open: 'Open',
    under_review: 'Under review',
    resolved_worker: 'Decision overturned',
    resolved_employer: 'Decision upheld',
    withdrawn: 'Withdrawn',
  },
  { open: 'warning', under_review: 'info', resolved_worker: 'success', resolved_employer: 'danger', withdrawn: 'neutral' },
);
export type DisputeStatus = (typeof DISPUTE_STATUS.values)[number];

// ---------------------------------------------------------------------------
// §7.5–§7.8 Money
// ---------------------------------------------------------------------------

export const WITHDRAWAL_STATUS = defineEnum(
  ['requested', 'processing', 'paid', 'rejected', 'cancelled', 'failed'] as const,
  { requested: 'Requested', processing: 'Processing', paid: 'Paid', rejected: 'Rejected', cancelled: 'Cancelled', failed: 'Failed' },
  { requested: 'warning', processing: 'info', paid: 'success', rejected: 'danger', cancelled: 'neutral', failed: 'danger' },
);
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUS.values)[number];

export const DEPOSIT_STATUS = defineEnum(
  ['initiated', 'pending', 'completed', 'failed', 'cancelled', 'expired', 'refunded'] as const,
  {
    initiated: 'Initiated',
    pending: 'Pending',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    expired: 'Expired',
    refunded: 'Refunded',
  },
  { initiated: 'neutral', pending: 'warning', completed: 'success', failed: 'danger', cancelled: 'neutral', expired: 'neutral', refunded: 'info' },
);
export type DepositStatus = (typeof DEPOSIT_STATUS.values)[number];

/** Worker wallet "Recent transactions" display status (§7.7). */
export const WORKER_LEDGER_DISPLAY_STATUS = defineEnum(
  ['added', 'processing', 'paid', 'refunded'] as const,
  { added: 'Added', processing: 'Processing', paid: 'Paid', refunded: 'Refunded' },
  { added: 'success', processing: 'info', paid: 'success', refunded: 'neutral' },
);
export type WorkerLedgerDisplayStatus = (typeof WORKER_LEDGER_DISPLAY_STATUS.values)[number];

export const LEDGER_TX_TYPE = defineEnum(
  [
    'deposit', 'job_reserve', 'job_spend', 'job_release', 'task_reward', 'referral_commission',
    'withdrawal', 'withdrawal_reversal', 'platform_fee', 'deposit_refund', 'adjustment',
  ] as const,
  {
    deposit: 'Deposit',
    job_reserve: 'Reserve',
    job_spend: 'Job spend',
    job_release: 'Refund',
    task_reward: 'Task reward',
    referral_commission: 'Referral',
    withdrawal: 'Withdrawal',
    withdrawal_reversal: 'Refunded',
    platform_fee: 'Platform fee',
    deposit_refund: 'Deposit refund',
    adjustment: 'Adjustment',
  },
);
export type LedgerTxType = (typeof LEDGER_TX_TYPE.values)[number];

export const WALLET_ACCOUNT_KIND = defineEnum(
  [
    'worker_earnings', 'employer_available', 'employer_reserved', 'payout_clearing', 'gateway_clearing',
    'platform_revenue', 'referral_expense', 'adjustments', 'treasury', 'gateway_fees',
  ] as const,
  {
    worker_earnings: 'Available to withdraw',
    employer_available: 'Available for new jobs',
    employer_reserved: 'Reserved for running jobs',
    payout_clearing: 'Payout clearing',
    gateway_clearing: 'Gateway clearing',
    platform_revenue: 'Platform revenue',
    referral_expense: 'Referral expense',
    adjustments: 'Adjustments',
    treasury: 'Treasury',
    gateway_fees: 'Gateway fees',
  },
);
export type WalletAccountKind = (typeof WALLET_ACCOUNT_KIND.values)[number];
export const USER_WALLET_KINDS = ['worker_earnings', 'employer_available', 'employer_reserved'] as const satisfies readonly WalletAccountKind[];
export type UserWalletKind = (typeof USER_WALLET_KINDS)[number];

export const ADJUSTMENT_REASON = defineEnum(
  ['correction', 'goodwill', 'fx_difference', 'referral_reversal', 'write_off', 'provider_settlement', 'other'] as const,
  {
    correction: 'Correction',
    goodwill: 'Goodwill',
    fx_difference: 'FX difference',
    referral_reversal: 'Referral reversal',
    write_off: 'Write-off',
    provider_settlement: 'Provider settlement',
    other: 'Other',
  },
);
export type AdjustmentReason = (typeof ADJUSTMENT_REASON.values)[number];

export const PAYOUT_METHOD_TYPE = defineEnum(['bkash', 'nagad', 'rocket', 'usdt_trc20'] as const, {
  bkash: 'bKash',
  nagad: 'Nagad',
  rocket: 'Rocket',
  usdt_trc20: 'USDT TRC20',
});
export type PayoutMethodType = (typeof PAYOUT_METHOD_TYPE.values)[number];

export const PAYOUT_METHOD_STATUS = defineEnum(
  ['active', 'pending_review', 'disabled'] as const,
  { active: 'Active', pending_review: 'Pending review', disabled: 'Disabled' },
  { active: 'success', pending_review: 'warning', disabled: 'neutral' },
);
export type PayoutMethodStatus = (typeof PAYOUT_METHOD_STATUS.values)[number];

export const DEPOSIT_METHOD = defineEnum(['crypto', 'mobile_wallet', 'card'] as const, {
  crypto: 'Crypto',
  mobile_wallet: 'Mobile wallet',
  card: 'Card',
});
export type DepositMethod = (typeof DEPOSIT_METHOD.values)[number];

// ---------------------------------------------------------------------------
// §7.9 KYC and employer verification
// ---------------------------------------------------------------------------

export const KYC_STATUS = defineEnum(
  ['not_submitted', 'pending', 'verified', 'rejected'] as const,
  { not_submitted: 'Not verified', pending: 'In review', verified: 'Identity verified', rejected: 'Rejected' },
  { not_submitted: 'neutral', pending: 'warning', verified: 'success', rejected: 'danger' },
);
export type KycStatus = (typeof KYC_STATUS.values)[number];

export const KYC_DOCUMENT_TYPE = defineEnum(['national_id', 'passport', 'driving_licence'] as const, {
  national_id: 'National ID',
  passport: 'Passport',
  driving_licence: 'Driving licence',
});
export type KycDocumentType = (typeof KYC_DOCUMENT_TYPE.values)[number];

export const KYC_REJECTION_REASON = defineEnum(
  ['document_unreadable', 'name_mismatch', 'document_expired', 'selfie_mismatch', 'other'] as const,
  {
    document_unreadable: 'Document unreadable',
    name_mismatch: 'Name does not match',
    document_expired: 'Document expired',
    selfie_mismatch: 'Selfie does not match',
    other: 'Other',
  },
);
export type KycRejectionReason = (typeof KYC_REJECTION_REASON.values)[number];

export const EMPLOYER_VERIFICATION_STATUS = defineEnum(
  ['not_submitted', 'pending', 'verified', 'rejected'] as const,
  { not_submitted: 'Not submitted', pending: 'In review', verified: 'Verified employer', rejected: 'Rejected' },
  { not_submitted: 'neutral', pending: 'warning', verified: 'success', rejected: 'danger' },
);
export type EmployerVerificationStatus = (typeof EMPLOYER_VERIFICATION_STATUS.values)[number];

// ---------------------------------------------------------------------------
// §7.10 Referral
// ---------------------------------------------------------------------------

export const REFERRAL_STATUS = defineEnum(
  ['not_started', 'active', 'ineligible'] as const,
  { not_started: 'Not started', active: 'Active', ineligible: 'Not eligible' },
  { not_started: 'neutral', active: 'success', ineligible: 'danger' },
);
export type ReferralStatus = (typeof REFERRAL_STATUS.values)[number];

export const REFERRAL_COMMISSION_STATUS = defineEnum(
  ['pending', 'credited', 'reversed', 'ineligible'] as const,
  { pending: 'Pending', credited: 'Credited', reversed: 'Reversed', ineligible: 'Not eligible' },
  { pending: 'warning', credited: 'success', reversed: 'danger', ineligible: 'neutral' },
);
export type ReferralCommissionStatus = (typeof REFERRAL_COMMISSION_STATUS.values)[number];

export const REFERRAL_SOURCE_TYPE = defineEnum(['task', 'deposit'] as const, { task: 'Task', deposit: 'Deposit' });
export type ReferralSourceType = (typeof REFERRAL_SOURCE_TYPE.values)[number];

// ---------------------------------------------------------------------------
// §7.11 Notifications
// ---------------------------------------------------------------------------

export const NOTIFICATION_CATEGORY = defineEnum(['tasks', 'payments', 'referrals', 'system'] as const, {
  tasks: 'Tasks',
  payments: 'Payments',
  referrals: 'Referrals',
  system: 'System',
});
export type NotificationCategory = (typeof NOTIFICATION_CATEGORY.values)[number];

export const NOTIFICATION_PREF_KEY = defineEnum(
  [
    'task_approved', 'submission_needs_fix', 'payout_updates', 'new_jobs_matching', 'referral_earnings',
    'tips_product_news', 'new_submissions_digest', 'review_window_ending', 'low_deposit_balance', 'monthly_spending_report',
  ] as const,
  {
    task_approved: 'Task approved',
    submission_needs_fix: 'Submission needs a fix',
    payout_updates: 'Payout updates',
    new_jobs_matching: 'New jobs matching my interests',
    referral_earnings: 'Referral earnings',
    tips_product_news: 'Tips and product news',
    new_submissions_digest: 'New submissions digest',
    review_window_ending: 'Review window ending soon',
    low_deposit_balance: 'Low deposit balance',
    monthly_spending_report: 'Monthly spending report',
  },
);
export type NotificationPrefKey = (typeof NOTIFICATION_PREF_KEY.values)[number];

// ---------------------------------------------------------------------------
// §7.12 Other enums
// ---------------------------------------------------------------------------

export const PROOF_TYPE = defineEnum(['screenshot', 'link', 'text', 'file'] as const, {
  screenshot: 'Screenshot',
  link: 'Link',
  text: 'Text answer',
  file: 'File upload',
});
export type ProofType = (typeof PROOF_TYPE.values)[number];

/** Public categories (C-09). `other` is employer-only and never shown on public or worker filters. */
export const CATEGORY_SLUG = defineEnum(
  ['data-entry', 'surveys', 'website-testing', 'app-testing', 'writing', 'image-tagging', 'social-media', 'research', 'other'] as const,
  {
    'data-entry': 'Data entry',
    surveys: 'Surveys',
    'website-testing': 'Website testing',
    'app-testing': 'App testing',
    writing: 'Writing',
    'image-tagging': 'Image tagging',
    'social-media': 'Social media',
    research: 'Research',
    other: 'Other',
  },
);
export type CategorySlug = (typeof CATEGORY_SLUG.values)[number];
export const PUBLIC_CATEGORY_SLUGS = CATEGORY_SLUG.values.filter((s) => s !== 'other') as Exclude<CategorySlug, 'other'>[];

export const TIME_PER_TASK = defineEnum(['about_2', 'about_5', 'about_10', 'about_15', 'about_30', 'about_60'] as const, {
  about_2: 'About 2 minutes',
  about_5: 'About 5 minutes',
  about_10: 'About 10 minutes',
  about_15: 'About 15 minutes',
  about_30: 'About 30 minutes',
  about_60: 'About 60 minutes',
});
export type TimePerTask = (typeof TIME_PER_TASK.values)[number];
export const TIME_PER_TASK_MINUTES: Readonly<Record<TimePerTask, number>> = Object.freeze({
  about_2: 2,
  about_5: 5,
  about_10: 10,
  about_15: 15,
  about_30: 30,
  about_60: 60,
});

export const TIME_BUCKET = defineEnum(['under_5', '5_15', 'over_15'] as const, {
  under_5: 'Under 5 min',
  '5_15': '5–15 min',
  over_15: 'Over 15 min',
});
export type TimeBucket = (typeof TIME_BUCKET.values)[number];
/** A-53: filter bucket → time_per_task values. */
export const TIME_BUCKET_TO_TIME_PER_TASK: Readonly<Record<TimeBucket, readonly TimePerTask[]>> = Object.freeze({
  under_5: ['about_2', 'about_5'],
  '5_15': ['about_10', 'about_15'],
  over_15: ['about_30', 'about_60'],
});

export const OPEN_FOR_DAYS = [1, 3, 7, 14, 30] as const;
export type OpenForDays = (typeof OPEN_FOR_DAYS)[number];

export const JOB_ELIGIBILITY = defineEnum(['all_verified', 'kyc_verified'] as const, {
  all_verified: 'All verified workers',
  kyc_verified: 'Identity-verified workers only',
});
export type JobEligibility = (typeof JOB_ELIGIBILITY.values)[number];

export const MIN_APPROVAL_RATE = [0, 60, 70, 80, 90, 95] as const;
export type MinApprovalRate = (typeof MIN_APPROVAL_RATE)[number];
export const MIN_APPROVAL_RATE_LABEL: Readonly<Record<MinApprovalRate, string>> = Object.freeze({
  0: 'Any',
  60: '60% or higher',
  70: '70% or higher',
  80: '80% or higher',
  90: '90% or higher',
  95: '95% or higher',
});

export const REVIEW_WINDOW_HOURS = [24, 48, 72] as const;
export type ReviewWindowHours = (typeof REVIEW_WINDOW_HOURS)[number];
export const REVIEW_WINDOW_LABEL: Readonly<Record<ReviewWindowHours, string>> = Object.freeze({
  24: '24 hours',
  48: '48 hours',
  72: '72 hours (default)',
});

export const SUBMISSIONS_PER_WORKER = [1] as const;

export const INTEREST_TIME = defineEnum(['under_15', '15_60', 'over_60'] as const, {
  under_15: 'Under 15 minutes',
  '15_60': '15–60 minutes',
  over_60: 'More than an hour',
});
export type InterestTime = (typeof INTEREST_TIME.values)[number];

export const INTEREST_DEVICE = defineEnum(['phone', 'desktop'] as const, { phone: 'Phone', desktop: 'Desktop' });
export type InterestDevice = (typeof INTEREST_DEVICE.values)[number];

export const OTP_PURPOSE = defineEnum(
  ['signup', 'login', 'password_reset', 'new_device', 'first_withdrawal', 'contact_change'] as const,
  {
    signup: 'Sign up',
    login: 'Sign in',
    password_reset: 'Password reset',
    new_device: 'New device',
    first_withdrawal: 'First withdrawal',
    contact_change: 'Contact change',
  },
);
export type OtpPurpose = (typeof OTP_PURPOSE.values)[number];

export const OTP_CHANNEL = defineEnum(['sms', 'email'] as const, { sms: 'SMS', email: 'Email' });
export type OtpChannel = (typeof OTP_CHANNEL.values)[number];

export const CONTACT_TOPIC = defineEnum(
  ['getting_started', 'tasks_proof', 'payments_withdrawals', 'employers', 'account_security', 'referral'] as const,
  {
    getting_started: 'Getting started',
    tasks_proof: 'Tasks & proof',
    payments_withdrawals: 'Payments & withdrawals',
    employers: 'For employers',
    account_security: 'Account & security',
    referral: 'Referral program',
  },
);
export type ContactTopic = (typeof CONTACT_TOPIC.values)[number];

export const CONTACT_MESSAGE_STATUS = defineEnum(
  ['new', 'in_progress', 'answered', 'closed', 'spam'] as const,
  { new: 'New', in_progress: 'In progress', answered: 'Answered', closed: 'Closed', spam: 'Spam' },
  { new: 'brand', in_progress: 'info', answered: 'success', closed: 'neutral', spam: 'danger' },
);
export type ContactMessageStatus = (typeof CONTACT_MESSAGE_STATUS.values)[number];

export const JOB_REPORT_REASON = defineEnum(
  ['scam_or_payment', 'personal_data', 'fake_engagement', 'broken_materials', 'misleading', 'other'] as const,
  {
    scam_or_payment: 'Scam or asks for payment',
    personal_data: 'Asks for personal data',
    fake_engagement: 'Fake engagement',
    broken_materials: 'Broken link or materials',
    misleading: 'Misleading description',
    other: 'Other',
  },
);
export type JobReportReason = (typeof JOB_REPORT_REASON.values)[number];

export const JOB_REPORT_STATUS = defineEnum(
  ['open', 'reviewed', 'actioned', 'dismissed'] as const,
  { open: 'Open', reviewed: 'Reviewed', actioned: 'Actioned', dismissed: 'Dismissed' },
  { open: 'warning', reviewed: 'info', actioned: 'success', dismissed: 'neutral' },
);
export type JobReportStatus = (typeof JOB_REPORT_STATUS.values)[number];

export const JOB_SORT = defineEnum(['newest', 'highest_reward', 'shortest_time', 'most_slots', 'ending_soon'] as const, {
  newest: 'Newest first',
  highest_reward: 'Highest reward',
  shortest_time: 'Shortest time',
  most_slots: 'Most slots left',
  ending_soon: 'Ending soon',
});
export type JobSort = (typeof JOB_SORT.values)[number];

/** Public browse reward filter ("$0.10 or more"…). */
export const REWARD_MIN_OPTIONS = ['0.10', '0.25', '0.50'] as const;
export type RewardMinOption = (typeof REWARD_MIN_OPTIONS)[number];

export const UPLOAD_PURPOSE = defineEnum(
  ['proof_screenshot', 'proof_file', 'kyc_document', 'kyc_selfie', 'avatar', 'employer_logo', 'cms_image'] as const,
  {
    proof_screenshot: 'Screenshot',
    proof_file: 'File',
    kyc_document: 'Identity document',
    kyc_selfie: 'Selfie',
    avatar: 'Profile photo',
    employer_logo: 'Logo',
    cms_image: 'Content image',
  },
);
export type UploadPurpose = (typeof UPLOAD_PURPOSE.values)[number];

export const UPLOAD_STATUS = defineEnum(
  ['pending', 'uploaded', 'quarantined', 'deleted'] as const,
  { pending: 'Processing', uploaded: 'Uploaded', quarantined: 'Rejected', deleted: 'Removed' },
  { pending: 'info', uploaded: 'success', quarantined: 'danger', deleted: 'neutral' },
);
export type UploadStatus = (typeof UPLOAD_STATUS.values)[number];

export const LEGAL_PAGE_SLUG = defineEnum(['terms', 'privacy', 'refund', 'cancellation'] as const, {
  terms: 'Terms & conditions',
  privacy: 'Privacy policy',
  refund: 'Refund policy',
  cancellation: 'Cancellation policy',
});
export type LegalPageSlug = (typeof LEGAL_PAGE_SLUG.values)[number];

export const FAQ_PLACEMENT = defineEnum(['home', 'help', 'referral'] as const, { home: 'Home', help: 'Help center', referral: 'Referral' });
export type FaqPlacement = (typeof FAQ_PLACEMENT.values)[number];

export const ONBOARDING_STEP = defineEnum(['role', 'interests', 'payout', 'business', 'skip'] as const, {
  role: 'Role',
  interests: 'Interests',
  payout: 'Payout method',
  business: 'Business profile',
  skip: 'Skip',
});
export type OnboardingStep = (typeof ONBOARDING_STEP.values)[number];

/** Close-account blockers (Doc 06 §5.2 `POST /me/close`). */
export const CLOSE_BLOCKER = defineEnum(
  ['worker_balance', 'withdrawals_in_flight', 'active_reservations', 'open_submissions', 'open_jobs', 'employer_balance', 'employer_reserved'] as const,
  {
    worker_balance: 'Withdraw your balance',
    withdrawals_in_flight: 'Withdrawals on the way',
    active_reservations: 'Jobs in progress',
    open_submissions: 'Tasks waiting for a decision',
    open_jobs: 'Running or paused jobs',
    employer_balance: 'Deposit balance left',
    employer_reserved: 'Reserved budget',
  },
);
export type CloseBlocker = (typeof CLOSE_BLOCKER.values)[number];

export const IDEMPOTENCY_STATUS = defineEnum(['in_progress', 'completed', 'failed'] as const, {
  in_progress: 'In progress',
  completed: 'Completed',
  failed: 'Failed',
});
export type IdempotencyStatus = (typeof IDEMPOTENCY_STATUS.values)[number];

/** Date range codes for statements and exports (Doc 06 §1.8). */
export const DATE_RANGE = defineEnum(['last_7_days', 'last_30_days', 'last_90_days', 'this_month', 'all_time', 'custom'] as const, {
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  this_month: 'This month',
  all_time: 'All time',
  custom: 'Custom range',
});
export type DateRange = (typeof DATE_RANGE.values)[number];

/** Allowed `per_page` values (Doc 06 §1.7). */
export const PER_PAGE_VALUES = [6, 8, 9, 10, 20, 50] as const;
export type PerPage = (typeof PER_PAGE_VALUES)[number];
