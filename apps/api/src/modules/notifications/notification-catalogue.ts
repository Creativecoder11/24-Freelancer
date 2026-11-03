import type { NotificationCategory, NotificationPrefKey } from '@24f/shared';

/**
 * Notification catalogue (Doc 04 §9.3). Titles and bodies are templates with `{var}`
 * placeholders; amounts and dates arrive pre-formatted (Canonical §5).
 */
export interface CatalogueEntry {
  audience: 'worker' | 'employer' | 'active';
  category: NotificationCategory;
  title: string;
  body: string;
  link?: string;
  /** Ignores preferences (payout and security, BR-087). */
  mandatory?: boolean;
  /** Preference gating in-app and email. Undefined = not gated. */
  prefKey?: NotificationPrefKey;
  /** Sent by email too when the preference allows (the email queue is owned by Doc 11 §7.4). */
  email?: boolean;
}

export const NOTIFICATION_CATALOGUE = {
  // ----- Worker: tasks -----
  task_approved: { audience: 'worker', category: 'tasks', title: 'Task approved · +{reward}', body: '“{job}” was approved by {employer}.', link: '/worker/tasks/{ref}', prefKey: 'task_approved', email: true },
  task_auto_approved: { audience: 'worker', category: 'tasks', title: 'Task auto-approved · +{reward}', body: '“{job}” was approved when the review window ended.', link: '/worker/tasks/{ref}', prefKey: 'task_approved', email: true },
  submission_needs_fix: { audience: 'worker', category: 'tasks', title: 'Submission needs a fix', body: '{employer} asked you to resubmit “{job}”. Reason included.', link: '/worker/tasks/{ref}/fix', prefKey: 'submission_needs_fix', email: true },
  submission_rejected: { audience: 'worker', category: 'tasks', title: 'Submission rejected', body: '{employer} rejected “{job}”. Reason included.', link: '/worker/tasks/{ref}', prefKey: 'submission_needs_fix', email: true },
  fix_due_soon: { audience: 'worker', category: 'tasks', title: 'Fix due soon', body: 'Resubmit “{job}” by {deadline}.', link: '/worker/tasks/{ref}/fix', prefKey: 'submission_needs_fix' },
  reservation_expiring: { audience: 'worker', category: 'tasks', title: '10 minutes left on your task', body: 'Submit “{job}” before your slot is released.', link: '/worker/jobs/{job_public_id}' },
  reservation_expired: { audience: 'worker', category: 'tasks', title: 'Your slot was released', body: 'Your time on “{job}” ran out. You can start again if slots remain.', link: '/worker/jobs/{job_public_id}' },
  reservation_cancelled: { audience: 'worker', category: 'tasks', title: 'Your slot was released', body: '“{job}” closed before you submitted.', link: '/worker/jobs/{job_public_id}', mandatory: true },
  dispute_opened: { audience: 'worker', category: 'tasks', title: 'Dispute {dispute_ref} received', body: 'We aim to decide within 48 hours.', link: '/worker/tasks/{ref}', mandatory: true, email: true },
  dispute_resolved: { audience: 'worker', category: 'tasks', title: 'Dispute {dispute_ref} resolved', body: '{outcome}. {note}', link: '/worker/tasks/{ref}', mandatory: true, email: true },
  new_jobs_matching_interests: { audience: 'worker', category: 'system', title: 'New jobs in {category}', body: '{count} jobs matching your interests were posted in the last hour.', link: '/worker/jobs?chip=for_you', prefKey: 'new_jobs_matching', email: true },
  kyc_required: { audience: 'worker', category: 'system', title: 'Verify your account', body: 'Verification may be required before your first withdrawal.', link: '/worker/settings#verification', mandatory: true },

  // ----- Worker: payments -----
  withdrawal_requested: { audience: 'worker', category: 'payments', title: 'Withdrawal requested', body: 'It’s on its way to {method}.', link: '/worker/wallet/withdrawals?ref={wd_ref}', mandatory: true, prefKey: 'payout_updates', email: true },
  withdrawal_processing: { audience: 'worker', category: 'payments', title: 'Withdrawal processing · {amount}', body: 'We’re sending it to {method}.', link: '/worker/wallet/withdrawals?ref={wd_ref}', mandatory: true, prefKey: 'payout_updates' },
  withdrawal_paid: { audience: 'worker', category: 'payments', title: 'Withdrawal paid · {amount}', body: 'Sent to your mobile wallet ending {last3}.', link: '/worker/wallet/withdrawals?ref={wd_ref}', mandatory: true, prefKey: 'payout_updates', email: true },
  withdrawal_rejected: { audience: 'worker', category: 'payments', title: 'Withdrawal rejected and refunded', body: '{reason} {amount} is back in your balance.', link: '/worker/wallet/withdrawals?ref={wd_ref}', mandatory: true, prefKey: 'payout_updates', email: true },
  withdrawal_failed: { audience: 'worker', category: 'payments', title: 'Withdrawal failed · {amount} refunded', body: '{reason} {amount} is back in your balance.', link: '/worker/wallet/withdrawals?ref={wd_ref}', mandatory: true, prefKey: 'payout_updates', email: true },
  withdrawal_cancelled: { audience: 'worker', category: 'payments', title: 'Withdrawal cancelled', body: '{amount} is back in your balance.', link: '/worker/wallet/withdrawals?ref={wd_ref}', mandatory: true, prefKey: 'payout_updates' },

  // ----- Referral -----
  referral_commission: { audience: 'worker', category: 'referrals', title: 'Referral commission · +{amount}', body: '5% of tasks completed by {friend} this week.', link: '/worker/referral', prefKey: 'referral_earnings', email: true },
  referral_friend_joined: { audience: 'worker', category: 'referrals', title: 'A friend joined with your link', body: '{friend} signed up. You’ll earn when they start.', link: '/worker/referral', prefKey: 'referral_earnings' },

  // ----- Employer -----
  dispute_against_decision: { audience: 'employer', category: 'tasks', title: 'A worker disputed your decision on {ref}', body: 'A 24 Freelancing reviewer will look at it.', link: '/employer/submissions?ref={ref}', mandatory: true, email: true },
  employer_dispute_withdrawn: { audience: 'employer', category: 'tasks', title: 'Dispute withdrawn on {ref}', body: 'The worker withdrew their dispute.', link: '/employer/submissions?ref={ref}' },
  employer_submission_resubmitted: { audience: 'employer', category: 'tasks', title: 'A fix was resubmitted on {ref}', body: '“{job}” is back in your review queue.', link: '/employer/submissions?ref={ref}', prefKey: 'new_submissions_digest' },
} as const satisfies Record<string, CatalogueEntry>;

export type NotificationType = keyof typeof NOTIFICATION_CATALOGUE;

/** Default preference rows (Doc 06 §5.15, Doc 05 §8.6: a missing row means the default). */
export const PREFERENCE_DEFAULTS: Record<'worker' | 'employer', { pref_key: NotificationPrefKey; label: string; helper?: string; on: boolean; locked?: boolean }[]> = {
  worker: [
    { pref_key: 'task_approved', label: 'Task approved', on: true },
    { pref_key: 'submission_needs_fix', label: 'Submission needs a fix', on: true },
    { pref_key: 'payout_updates', label: 'Payout updates', on: true, locked: true },
    { pref_key: 'new_jobs_matching', label: 'New jobs matching my interests', on: false },
    { pref_key: 'referral_earnings', label: 'Referral earnings', on: true },
    { pref_key: 'tips_product_news', label: 'Tips and product news', on: false },
  ],
  employer: [
    { pref_key: 'new_submissions_digest', label: 'New submissions', helper: 'Daily summary at 9:00', on: true },
    { pref_key: 'review_window_ending', label: 'Review window ending soon', helper: 'When submissions are 12 h from auto-approval', on: true },
    { pref_key: 'low_deposit_balance', label: 'Low deposit balance', helper: 'When reserve can’t cover remaining slots', on: true },
    { pref_key: 'monthly_spending_report', label: 'Monthly spending report', helper: 'First day of each month', on: false },
  ],
};

export const LOCKED_PREF_KEYS: ReadonlySet<NotificationPrefKey> = new Set(['payout_updates']);

export function render(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : String(v);
  });
}
