-- =====================================================================
-- 24 Freelancing — reference data (idempotent; safe to re-run)
-- =====================================================================
BEGIN;

-- 1. Categories (C-09: 8 public + "Other" employer-only) ----------------
INSERT INTO categories (slug, name, sort_order, is_public) VALUES
  ('data-entry',      'Data entry',       1, true),
  ('surveys',         'Surveys',          2, true),
  ('website-testing', 'Website testing',  3, true),
  ('app-testing',     'App testing',      4, true),
  ('writing',         'Writing',          5, true),
  ('image-tagging',   'Image tagging',    6, true),
  ('social-media',    'Social media',     7, true),
  ('research',        'Research',         8, true),
  ('other',           'Other',           99, false)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, is_public = EXCLUDED.is_public;

-- 2. System wallet accounts (A-16) --------------------------------------
INSERT INTO wallet_accounts (owner_user_id, kind, system_code, allow_negative) VALUES
  (NULL, 'payout_clearing',  'payout_clearing',  true),
  (NULL, 'platform_revenue', 'platform_revenue', true),
  (NULL, 'referral_expense', 'referral_expense', true),
  (NULL, 'adjustments',      'adjustments',      true),
  (NULL, 'gateway_fees',     'gateway_fees',     true),
  (NULL, 'gateway_clearing', 'gateway_clearing:bkash_checkout', true),
  (NULL, 'gateway_clearing', 'gateway_clearing:nowpayments',    true),
  (NULL, 'gateway_clearing', 'gateway_clearing:sslcommerz',     true),
  (NULL, 'treasury', 'treasury:bkash_merchant',  true),
  (NULL, 'treasury', 'treasury:nagad_merchant',  true),
  (NULL, 'treasury', 'treasury:rocket_merchant', true),
  (NULL, 'treasury', 'treasury:usdt_hot_wallet', true),
  (NULL, 'treasury', 'treasury:bank_main',       true)
ON CONFLICT (system_code) DO NOTHING;

-- 3. Admin roles (Canonical §6; final permission keys from Doc 09 §4.3, NEW-09-13, v1.1 audit) --
INSERT INTO admin_roles (code, name, description, permissions) VALUES
  ('super_admin',   'Super admin',   'Full access, including admin accounts and platform settings.', ARRAY['*']),
  ('ops_admin',     'Operations admin', 'Users, jobs, submissions, disputes, reports, KYC and employer verification.',
     ARRAY['dashboard.read','users.*','appeals.*','kyc.*','employers.verify','jobs.*','submissions.read','disputes.*','reports.read','reports.handle','reports.operational','deposits.read_masked','deposits.read','withdrawals.read_masked','withdrawals.read','ledger.read','ledger.read_aggregate','referrals.read','referrals.read_aggregate','referrals.review','support.reply','content.write','broadcast.send','settings.read','settings.write','payout_configs.read','audit.read','audit.export']),
  ('finance_admin', 'Finance admin', 'Deposits, withdrawals, ledger, FX rates, payout configuration and financial reports.',
     ARRAY['dashboard.read','dashboard.money_read','users.read_masked','users.read','jobs.read','deposits.read_masked','deposits.read','deposits.write','deposits.approve','withdrawals.*','ledger.*','recon.*','fx.*','payout_configs.*','referrals.read','referrals.read_aggregate','referrals.review','referrals.reverse','support.reply','settings.read','reports.financial','reports.operational','audit.read']),
  ('moderator',     'Moderator',     'Job moderation, job reports and dispute review.',
     ARRAY['dashboard.read','users.read_masked','users.read','users.reveal','users.restrict','appeals.log','appeals.read','jobs.read','jobs.read_detail','jobs.moderate','submissions.*','disputes.*','reports.read','reports.handle','reports.operational','ledger.read','ledger.read_aggregate','referrals.read','referrals.read_aggregate','referrals.review','support.reply']),
  ('support_agent', 'Support agent', 'Contact messages and read-only account lookup.',
     ARRAY['dashboard.read','users.read_masked','users.read','users.reveal','appeals.log','kyc.read_status','jobs.read','jobs.read_detail','submissions.read','disputes.read','reports.read','deposits.read_masked','withdrawals.read_masked','ledger.read','ledger.read_aggregate','referrals.read','referrals.read_aggregate','support.reply']),
  ('analyst',       'Analyst',       'Read-only dashboards and reports.',
     ARRAY['dashboard.read','dashboard.money_read','users.read_masked','users.read','jobs.read','deposits.read_masked','withdrawals.read_masked','ledger.read_aggregate','recon.read','referrals.read_aggregate','audit.read','audit.export','reports.financial','reports.operational'])
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, permissions = EXCLUDED.permissions;

-- 4. Payout method configuration (D-03, D-14, D-25) ---------------------
INSERT INTO payout_method_configs
  (method_type, display_name, subtitle, account_label, account_regex, payout_currency,
   min_usd, max_per_request_usd, max_per_day_usd, fee_fixed_usd, fee_percent, quick_amounts_usd, eta_text,
   execution, treasury_system_code, enabled, sort_order) VALUES
  ('bkash',  'bKash',  'Mobile wallet',  'bKash personal number',  '^01[3-9][0-9]{8}$',   'BDT',   5.00, 500.00, 500.00, 0.00, 0, '[5.00,10.00]',  'Usually arrives within 24 hours', 'manual', 'treasury:bkash_merchant',  true, 1),
  ('nagad',  'Nagad',  'Mobile wallet',  'Nagad personal number',  '^01[3-9][0-9]{8}$',   'BDT',   5.00, 500.00, 500.00, 0.00, 0, '[5.00,10.00]',  'Usually arrives within 24 hours', 'manual', 'treasury:nagad_merchant',  true, 2),
  ('rocket', 'Rocket', 'Mobile wallet',  'Rocket account number', '^01[3-9][0-9]{8,9}$', 'BDT',   5.00, 500.00, 500.00, 0.00, 0, '[5.00,10.00]',  'Usually arrives within 24 hours', 'manual', 'treasury:rocket_merchant', true, 3),
  ('usdt_trc20', 'USDT', 'TRC20 · crypto', 'USDT TRC20 address',   '^T[1-9A-HJ-NP-Za-km-z]{33}$', 'USDT', 10.00, 500.00, 500.00, 1.00, 0, '[10.00,20.00]', 'Usually arrives within 24 hours', 'manual', 'treasury:usdt_hot_wallet', false, 4)  -- off by default [D-35]
ON CONFLICT (method_type) DO NOTHING;

-- 5. Exchange rates (D-04; placeholder 121.50 from Figma 41:753) --------
INSERT INTO exchange_rates (quote_currency, direction, rate, source, effective_from, note) VALUES
  ('BDT',  'payout',  121.500000, 'manual', '2026-01-01T00:00:00Z', 'Launch placeholder from Figma; finance replaces it daily (D-04).'),
  ('BDT',  'deposit', 121.500000, 'manual', '2026-01-01T00:00:00Z', 'Deposit rate for BDT rails (Doc 08 §5). Same placeholder.'),
  ('USDT', 'payout', 1.000000, 'manual', '2026-01-01T00:00:00Z', '1 USD = 1 USDT unless finance changes it (Canonical §5).')
ON CONFLICT (quote_currency, direction, effective_from) DO NOTHING;

-- 6. Platform settings --------------------------------------------------
INSERT INTO platform_settings (key, value, value_type, description, source_ref, is_public) VALUES
 -- Money and fees
 ('platform_fee_percent',          '0',      'number',  'Fee on employer jobs, percent. Launch value 0. Snapshotted on jobs.fee_percent at publish.', 'D-02', true),
 ('reward_min_usd',                '0.010',  'number',  'Minimum reward per task.', 'D-31', true),
 ('reward_max_usd',                '10.000', 'number',  'Maximum reward per task.', 'D-31', true),
 ('reward_step_usd',               '0.001',  'number',  'Reward input step.', 'D-31', true),
 ('slots_min',                     '1',      'integer', 'Minimum slots per job.', 'D-31', true),
 ('slots_max',                     '10000',  'integer', 'Maximum slots per job.', 'D-31', true),
 ('job_id_prefix',                 '"WJ-"',  'string',  'Prefix for new job public IDs. "TF-" is the alternative.', 'D-18', false),
 -- Deposits
 ('deposit_presets_usd',           '[10,25,50,100]', 'json', 'Add funds preset chips.', 'SCR-WAL-05', true),
 ('deposit_min_usd',               '10.00',  'number',  'Minimum deposit (smallest preset).', 'Doc 08 §5', true),
 ('deposit_max_usd',               '1000.00','number',  'Maximum single deposit.', 'Doc 08 §5', true),
 ('deposit_daily_max_usd',         '3000.00','number',  'Maximum per employer per rolling 24 h.', 'Doc 08 §5', false),
 ('card_new_customer_max_usd',     '200.00', 'number',  'Card limit per deposit for the first 30 days.', 'Doc 08 §5', false),
 ('deposit_expiry_minutes_card',   '30',     'integer', 'Card deposit expiry.', 'Doc 08 §5', false),
 ('deposit_expiry_minutes_mobile_wallet','30','integer', 'Mobile wallet deposit expiry.', 'Doc 08 §5', false),
 ('deposit_expiry_minutes_crypto', '60',     'integer', 'Crypto invoice expiry.', 'Doc 08 §5', false),
 ('deposit_refund_window_days',    '30',     'integer', 'Admin refund window for unused deposits.', 'D-15', false),
 ('deposit_methods_enabled',       '["mobile_wallet","card"]', 'json', 'Deposit tiles shown on Add funds. Crypto is off until written legal advice.', 'D-06, D-35', true),
 -- Slots, review, resubmission, disputes
 ('slot_hold_minutes',             '60',     'integer', 'Reservation hold after Start job.', 'A-17, D-08', true),
 ('review_window_default',   '72',     'integer', 'Default review window.', 'D-07', true),
 ('review_window_options_hours',   '[24,48,72]', 'json', 'Allowed review windows.', 'A-13, D-07', true),
 ('auto_approve_default',          'true',   'boolean', 'Auto-approve default on new jobs.', 'D-07', true),
 ('auto_approve_escalation_days',  '7',      'integer', 'Admin escalation this many days after the window if auto-approve is off.', 'A-22', false),
 ('review_ending_notice_hours',    '12',     'integer', '"Review window ending soon" notice lead time.', 'SCR-SET-02', false),
 ('resubmit_window_hours',         '24',     'integer', 'Time after a needs-fix decision, capped at the job end.', 'A-18, D-09', true),
 ('max_resubmissions',             '1',      'integer', 'Resubmissions per submission.', 'A-18, D-09', true),
 ('dispute_window_hours',          '72',     'integer', 'Time after a decision to open a dispute.', 'D-13', true),
 ('dispute_sla_hours',             '48',     'integer', 'Admin dispute SLA.', 'D-13', false),
 ('job_new_badge_minutes',         '60',     'integer', '"New" badge threshold.', 'A-19', true),
 ('open_for_days_options',         '[1,3,7,14,30]', 'json', '"Keep open for" options. Default 7.', 'A-13', true),
 ('min_approval_rate_options',     '[0,60,70,80,90,95]', 'json', '"Minimum approval rate" options. Default 80.', 'A-13', true),
 ('approval_rate_window_days',     '30',     'integer', 'Approval-rate window.', 'A-20', true),
 ('approval_rate_min_decisions',   '5',      'integer', 'Show "—" below this many decisions.', 'A-20', true),
 ('market_hint_window_days',       '30',     'integer', 'Market hint look-back.', 'A-24', false),
 ('market_hint_min_jobs',          '5',      'integer', 'Hide the hint below this many jobs.', 'A-24', false),
 ('phash_duplicate_distance',      '6',      'integer', 'pHash distance that flags duplicate_suspected.', 'A-26', false),
 -- Referral
 ('referral_enabled',              'true',   'boolean', 'Master switch for the referral program.', 'D-10', true),
 ('referral_task_rate',            '0.05',   'number',  'Commission on the friend''s approved task rewards.', 'D-10', true),
 ('referral_deposit_rate',         '0.05',   'number',  'Commission on the friend''s completed deposits.', 'D-10', true),
 ('referral_reminder_cooldown_hours', '168', 'integer', 'Minimum gap between "Send a reminder" uses per friend.', 'NEW-05-08', false),
 -- Withdrawals
 ('withdrawal_daily_max_usd',      '500.00', 'number',  'Per-user withdrawal total per rolling 24 h.', 'D-25', true),
 ('withdrawal_daily_count_max',    '3',      'integer', 'Per-user withdrawal requests per rolling 24 h.', 'D-25', false),
 ('withdrawal_monthly_max_usd',    '3000.00','number',  'Per-user withdrawal total per calendar month.', 'Doc 08 §6', false),
 ('payout_methods_max',            '5',      'integer', 'Saved payout methods per user.', 'Doc 08 §6', false),
 ('payout_method_cooldown_hours',  '24',     'integer', 'Wait after a method is added or edited.', 'Doc 08 §6', false),
 ('withdrawal_quote_ttl_seconds',  '600',    'integer', 'Withdrawal quote validity.', 'Doc 08 §6', false),
 ('payout_dual_approval_threshold_usd','100.00','number','Second finance approval at or above this amount.', 'Doc 08 §12', false),
 ('first_withdrawal_hold_hours',   '24',     'integer', 'Review hold on a user''s first withdrawal.', 'D-25', false),
 ('kyc_required_for_withdrawal',   'true',   'boolean', 'KYC gate before the first withdrawal.', 'A-05, D-11', true),
 ('kyc_review_sla_hours',          '24',     'integer', 'Manual KYC review target.', 'A-12', true),
 ('fx_auto_fetch_enabled',         'false',  'boolean', 'Automatic FX fetch. Launch: finance enters the rate.', 'D-04', false),
 ('fx_margin_percent',             '0',      'number',  'Margin applied when auto-fetch is on.', 'D-04', false),
 ('payout_execution_mode',         '"manual"', 'string','"manual" at launch; "api" in phase 2.', 'D-05', false),
 -- Auth and uploads
 ('otp_length',                    '6',      'integer', 'OTP digits.', 'SCR-AUTH-05', true),
 ('otp_ttl_minutes',               '10',     'integer', 'OTP expiry.', 'SCR-AUTH-05', true),
 ('otp_resend_seconds',            '60',     'integer', 'OTP resend cooldown.', 'SCR-AUTH-05', true),
 ('otp_max_attempts',              '5',      'integer', 'Wrong-code attempts before the challenge is invalidated.', 'NEW-05-08', false),
 ('password_min_length',           '8',      'integer', 'Password minimum length.', 'SCR-AUTH-04', true),
 ('access_token_ttl_minutes',      '15',     'integer', 'Access token lifetime.', 'Canonical §11', false),
 ('refresh_ttl_days_keep_signed_in','30',    'integer', 'Refresh lifetime with "Keep me signed in".', 'A-29', false),
 ('refresh_ttl_hours_session',     '12',     'integer', 'Refresh lifetime without it.', 'A-29', false),
 ('upload_image_max_bytes',        '5242880','integer', 'PNG or JPG, up to 5 MB.', 'SCR-WRK-05', true),
 ('upload_file_max_bytes',         '10485760','integer','File-upload proof limit.', 'NEW-05-08', true),
 -- Binding limits (Canonical §17)
 ('max_active_reservations_per_worker','3',  'integer', 'Active reservations a worker can hold at once.', 'Canonical §17', true),
 ('withdrawal_password_max_failures','5',    'integer', 'Wrong withdrawal passwords before the lock.', 'Canonical §17', false),
 ('withdrawal_lock_minutes',       '15',     'integer', 'Withdrawal lock length.', 'Canonical §17', false),
 ('login_max_failed_attempts',     '5',      'integer', 'Failed sign-ins before the lock.', 'Canonical §17', false),
 ('login_lock_minutes',            '15',     'integer', 'Sign-in lock length.', 'Canonical §17', false),
 ('otp_max_sends_per_hour',        '5',      'integer', 'OTP sends per destination per hour.', 'Canonical §17', false),
 ('referral_cookie_days',          '30',     'integer', 'Referral cookie lifetime.', 'Canonical §17', false),
 ('bulk_approve_max',              '100',    'integer', 'Maximum submissions in one bulk approve.', 'Canonical §17', true),
 -- Incident response (Doc 11 §10.6)
 ('banner_text',                   'null',   'string',  'Incident banner text. Null hides it.', 'Doc 11 §10.6', true),
 ('withdrawals_paused',            'false',  'boolean', 'Incident switch for withdrawals.', 'Doc 11 §10.6', true),
 ('deposits_paused',               'false',  'boolean', 'Incident switch for deposits.', 'Doc 11 §10.6', true),
 -- Retention
 ('proof_retention_days',          '180',    'integer', 'Proof files kept after the final decision.', 'D-27', false),
 ('kyc_retention_years',           '5',      'integer', 'KYC images kept after review.', 'D-27', false),
 ('notification_retention_days',   '90',     'integer', 'In-app notifications retention.', 'A-32', false),
 ('account_anonymise_after_days',  '30',     'integer', 'Delay between close and anonymisation.', 'NEW-05-08', false),
 -- Company and support
 ('support_hours_text',            'null',   'string',  'Support hours. The client supplies the text.', 'D-16', true),
 ('live_chat_provider',            '"tawk"', 'string',  'Live chat embed provider.', 'D-16', false),
 ('company_legal_name',            'null',   'string',  'Legal entity name. The client supplies it.', 'D-17', true),
 ('company_registered_address',    'null',   'string',  'Registered office. The client supplies it.', 'D-17', true),
 ('public_payout_history_enabled', 'true',   'boolean', 'Public "Recent payouts" page.', 'D-19', true),
 ('public_payout_history_limit',   '50',     'integer', 'Rows on the Recent payouts page.', 'D-19', true),
 ('job_moderation_mode',           '"post"', 'string',  '"post" (live at publish) or "pre".', 'D-12', false),
 -- Added in the v1.1 audit (Doc 04 §2.9, §16.6; Doc 07 §14.4; Doc 01 N-28)
 ('maintenance_mode', 'false', 'boolean', 'Shows the maintenance page; the API returns 503 MAINTENANCE except /healthz, webhooks and admin. FEATURE_MAINTENANCE_MODE (Doc 11) forces it on.', 'FR-PUB-021, G-17', true),
 ('live_chat_enabled', 'true', 'boolean', 'Shows the live chat widget and its triggers. FEATURE_LIVE_CHAT (Doc 11) can force it off.', 'D-16', true),
 ('kyc_max_attempts', '3', 'integer', 'KYC submissions allowed per user before KYC_ATTEMPTS_EXCEEDED.', 'Doc 07 §14.4', false),
 ('reset_token_ttl_minutes', '15', 'integer', 'Password reset token lifetime.', 'Doc 07 §14.4', false),
 ('slot_expiry_warning_minutes', '10', 'integer', 'Warn the worker this long before a slot hold ends.', 'Doc 07 §14.4', false),
 ('unverified_account_purge_days', '7', 'integer', 'Delete accounts that never verified a contact after this many days.', 'Doc 07 §14.4', false),
 ('otp_max_sends_per_day', '10', 'integer', 'OTP sends per destination per day.', 'Canonical §17', false),
 ('otp_max_sends_per_ip_per_day', '20', 'integer', 'OTP sends per IP per day.', 'Canonical §17', false),
 ('trusted_device_days', '180', 'integer', 'Days a device skips the new-device OTP (trusted_devices).', 'FR-AUTH-006', false),
 ('referral_risk_flag_score', '30', 'integer', 'Risk score that puts a referral in the Flagged tab.', 'Doc 08 §9.5', false),
 ('referral_risk_block_score', '60', 'integer', 'Risk score that blocks the referral commission.', 'Doc 08 §9.5', false),
 ('referral_recheck_days', '30', 'integer', 'Days during which referral risk is re-scored.', 'Doc 08 §9.5', false),
 ('moderation_blocklist_terms', '["casino", "betting", "adult content"]', 'json', 'Terms that block a job at publish (BR-092). Seed list; moderation team edits it.', 'D-12, Doc 04 §16.6', false),
 ('moderation_blocklist_domains', '[]', 'json', 'Hostnames that block a job link at publish.', 'D-12, Doc 04 §16.6', false),
 ('moderation_watchlist_terms', '["password", "OTP", "NID", "card number"]', 'json', 'Terms that flag a live job for review (jobs.moderation_flags).', 'D-12, Doc 04 §16.6', false),
 ('url_shortener_domains', '["bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "cutt.ly"]', 'json', 'Link shorteners that flag a job link.', 'D-12, Doc 04 §16.6', false)
ON CONFLICT (key) DO NOTHING;

-- 7. Help topics (Figma 23:1389; article counts are computed) -----------
INSERT INTO help_topics (slug, title, description, contact_topic, sort_order) VALUES
 ('getting-started',  'Getting started',        'Create an account, choose earn or hire, set up your profile.', 'getting_started', 1),
 ('tasks-proof',      'Tasks & proof',          'Starting jobs, submitting proof, rejections and resubmitting.', 'tasks_proof', 2),
 ('payments-withdrawals','Payments & withdrawals','Balance, payout methods, minimums, fees and timing.', 'payments_withdrawals', 3),
 ('employers',        'For employers',          'Posting jobs, budgets, reviewing and refunds.', 'employers', 4),
 ('account-security', 'Account & security',     'Verification, passwords, suspicious activity, bans and appeals.', 'account_security', 5),
 ('referral',         'Referral program',       'Invite links, the 5% commission and eligibility.', 'referral', 6)
ON CONFLICT (slug) DO NOTHING;

-- 8. FAQ questions (Figma 19:876, 23:1389). Only answers written in Figma are published; G-14 covers the rest.
INSERT INTO faqs (question, answer_md, placements, sort_order, is_published)
SELECT v.q, v.a, v.p, v.s, length(v.a) > 0 FROM (VALUES
 ('How much can I earn?', 'Each job shows its reward before you start. What you earn depends on how many tasks you complete and how many are approved — careful work gets approved more often.', ARRAY['home'], 1),
 ('When do I get paid?', '', ARRAY['home'], 2),
 ('What happens if my task is rejected?', '', ARRAY['home'], 3),
 ('What is the minimum withdrawal?', '', ARRAY['home','help'], 4),
 ('How do I post a job, and what does it cost?', '', ARRAY['home'], 5),
 ('How does the referral commission work?', '', ARRAY['home'], 6),
 ('When will my withdrawal arrive?', 'Each payout method shows its usual timing before you confirm. You can follow every request in Wallet → History, from “Requested” to “Paid”.', ARRAY['help'], 1),
 ('Why was my task rejected?', '', ARRAY['help'], 2),
 ('Can I resubmit a rejected task?', '', ARRAY['help'], 3),
 ('Why do I need to verify my account?', '', ARRAY['help'], 5),
 ('How do employers get refunded for unused slots?', '', ARRAY['help'], 6),
 ('My account was restricted — how do I appeal?', '', ARRAY['help'], 7)
) AS v(q, a, p, s)
WHERE NOT EXISTS (SELECT 1 FROM faqs f WHERE f.question = v.q);

COMMIT;
