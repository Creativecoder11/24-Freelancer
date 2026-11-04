/**
 * Typed validation for `platform_settings` (Doc 09 §17). `S` = super_admin only; class C1–C3 is
 * the confirmation level the review dialog asks for. Values not listed fall back to their
 * `value_type` with no range and class C1, editable by super and ops.
 */
export type SettingRule = {
  group: string;
  type: 'number' | 'integer' | 'boolean' | 'string' | 'json';
  min?: number;
  max?: number;
  dp?: number;
  enum?: string[];
  maxLen?: number;
  nullable?: boolean;
  list?: 'int' | 'num' | 'str';
  superOnly?: boolean;
  cls: 'C1' | 'C2' | 'C3';
  applies: string;
};

const r = (group: string, type: SettingRule['type'], cls: SettingRule['cls'], applies: string, extra: Partial<SettingRule> = {}): SettingRule => ({ group, type, cls, applies, ...extra });

export const SETTING_RULES: Record<string, SettingRule> = {
  reward_min_usd: r('jobs', 'number', 'C2', 'New jobs', { min: 0.001, max: 1000, dp: 3 }),
  reward_max_usd: r('jobs', 'number', 'C2', 'New jobs', { min: 0.001, max: 1000, dp: 3 }),
  reward_step_usd: r('jobs', 'number', 'C1', 'New jobs', { min: 0.001, max: 1, dp: 3 }),
  slots_min: r('jobs', 'integer', 'C1', 'New jobs', { min: 1, max: 100000 }),
  slots_max: r('jobs', 'integer', 'C1', 'New jobs', { min: 1, max: 100000 }),
  platform_fee_percent: r('jobs', 'number', 'C3', 'Jobs published after the change', { min: 0, max: 50, dp: 2, superOnly: true }),
  job_id_prefix: r('jobs', 'string', 'C3', 'New job IDs only', { enum: undefined, maxLen: 3, superOnly: true }),
  job_new_badge_minutes: r('jobs', 'integer', 'C1', 'Immediately', { min: 0, max: 1440 }),
  open_for_days_options: r('jobs', 'json', 'C1', 'New jobs', { list: 'int', min: 1, max: 90 }),
  min_approval_rate_options: r('jobs', 'json', 'C1', 'New jobs', { list: 'int', min: 0, max: 100 }),
  slot_hold_minutes: r('jobs', 'integer', 'C1', 'New reservations', { min: 5, max: 1440 }),
  max_active_reservations_per_worker: r('jobs', 'integer', 'C1', 'New starts', { min: 1, max: 20 }),
  market_hint_min_jobs: r('jobs', 'integer', 'C1', 'Next roll-up', { min: 1, max: 100 }),
  market_hint_window_days: r('jobs', 'integer', 'C1', 'Next roll-up', { min: 7, max: 180 }),
  slot_expiry_warning_minutes: r('jobs', 'integer', 'C1', 'New reservations', { min: 1, max: 60 }),

  auto_approve_default: r('review', 'boolean', 'C1', 'New jobs'),
  review_window_default: r('review', 'integer', 'C1', 'New jobs', { min: 1, max: 336 }),
  review_window_options_hours: r('review', 'json', 'C1', 'New jobs', { list: 'int', min: 1, max: 336 }),
  review_ending_notice_hours: r('review', 'integer', 'C1', 'Next check', { min: 1, max: 72 }),
  auto_approve_escalation_days: r('review', 'integer', 'C2', 'Next hourly run', { min: 1, max: 30 }),
  resubmit_window_hours: r('review', 'integer', 'C1', 'New rejections', { min: 1, max: 168 }),
  max_resubmissions: r('review', 'integer', 'C1', 'New rejections', { min: 0, max: 5 }),
  dispute_window_hours: r('review', 'integer', 'C1', 'New decisions', { min: 1, max: 336 }),
  dispute_sla_hours: r('review', 'integer', 'C1', 'New disputes', { min: 1, max: 168 }),
  approval_rate_min_decisions: r('review', 'integer', 'C1', 'Next roll-up', { min: 1, max: 100 }),
  approval_rate_window_days: r('review', 'integer', 'C1', 'Next roll-up', { min: 7, max: 365 }),
  phash_duplicate_distance: r('review', 'integer', 'C1', 'New uploads', { min: 0, max: 32 }),
  bulk_approve_max: r('review', 'integer', 'C1', 'Immediately', { min: 1, max: 500 }),

  job_moderation_mode: r('moderation', 'string', 'C3', 'Jobs published after the change', { enum: ['post', 'pre'], superOnly: true }),
  moderation_blocklist_terms: r('moderation', 'json', 'C1', 'Next publish', { list: 'str', maxLen: 60 }),
  moderation_blocklist_domains: r('moderation', 'json', 'C1', 'Next publish', { list: 'str', maxLen: 253 }),
  moderation_watchlist_terms: r('moderation', 'json', 'C1', 'Next publish', { list: 'str', maxLen: 60 }),
  url_shortener_domains: r('moderation', 'json', 'C1', 'Next publish', { list: 'str', maxLen: 253 }),

  password_min_length: r('accounts', 'integer', 'C2', 'New passwords', { min: 8, max: 64, superOnly: true }),
  otp_length: r('accounts', 'integer', 'C2', 'New codes', { min: 6, max: 6, superOnly: true }),
  otp_ttl_minutes: r('accounts', 'integer', 'C2', 'New codes', { min: 1, max: 30, superOnly: true }),
  otp_resend_seconds: r('accounts', 'integer', 'C1', 'New codes', { min: 30, max: 600 }),
  otp_max_attempts: r('accounts', 'integer', 'C2', 'New codes', { min: 3, max: 10, superOnly: true }),
  otp_max_sends_per_hour: r('accounts', 'integer', 'C2', 'Immediately', { min: 1, max: 20, superOnly: true }),
  otp_max_sends_per_day: r('accounts', 'integer', 'C2', 'Immediately', { min: 1, max: 100, superOnly: true }),
  otp_max_sends_per_ip_per_day: r('accounts', 'integer', 'C2', 'Immediately', { min: 1, max: 500, superOnly: true }),
  login_max_failed_attempts: r('accounts', 'integer', 'C2', 'Immediately', { min: 3, max: 20, superOnly: true }),
  login_lock_minutes: r('accounts', 'integer', 'C2', 'New locks', { min: 5, max: 1440, superOnly: true }),
  access_token_ttl_minutes: r('accounts', 'integer', 'C3', 'New tokens', { min: 5, max: 60, superOnly: true }),
  refresh_ttl_days_keep_signed_in: r('accounts', 'integer', 'C2', 'New sessions', { min: 1, max: 90, superOnly: true }),
  refresh_ttl_hours_session: r('accounts', 'integer', 'C2', 'New sessions', { min: 1, max: 72, superOnly: true }),
  account_anonymise_after_days: r('accounts', 'integer', 'C3', 'Next retention run', { min: 0, max: 365, superOnly: true }),
  trusted_device_days: r('accounts', 'integer', 'C2', 'New devices', { min: 1, max: 365, superOnly: true }),
  reset_token_ttl_minutes: r('accounts', 'integer', 'C2', 'New links', { min: 5, max: 60, superOnly: true }),
  unverified_account_purge_days: r('accounts', 'integer', 'C2', 'Next purge', { min: 1, max: 90, superOnly: true }),

  kyc_required_for_withdrawal: r('kyc', 'boolean', 'C3', 'Immediately', { superOnly: true }),
  kyc_review_sla_hours: r('kyc', 'integer', 'C1', 'New submissions', { min: 1, max: 168 }),
  kyc_retention_years: r('kyc', 'integer', 'C3', 'Future decisions', { min: 1, max: 10, superOnly: true }),
  kyc_max_attempts: r('kyc', 'integer', 'C1', 'New submissions', { min: 1, max: 10 }),

  deposit_methods_enabled: r('deposits', 'json', 'C3', 'Immediately', { list: 'str', enum: ['mobile_wallet', 'card', 'crypto'], superOnly: true }),
  deposit_min_usd: r('deposits', 'number', 'C2', 'New deposits', { min: 1, max: 100000, dp: 2 }),
  deposit_max_usd: r('deposits', 'number', 'C2', 'New deposits', { min: 1, max: 100000, dp: 2 }),
  deposit_daily_max_usd: r('deposits', 'number', 'C2', 'New deposits', { min: 1, max: 100000, dp: 2 }),
  card_new_customer_max_usd: r('deposits', 'number', 'C2', 'New deposits', { min: 1, max: 100000, dp: 2 }),
  deposit_presets_usd: r('deposits', 'json', 'C1', 'Immediately', { list: 'num', min: 1, max: 100000 }),
  deposit_expiry_minutes_card: r('deposits', 'integer', 'C1', 'New deposits', { min: 5, max: 1440 }),
  deposit_expiry_minutes_crypto: r('deposits', 'integer', 'C1', 'New deposits', { min: 5, max: 1440 }),
  deposit_expiry_minutes_mobile_wallet: r('deposits', 'integer', 'C1', 'New deposits', { min: 5, max: 1440 }),
  deposit_refund_window_days: r('deposits', 'integer', 'C2', 'Requests from now on', { min: 0, max: 180, superOnly: true }),

  withdrawal_daily_max_usd: r('withdrawals', 'number', 'C3', 'New requests', { min: 1, max: 1000000, dp: 2, superOnly: true }),
  withdrawal_daily_count_max: r('withdrawals', 'integer', 'C2', 'New requests', { min: 1, max: 50, superOnly: true }),
  withdrawal_monthly_max_usd: r('withdrawals', 'number', 'C3', 'New requests', { min: 1, max: 1000000, dp: 2, superOnly: true }),
  first_withdrawal_hold_hours: r('withdrawals', 'integer', 'C3', 'New requests', { min: 0, max: 168, superOnly: true }),
  payout_dual_approval_threshold_usd: r('withdrawals', 'number', 'C3', 'Next action', { min: 1, max: 5000, dp: 2, superOnly: true }),
  payout_method_cooldown_hours: r('withdrawals', 'integer', 'C3', 'New edits', { min: 0, max: 168, superOnly: true }),
  payout_methods_max: r('withdrawals', 'integer', 'C1', 'New methods', { min: 1, max: 20 }),
  payout_execution_mode: r('withdrawals', 'string', 'C3', 'Next run', { enum: ['manual', 'api'], superOnly: true }),
  withdrawal_quote_ttl_seconds: r('withdrawals', 'integer', 'C1', 'New quotes', { min: 60, max: 3600 }),
  withdrawal_password_max_failures: r('withdrawals', 'integer', 'C2', 'Immediately', { min: 3, max: 20, superOnly: true }),
  withdrawal_lock_minutes: r('withdrawals', 'integer', 'C2', 'New locks', { min: 5, max: 1440, superOnly: true }),

  fx_auto_fetch_enabled: r('fx', 'boolean', 'C3', 'Next hourly run', { superOnly: true }),
  fx_margin_percent: r('fx', 'number', 'C2', 'Next auto rate', { min: 0, max: 20, dp: 2, superOnly: true }),

  referral_enabled: r('referral', 'boolean', 'C3', 'Immediately', { superOnly: true }),
  referral_task_rate: r('referral', 'number', 'C3', 'Commission events from now on', { min: 0, max: 0.5, dp: 4, superOnly: true }),
  referral_deposit_rate: r('referral', 'number', 'C3', 'Commission events from now on', { min: 0, max: 0.5, dp: 4, superOnly: true }),
  referral_cookie_days: r('referral', 'integer', 'C1', 'New cookies', { min: 1, max: 365 }),
  referral_reminder_cooldown_hours: r('referral', 'integer', 'C1', 'Next reminder', { min: 24, max: 720 }),
  referral_risk_block_score: r('referral', 'integer', 'C2', 'Next check', { min: 1, max: 200, superOnly: true }),
  referral_risk_flag_score: r('referral', 'integer', 'C2', 'Next check', { min: 1, max: 200, superOnly: true }),
  referral_recheck_days: r('referral', 'integer', 'C1', 'Next check', { min: 1, max: 180 }),

  upload_file_max_bytes: r('uploads', 'integer', 'C1', 'New uploads', { min: 1048576, max: 52428800 }),
  upload_image_max_bytes: r('uploads', 'integer', 'C1', 'New uploads', { min: 1048576, max: 20971520 }),
  proof_retention_days: r('uploads', 'integer', 'C3', 'Next retention run', { min: 30, max: 3650, superOnly: true }),
  notification_retention_days: r('uploads', 'integer', 'C1', 'Next cleanup', { min: 30, max: 365 }),

  company_legal_name: r('company', 'string', 'C1', 'Immediately', { maxLen: 120, nullable: true }),
  company_registered_address: r('company', 'string', 'C1', 'Immediately', { maxLen: 300, nullable: true }),
  support_hours_text: r('company', 'string', 'C1', 'Immediately', { maxLen: 120, nullable: true }),
  live_chat_provider: r('company', 'string', 'C2', 'Next page load', { enum: ['tawk', 'crisp', 'none'], superOnly: true }),
  live_chat_enabled: r('company', 'boolean', 'C1', 'Next page load'),
  public_payout_history_enabled: r('company', 'boolean', 'C2', 'Immediately'),
  public_payout_history_limit: r('company', 'integer', 'C1', 'Immediately', { min: 1, max: 200 }),

  withdrawals_paused: r('incident', 'boolean', 'C1', 'Immediately'),
  deposits_paused: r('incident', 'boolean', 'C1', 'Immediately'),
  maintenance_mode: r('incident', 'boolean', 'C2', 'Immediately', { superOnly: true }),
  banner_text: r('incident', 'string', 'C1', 'Immediately', { maxLen: 200, nullable: true }),
};

export const GROUP_ORDER = ['incident', 'jobs', 'review', 'moderation', 'accounts', 'kyc', 'deposits', 'withdrawals', 'fx', 'referral', 'uploads', 'company', 'other'];
export const GROUP_LABEL: Record<string, string> = {
  incident: 'Incident switches', jobs: 'Jobs and slots', review: 'Review and disputes', moderation: 'Job moderation', accounts: 'Accounts and sign-in',
  kyc: 'KYC', deposits: 'Deposits', withdrawals: 'Withdrawals and payouts', fx: 'FX', referral: 'Referral', uploads: 'Uploads and retention', company: 'Site and company', other: 'Other',
};

/** Returns the parsed value or an error message. */
export function validateSetting(key: string, rule: SettingRule | undefined, value: unknown, current: Map<string, unknown>): { ok: true; value: unknown } | { ok: false; message: string; allowed?: unknown } {
  const t = rule?.type;
  if (value === null) return rule?.nullable ? { ok: true, value: null } : { ok: false, message: 'This setting needs a value.' };
  if (t === 'boolean') return typeof value === 'boolean' ? { ok: true, value } : { ok: false, message: 'Choose on or off.' };
  if (t === 'number' || t === 'integer') {
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, message: 'Enter a number.' };
    if (t === 'integer' && !Number.isInteger(n)) return { ok: false, message: 'Enter a whole number.' };
    if (rule?.dp !== undefined && Math.round(n * 10 ** rule.dp) / 10 ** rule.dp !== n) return { ok: false, message: `Use up to ${rule.dp} decimals.` };
    if (rule?.min !== undefined && n < rule.min) return { ok: false, message: `The minimum is ${rule.min}.`, allowed: { min: rule.min, max: rule.max } };
    if (rule?.max !== undefined && n > rule.max) return { ok: false, message: `The maximum is ${rule.max}.`, allowed: { min: rule.min, max: rule.max } };
    const num = (k: string) => Number(current.get(k));
    if (key === 'reward_min_usd' && n > num('reward_max_usd')) return { ok: false, message: 'Must not exceed the maximum reward.' };
    if (key === 'reward_max_usd' && n < num('reward_min_usd')) return { ok: false, message: 'Must not be below the minimum reward.' };
    if (key === 'slots_min' && n > num('slots_max')) return { ok: false, message: 'Must not exceed the maximum slots.' };
    if (key === 'slots_max' && n < num('slots_min')) return { ok: false, message: 'Must not be below the minimum slots.' };
    if (key === 'deposit_min_usd' && n > num('deposit_max_usd')) return { ok: false, message: 'Must not exceed the maximum deposit.' };
    if (key === 'deposit_max_usd' && (n < num('deposit_min_usd') || n > num('deposit_daily_max_usd'))) return { ok: false, message: 'Must be between the minimum and the daily maximum.' };
    if (key === 'withdrawal_daily_max_usd' && n > num('withdrawal_monthly_max_usd')) return { ok: false, message: 'Must not exceed the monthly maximum.' };
    if (key === 'referral_risk_flag_score' && n > num('referral_risk_block_score')) return { ok: false, message: 'Must not exceed the block score.' };
    return { ok: true, value: n };
  }
  if (t === 'string') {
    if (typeof value !== 'string') return { ok: false, message: 'Enter text.' };
    const s = value.trim();
    if (!s && rule?.nullable) return { ok: true, value: null };
    if (rule?.enum && !rule.enum.includes(s)) return { ok: false, message: 'That value isn’t allowed for this setting.', allowed: rule.enum };
    if (key === 'job_id_prefix' && !/^[A-Z]{2}-$/.test(s)) return { ok: false, message: 'Use two capital letters and a hyphen, like WJ-.' };
    if (rule?.maxLen && s.length > rule.maxLen) return { ok: false, message: `Keep it to ${rule.maxLen} characters.` };
    return { ok: true, value: s };
  }
  if (t === 'json' && rule?.list) {
    if (!Array.isArray(value)) return { ok: false, message: 'Enter a list.' };
    if (rule.list === 'str') {
      const items = value.map((v) => String(v).trim()).filter(Boolean);
      if (items.length > 500) return { ok: false, message: 'Up to 500 items.' };
      if (rule.maxLen && items.some((s) => s.length > rule.maxLen!)) return { ok: false, message: `Each item up to ${rule.maxLen} characters.` };
      if (rule.enum && items.some((s) => !rule.enum!.includes(s))) return { ok: false, message: 'Unknown value in the list.', allowed: rule.enum };
      if (rule.enum && !items.length) return { ok: false, message: 'Keep at least one.' };
      return { ok: true, value: [...new Set(items)] };
    }
    const nums = value.map(Number);
    if (nums.some((n) => !Number.isFinite(n) || (rule.list === 'int' && !Number.isInteger(n)))) return { ok: false, message: 'Enter numbers only.' };
    if (nums.some((n, i) => i > 0 && n <= nums[i - 1]!)) return { ok: false, message: 'List the values in ascending order.' };
    if (rule.min !== undefined && nums.some((n) => n < rule.min!)) return { ok: false, message: `Values from ${rule.min}.` };
    if (rule.max !== undefined && nums.some((n) => n > rule.max!)) return { ok: false, message: `Values up to ${rule.max}.` };
    if (key === 'deposit_presets_usd' && nums.length !== 4) return { ok: false, message: 'Exactly 4 amounts.' };
    if (key === 'min_approval_rate_options' && !nums.includes(0)) return { ok: false, message: 'Include 0.' };
    return { ok: true, value: nums };
  }
  return { ok: true, value };
}
