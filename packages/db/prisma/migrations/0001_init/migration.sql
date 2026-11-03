-- =====================================================================
-- 24 Freelancing — PostgreSQL 16 schema  (Doc 05 v1.0, 2026-11-02)
-- Run as a superuser/owner on an empty database:  psql -v ON_ERROR_STOP=1 -f schema.sql
-- =====================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_bytes, digest
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy search on titles

-- ---------------------------------------------------------------------
-- 0. Helper functions
-- ---------------------------------------------------------------------

-- UUID v7 (RFC 9562): 48-bit unix ms timestamp + version 7 + random. [A-02]
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  ts_ms  bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  b      bytea  := gen_random_bytes(16);
BEGIN
  b := set_byte(b, 0, ((ts_ms >> 40) & 255)::int);
  b := set_byte(b, 1, ((ts_ms >> 32) & 255)::int);
  b := set_byte(b, 2, ((ts_ms >> 24) & 255)::int);
  b := set_byte(b, 3, ((ts_ms >> 16) & 255)::int);
  b := set_byte(b, 4, ((ts_ms >> 8) & 255)::int);
  b := set_byte(b, 5, (ts_ms & 255)::int);
  b := set_byte(b, 6, ((get_byte(b, 6) & 15) | 112));   -- version 7
  b := set_byte(b, 8, ((get_byte(b, 8) & 63) | 128));   -- variant 10
  RETURN encode(b, 'hex')::uuid;
END $$;

-- Public reference formatter: prefix + zero-padded number, never truncates.
CREATE OR REPLACE FUNCTION fmt_ref(prefix text, n bigint, width int) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT prefix || CASE WHEN length(n::text) >= width THEN n::text
                        ELSE lpad(n::text, width, '0') END
$$;

-- updated_at maintenance
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- Append-only guard (ledger, audit, events)
CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

-- ---------------------------------------------------------------------
-- 1. Sequences for public references (Canonical §4, A-01)
-- ---------------------------------------------------------------------
CREATE SEQUENCE withdrawal_ref_seq  START 10001;   -- WD-#####
CREATE SEQUENCE ledger_tx_seq       START 10001;   -- TX-#####
CREATE SEQUENCE deposit_ref_seq     START 10001;   -- DP-#####
CREATE SEQUENCE submission_ref_seq  START 100001;  -- SB-######
CREATE SEQUENCE dispute_ref_seq     START 1;       -- DS-#####

-- ---------------------------------------------------------------------
-- 2. Enum types (Canonical §6, §7, §10)
-- ---------------------------------------------------------------------
CREATE TYPE user_status              AS ENUM ('active','restricted','suspended','closed');
CREATE TYPE active_mode              AS ENUM ('worker','employer');
CREATE TYPE job_status               AS ENUM ('draft','running','paused','completed','cancelled','suspended');
CREATE TYPE pause_reason             AS ENUM ('employer','low_deposit','admin');
CREATE TYPE close_reason             AS ENUM ('slots_filled','expired','employer_closed','admin_closed');
CREATE TYPE reservation_status       AS ENUM ('active','submitted','released','expired','cancelled');
CREATE TYPE submission_status        AS ENUM ('in_review','approved','needs_fix','rejected');
CREATE TYPE decision_source          AS ENUM ('employer','auto','admin');
CREATE TYPE rejection_reason_code    AS ENUM ('proof_incomplete','steps_not_followed','wrong_or_copied','link_not_accessible','other');
CREATE TYPE dispute_status           AS ENUM ('open','under_review','resolved_worker','resolved_employer','withdrawn');
CREATE TYPE withdrawal_status        AS ENUM ('requested','processing','paid','rejected','cancelled','failed');
CREATE TYPE deposit_status           AS ENUM ('initiated','pending','completed','failed','cancelled','expired','refunded');
CREATE TYPE ledger_tx_type           AS ENUM ('deposit','job_reserve','job_spend','job_release','task_reward','referral_commission',
                                              'withdrawal','withdrawal_reversal','platform_fee','deposit_refund','adjustment');
CREATE TYPE wallet_account_kind      AS ENUM ('worker_earnings','employer_available','employer_reserved',
                                              'payout_clearing','gateway_clearing','platform_revenue','referral_expense','adjustments','treasury','gateway_fees');
CREATE TYPE kyc_status               AS ENUM ('not_submitted','pending','verified','rejected');
CREATE TYPE kyc_document_type        AS ENUM ('national_id','passport','driving_licence');
CREATE TYPE referral_status          AS ENUM ('not_started','active','ineligible');
CREATE TYPE referral_commission_status AS ENUM ('pending','credited','reversed','ineligible');
CREATE TYPE referral_source_type     AS ENUM ('task','deposit');
CREATE TYPE notification_category    AS ENUM ('tasks','payments','referrals','system');
CREATE TYPE proof_type               AS ENUM ('screenshot','link','text','file');
CREATE TYPE time_per_task            AS ENUM ('about_2','about_5','about_10','about_15','about_30','about_60');
CREATE TYPE job_eligibility          AS ENUM ('all_verified','kyc_verified');
CREATE TYPE payout_method_type       AS ENUM ('bkash','nagad','rocket','usdt_trc20');
CREATE TYPE deposit_method           AS ENUM ('crypto','mobile_wallet','card');
CREATE TYPE interest_time            AS ENUM ('under_15','15_60','over_60');
CREATE TYPE interest_device          AS ENUM ('phone','desktop');
CREATE TYPE otp_purpose              AS ENUM ('signup','login','password_reset','new_device','first_withdrawal','contact_change');
CREATE TYPE otp_channel              AS ENUM ('sms','email');
CREATE TYPE contact_topic            AS ENUM ('getting_started','tasks_proof','payments_withdrawals','employers','account_security','referral');
CREATE TYPE upload_purpose           AS ENUM ('proof_screenshot','proof_file','kyc_document','kyc_selfie','avatar','employer_logo','cms_image');
CREATE TYPE upload_status            AS ENUM ('pending','uploaded','quarantined','deleted');
CREATE TYPE submission_event_type    AS ENUM ('job_opened','slot_reserved','steps_updated','draft_saved','slot_released','slot_expired',
                                              'reservation_cancelled','submitted','resubmitted','approved','auto_approved','needs_fix',
                                              'rejected','fix_window_expired','dispute_opened','dispute_resolved','escalated','paid_to_balance');
CREATE TYPE actor_type               AS ENUM ('user','admin','system');
CREATE TYPE job_report_reason        AS ENUM ('scam_or_payment','personal_data','fake_engagement','broken_materials','misleading','other');
CREATE TYPE kyc_rejection_reason     AS ENUM ('document_unreadable','name_mismatch','document_expired','selfie_mismatch','other');
CREATE TYPE employer_verification_status AS ENUM ('not_submitted','pending','verified','rejected');
CREATE TYPE job_report_status        AS ENUM ('open','reviewed','actioned','dismissed');
CREATE TYPE restriction_kind         AS ENUM ('restricted','suspended');
CREATE TYPE appeal_status            AS ENUM ('open','under_review','upheld','denied');
CREATE TYPE contact_message_status   AS ENUM ('new','in_progress','answered','closed','spam');
CREATE TYPE idempotency_status       AS ENUM ('in_progress','completed','failed');
CREATE TYPE admin_user_status        AS ENUM ('active','disabled');
CREATE TYPE payout_method_status     AS ENUM ('active','pending_review','disabled');
CREATE TYPE legal_page_slug          AS ENUM ('terms','privacy','refund','cancellation');
CREATE TYPE notification_pref_key    AS ENUM (
  -- worker (SCR-WRK-09 / SCR-SET-01 #notifications)
  'task_approved','submission_needs_fix','payout_updates','new_jobs_matching','referral_earnings','tips_product_news',
  -- employer (SCR-SET-02 #notifications)
  'new_submissions_digest','review_window_ending','low_deposit_balance','monthly_spending_report');

-- ---------------------------------------------------------------------
-- 3. Identity & profiles
-- ---------------------------------------------------------------------
CREATE TABLE categories (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug          varchar(40)  NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name          varchar(60)  NOT NULL,
  sort_order    smallint     NOT NULL DEFAULT 0,
  is_public     boolean      NOT NULL DEFAULT true,
  is_active     boolean      NOT NULL DEFAULT true,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE uploads (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  owner_user_id     uuid,                                   -- FK added after users
  owner_admin_id    uuid,                                   -- FK added after admin_users
  purpose           upload_purpose NOT NULL,
  status            upload_status  NOT NULL DEFAULT 'pending',
  storage_bucket    varchar(63)    NOT NULL,
  storage_key       varchar(512),                           -- NULL for KYC (encrypted copy only)
  storage_key_enc   bytea,                                  -- KYC only: AES-256-GCM envelope (KMS)
  original_filename varchar(255)   NOT NULL,
  mime_type         varchar(100)   NOT NULL,
  size_bytes        integer        NOT NULL CHECK (size_bytes > 0),
  sha256            bytea,
  phash             bigint,                                 -- 64-bit perceptual hash, images only [A-26]
  width_px          integer,
  height_px         integer,
  completed_at      timestamptz,
  delete_after      timestamptz,                            -- retention [D-27]
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uploads_owner_ck CHECK (num_nonnulls(owner_user_id, owner_admin_id) = 1),
  CONSTRAINT uploads_key_ck CHECK (
    (purpose IN ('kyc_document','kyc_selfie') AND storage_key IS NULL AND storage_key_enc IS NOT NULL)
    OR (purpose NOT IN ('kyc_document','kyc_selfie') AND storage_key IS NOT NULL)),
  CONSTRAINT uploads_image_size_ck CHECK (
    purpose <> 'proof_screenshot'
    OR (size_bytes <= 5242880 AND mime_type IN ('image/png','image/jpeg'))),
  CONSTRAINT uploads_kyc_size_ck CHECK (                  -- [A-38]
    purpose NOT IN ('kyc_document','kyc_selfie')
    OR (size_bytes <= 10485760 AND (mime_type IN ('image/png','image/jpeg')
        OR (purpose = 'kyc_document' AND mime_type = 'application/pdf')))),
  CONSTRAINT uploads_brand_size_ck CHECK (                -- [A-38]
    purpose NOT IN ('avatar','employer_logo')
    OR (size_bytes <= 2097152 AND mime_type IN ('image/png','image/jpeg','image/webp'))),
  CONSTRAINT uploads_cms_size_ck CHECK (
    purpose <> 'cms_image'
    OR (size_bytes <= 5242880 AND mime_type IN ('image/png','image/jpeg','image/webp'))),
  CONSTRAINT uploads_file_size_ck CHECK (purpose <> 'proof_file' OR size_bytes <= 10485760)
);

CREATE TABLE users (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  public_id              varchar(9)   NOT NULL UNIQUE CHECK (public_id ~ '^[1-9][0-9]{5,8}$'),
  full_name              varchar(80),                        -- NULL after anonymisation
  email                  citext       UNIQUE,
  email_verified_at      timestamptz,
  email_status           varchar(12)  NOT NULL DEFAULT 'ok' CHECK (email_status IN ('ok','bouncing','complained')),
  phone_e164             varchar(16)  UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified_at      timestamptz,
  password_hash          varchar(255),                       -- argon2id; NULL after anonymisation
  password_changed_at    timestamptz,
  country_code           char(2)      NOT NULL DEFAULT 'BD' CHECK (country_code ~ '^[A-Z]{2}$'),
  status                 user_status  NOT NULL DEFAULT 'active',
  active_mode            active_mode  NOT NULL DEFAULT 'worker',
  default_mode           active_mode  NOT NULL DEFAULT 'worker',
  signup_role            active_mode  NOT NULL DEFAULT 'worker',
  referral_code          varchar(12)  CHECK (referral_code ~ '^[A-Z0-9]{4,12}$'),
  avatar_upload_id       uuid REFERENCES uploads(id) ON DELETE SET NULL,
  two_step_enabled       boolean      NOT NULL DEFAULT false,
  withdrawal_password_required boolean NOT NULL DEFAULT true,
  email_digest_enabled   boolean      NOT NULL DEFAULT true,
  kyc_status             kyc_status   NOT NULL DEFAULT 'not_submitted',
  kyc_verified_at        timestamptz,
  onboarding_step        smallint     NOT NULL DEFAULT 1 CHECK (onboarding_step BETWEEN 1 AND 4),
  onboarding_completed_at timestamptz,
  terms_accepted_at      timestamptz  NOT NULL,
  terms_version          varchar(20)  NOT NULL,
  signup_ip              inet,
  last_login_at          timestamptz,
  failed_login_count     smallint     NOT NULL DEFAULT 0,
  locked_until           timestamptz,
  closed_at              timestamptz,
  anonymised_at          timestamptz,
  setup_card_dismissed_at timestamptz,                                   -- FR-ONB-006 (v1.1 audit)
  created_at             timestamptz  NOT NULL DEFAULT now(),
  updated_at             timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT users_contact_ck CHECK (anonymised_at IS NOT NULL OR email IS NOT NULL OR phone_e164 IS NOT NULL),
  CONSTRAINT users_closed_ck  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX users_referral_code_uq ON users (referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX users_status_idx ON users (status) WHERE status <> 'active';
CREATE INDEX users_full_name_trgm ON users USING gin (full_name gin_trgm_ops);
CREATE INDEX users_created_at_idx ON users (created_at);

ALTER TABLE uploads ADD CONSTRAINT uploads_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;
CREATE INDEX uploads_owner_idx ON uploads (owner_user_id, purpose);
CREATE INDEX uploads_phash_idx ON uploads (phash) WHERE phash IS NOT NULL;
CREATE INDEX uploads_delete_after_idx ON uploads (delete_after) WHERE deleted_at IS NULL AND delete_after IS NOT NULL;
CREATE INDEX uploads_pending_idx ON uploads (created_at) WHERE status = 'pending';

CREATE TABLE worker_profiles (
  user_id                 uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  interest_time           interest_time,
  interest_device         interest_device,
  approval_rate_pct       smallint CHECK (approval_rate_pct BETWEEN 0 AND 100),  -- NULL = "—" (<5 decisions) [A-20]
  approved_30d            integer NOT NULL DEFAULT 0 CHECK (approved_30d >= 0),
  rejected_30d            integer NOT NULL DEFAULT 0 CHECK (rejected_30d >= 0),
  approved_total          integer NOT NULL DEFAULT 0 CHECK (approved_total >= 0),
  stats_refreshed_at      timestamptz,
  first_withdrawal_at     timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX worker_profiles_rate_idx ON worker_profiles (approval_rate_pct);

CREATE TABLE employer_profiles (
  user_id                     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  business_name               varchar(80) NOT NULL,
  website_url                 varchar(255),
  industry                    varchar(60),
  billing_email               citext,
  about                       varchar(300),
  logo_upload_id              uuid REFERENCES uploads(id) ON DELETE SET NULL,
  verification_status         employer_verification_status NOT NULL DEFAULT 'not_submitted',   -- [A-14]
  verification_submitted_at   timestamptz,
  employer_verified_at        timestamptz,
  verification_note           varchar(500),
  default_review_window_hours smallint NOT NULL DEFAULT 72 CHECK (default_review_window_hours IN (24,48,72)),
  default_min_approval_rate   smallint NOT NULL DEFAULT 80 CHECK (default_min_approval_rate IN (0,60,70,80,90,95)),
  default_auto_approve        boolean  NOT NULL DEFAULT true,
  default_allow_resubmission  boolean  NOT NULL DEFAULT true,
  default_pause_on_low_deposit boolean NOT NULL DEFAULT true,
  approval_rate_pct           smallint CHECK (approval_rate_pct BETWEEN 0 AND 100),
  avg_review_seconds          integer  CHECK (avg_review_seconds >= 0),
  jobs_posted_count           integer  NOT NULL DEFAULT 0 CHECK (jobs_posted_count >= 0),
  stats_refreshed_at          timestamptz,
  receivable_usd              numeric(20,6) NOT NULL DEFAULT 0 CHECK (receivable_usd >= 0),   -- A-47, NEW-04-10
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_verified_ck CHECK ((verification_status = 'verified') = (employer_verified_at IS NOT NULL))
);
CREATE INDEX employer_profiles_verif_idx ON employer_profiles (verification_status, verification_submitted_at)
  WHERE verification_status = 'pending';
CREATE INDEX employer_profiles_name_trgm ON employer_profiles USING gin (business_name gin_trgm_ops);

CREATE TABLE user_interests (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category_id)
);
CREATE INDEX user_interests_category_idx ON user_interests (category_id);

CREATE TABLE otp_challenges (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id              uuid REFERENCES users(id) ON DELETE CASCADE,   -- NULL during sign-up before the user row exists
  purpose              otp_purpose NOT NULL,
  channel              otp_channel NOT NULL,
  destination          varchar(255) NOT NULL,                       -- normalised email or E.164 phone
  code_hash            varchar(255) NOT NULL,                       -- HMAC-SHA256(code, pepper)
  attempts             smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts         smallint NOT NULL DEFAULT 5,
  send_count           smallint NOT NULL DEFAULT 1 CHECK (send_count >= 1),
  expires_at           timestamptz NOT NULL,
  resend_available_at  timestamptz NOT NULL,
  consumed_at          timestamptz,
  invalidated_at       timestamptz,
  request_ip           inet,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_expiry_ck CHECK (expires_at > created_at)
);
CREATE INDEX otp_lookup_idx ON otp_challenges (destination, purpose, created_at DESC)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;
CREATE INDEX otp_user_idx ON otp_challenges (user_id, created_at DESC);
CREATE INDEX otp_created_idx ON otp_challenges (created_at);

CREATE TABLE auth_sessions (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash  bytea NOT NULL UNIQUE,                       -- SHA-256 of the current refresh token
  family_id           uuid  NOT NULL,                              -- rotation family (reuse detection)
  keep_signed_in      boolean NOT NULL DEFAULT false,
  device_label        varchar(120),                                -- "Chrome on Windows"
  user_agent          varchar(512),
  ip_address          inet,
  city                varchar(80),                                 -- "Dhaka" (GeoIP)
  last_active_at      timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  revoked_reason      varchar(40),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_active_idx ON auth_sessions (user_id, last_active_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX auth_sessions_family_idx ON auth_sessions (family_id);
CREATE INDEX auth_sessions_expires_idx ON auth_sessions (expires_at);

CREATE TABLE trusted_devices (                                            -- NEW-04-01 (v1.1 audit)
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash    bytea NOT NULL,                                          -- HMAC of fl_did
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  trusted_until  timestamptz NOT NULL,                                    -- + 180 days (FR-AUTH-006)
  last_ip        inet,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trusted_devices_user_device_key UNIQUE (user_id, device_hash)
);
CREATE INDEX trusted_devices_device_idx ON trusted_devices (device_hash);

CREATE TABLE password_history (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash  varchar(255) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_history_user_idx ON password_history (user_id, created_at DESC);

CREATE TABLE kyc_verifications (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  document_type          kyc_document_type NOT NULL,
  status                 kyc_status NOT NULL DEFAULT 'pending' CHECK (status <> 'not_submitted'),
  front_upload_id        uuid NOT NULL REFERENCES uploads(id) ON DELETE RESTRICT,
  back_upload_id         uuid REFERENCES uploads(id) ON DELETE RESTRICT,
  selfie_upload_id       uuid NOT NULL REFERENCES uploads(id) ON DELETE RESTRICT,
  document_number_enc    bytea NOT NULL,                     -- AES-256-GCM envelope (KMS)
  document_number_hash   bytea NOT NULL,                     -- HMAC for duplicate-identity detection
  document_last4         varchar(4) NOT NULL,
  name_on_document       varchar(80),
  submitted_at           timestamptz NOT NULL DEFAULT now(),
  review_due_at          timestamptz NOT NULL,               -- submitted_at + 24 h [A-12]
  reviewed_at            timestamptz,
  reviewed_by_admin_id   uuid,                               -- FK added after admin_users
  rejection_reason_code  kyc_rejection_reason,
  rejection_reason       varchar(300),
  verified_at            timestamptz,
  retain_until           timestamptz,                        -- D-27 (5 years)
  purged_at              timestamptz,
  date_of_birth_enc      bytea,                                          -- VR-066, encrypted (v1.1 audit)
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_back_ck     CHECK (document_type <> 'national_id' OR back_upload_id IS NOT NULL),
  CONSTRAINT kyc_verified_ck CHECK ((status = 'verified') = (verified_at IS NOT NULL)),
  CONSTRAINT kyc_rejected_ck CHECK (status <> 'rejected' OR rejection_reason_code IS NOT NULL)
);
CREATE UNIQUE INDEX kyc_one_pending_uq ON kyc_verifications (user_id) WHERE status = 'pending';
CREATE INDEX kyc_queue_idx ON kyc_verifications (review_due_at) WHERE status = 'pending';
CREATE INDEX kyc_user_idx ON kyc_verifications (user_id, submitted_at DESC);
CREATE INDEX kyc_doc_hash_idx ON kyc_verifications (document_number_hash);

-- ---------------------------------------------------------------------
-- 4. Admin identity (needed early for FKs)
-- ---------------------------------------------------------------------
CREATE TABLE admin_roles (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code         varchar(30) NOT NULL UNIQUE
               CHECK (code IN ('super_admin','ops_admin','finance_admin','moderator','support_agent','analyst')),
  name         varchar(60) NOT NULL,
  description  varchar(300) NOT NULL,
  permissions  text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_users (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  email              citext NOT NULL UNIQUE,
  full_name          varchar(80) NOT NULL,
  password_hash      varchar(255) NOT NULL,
  totp_secret_enc    bytea,                                     -- mandatory 2FA once enrolled
  totp_enrolled_at   timestamptz,
  must_change_password boolean NOT NULL DEFAULT false,
  status             admin_user_status NOT NULL DEFAULT 'active',
  last_login_at      timestamptz,
  failed_login_count smallint NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_user_roles (
  admin_user_id      uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  admin_role_id      uuid NOT NULL REFERENCES admin_roles(id) ON DELETE RESTRICT,
  granted_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  granted_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, admin_role_id)
);
CREATE INDEX admin_user_roles_role_idx ON admin_user_roles (admin_role_id);

ALTER TABLE uploads ADD CONSTRAINT uploads_owner_admin_fk FOREIGN KEY (owner_admin_id) REFERENCES admin_users(id) ON DELETE RESTRICT;
ALTER TABLE kyc_verifications ADD CONSTRAINT kyc_reviewed_by_fk FOREIGN KEY (reviewed_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 5. Jobs & submissions
-- ---------------------------------------------------------------------
CREATE TABLE jobs (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  public_id                varchar(12) NOT NULL UNIQUE CHECK (public_id ~ '^[A-Z]{2}-[0-9]{5,7}$'),
  employer_user_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category_id              uuid REFERENCES categories(id) ON DELETE RESTRICT,     -- NULL allowed in draft
  title                    varchar(80) NOT NULL CHECK (length(btrim(title)) >= 10),
  time_per_task            time_per_task NOT NULL DEFAULT 'about_5',
  est_minutes              smallint NOT NULL DEFAULT 5 CHECK (est_minutes IN (2,5,10,15,30,60)),
  display_minutes          smallint NOT NULL DEFAULT 5 CHECK (display_minutes BETWEEN 1 AND 600),
  open_for_days            smallint NOT NULL DEFAULT 7 CHECK (open_for_days IN (1,3,7,14,30)),
  eligibility              job_eligibility NOT NULL DEFAULT 'all_verified',
  min_approval_rate        smallint NOT NULL DEFAULT 80 CHECK (min_approval_rate IN (0,60,70,80,90,95)),
  task_link_url            varchar(2048),
  proof_instructions       varchar(300),
  proof_types              proof_type[] NOT NULL DEFAULT '{}',                    -- denormalised from job_proof_requirements
  rules                    jsonb,                                                 -- {"allowed":[...],"not_allowed":[...]}; NULL = platform defaults
  reward_usd            numeric(20,6) CHECK (reward_usd BETWEEN 0.010 AND 10.000 AND reward_usd = round(reward_usd, 3)),
  slots_total              integer CHECK (slots_total BETWEEN 1 AND 10000),
  platform_fee_percent     numeric(7,4) NOT NULL DEFAULT 0 CHECK (platform_fee_percent >= 0 AND platform_fee_percent < 100),
  fee_per_task_usd             numeric(20,6) NOT NULL DEFAULT 0 CHECK (fee_per_task_usd >= 0),
  review_window_hours      smallint NOT NULL DEFAULT 72 CHECK (review_window_hours IN (24,48,72)),
  submissions_per_worker   smallint NOT NULL DEFAULT 1 CHECK (submissions_per_worker = 1),
  allow_resubmission       boolean NOT NULL DEFAULT true,
  auto_approve             boolean NOT NULL DEFAULT true,
  pause_on_low_deposit     boolean NOT NULL DEFAULT true,
  status                   job_status NOT NULL DEFAULT 'draft',
  pause_reason             pause_reason,
  close_reason             close_reason,
  wizard_step              smallint NOT NULL DEFAULT 1 CHECK (wizard_step BETWEEN 1 AND 4),
  posting_rules_accepted_at timestamptz,
  published_at             timestamptz,
  ends_at                  timestamptz,
  paused_at                timestamptz,
  closed_at                timestamptz,
  suspended_at             timestamptz,
  suspended_by_admin_id    uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  suspension_reason        varchar(300),
  first_submission_at      timestamptz,                                           -- edit lock [A-23]
  count_active_reservations integer NOT NULL DEFAULT 0 CHECK (count_active_reservations >= 0),
  count_in_review          integer NOT NULL DEFAULT 0 CHECK (count_in_review >= 0),
  count_needs_fix          integer NOT NULL DEFAULT 0 CHECK (count_needs_fix >= 0),
  count_approved           integer NOT NULL DEFAULT 0 CHECK (count_approved >= 0),
  count_rejected           integer NOT NULL DEFAULT 0 CHECK (count_rejected >= 0),
  count_views              integer NOT NULL DEFAULT 0 CHECK (count_views >= 0),
  count_starts             integer NOT NULL DEFAULT 0 CHECK (count_starts >= 0),
  slots_left               integer GENERATED ALWAYS AS (
                             COALESCE(slots_total, 0) - count_approved - count_in_review - count_needs_fix - count_active_reservations
                           ) STORED,
  spent_usd                numeric(20,6) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  reserve_outstanding_usd  numeric(20,6) NOT NULL DEFAULT 0 CHECK (reserve_outstanding_usd >= 0),
  avg_review_seconds       integer CHECK (avg_review_seconds >= 0),
  avg_completion_seconds   integer CHECK (avg_completion_seconds >= 0),
  duplicated_from_job_id   uuid REFERENCES jobs(id) ON DELETE SET NULL,
  search_tsv               tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, ''))) STORED,
  version                  integer NOT NULL DEFAULT 1,
  deleted_at               timestamptz,                                           -- soft delete: drafts only
  moderation_flags         jsonb,                                         -- NEW-04-07; NULL when clean
  moderation_flagged_at    timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_slots_left_ck   CHECK (slots_left >= 0),
  CONSTRAINT jobs_publish_ck      CHECK (status = 'draft' OR (
      category_id IS NOT NULL AND reward_usd IS NOT NULL AND slots_total IS NOT NULL
      AND published_at IS NOT NULL AND ends_at IS NOT NULL AND posting_rules_accepted_at IS NOT NULL
      AND cardinality(proof_types) >= 1)),
  CONSTRAINT jobs_pause_ck        CHECK ((status = 'paused') = (pause_reason IS NOT NULL)),
  CONSTRAINT jobs_close_ck        CHECK ((status IN ('completed','cancelled')) = (close_reason IS NOT NULL AND closed_at IS NOT NULL)),
  CONSTRAINT jobs_suspend_ck      CHECK (status <> 'suspended' OR suspended_at IS NOT NULL),
  CONSTRAINT jobs_delete_ck       CHECK (deleted_at IS NULL OR status = 'draft'),
  CONSTRAINT jobs_fee_ck          CHECK (reward_usd IS NULL OR fee_per_task_usd = round(reward_usd * platform_fee_percent / 100, 6))
);
CREATE INDEX jobs_board_idx       ON jobs (published_at DESC) WHERE status = 'running' AND deleted_at IS NULL;
CREATE INDEX jobs_board_cat_idx   ON jobs (category_id, published_at DESC) WHERE status = 'running';
CREATE INDEX jobs_board_reward_idx ON jobs (reward_usd DESC, published_at DESC) WHERE status = 'running';
CREATE INDEX jobs_board_time_idx  ON jobs (display_minutes, published_at DESC) WHERE status = 'running';
CREATE INDEX jobs_board_slots_idx ON jobs (slots_left DESC) WHERE status = 'running';
CREATE INDEX jobs_board_ends_idx  ON jobs (ends_at) WHERE status = 'running';
CREATE INDEX jobs_proof_types_gin ON jobs USING gin (proof_types);
CREATE INDEX jobs_search_gin      ON jobs USING gin (search_tsv);
CREATE INDEX jobs_title_trgm      ON jobs USING gin (title gin_trgm_ops);
CREATE INDEX jobs_employer_idx    ON jobs (employer_user_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX jobs_expiry_idx      ON jobs (ends_at) WHERE status IN ('running','paused');
CREATE INDEX jobs_market_idx      ON jobs (category_id, est_minutes, published_at) WHERE published_at IS NOT NULL;
CREATE INDEX jobs_moderation_flagged_idx ON jobs (moderation_flagged_at) WHERE moderation_flagged_at IS NOT NULL;

CREATE TABLE job_steps (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position    smallint NOT NULL CHECK (position BETWEEN 1 AND 10),
  body        varchar(300) NOT NULL CHECK (length(btrim(body)) >= 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_steps_position_uq UNIQUE (job_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE job_proof_requirements (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position    smallint NOT NULL CHECK (position BETWEEN 1 AND 10),
  proof_type  proof_type NOT NULL,
  title       varchar(80) NOT NULL,          -- "Share link to your copy of the sheet"
  field_label varchar(60),                   -- "Sheet share link" (worker form label)
  helper      varchar(200),                  -- "Anyone with the link must be able to view it."
  is_required boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_proof_position_uq UNIQUE (job_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX job_proof_type_idx ON job_proof_requirements (proof_type, job_id);

CREATE TABLE job_views (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  job_id           uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  viewer_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  viewer_key       varchar(64) NOT NULL,      -- 'u:<user uuid>' or 'a:<sha256(fl_did cookie)>'
  first_viewed_at  timestamptz NOT NULL DEFAULT now(),
  last_viewed_at   timestamptz NOT NULL DEFAULT now(),
  view_count       integer NOT NULL DEFAULT 1 CHECK (view_count >= 1),
  CONSTRAINT job_views_viewer_uq UNIQUE (job_id, viewer_key)
);
CREATE INDEX job_views_job_day_idx ON job_views (job_id, first_viewed_at);
CREATE INDEX job_views_user_idx ON job_views (viewer_user_id, job_id) WHERE viewer_user_id IS NOT NULL;

CREATE TABLE slot_reservations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  job_id          uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  worker_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status          reservation_status NOT NULL DEFAULT 'active',
  started_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  steps_checked   smallint[] NOT NULL DEFAULT '{}',
  draft           jsonb,                     -- autosaved proof draft (SCR-WRK-05 toast "Draft saved")
  draft_saved_at  timestamptz,
  submitted_at    timestamptz,
  released_at     timestamptz,
  expired_at      timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT res_expiry_ck CHECK (expires_at > started_at),
  CONSTRAINT res_state_ck CHECK (
       (status = 'active'    AND submitted_at IS NULL AND released_at IS NULL AND expired_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'submitted' AND submitted_at IS NOT NULL)
    OR (status = 'released'  AND released_at  IS NOT NULL)
    OR (status = 'expired'   AND expired_at   IS NOT NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX res_one_live_per_worker_uq ON slot_reservations (job_id, worker_user_id)
  WHERE status IN ('active','submitted');
CREATE INDEX res_expiry_sweep_idx ON slot_reservations (expires_at) WHERE status = 'active';
CREATE INDEX res_worker_idx ON slot_reservations (worker_user_id, started_at DESC);
CREATE INDEX res_job_idx ON slot_reservations (job_id, status);

CREATE TABLE submissions (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  public_ref             varchar(12) NOT NULL UNIQUE DEFAULT fmt_ref('SB-', nextval('submission_ref_seq'), 6)
                         CHECK (public_ref ~ '^SB-[0-9]{6,9}$'),
  job_id                 uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  reservation_id         uuid NOT NULL UNIQUE REFERENCES slot_reservations(id) ON DELETE RESTRICT,
  worker_user_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  employer_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status                 submission_status NOT NULL DEFAULT 'in_review',
  reward_usd          numeric(20,6) NOT NULL CHECK (reward_usd > 0),
  fee_usd                numeric(20,6) NOT NULL DEFAULT 0 CHECK (fee_usd >= 0),
  current_attempt_no     smallint NOT NULL DEFAULT 1 CHECK (current_attempt_no BETWEEN 1 AND 5),
  resubmission_count     smallint NOT NULL DEFAULT 0 CHECK (resubmission_count >= 0),
  first_submitted_at     timestamptz NOT NULL DEFAULT now(),
  last_submitted_at      timestamptz NOT NULL DEFAULT now(),
  review_due_at          timestamptz NOT NULL,
  decided_at             timestamptz,
  decision_source        decision_source,
  decided_by_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_by_admin_id    uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  rejection_reason_code  rejection_reason_code,
  rejection_reason_text  varchar(300),
  fix_allowed            boolean,
  resubmit_deadline      timestamptz,
  final_at               timestamptz,              -- time the outcome became final (approved, rejected, needs_fix lapsed)
  paid_ledger_tx_id      uuid,                     -- FK added after ledger_transactions
  auto_check             jsonb,                    -- {"link_ok":true,"screenshot_present":true,"duplicate_suspected":false} [A-25]
  duplicate_suspected    boolean NOT NULL DEFAULT false,
  escalated_at           timestamptz,              -- [A-22]
  dispute_open           boolean NOT NULL DEFAULT false,
  timers_paused_at       timestamptz,                                    -- UF-28 (v1.1 audit)
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sub_one_per_worker_uq UNIQUE (job_id, worker_user_id),
  CONSTRAINT sub_decision_ck CHECK (status = 'in_review' OR (decided_at IS NOT NULL AND decision_source IS NOT NULL)),
  CONSTRAINT sub_reject_ck   CHECK (status NOT IN ('needs_fix','rejected')
                                    OR (rejection_reason_code IS NOT NULL AND length(btrim(rejection_reason_text)) >= 10)),
  CONSTRAINT sub_fix_ck      CHECK (status <> 'needs_fix' OR (fix_allowed AND resubmit_deadline IS NOT NULL)),
  CONSTRAINT sub_paid_ck     CHECK (status <> 'approved' OR paid_ledger_tx_id IS NOT NULL),
  CONSTRAINT sub_self_ck     CHECK (worker_user_id <> employer_user_id)
);
CREATE INDEX sub_worker_list_idx   ON submissions (worker_user_id, status, last_submitted_at DESC);
CREATE INDEX sub_employer_queue_idx ON submissions (employer_user_id, status, last_submitted_at);
CREATE INDEX sub_job_queue_idx     ON submissions (job_id, status, last_submitted_at);
CREATE INDEX sub_auto_approve_idx  ON submissions (review_due_at) WHERE status = 'in_review';
CREATE INDEX sub_fix_expiry_idx    ON submissions (resubmit_deadline) WHERE status = 'needs_fix';
CREATE INDEX sub_worker_rate_idx   ON submissions (worker_user_id, decided_at) WHERE status <> 'in_review';
CREATE INDEX sub_employer_rate_idx ON submissions (employer_user_id, decided_at) WHERE status <> 'in_review';
CREATE INDEX sub_job_decided_idx   ON submissions (job_id, decided_at);

CREATE TABLE submission_attempts (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  submission_id          uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  attempt_no             smallint NOT NULL CHECK (attempt_no BETWEEN 1 AND 5),
  worker_note            varchar(300),             -- "Note to the employer (optional)"
  change_note            varchar(300),             -- "What did you change? (optional)" (attempt >= 2)
  attestation_accepted_at timestamptz NOT NULL,    -- "I did this work myself and followed every step"
  steps_checked          smallint[] NOT NULL DEFAULT '{}',
  submitted_at           timestamptz NOT NULL DEFAULT now(),
  decision               submission_status,        -- outcome of THIS attempt (NULL while in review)
  decided_at             timestamptz,
  rejection_reason_code  rejection_reason_code,
  rejection_reason_text  varchar(300),
  annotations            jsonb,                    -- employer markers e.g. "Rows 9–12 missing"
  auto_check             jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attempt_no_uq UNIQUE (submission_id, attempt_no),
  CONSTRAINT attempt_change_note_ck CHECK (attempt_no > 1 OR change_note IS NULL)
);

CREATE TABLE submission_proof_items (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  attempt_id              uuid NOT NULL REFERENCES submission_attempts(id) ON DELETE CASCADE,
  proof_requirement_id    uuid NOT NULL REFERENCES job_proof_requirements(id) ON DELETE RESTRICT,
  proof_type              proof_type NOT NULL,
  link_url                varchar(2048),
  text_value              varchar(2000),
  upload_id               uuid REFERENCES uploads(id) ON DELETE SET NULL,
  link_check_status       smallint,                -- HTTP status from the auto-check [A-25]
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proof_item_uq UNIQUE (attempt_id, proof_requirement_id),
  CONSTRAINT proof_item_value_ck CHECK (
       (proof_type = 'link' AND link_url IS NOT NULL)
    OR (proof_type = 'text' AND length(btrim(text_value)) >= 1)
    OR (proof_type IN ('screenshot','file')))     -- upload may be NULL only after retention purge
);
CREATE INDEX proof_items_upload_idx ON submission_proof_items (upload_id) WHERE upload_id IS NOT NULL;

CREATE TABLE submission_events (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  reservation_id   uuid NOT NULL REFERENCES slot_reservations(id) ON DELETE CASCADE,
  submission_id    uuid REFERENCES submissions(id) ON DELETE CASCADE,
  event_type       submission_event_type NOT NULL,
  actor_type       actor_type NOT NULL,
  actor_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_admin_id   uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  data             jsonb NOT NULL DEFAULT '{}',
  occurred_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sub_events_reservation_idx ON submission_events (reservation_id, occurred_at DESC);
CREATE INDEX sub_events_submission_idx  ON submission_events (submission_id, occurred_at DESC);

CREATE TABLE disputes (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  public_ref             varchar(12) NOT NULL UNIQUE DEFAULT fmt_ref('DS-', nextval('dispute_ref_seq'), 5)
                         CHECK (public_ref ~ '^DS-[0-9]{5,9}$'),
  submission_id          uuid NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE RESTRICT,   -- one per submission [D-13]
  worker_user_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  employer_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status                 dispute_status NOT NULL DEFAULT 'open',
  disputed_decision      submission_status NOT NULL CHECK (disputed_decision IN ('needs_fix','rejected')),
  worker_statement       varchar(1000) NOT NULL CHECK (length(btrim(worker_statement)) >= 20),
  evidence_upload_id     uuid REFERENCES uploads(id) ON DELETE SET NULL,
  evidence_upload_2_id   uuid REFERENCES uploads(id) ON DELETE SET NULL,
  evidence_upload_3_id   uuid REFERENCES uploads(id) ON DELETE SET NULL,
  opened_at              timestamptz NOT NULL DEFAULT now(),
  sla_due_at             timestamptz NOT NULL,              -- opened_at + 48 h [D-13]
  assigned_admin_id      uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  under_review_at        timestamptz,
  resolved_at            timestamptz,
  resolved_by_admin_id   uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  resolution_note        varchar(1000),
  withdrawn_at           timestamptz,
  payout_ledger_tx_id    uuid,                              -- FK added after ledger_transactions
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispute_resolved_ck CHECK (status NOT IN ('resolved_worker','resolved_employer')
                                        OR (resolved_at IS NOT NULL AND resolution_note IS NOT NULL)),
  CONSTRAINT dispute_withdrawn_ck CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL))
);
CREATE INDEX disputes_queue_idx ON disputes (status, sla_due_at) WHERE status IN ('open','under_review');
CREATE INDEX disputes_worker_idx ON disputes (worker_user_id, opened_at DESC);

CREATE TABLE job_reports (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  job_id               uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  reporter_user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason               job_report_reason NOT NULL,
  details              varchar(300),                                   -- VR-108
  status               job_report_status NOT NULL DEFAULT 'open',
  handled_by_admin_id  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  handled_at           timestamptz,
  resolution_note      varchar(500),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_reports_once_uq UNIQUE (job_id, reporter_user_id)
);
CREATE INDEX job_reports_queue_idx ON job_reports (status, created_at) WHERE status = 'open';
CREATE INDEX job_reports_job_idx ON job_reports (job_id);

-- ---------------------------------------------------------------------
-- 6. Wallet, ledger & payments
-- ---------------------------------------------------------------------
CREATE TABLE wallet_accounts (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  owner_user_id    uuid REFERENCES users(id) ON DELETE RESTRICT,
  kind             wallet_account_kind NOT NULL,
  system_code      varchar(60) UNIQUE,                     -- 'treasury:bkash_merchant', 'payout_clearing' …; NULL for user accounts
  currency         char(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  is_system        boolean GENERATED ALWAYS AS (owner_user_id IS NULL) STORED,
  balance_cached   numeric(20,6) NOT NULL DEFAULT 0,       -- user accounts only; system accounts stay 0 and are derived by SUM
  allow_negative   boolean NOT NULL DEFAULT false,         -- true only while an admin adjustment holds it below zero
  last_entry_at    timestamptz,
  version          bigint NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_owner_kind_ck CHECK (
       (owner_user_id IS NOT NULL AND system_code IS NULL AND kind IN ('worker_earnings','employer_available','employer_reserved'))
    OR (owner_user_id IS NULL AND system_code IS NOT NULL AND kind NOT IN ('worker_earnings','employer_available','employer_reserved'))),
  CONSTRAINT wa_non_negative_ck CHECK (balance_cached >= 0 OR allow_negative)
);
CREATE UNIQUE INDEX wa_user_kind_uq ON wallet_accounts (owner_user_id, kind) WHERE owner_user_id IS NOT NULL;
CREATE INDEX wa_system_kind_idx ON wallet_accounts (kind) WHERE owner_user_id IS NULL;

CREATE TABLE ledger_transactions (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  seq                   bigint NOT NULL UNIQUE DEFAULT nextval('ledger_tx_seq'),
  public_ref            varchar(12) GENERATED ALWAYS AS (fmt_ref('TX-', seq, 5)) STORED UNIQUE,
  type                  ledger_tx_type NOT NULL,
  operation_id          uuid NOT NULL,                     -- groups txs posted by one business action (e.g. approval)
  idempotency_key       varchar(120) NOT NULL UNIQUE,      -- e.g. 'submission:SB-204118:approve'
  job_id                uuid REFERENCES jobs(id) ON DELETE RESTRICT,
  submission_id         uuid REFERENCES submissions(id) ON DELETE RESTRICT,
  deposit_id            uuid,                              -- FK below
  withdrawal_id         uuid,                              -- FK below
  referral_commission_id uuid,                             -- FK below
  dispute_id            uuid REFERENCES disputes(id) ON DELETE RESTRICT,
  reverses_tx_id        uuid REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  created_by_actor      actor_type NOT NULL,
  created_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by_admin_id   uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  approved_by_admin_id  uuid REFERENCES admin_users(id) ON DELETE SET NULL,   -- four-eyes on large adjustments (Doc 08)
  reason_code           varchar(30) CHECK (reason_code IN ('correction','goodwill','fx_difference','referral_reversal','write_off','provider_settlement','other')),
  reason                varchar(300),                      -- mandatory for adjustment / deposit_refund
  description_params    jsonb NOT NULL DEFAULT '{}',       -- snapshot rendered into DESCRIPTION / DETAIL at read time (Doc 08 §4.3)
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ltx_reason_ck CHECK (type <> 'adjustment' OR (reason IS NOT NULL AND reason_code IS NOT NULL))
);
CREATE INDEX ltx_job_idx ON ledger_transactions (job_id, occurred_at) WHERE job_id IS NOT NULL;
CREATE INDEX ltx_type_posted_idx ON ledger_transactions (type, occurred_at);
CREATE INDEX ltx_operation_idx ON ledger_transactions (operation_id);
CREATE INDEX ltx_withdrawal_idx ON ledger_transactions (withdrawal_id) WHERE withdrawal_id IS NOT NULL;
CREATE INDEX ltx_deposit_idx ON ledger_transactions (deposit_id) WHERE deposit_id IS NOT NULL;

CREATE TABLE ledger_entries (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  transaction_id   uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  tx_seq           bigint NOT NULL,                        -- copy of ledger_transactions.seq (ordering)
  account_id       uuid NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
  display_type     ledger_tx_type NOT NULL,                -- the label the account owner sees (e.g. task_reward)
  amount           numeric(20,6) NOT NULL CHECK (amount <> 0),   -- signed: + increases the account
  balance_after    numeric(20,6),                          -- user accounts only; NULL for system accounts
  created_at       timestamptz NOT NULL DEFAULT now(),     -- copied from ledger_transactions.occurred_at
  CONSTRAINT le_tx_account_uq UNIQUE (transaction_id, account_id)
);
CREATE INDEX le_account_seq_idx ON ledger_entries (account_id, tx_seq DESC);
CREATE INDEX le_account_type_created_idx ON ledger_entries (account_id, display_type, created_at);
CREATE INDEX le_transaction_idx ON ledger_entries (transaction_id);

-- 6a. Ledger integrity triggers ------------------------------------------------
-- (1) Apply each entry to the account's cached balance under a row lock and stamp balance_after.
CREATE OR REPLACE FUNCTION ledger_entry_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  acc    wallet_accounts%ROWTYPE;
  tx     ledger_transactions%ROWTYPE;
BEGIN
  SELECT * INTO tx FROM ledger_transactions WHERE id = NEW.transaction_id;
  NEW.tx_seq     := tx.seq;
  NEW.created_at := tx.occurred_at;
  SELECT * INTO acc FROM wallet_accounts WHERE id = NEW.account_id;   -- no lock yet
  IF acc.is_system THEN
    NEW.balance_after := NULL;     -- system balances are derived by SUM: no hot row, no lock
    RETURN NEW;
  END IF;
  SELECT * INTO acc FROM wallet_accounts WHERE id = NEW.account_id FOR UPDATE;
  NEW.balance_after := acc.balance_cached + NEW.amount;
  -- A user account may only go (further) negative through an admin adjustment.
  IF NEW.balance_after < 0 AND NEW.amount < 0 AND tx.type <> 'adjustment' THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS: account % (%) would go to %', acc.id, acc.kind, NEW.balance_after
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE wallet_accounts
     SET balance_cached = NEW.balance_after,
         allow_negative = (NEW.balance_after < 0),
         last_entry_at  = NEW.created_at,
         version        = version + 1
   WHERE id = acc.id;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_entries_apply BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_apply();

-- (2) Every transaction balances to zero and has >= 2 entries (checked at COMMIT).
CREATE OR REPLACE FUNCTION ledger_tx_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE s numeric; n int;
BEGIN
  SELECT coalesce(sum(amount), 0), count(*) INTO s, n FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF s <> 0 OR n < 2 THEN
    RAISE EXCEPTION 'UNBALANCED_TRANSACTION: tx % sums to % over % entries', NEW.transaction_id, s, n
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_tx_balanced();

-- (3) Immutability.
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER ledger_transactions_immutable BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

ALTER TABLE submissions ADD CONSTRAINT sub_paid_tx_fk FOREIGN KEY (paid_ledger_tx_id) REFERENCES ledger_transactions(id) ON DELETE RESTRICT;
ALTER TABLE disputes ADD CONSTRAINT dispute_payout_tx_fk FOREIGN KEY (payout_ledger_tx_id) REFERENCES ledger_transactions(id) ON DELETE RESTRICT;

CREATE TABLE payout_method_configs (
  method_type          payout_method_type PRIMARY KEY,
  display_name         varchar(30) NOT NULL,              -- "bKash"
  subtitle             varchar(40) NOT NULL,              -- "Mobile wallet" / "TRC20 · crypto"
  account_label        varchar(60) NOT NULL,              -- "bKash personal number"
  account_regex        varchar(200) NOT NULL,
  payout_currency      char(4) NOT NULL CHECK (payout_currency IN ('BDT','USDT')),
  min_usd              numeric(20,6) NOT NULL CHECK (min_usd > 0),
  max_per_request_usd  numeric(20,6) NOT NULL CHECK (max_per_request_usd >= min_usd),
  max_per_day_usd      numeric(20,6) NOT NULL CHECK (max_per_day_usd >= max_per_request_usd),
  fee_fixed_usd        numeric(20,6) NOT NULL DEFAULT 0 CHECK (fee_fixed_usd >= 0),
  fee_percent          numeric(7,4)  NOT NULL DEFAULT 0 CHECK (fee_percent >= 0 AND fee_percent < 100),
  quick_amounts_usd    jsonb NOT NULL DEFAULT '[]',       -- withdraw chips
  eta_text             varchar(80) NOT NULL,              -- "Usually arrives within 24 hours"
  execution            varchar(10) NOT NULL DEFAULT 'manual' CHECK (execution IN ('manual','api')),   -- D-05
  treasury_system_code varchar(60) NOT NULL REFERENCES wallet_accounts(system_code) ON DELETE RESTRICT,
  enabled              boolean NOT NULL DEFAULT true,
  sort_order           smallint NOT NULL DEFAULT 0,
  updated_by_admin_id  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pmc_fee_lt_min_ck CHECK (fee_fixed_usd < min_usd)
);

CREATE TABLE exchange_rates (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  base_currency       char(3) NOT NULL DEFAULT 'USD' CHECK (base_currency = 'USD'),
  quote_currency      char(4) NOT NULL CHECK (quote_currency IN ('BDT','USDT')),
  direction           varchar(8) NOT NULL DEFAULT 'payout' CHECK (direction IN ('payout','deposit')),
  rate                numeric(20,6) NOT NULL CHECK (rate > 0),
  source              varchar(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto')),
  margin_percent      numeric(7,4) NOT NULL DEFAULT 0,
  effective_from      timestamptz NOT NULL DEFAULT now(),
  created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  note                varchar(200),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fx_effective_uq UNIQUE (quote_currency, direction, effective_from)
);
CREATE INDEX fx_current_idx ON exchange_rates (quote_currency, direction, effective_from DESC);

CREATE TABLE payout_methods (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  method_type           payout_method_type NOT NULL REFERENCES payout_method_configs(method_type) ON DELETE RESTRICT,
  account_label         varchar(30),                       -- "Personal"
  account_encrypted     bytea NOT NULL,                    -- AES-256-GCM envelope (KMS) of phone number / TRC20 address
  key_id                varchar(120) NOT NULL,             -- KMS key version used for the envelope
  account_hash          bytea NOT NULL,                    -- HMAC-SHA256(normalised account, pepper)
  account_masked        varchar(40) NOT NULL,              -- "017••• ••569" / "T9x…k2a"
  account_last3         char(3) NOT NULL,                  -- "569"
  status                payout_method_status NOT NULL DEFAULT 'active',
  is_default            boolean NOT NULL DEFAULT false,
  verified_at           timestamptz,                       -- password/OTP confirmed
  usable_from           timestamptz NOT NULL DEFAULT now(), -- verified_at + payout_method_cooldown_hours
  last_used_at          timestamptz,
  deleted_at            timestamptz,                       -- soft delete (withdrawals keep a snapshot)
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pm_one_default_uq ON payout_methods (user_id) WHERE is_default AND deleted_at IS NULL;
CREATE UNIQUE INDEX pm_no_dup_uq ON payout_methods (user_id, method_type, account_hash) WHERE deleted_at IS NULL;
CREATE INDEX pm_account_hash_idx ON payout_methods (account_hash);      -- shared-destination fraud check
CREATE INDEX pm_user_idx ON payout_methods (user_id) WHERE deleted_at IS NULL;

CREATE TABLE withdrawals (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  public_ref            varchar(12) NOT NULL UNIQUE DEFAULT fmt_ref('WD-', nextval('withdrawal_ref_seq'), 5)
                        CHECK (public_ref ~ '^WD-[0-9]{5,9}$'),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payout_method_id      uuid NOT NULL REFERENCES payout_methods(id) ON DELETE RESTRICT,
  quote_id              uuid,                              -- FK added after withdrawal_quotes
  batch_id              uuid,                              -- FK added after withdrawal_batches
  method                payout_method_type NOT NULL,
  destination_masked    varchar(40) NOT NULL,              -- snapshot
  destination_encrypted bytea NOT NULL,                    -- snapshot (encrypted)
  key_id                varchar(120) NOT NULL,
  amount_usd            numeric(20,6) NOT NULL CHECK (amount_usd > 0 AND amount_usd = round(amount_usd, 2)),
  fee_usd               numeric(20,6) NOT NULL DEFAULT 0 CHECK (fee_usd >= 0),
  net_usd               numeric(20,6) GENERATED ALWAYS AS (amount_usd - fee_usd) STORED,
  payout_currency       char(4) NOT NULL CHECK (payout_currency IN ('BDT','USDT')),
  exchange_rate_id      uuid REFERENCES exchange_rates(id) ON DELETE RESTRICT,
  fx_rate               numeric(20,6) NOT NULL CHECK (fx_rate > 0),     -- locked at request
  payout_amount         numeric(20,6) NOT NULL CHECK (payout_amount > 0),
  status                withdrawal_status NOT NULL DEFAULT 'requested',
  requested_at          timestamptz NOT NULL DEFAULT now(),
  hold_until            timestamptz,                       -- first-withdrawal review hold [D-25]
  processing_at         timestamptz,
  paid_at               timestamptz,
  rejected_at           timestamptz,
  cancelled_at          timestamptz,
  failed_at             timestamptz,
  reject_reason_code    varchar(30) CHECK (reject_reason_code IN ('invalid_account','name_mismatch','kyc_issue','suspected_fraud','duplicate_request','other')),
  reject_reason_text    varchar(300),
  risk_flags            text[] NOT NULL DEFAULT '{}',
  provider_trx_id       varchar(120),                      -- bKash TrxID / TRON tx hash
  processed_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  request_ledger_tx_id  uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  settle_ledger_tx_id   uuid REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  reversal_ledger_tx_id uuid REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wd_net_ck       CHECK (amount_usd > fee_usd),
  CONSTRAINT wd_paid_ck      CHECK ((status = 'paid') = (paid_at IS NOT NULL AND settle_ledger_tx_id IS NOT NULL)),
  CONSTRAINT wd_reversed_ck  CHECK ((status IN ('rejected','cancelled','failed')) = (reversal_ledger_tx_id IS NOT NULL)),
  CONSTRAINT wd_rejected_ck  CHECK (status <> 'rejected' OR (rejected_at IS NOT NULL AND reject_reason_text IS NOT NULL)),
  CONSTRAINT wd_cancelled_ck CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CONSTRAINT wd_failed_ck    CHECK (status <> 'failed' OR failed_at IS NOT NULL)
);
CREATE INDEX wd_user_list_idx ON withdrawals (user_id, requested_at DESC);
CREATE INDEX wd_user_status_idx ON withdrawals (user_id, status);
CREATE INDEX wd_queue_idx ON withdrawals (status, requested_at) WHERE status IN ('requested','processing');
CREATE INDEX wd_paid_recent_idx ON withdrawals (paid_at DESC) WHERE status = 'paid';
CREATE UNIQUE INDEX wd_provider_trx_uq ON withdrawals (provider_trx_id) WHERE provider_trx_id IS NOT NULL;
CREATE INDEX wd_batch_idx ON withdrawals (batch_id) WHERE batch_id IS NOT NULL;

CREATE TABLE withdrawal_events (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  withdrawal_id   uuid NOT NULL REFERENCES withdrawals(id) ON DELETE CASCADE,
  from_status     withdrawal_status,
  to_status       withdrawal_status NOT NULL,
  actor_type      actor_type NOT NULL,
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_admin_id  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  note            varchar(300),
  data            jsonb NOT NULL DEFAULT '{}',
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wd_events_wd_idx ON withdrawal_events (withdrawal_id, occurred_at);

CREATE TABLE deposits (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  public_ref            varchar(12) NOT NULL UNIQUE DEFAULT fmt_ref('DP-', nextval('deposit_ref_seq'), 5)
                        CHECK (public_ref ~ '^DP-[0-9]{5,9}$'),
  employer_user_id      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  method                deposit_method NOT NULL,
  provider              varchar(40) NOT NULL,              -- 'nowpayments', 'bkash', 'sslcommerz' … [D-06]
  provider_payment_id   varchar(120),
  provider_asset        varchar(20),                       -- 'USDT', 'BTC', 'bKash', 'Visa' (description detail)
  amount_usd            numeric(20,6) NOT NULL CHECK (amount_usd > 0 AND amount_usd = round(amount_usd, 2)),
  amount_received_usd   numeric(20,6) CHECK (amount_received_usd >= 0),
  credited_amount_usd   numeric(20,6) CHECK (credited_amount_usd > 0),
  provider_fee          numeric(20,6),                     -- from settlement: "Shown by payment provider"
  fx_rate               numeric(20,6) CHECK (fx_rate > 0),      -- mobile wallet / card in BDT (Doc 08 §5)
  charge_amount_bdt     numeric(20,2) CHECK (charge_amount_bdt > 0),
  pay_currency          varchar(10),                       -- crypto: USDT, BTC …
  pay_amount            numeric(30,10),
  network               varchar(20),
  tx_hash               varchar(120),
  confirmations         integer CHECK (confirmations >= 0),
  needs_review          boolean NOT NULL DEFAULT false,
  status                deposit_status NOT NULL DEFAULT 'initiated',
  checkout_url          varchar(2048),
  expires_at            timestamptz,
  initiated_at          timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  failed_at             timestamptz,
  failure_reason        varchar(300),
  credit_ledger_tx_id   uuid REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  settled_at            timestamptz,
  settlement_id         uuid,                              -- provider_settlement_lines.settlement_id
  refunded_amount_usd   numeric(20,6) NOT NULL DEFAULT 0 CHECK (refunded_amount_usd >= 0),
  refunded_at           timestamptz,
  refund_ledger_tx_id   uuid REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dep_completed_ck CHECK (status NOT IN ('completed','refunded') OR (completed_at IS NOT NULL AND credit_ledger_tx_id IS NOT NULL AND credited_amount_usd IS NOT NULL)),
  CONSTRAINT dep_refund_ck CHECK (refunded_amount_usd <= coalesce(credited_amount_usd, amount_usd)),
  CONSTRAINT dep_refunded_ck CHECK (status <> 'refunded' OR refund_ledger_tx_id IS NOT NULL)
);
CREATE UNIQUE INDEX dep_provider_payment_uq ON deposits (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX dep_employer_idx ON deposits (employer_user_id, initiated_at DESC);
CREATE INDEX dep_open_idx ON deposits (expires_at) WHERE status IN ('initiated','pending');
CREATE INDEX dep_completed_idx ON deposits (completed_at) WHERE status IN ('completed','refunded');

ALTER TABLE ledger_transactions ADD CONSTRAINT ltx_deposit_fk FOREIGN KEY (deposit_id) REFERENCES deposits(id) ON DELETE RESTRICT;
-- Deferred: a withdrawal and its request transaction reference each other and are inserted in one DB transaction.
ALTER TABLE ledger_transactions ADD CONSTRAINT ltx_withdrawal_fk FOREIGN KEY (withdrawal_id) REFERENCES withdrawals(id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE payment_webhook_events (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  provider           varchar(40) NOT NULL,
  direction          varchar(10) NOT NULL CHECK (direction IN ('payments','payouts')),
  provider_event_id  varchar(160) NOT NULL,
  event_type         varchar(80),
  signature_valid    boolean NOT NULL,
  raw_body           bytea NOT NULL,
  payload            jsonb,
  headers            jsonb NOT NULL DEFAULT '{}',
  attempts           smallint NOT NULL DEFAULT 0,
  processing_result  varchar(20) CHECK (processing_result IN ('credited','ignored_duplicate','ignored_state','amount_mismatch','error')),
  error_message      varchar(1000),
  deposit_id         uuid REFERENCES deposits(id) ON DELETE SET NULL,
  withdrawal_id      uuid REFERENCES withdrawals(id) ON DELETE SET NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz,
  CONSTRAINT webhook_event_uq UNIQUE (provider, provider_event_id)
);
CREATE INDEX webhook_unprocessed_idx ON payment_webhook_events (received_at) WHERE processed_at IS NULL;
CREATE INDEX webhook_received_idx ON payment_webhook_events (received_at);

-- Payment operations tables requested by Doc 08 §15.3
CREATE TABLE withdrawal_quotes (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payout_method_id uuid REFERENCES payout_methods(id) ON DELETE CASCADE,
  method           payout_method_type NOT NULL,
  amount_usd       numeric(20,6) NOT NULL CHECK (amount_usd > 0),
  fee_usd          numeric(20,6) NOT NULL CHECK (fee_usd >= 0),
  payout_currency  char(4) NOT NULL CHECK (payout_currency IN ('BDT','USDT')),
  exchange_rate_id uuid NOT NULL REFERENCES exchange_rates(id) ON DELETE RESTRICT,
  fx_rate          numeric(20,6) NOT NULL CHECK (fx_rate > 0),
  receive_amount   numeric(20,6) NOT NULL CHECK (receive_amount > 0),
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wq_user_idx ON withdrawal_quotes (user_id, created_at DESC);
CREATE INDEX wq_expires_idx ON withdrawal_quotes (expires_at);
ALTER TABLE withdrawals ADD CONSTRAINT wd_quote_fk FOREIGN KEY (quote_id) REFERENCES withdrawal_quotes(id) ON DELETE SET NULL;

CREATE TABLE withdrawal_batches (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  method               payout_method_type NOT NULL,
  status               varchar(12) NOT NULL DEFAULT 'exported' CHECK (status IN ('exported','imported','closed')),
  row_count            integer NOT NULL CHECK (row_count >= 0),
  total_amount_usd     numeric(20,6) NOT NULL CHECK (total_amount_usd >= 0),
  export_sha256        bytea,
  created_by_admin_id  uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  imported_at          timestamptz,
  import_result        jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wb_method_idx ON withdrawal_batches (method, created_at DESC);
ALTER TABLE withdrawals ADD CONSTRAINT wd_batch_fk FOREIGN KEY (batch_id) REFERENCES withdrawal_batches(id) ON DELETE SET NULL;

CREATE TABLE ledger_adjustment_requests (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id            uuid NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
  amount                numeric(20,6) NOT NULL CHECK (amount <> 0),
  reason_code           varchar(30) NOT NULL CHECK (reason_code IN ('correction','goodwill','fx_difference','referral_reversal','write_off','provider_settlement','other')),
  internal_note         varchar(1000) NOT NULL,
  visible_text          varchar(120) NOT NULL,
  evidence_upload_id    uuid REFERENCES uploads(id) ON DELETE SET NULL,
  status                varchar(20) NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','declined','expired')),
  created_by_admin_id   uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  decided_by_admin_id   uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  decided_at            timestamptz,
  decision_note         varchar(500),
  ledger_tx_id          uuid REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  expires_at            timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lar_no_self_ck CHECK (decided_by_admin_id IS NULL OR decided_by_admin_id <> created_by_admin_id),
  CONSTRAINT lar_posted_ck  CHECK ((status = 'approved') = (ledger_tx_id IS NOT NULL))
);
CREATE INDEX lar_queue_idx ON ledger_adjustment_requests (status, expires_at) WHERE status = 'pending_approval';

CREATE TABLE provider_settlement_lines (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  settlement_id       uuid NOT NULL,                     -- one provider settlement batch or import
  provider            varchar(40) NOT NULL,
  provider_payment_id varchar(120) NOT NULL,
  gross_amount        numeric(20,6) NOT NULL,
  fee_amount          numeric(20,6) NOT NULL DEFAULT 0,
  net_amount          numeric(20,6) NOT NULL,
  currency            varchar(10) NOT NULL,
  settled_on          date NOT NULL,
  deposit_id          uuid REFERENCES deposits(id) ON DELETE SET NULL,
  match_status        varchar(20) NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','missing_credit','amount_differs')),
  ledger_tx_id        uuid REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  raw                 jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT psl_line_uq UNIQUE (provider, provider_payment_id)
);
CREATE INDEX psl_settlement_idx ON provider_settlement_lines (settlement_id);
CREATE INDEX psl_unmatched_idx ON provider_settlement_lines (provider, settled_on) WHERE match_status <> 'matched';

CREATE TABLE provider_statement_lines (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  rail              varchar(60) NOT NULL,              -- 'treasury:bkash_merchant' …
  provider_trx_id   varchar(120) NOT NULL,
  direction         varchar(3) NOT NULL CHECK (direction IN ('in','out')),
  amount            numeric(20,6) NOT NULL,
  currency          varchar(10) NOT NULL,
  counterparty      varchar(120),
  category          varchar(30),                       -- finance tag for non-withdrawal movements
  occurred_at       timestamptz NOT NULL,
  import_sha256     bytea,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pstl_line_uq UNIQUE (rail, provider_trx_id)
);
CREATE INDEX pstl_trx_idx ON provider_statement_lines (provider_trx_id);
CREATE INDEX pstl_occurred_idx ON provider_statement_lines (rail, occurred_at);

CREATE TABLE reconciliation_runs (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  job_name      varchar(40) NOT NULL,                  -- 'recon.ledger_integrity' …
  status        varchar(10) NOT NULL DEFAULT 'running' CHECK (status IN ('running','passed','failed','error')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  item_count    integer NOT NULL DEFAULT 0,
  summary       jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX rr_job_idx ON reconciliation_runs (job_name, started_at DESC);

CREATE TABLE reconciliation_items (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  run_id               uuid NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  check_code           varchar(10) NOT NULL,            -- 'L-5', 'P-1' …
  severity             varchar(10) NOT NULL CHECK (severity IN ('critical','high','medium','info')),
  entity_type          varchar(40),
  entity_ref           varchar(40),
  detail               jsonb NOT NULL DEFAULT '{}',
  resolved_at          timestamptz,
  resolved_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  resolution_note      varchar(500),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ri_run_idx ON reconciliation_items (run_id);
CREATE INDEX ri_open_idx ON reconciliation_items (severity, created_at) WHERE resolved_at IS NULL;

CREATE TABLE idempotency_keys (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  actor_type       actor_type NOT NULL,
  actor_id         uuid NOT NULL,                     -- users.id or admin_users.id
  key              varchar(80) NOT NULL,              -- client "Idempotency-Key" header (UUID)
  method           varchar(8) NOT NULL,
  path             varchar(300) NOT NULL,
  request_hash     bytea NOT NULL,                    -- SHA-256 of canonical body
  status           idempotency_status NOT NULL DEFAULT 'in_progress',
  response_code    smallint,
  response_body    jsonb,
  locked_until     timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  CONSTRAINT idem_key_uq UNIQUE (actor_type, actor_id, key)
);
CREATE INDEX idem_expires_idx ON idempotency_keys (expires_at);

-- ---------------------------------------------------------------------
-- 7. Referral & notifications
-- ---------------------------------------------------------------------
CREATE TABLE referrals (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  referrer_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  referred_user_id    uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  code_used           varchar(12) NOT NULL,
  attributed_via      varchar(10) NOT NULL CHECK (attributed_via IN ('link','code')),
  status              referral_status NOT NULL DEFAULT 'not_started',
  ineligible_reason   varchar(30) CHECK (ineligible_reason IN ('self_referral','duplicate_account','fraud','admin')),
  eligible_at         timestamptz,                    -- KYC, first task, deposit, or approved submission on own job [D-10]
  activated_at        timestamptz,                    -- first approved task or completed deposit [A-31]
  last_activity_at    timestamptz,
  reminder_count      smallint NOT NULL DEFAULT 0,
  last_reminded_at    timestamptz,
  risk_score          smallint CHECK (risk_score BETWEEN 0 AND 100),   -- NEW-04-11
  risk_flags          text[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ref_self_ck CHECK (referrer_user_id <> referred_user_id),
  CONSTRAINT ref_ineligible_ck CHECK ((status = 'ineligible') = (ineligible_reason IS NOT NULL)),
  CONSTRAINT ref_active_ck CHECK (status <> 'active' OR activated_at IS NOT NULL)
);
CREATE INDEX referrals_referrer_idx ON referrals (referrer_user_id, status, created_at DESC);

CREATE TABLE referral_commissions (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  referral_id         uuid NOT NULL REFERENCES referrals(id) ON DELETE RESTRICT,
  referrer_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  referred_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_type         referral_source_type NOT NULL,
  submission_id       uuid REFERENCES submissions(id) ON DELETE RESTRICT,
  deposit_id          uuid REFERENCES deposits(id) ON DELETE RESTRICT,
  base_amount         numeric(20,6) NOT NULL CHECK (base_amount > 0),
  rate                numeric(7,6)  NOT NULL CHECK (rate > 0 AND rate < 1),
  amount              numeric(20,6) NOT NULL CHECK (amount > 0),
  status              referral_commission_status NOT NULL DEFAULT 'pending',
  ledger_tx_id        uuid REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  reversal_ledger_tx_id uuid REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  credited_at         timestamptz,
  reversed_at         timestamptz,
  status_reason       varchar(200),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rc_source_ck CHECK (
       (source_type = 'task'    AND submission_id IS NOT NULL AND deposit_id IS NULL)
    OR (source_type = 'deposit' AND deposit_id IS NOT NULL AND submission_id IS NULL)),
  CONSTRAINT rc_amount_ck   CHECK (amount = round(base_amount * rate, 6)),
  CONSTRAINT rc_credited_ck CHECK (status NOT IN ('credited','reversed') OR (ledger_tx_id IS NOT NULL AND credited_at IS NOT NULL)),
  CONSTRAINT rc_reversed_ck CHECK (status <> 'reversed' OR reversal_ledger_tx_id IS NOT NULL)
);
CREATE UNIQUE INDEX rc_submission_uq ON referral_commissions (submission_id) WHERE submission_id IS NOT NULL;
CREATE UNIQUE INDEX rc_deposit_uq ON referral_commissions (deposit_id) WHERE deposit_id IS NOT NULL;
CREATE INDEX rc_referrer_idx ON referral_commissions (referrer_user_id, status, created_at DESC);
CREATE INDEX rc_referral_idx ON referral_commissions (referral_id, created_at DESC);

ALTER TABLE ledger_transactions ADD CONSTRAINT ltx_referral_commission_fk
  FOREIGN KEY (referral_commission_id) REFERENCES referral_commissions(id) ON DELETE RESTRICT;

CREATE TABLE notifications (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audience         active_mode NOT NULL,                 -- which notification page shows it
  category         notification_category NOT NULL,
  type             varchar(50) NOT NULL CHECK (type ~ '^[a-z][a-z0-9_]*$'),   -- catalogue in Doc 06/08
  title            varchar(120) NOT NULL,
  body             varchar(300) NOT NULL,
  link_path        varchar(300),
  data             jsonb NOT NULL DEFAULT '{}',
  is_mandatory     boolean NOT NULL DEFAULT false,       -- payout & security (cannot be muted)
  read_at          timestamptz,
  email_sent_at    timestamptz,
  dedupe_key       varchar(120),                         -- NEW-04-12
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL                  -- created_at + 90 days [A-32]
);
CREATE INDEX notif_list_idx ON notifications (user_id, audience, created_at DESC);
CREATE INDEX notif_unread_idx ON notifications (user_id, audience, category) WHERE read_at IS NULL;
CREATE INDEX notif_expiry_idx ON notifications (expires_at);
CREATE UNIQUE INDEX notif_dedupe_uq ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE notification_preferences (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pref_key       notification_pref_key NOT NULL,
  in_app_enabled boolean NOT NULL DEFAULT true,
  email_enabled  boolean NOT NULL DEFAULT true,
  is_locked      boolean NOT NULL DEFAULT false,         -- payout_updates: on + disabled [C-11]
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pref_key),
  CONSTRAINT np_locked_ck CHECK (NOT is_locked OR (in_app_enabled AND email_enabled))
);

-- ---------------------------------------------------------------------
-- 8. Content & support
-- ---------------------------------------------------------------------
CREATE TABLE help_topics (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug          varchar(60) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title         varchar(60) NOT NULL,
  description   varchar(160) NOT NULL,
  contact_topic contact_topic,
  sort_order    smallint NOT NULL DEFAULT 0,
  is_published  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE help_articles (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  topic_id             uuid NOT NULL REFERENCES help_topics(id) ON DELETE RESTRICT,
  slug                 varchar(120) NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title                varchar(160) NOT NULL,
  summary              varchar(300),
  body_md              text NOT NULL,
  is_popular           boolean NOT NULL DEFAULT false,      -- "Popular:" chips
  popular_label        varchar(40),
  sort_order           smallint NOT NULL DEFAULT 0,
  published_at         timestamptz,
  updated_by_admin_id  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  search_tsv           tsvector GENERATED ALWAYS AS (
                         setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
                         setweight(to_tsvector('english', coalesce(body_md,'')), 'B')) STORED,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT help_article_slug_uq UNIQUE (topic_id, slug)
);
CREATE INDEX help_articles_search_gin ON help_articles USING gin (search_tsv);
CREATE INDEX help_articles_topic_idx ON help_articles (topic_id, sort_order) WHERE published_at IS NOT NULL;

CREATE TABLE faqs (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  question             varchar(200) NOT NULL,
  answer_md            text NOT NULL,
  placements           text[] NOT NULL CHECK (placements <@ ARRAY['home','help']::text[] AND cardinality(placements) >= 1),
  sort_order           smallint NOT NULL DEFAULT 0,
  is_published         boolean NOT NULL DEFAULT false,
  updated_by_admin_id  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT faq_published_ck CHECK (NOT is_published OR length(btrim(answer_md)) > 0)
);
CREATE INDEX faqs_placement_gin ON faqs USING gin (placements);

CREATE TABLE legal_pages (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug                 legal_page_slug NOT NULL,
  version              varchar(20) NOT NULL,              -- '2026-11-01'
  title                varchar(80) NOT NULL,
  body_md              text NOT NULL,
  effective_at         timestamptz NOT NULL,
  is_current           boolean NOT NULL DEFAULT false,
  published_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_version_uq UNIQUE (slug, version)
);
CREATE UNIQUE INDEX legal_current_uq ON legal_pages (slug) WHERE is_current;

CREATE TABLE contact_messages (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  full_name           varchar(80) NOT NULL,
  email               citext NOT NULL,
  topic               contact_topic NOT NULL,
  account_public_id   varchar(9) CHECK (account_public_id ~ '^[0-9]{6,9}$'),
  message             varchar(300) NOT NULL CHECK (length(btrim(message)) >= 10),
  consent_at          timestamptz NOT NULL,
  status              contact_message_status NOT NULL DEFAULT 'new',
  assigned_admin_id   uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  answered_at         timestamptz,
  ip_address          inet,
  user_agent          varchar(512),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_queue_idx ON contact_messages (status, created_at) WHERE status IN ('new','in_progress');
CREATE INDEX contact_email_idx ON contact_messages (email);

-- ---------------------------------------------------------------------
-- 9. Admin, moderation & configuration
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  actor_type       actor_type NOT NULL,
  actor_admin_id   uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  actor_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action           varchar(80) NOT NULL,                  -- 'withdrawal.mark_paid', 'job.suspend', 'settings.update'
  entity_type      varchar(40) NOT NULL,
  entity_id        uuid,
  entity_ref       varchar(20),                           -- public ref for search (WD-90412)
  reason           varchar(500),
  before_data      jsonb,
  after_data       jsonb,
  ip_address       inet,
  user_agent       varchar(512),
  request_id       varchar(64),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_admin_idx ON audit_logs (actor_admin_id, created_at DESC);
CREATE INDEX audit_ref_idx ON audit_logs (entity_ref) WHERE entity_ref IS NOT NULL;
CREATE INDEX audit_created_idx ON audit_logs (created_at);
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TABLE platform_settings (
  key                  varchar(80) PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  value                jsonb NOT NULL,
  value_type           varchar(10) NOT NULL CHECK (value_type IN ('number','integer','boolean','string','json')),
  description          varchar(300) NOT NULL,
  source_ref           varchar(40) NOT NULL,              -- 'D-02', 'A-17' …
  is_public            boolean NOT NULL DEFAULT false,    -- exposed via GET /public/config
  updated_by_admin_id  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_restrictions (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                 restriction_kind NOT NULL,
  reason_code          varchar(40) NOT NULL,              -- 'fraud_suspected','duplicate_account','chargeback','policy_violation'
  internal_note        varchar(1000),
  public_message       varchar(300) NOT NULL,
  starts_at            timestamptz NOT NULL DEFAULT now(),
  ends_at              timestamptz,
  created_by_admin_id  uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  lifted_at            timestamptz,
  lifted_by_admin_id   uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restr_period_ck CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX restr_user_active_idx ON account_restrictions (user_id) WHERE lifted_at IS NULL;
CREATE INDEX restr_expiry_idx ON account_restrictions (ends_at) WHERE lifted_at IS NULL AND ends_at IS NOT NULL;

CREATE TABLE appeals (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restriction_id       uuid NOT NULL REFERENCES account_restrictions(id) ON DELETE CASCADE,
  message              varchar(1000) NOT NULL,
  evidence_upload_id   uuid REFERENCES uploads(id) ON DELETE SET NULL,
  status               appeal_status NOT NULL DEFAULT 'open',
  decided_by_admin_id  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  decision_note        varchar(500),
  decided_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appeal_decided_ck CHECK (status NOT IN ('upheld','denied') OR (decided_at IS NOT NULL AND decision_note IS NOT NULL))
);
CREATE UNIQUE INDEX appeal_one_open_uq ON appeals (restriction_id) WHERE status IN ('open','under_review');
CREATE INDEX appeal_queue_idx ON appeals (status, created_at) WHERE status IN ('open','under_review');

CREATE TABLE admin_sessions (                                             -- NEW-09-04 (v1.1 audit)
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  admin_user_id       uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  refresh_token_hash  bytea NOT NULL UNIQUE,
  family_id           uuid NOT NULL,
  ip_address          inet,
  user_agent          varchar(512),
  last_active_at      timestamptz NOT NULL DEFAULT now(),
  reauth_at           timestamptz,                                        -- TOTP re-auth (Doc 09 §22.2)
  expires_at          timestamptz NOT NULL,                               -- 12 h absolute
  revoked_at          timestamptz,
  revoked_reason      varchar(40),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_sessions_active_idx ON admin_sessions (admin_user_id, last_active_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX admin_sessions_family_idx ON admin_sessions (family_id);

CREATE TABLE admin_pending_actions (                                      -- dual control, Doc 09 §10 (v1.1 audit)
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  action               varchar(60) NOT NULL,                              -- e.g. withdrawal.mark_paid
  object_type          varchar(40) NOT NULL,
  object_id            uuid NOT NULL,
  payload              jsonb NOT NULL DEFAULT '{}',
  reason               varchar(500) NOT NULL,
  idempotency_key      varchar(100) NOT NULL,
  status               varchar(20) NOT NULL DEFAULT 'pending',
  created_by_admin_id  uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  decided_by_admin_id  uuid REFERENCES admin_users(id) ON DELETE RESTRICT,
  decided_at           timestamptz,
  decision_note        varchar(500),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_pending_status_ck CHECK (status IN ('pending','approved','declined','void')),
  CONSTRAINT admin_pending_maker_checker_ck CHECK (decided_by_admin_id IS NULL OR decided_by_admin_id <> created_by_admin_id),
  CONSTRAINT admin_pending_decided_ck CHECK ((status = 'pending') = (decided_at IS NULL)),
  CONSTRAINT admin_pending_declined_note_ck CHECK (status <> 'declined' OR decision_note IS NOT NULL)
);
CREATE UNIQUE INDEX admin_pending_one_open_uq ON admin_pending_actions (object_type, object_id) WHERE status = 'pending';
CREATE INDEX admin_pending_queue_idx ON admin_pending_actions (status, created_at) WHERE status = 'pending';

CREATE TABLE support_replies (                                            -- UF-33 (v1.1 audit)
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  contact_message_id  uuid NOT NULL REFERENCES contact_messages(id) ON DELETE CASCADE,
  admin_user_id       uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  body                text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  email_sent_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_replies_message_idx ON support_replies (contact_message_id, created_at);

-- ---------------------------------------------------------------------
-- 10. updated_at triggers
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
           WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                   t || '_set_updated_at', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 11. Reporting views
-- ---------------------------------------------------------------------
-- Employer wallet summary (SCR-WAL-05, topbar pill, SCR-EMP-01)
CREATE VIEW v_employer_balances AS
SELECT u.id AS user_id,
       coalesce(max(wa.balance_cached) FILTER (WHERE wa.kind = 'employer_available'), 0) AS available,
       coalesce(max(wa.balance_cached) FILTER (WHERE wa.kind = 'employer_reserved'), 0)  AS reserved,
       coalesce(sum(wa.balance_cached) FILTER (WHERE wa.kind IN ('employer_available','employer_reserved')), 0) AS deposit_total
FROM users u
LEFT JOIN wallet_accounts wa ON wa.owner_user_id = u.id
GROUP BY u.id;

-- System account balances are derived (no cached balance) — used by finance reports.
CREATE VIEW v_system_account_balances AS
SELECT wa.id, wa.kind, wa.system_code, coalesce(sum(le.amount), 0) AS balance
FROM wallet_accounts wa
LEFT JOIN ledger_entries le ON le.account_id = wa.id
WHERE wa.is_system
GROUP BY wa.id, wa.kind, wa.system_code;

COMMIT;
