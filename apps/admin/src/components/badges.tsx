import { StatusBadge } from '@24f/ui';
import type { Tone } from '@24f/ui';

type Map = Record<string, [string, Tone]>;

/** Status badge tones for the panel (Doc 09 §5.2, Canonical §7). */
export const ADMIN_BADGES: Record<string, Map> = {
  user: { active: ['Active', 'success'], restricted: ['Restricted', 'warning'], suspended: ['Suspended', 'danger'], closed: ['Closed', 'neutral'] },
  kyc: { not_submitted: ['Not submitted', 'neutral'], pending: ['Pending', 'warning'], verified: ['Identity verified', 'success'], rejected: ['Rejected', 'danger'] },
  employer: { not_submitted: ['Not submitted', 'neutral'], pending: ['Pending', 'warning'], verified: ['Verified', 'success'], rejected: ['Rejected', 'danger'] },
  job: { draft: ['Draft', 'neutral'], running: ['Running', 'success'], paused: ['Paused', 'warning'], completed: ['Completed', 'neutral'], cancelled: ['Cancelled', 'neutral'], suspended: ['Suspended by admin', 'danger'] },
  submission: { in_review: ['In review', 'warning'], approved: ['Approved', 'success'], needs_fix: ['Needs fix', 'danger'], rejected: ['Rejected', 'danger'] },
  dispute: { open: ['Open', 'warning'], under_review: ['Under review', 'info'], resolved_worker: ['Decided for worker', 'success'], resolved_employer: ['Decision upheld', 'neutral'], withdrawn: ['Withdrawn', 'neutral'] },
  deposit: { initiated: ['Waiting for payment', 'neutral'], pending: ['Pending', 'warning'], completed: ['Completed', 'success'], failed: ['Failed', 'danger'], cancelled: ['Cancelled', 'neutral'], expired: ['Expired', 'neutral'], refunded: ['Refunded', 'neutral'] },
  withdrawal: { requested: ['Requested', 'warning'], processing: ['Processing', 'info'], paid: ['Paid', 'success'], rejected: ['Rejected', 'danger'], cancelled: ['Cancelled', 'neutral'], failed: ['Failed', 'danger'] },
  referral: { not_started: ['Not started', 'neutral'], active: ['Active', 'success'], ineligible: ['Not eligible', 'danger'] },
  commission: { pending: ['Pending', 'warning'], credited: ['Credited', 'success'], reversed: ['Reversed', 'danger'], ineligible: ['Not eligible', 'neutral'] },
  report: { open: ['Open', 'warning'], reviewed: ['Reviewed', 'info'], actioned: ['Actioned', 'success'], dismissed: ['Dismissed', 'neutral'] },
  contact: { new: ['New', 'warning'], in_progress: ['In progress', 'info'], answered: ['Answered', 'success'], closed: ['Closed', 'neutral'], spam: ['Spam', 'neutral'] },
  appeal: { open: ['Open', 'warning'], under_review: ['Under review', 'info'], upheld: ['Upheld', 'success'], denied: ['Denied', 'danger'] },
  admin: { active: ['Active', 'success'], disabled: ['Disabled', 'neutral'] },
  adjustment: { pending_approval: ['Awaiting approval', 'warning'], approved: ['Posted', 'success'], declined: ['Declined', 'neutral'], expired: ['Expired', 'neutral'] },
  severity: { critical: ['Critical', 'danger'], high: ['High', 'danger'], medium: ['Medium', 'warning'], info: ['Info', 'info'] },
  run: { ok: ['OK', 'success'], issues: ['Issues', 'warning'], running: ['Running', 'info'], failed: ['Failed', 'danger'] },
};

export function AdminBadge({ kind, code, className }: { kind: keyof typeof ADMIN_BADGES; code: string | null | undefined; className?: string }) {
  if (!code) return <span className="text-fg-tertiary">—</span>;
  const hit = ADMIN_BADGES[kind]?.[code];
  return <StatusBadge tone={hit?.[1] ?? 'neutral'} label={hit?.[0] ?? code.replace(/_/g, ' ')} className={className} />;
}

export function Chip({ tone = 'neutral', children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return <StatusBadge tone={tone} label={children as string} showDot={false} className="!h-[22px]" {...(title ? {} : {})} />;
}

export const LABELS = {
  restriction: { fraud_suspected: 'Suspected fraud', duplicate_account: 'Duplicate account', policy_violation: 'Terms violation', chargeback: 'Chargeback on a deposit', spam_or_abuse: 'Spam or abuse', identity_unverified: 'Identity not verified', other: 'Other' } as Record<string, string>,
  restrictionMessage: {
    fraud_suspected: "We've limited your account while we review unusual activity.",
    duplicate_account: 'It looks like you have more than one account. Only one is allowed.',
    policy_violation: 'Your account broke our Terms & conditions.',
    chargeback: 'A payment on your account was disputed with the provider.',
    spam_or_abuse: 'We received reports of spam or abuse from your account.',
    identity_unverified: 'We need to verify your identity before you can continue.',
    other: '',
  } as Record<string, string>,
  kycReject: { document_unreadable: 'Document unreadable', name_mismatch: "Name doesn't match", document_expired: 'Document expired', selfie_mismatch: "Selfie doesn't match", other: 'Other' } as Record<string, string>,
  kycRejectText: {
    document_unreadable: "We couldn't read your document. Upload a clear photo with all four corners showing.",
    name_mismatch: "The name on your document doesn't match your profile name.",
    document_expired: "This document has expired. Upload one that's still valid.",
    selfie_mismatch: "Your selfie doesn't match the photo on your document. Take a new selfie in good light.",
    other: '',
  } as Record<string, string>,
  docType: { national_id: 'National ID', passport: 'Passport', driving_licence: 'Driving licence' } as Record<string, string>,
  submissionReject: { proof_incomplete: 'Proof incomplete', steps_not_followed: 'Steps not followed', wrong_or_copied: 'Wrong or copied answer', link_not_accessible: 'Link not accessible', other: 'Other' } as Record<string, string>,
  reportReason: { scam_or_payment: 'Scam or asks for payment', personal_data: 'Asks for personal or payment data', fake_engagement: 'Fake reviews or engagement', broken_materials: "Task link or materials don't work", misleading: 'Reward or details are misleading', other: 'Something else' } as Record<string, string>,
  wdReject: { invalid_account: 'Invalid account', name_mismatch: 'Name mismatch', kyc_issue: 'KYC issue', suspected_fraud: 'Suspected fraud', duplicate_request: 'Duplicate request', other: 'Other' } as Record<string, string>,
  wdRejectText: {
    invalid_account: "The number isn't a registered mobile wallet.",
    name_mismatch: "The account name doesn't match your verified identity.",
    kyc_issue: 'We need to verify your identity again before paying this.',
    suspected_fraud: "We couldn't complete this withdrawal after a security review. Contact us for help.",
    duplicate_request: 'This looks like a duplicate of another request.',
    other: '',
  } as Record<string, string>,
  method: { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', usdt_trc20: 'USDT' } as Record<string, string>,
  risk: { 'VEL-04': 'First withdrawal, on hold 24 h', 'VEL-05': 'Withdraws ≥ 90% of balance within 1 h of a new device sign-in', 'VEL-06': 'Earned ≥ $50.00 in 24 h, or over 3× the 30-day daily average', 'VEL-07': 'Account under 7 days old and withdrawal ≥ $50.00', 'VEL-08': 'Payout account shared with another user', 'VEL-09': 'Payout account received from ≥ 3 users in 30 days', 'VEL-10': 'Earnings mostly from one employer (≥ 80%, ≥ $20.00)', GEO: 'Different country from profile, or VPN or hosting network', SANCTION: 'USDT address failed screening' } as Record<string, string>,
  topic: { getting_started: 'Getting started', tasks_proof: 'Tasks and proof', payments_withdrawals: 'Payments and withdrawals', employers: 'Employers', account_security: 'Account and security', referral: 'Referral' } as Record<string, string>,
  adjReason: { correction: 'Correction', goodwill: 'Goodwill', fx_difference: 'FX difference', referral_reversal: 'Referral reversal', write_off: 'Write-off', provider_settlement: 'Provider settlement', other: 'Other' } as Record<string, string>,
  account: { worker_earnings: 'Available to withdraw', employer_available: 'Available for new jobs', employer_reserved: 'Reserved for running jobs' } as Record<string, string>,
  ledgerType: { deposit: 'Deposit', job_reserve: 'Job reserve', job_spend: 'Job spend', job_release: 'Job release', task_reward: 'Task reward', referral_commission: 'Referral commission', withdrawal: 'Withdrawal', withdrawal_reversal: 'Refunded', platform_fee: 'Platform fee', deposit_refund: 'Deposit refund', adjustment: 'Adjustment' } as Record<string, string>,
};

/** SLA treatment (Doc 09 §5.2): "Overdue" Danger, "Due in 3 h" Warning under 6 h, otherwise plain text. */
export function SlaCell({ due, now }: { due: string | null | undefined; now: number }) {
  if (!due) return <span className="text-fg-tertiary">—</span>;
  const ms = new Date(due).getTime() - now;
  if (ms < 0) return <StatusBadge tone="danger" label="Overdue" />;
  if (ms < 6 * 3600_000) return <StatusBadge tone="warning" label={`Due in ${Math.max(1, Math.round(ms / 3600_000))} h`} />;
  return <span>{`Due ${new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(due))}`}</span>;
}
