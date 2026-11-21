-- Reset to launch: removes all demo and test data so real data can start from zero.
--
-- KEEPS  migration history; admin roles; ONE super admin (keep_admin); platform settings;
--        payout method config; exchange rates; categories and sub-categories; help topics and
--        articles; FAQs; legal pages; the platform's own wallet accounts (balances set to 0).
-- WIPES  every user and their profiles, wallets, sessions, payout methods, KYC and uploads;
--        all jobs, reservations, submissions and disputes; deposits, withdrawals and the
--        ledger; referrals; notifications; contact messages; reports; audit log; admin
--        sessions; every other admin account.
--
-- Uploaded files are not in the database. Empty the storage folders or buckets separately.
--
-- Usage. Take a backup first; this cannot be undone without one:
--   pg_dump -Fc "$DATABASE_URL" -f before-reset.dump
--   psql "$DATABASE_URL" -v confirm=WIPE-ALL-DATA -v keep_admin=<super admin email> -f packages/db/sql/reset-to-launch.sql
--
-- Runs in one transaction: if any step fails, nothing is changed. Safe to run again.

\set ON_ERROR_STOP on

\if :{?confirm}
\else
  \echo 'Refusing to run. Pass -v confirm=WIPE-ALL-DATA -v keep_admin=<super admin email>.'
  \quit
\endif
\if :{?keep_admin}
\else
  \echo 'Refusing to run. Pass -v keep_admin=<email of the super admin to keep>.'
  \quit
\endif
SELECT :'confirm' = 'WIPE-ALL-DATA' AS confirmed \gset
\if :confirmed
\else
  \echo 'Refusing to run: confirm must be exactly WIPE-ALL-DATA.'
  \quit
\endif

BEGIN;

SELECT set_config('reset.keep_admin', :'keep_admin', true) \g /dev/null

-- 0. The admin we keep must be an active super admin, or nobody could sign in afterwards.
DO $$
DECLARE keep uuid;
BEGIN
  SELECT a.id INTO keep
    FROM admin_users a
    JOIN admin_user_roles ur ON ur.admin_user_id = a.id
    JOIN admin_roles r ON r.id = ur.admin_role_id AND r.code = 'super_admin'
   WHERE lower(a.email::text) = lower(current_setting('reset.keep_admin')) AND a.status = 'active'
   LIMIT 1;
  IF keep IS NULL THEN
    RAISE EXCEPTION 'No active super admin with email "%". Nothing was changed.', current_setting('reset.keep_admin');
  END IF;
  PERFORM set_config('reset.keep_admin_id', keep::text, true);
END $$;

-- 1. Users' work, money, messages and logs. TRUNCATE does not fire the append-only guards on
--    ledger and audit rows, and it refuses (rolling everything back) if a kept table still
--    points at one of these tables.
TRUNCATE
  account_restrictions, admin_pending_actions, admin_sessions, appeals, audit_logs, auth_sessions,
  contact_messages, deposits, disputes, employer_profiles, idempotency_keys, job_proof_requirements,
  job_reports, job_steps, job_views, jobs, kyc_verifications, ledger_adjustment_requests,
  ledger_entries, ledger_transactions, notification_preferences, notifications, otp_challenges,
  password_history, payment_webhook_events, payout_methods, provider_settlement_lines,
  provider_statement_lines, reconciliation_items, reconciliation_runs, referral_commissions,
  referrals, slot_reservations, submission_attempts, submission_events, submission_proof_items,
  submissions, support_replies, trusted_devices, user_interests, withdrawal_batches,
  withdrawal_events, withdrawal_quotes, withdrawals, worker_profiles;

-- 2. Wallets: every user wallet goes. Platform wallets stay (payout configs point at them),
--    emptied to match the now-empty ledger.
DELETE FROM wallet_accounts WHERE owner_user_id IS NOT NULL;
UPDATE wallet_accounts SET balance_cached = 0, last_entry_at = NULL;

-- 3. Accounts and uploaded-file records (users and uploads point at each other).
UPDATE users SET avatar_upload_id = NULL WHERE avatar_upload_id IS NOT NULL;
DELETE FROM uploads;
DELETE FROM users;

-- 4. Admins: keep one super admin. Clear "last edited by" links to the admins being removed.
--    The updated_at triggers are paused for this so kept content keeps its real "last updated"
--    date (help articles show it publicly). Needs the table owner, which runs the migrations.
ALTER TABLE platform_settings     DISABLE TRIGGER platform_settings_set_updated_at;
ALTER TABLE payout_method_configs DISABLE TRIGGER payout_method_configs_set_updated_at;
ALTER TABLE help_articles         DISABLE TRIGGER help_articles_set_updated_at;
ALTER TABLE faqs                  DISABLE TRIGGER faqs_set_updated_at;
ALTER TABLE legal_pages           DISABLE TRIGGER legal_pages_set_updated_at;
UPDATE platform_settings     SET updated_by_admin_id   = NULL WHERE updated_by_admin_id   <> current_setting('reset.keep_admin_id')::uuid;
UPDATE payout_method_configs SET updated_by_admin_id   = NULL WHERE updated_by_admin_id   <> current_setting('reset.keep_admin_id')::uuid;
UPDATE exchange_rates        SET created_by_admin_id   = NULL WHERE created_by_admin_id   <> current_setting('reset.keep_admin_id')::uuid;
UPDATE help_articles         SET updated_by_admin_id   = NULL WHERE updated_by_admin_id   <> current_setting('reset.keep_admin_id')::uuid;
UPDATE faqs                  SET updated_by_admin_id   = NULL WHERE updated_by_admin_id   <> current_setting('reset.keep_admin_id')::uuid;
UPDATE legal_pages           SET published_by_admin_id = NULL WHERE published_by_admin_id <> current_setting('reset.keep_admin_id')::uuid;
ALTER TABLE platform_settings     ENABLE TRIGGER platform_settings_set_updated_at;
ALTER TABLE payout_method_configs ENABLE TRIGGER payout_method_configs_set_updated_at;
ALTER TABLE help_articles         ENABLE TRIGGER help_articles_set_updated_at;
ALTER TABLE faqs                  ENABLE TRIGGER faqs_set_updated_at;
ALTER TABLE legal_pages           ENABLE TRIGGER legal_pages_set_updated_at;
UPDATE admin_users           SET created_by_admin_id   = NULL WHERE created_by_admin_id   <> current_setting('reset.keep_admin_id')::uuid;
UPDATE admin_user_roles      SET granted_by_admin_id   = NULL WHERE granted_by_admin_id   <> current_setting('reset.keep_admin_id')::uuid;
DELETE FROM admin_users WHERE id <> current_setting('reset.keep_admin_id')::uuid; -- their role rows cascade

-- 5. What's left.
SELECT 'users' AS "table", count(*) AS "rows" FROM users
UNION ALL SELECT 'jobs', count(*) FROM jobs
UNION ALL SELECT 'submissions', count(*) FROM submissions
UNION ALL SELECT 'ledger_transactions', count(*) FROM ledger_transactions
UNION ALL SELECT 'wallet_accounts (platform)', count(*) FROM wallet_accounts
UNION ALL SELECT 'admin_users', count(*) FROM admin_users
UNION ALL SELECT 'categories', count(*) FROM categories
UNION ALL SELECT 'subcategories', count(*) FROM subcategories
UNION ALL SELECT 'platform_settings', count(*) FROM platform_settings
UNION ALL SELECT 'payout_method_configs', count(*) FROM payout_method_configs
UNION ALL SELECT 'exchange_rates', count(*) FROM exchange_rates
UNION ALL SELECT 'faqs', count(*) FROM faqs
UNION ALL SELECT 'help_articles', count(*) FROM help_articles
UNION ALL SELECT 'legal_pages', count(*) FROM legal_pages;

COMMIT;

\echo 'Done. Empty the upload storage too (local .storage folders or the S3 buckets).'
