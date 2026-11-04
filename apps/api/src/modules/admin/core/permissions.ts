/**
 * Permission keys (Doc 09 §4.3, seeded in `admin_roles.permissions`). A trailing `*` grants a
 * prefix; `*` alone grants everything. The browser uses `GET /admin/me` permissions for display
 * only; the API re-checks every call.
 */
export function hasPerm(perms: readonly string[], key: string): boolean {
  for (const p of perms) {
    if (p === '*' || p === key) return true;
    if (p.endsWith('.*') && key.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

export const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin',
  ops_admin: 'Operations admin',
  finance_admin: 'Finance admin',
  moderator: 'Moderator',
  support_agent: 'Support agent',
  analyst: 'Analyst',
};

/** Roles whose sessions use the 15-minute idle timeout (Doc 08 §12.1, NEW-09-03). */
export const PRIVILEGED_ROLES = new Set(['super_admin', 'finance_admin']);

/** Every key the panel checks, expanded for `GET /admin/me` so the client never parses wildcards. */
export const ALL_KEYS = [
  'dashboard.read', 'dashboard.money_read',
  'users.read_masked', 'users.read', 'users.reveal', 'users.restrict', 'users.suspend', 'users.contact', 'users.security',
  'appeals.log', 'appeals.read', 'appeals.decide',
  'kyc.read_status', 'kyc.read', 'kyc.decide', 'employers.verify',
  'jobs.read', 'jobs.read_detail', 'jobs.moderate',
  'submissions.read', 'submissions.override',
  'disputes.read', 'disputes.resolve',
  'reports.read', 'reports.handle',
  'deposits.read_masked', 'deposits.read', 'deposits.write', 'deposits.approve', 'deposits.refund_override',
  'withdrawals.read_masked', 'withdrawals.read', 'withdrawals.read_account', 'withdrawals.write', 'withdrawals.approve',
  'ledger.read', 'ledger.read_aggregate', 'ledger.adjust', 'ledger.approve',
  'recon.read', 'recon.write',
  'referrals.read', 'referrals.read_aggregate', 'referrals.review', 'referrals.reverse',
  'support.reply', 'content.write', 'broadcast.send',
  'settings.read', 'settings.write', 'payout_configs.read', 'payout_configs.write', 'fx.write',
  'admins.manage', 'audit.read', 'audit.export', 'reports.financial', 'reports.operational',
] as const;

export function expandPerms(raw: readonly string[]): string[] {
  return ALL_KEYS.filter((k) => hasPerm(raw, k));
}

/** Money settings `finance_admin` may read (Doc 09 §17.4 "(M)"). */
export const MONEY_SETTING_KEYS = new Set([
  'reward_min_usd', 'reward_max_usd', 'reward_step_usd', 'platform_fee_percent', 'kyc_required_for_withdrawal',
  'deposit_methods_enabled', 'deposit_min_usd', 'deposit_max_usd', 'deposit_daily_max_usd', 'card_new_customer_max_usd',
  'deposit_presets_usd', 'deposit_refund_window_days', 'withdrawal_daily_max_usd', 'withdrawal_daily_count_max',
  'withdrawal_monthly_max_usd', 'first_withdrawal_hold_hours', 'payout_dual_approval_threshold_usd',
  'payout_method_cooldown_hours', 'payout_execution_mode', 'fx_auto_fetch_enabled', 'fx_margin_percent', 'referral_enabled',
  'referral_task_rate', 'referral_deposit_rate', 'withdrawals_paused', 'deposits_paused',
]);

/** Audit actions finance may read (Doc 09 §20.3). */
export const MONEY_AUDIT_PREFIXES = ['deposit.', 'withdrawal.', 'ledger.', 'reconciliation.', 'referral.reverse', 'fx.', 'payout_config.'];
