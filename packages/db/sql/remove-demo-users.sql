-- Remove demo users: deletes every user whose email ends in "@example.com" or ".example"
-- (the sample accounts loaded by demo-fixture.sql and the demo job seeds) and everything that
-- belongs to them. Real accounts are not touched.
--
-- Preview (changes nothing, lists who would go):
--   psql "$DATABASE_URL" -f packages/db/sql/remove-demo-users.sql
-- Delete:
--   psql "$DATABASE_URL" -v confirm=DELETE-DEMO-USERS -f packages/db/sql/remove-demo-users.sql
--
-- Runs in one transaction. It refuses (and changes nothing) if a demo user has money in the
-- ledger, jobs, submissions, deposits, withdrawals or disputes, because those rows are
-- append-only or shared with real users and must be handled by hand. Safe to run again.

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE demo_users ON COMMIT DROP AS
  SELECT id, public_id, full_name, email::text AS email
    FROM users
   WHERE email::text ~* '(@example\.com|\.example)$';

\echo 'Demo users matched:'
SELECT public_id, full_name, email FROM demo_users ORDER BY public_id;

\echo 'Users that stay:'
SELECT public_id, full_name, email::text AS email FROM users
 WHERE id NOT IN (SELECT id FROM demo_users) ORDER BY created_at;

\if :{?confirm}
\else
  \echo 'Preview only. Nothing was changed. Pass -v confirm=DELETE-DEMO-USERS to delete.'
  ROLLBACK;
  \quit
\endif
SELECT :'confirm' = 'DELETE-DEMO-USERS' AS confirmed \gset
\if :confirmed
\else
  \echo 'Refusing to run: confirm must be exactly DELETE-DEMO-USERS. Nothing was changed.'
  ROLLBACK;
  \quit
\endif

-- 0. Stop if a demo user is tied to money or work that cannot simply be deleted.
DO $$
DECLARE n bigint;
BEGIN
  SELECT (SELECT count(*) FROM jobs WHERE employer_user_id IN (SELECT id FROM demo_users))
       + (SELECT count(*) FROM submissions WHERE worker_user_id IN (SELECT id FROM demo_users) OR employer_user_id IN (SELECT id FROM demo_users))
       + (SELECT count(*) FROM slot_reservations WHERE worker_user_id IN (SELECT id FROM demo_users))
       + (SELECT count(*) FROM deposits WHERE employer_user_id IN (SELECT id FROM demo_users))
       + (SELECT count(*) FROM withdrawals WHERE user_id IN (SELECT id FROM demo_users))
       + (SELECT count(*) FROM disputes WHERE worker_user_id IN (SELECT id FROM demo_users) OR employer_user_id IN (SELECT id FROM demo_users))
       + (SELECT count(*) FROM referral_commissions WHERE referrer_user_id IN (SELECT id FROM demo_users) OR referred_user_id IN (SELECT id FROM demo_users))
       + (SELECT count(*) FROM ledger_entries WHERE account_id IN (SELECT id FROM wallet_accounts WHERE owner_user_id IN (SELECT id FROM demo_users)))
       + (SELECT count(*) FROM ledger_transactions WHERE created_by_user_id IN (SELECT id FROM demo_users))
       + (SELECT count(*) FROM audit_logs WHERE actor_user_id IN (SELECT id FROM demo_users))
    INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'Demo users have % jobs, submissions, money or audit rows. Nothing was changed.', n;
  END IF;
END $$;

-- 1. Rows that point at the demo users' restrictions, uploads and payout methods.
DELETE FROM appeals            WHERE user_id IN (SELECT id FROM demo_users);
DELETE FROM kyc_verifications  WHERE user_id IN (SELECT id FROM demo_users);
DELETE FROM withdrawal_quotes  WHERE user_id IN (SELECT id FROM demo_users);
DELETE FROM payout_methods     WHERE user_id IN (SELECT id FROM demo_users);
DELETE FROM referrals          WHERE referrer_user_id IN (SELECT id FROM demo_users) OR referred_user_id IN (SELECT id FROM demo_users);
UPDATE contact_messages  SET user_id = NULL WHERE user_id IN (SELECT id FROM demo_users);
DELETE FROM contact_messages   WHERE email::text ~* '(@example\.com|\.example)$';
UPDATE job_views         SET viewer_user_id = NULL WHERE viewer_user_id IN (SELECT id FROM demo_users);
UPDATE submission_events SET actor_user_id  = NULL WHERE actor_user_id  IN (SELECT id FROM demo_users);
UPDATE withdrawal_events SET actor_user_id  = NULL WHERE actor_user_id  IN (SELECT id FROM demo_users);
UPDATE submissions       SET decided_by_user_id = NULL WHERE decided_by_user_id IN (SELECT id FROM demo_users);

-- 2. Uploads and wallets (users and uploads point at each other).
UPDATE users SET avatar_upload_id = NULL WHERE id IN (SELECT id FROM demo_users);
UPDATE employer_profiles SET logo_upload_id = NULL WHERE user_id IN (SELECT id FROM demo_users);
DELETE FROM uploads         WHERE owner_user_id IN (SELECT id FROM demo_users);
DELETE FROM wallet_accounts WHERE owner_user_id IN (SELECT id FROM demo_users);

-- 3. The accounts. Profiles, sessions, notifications, OTPs, interests, restrictions and the
--    rest cascade.
DELETE FROM users WHERE id IN (SELECT id FROM demo_users);

\echo 'Removed. Users left:'
SELECT count(*) AS users FROM users;

COMMIT;
