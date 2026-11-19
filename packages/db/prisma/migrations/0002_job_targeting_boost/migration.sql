-- 0002: post-a-job location targeting, subcategories, job note and image, scheduled start, paid boost.
-- Client change request (Nov 2026): SRS §1 listed these as out of scope for 1.0.

-- Subcategories ----------------------------------------------------------
CREATE TABLE subcategories (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  category_id  uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  slug         varchar(60) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name         varchar(60) NOT NULL,
  sort_order   smallint NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subcategories_category_idx ON subcategories (category_id, sort_order);

-- Upload purpose for the optional job image ------------------------------
ALTER TYPE upload_purpose ADD VALUE IF NOT EXISTS 'job_thumbnail';

-- Job columns ------------------------------------------------------------
ALTER TABLE jobs
  ADD COLUMN subcategory_id      uuid REFERENCES subcategories(id) ON DELETE RESTRICT,
  ADD COLUMN target_zone         varchar(30) NOT NULL DEFAULT 'international',
  ADD COLUMN target_countries    text[] NOT NULL DEFAULT '{}',   -- empty = every country
  ADD COLUMN excluded_countries  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN note                varchar(300),
  ADD COLUMN thumbnail_upload_id uuid REFERENCES uploads(id) ON DELETE SET NULL,
  ADD COLUMN starts_at           timestamptz,                    -- null = live at publish
  ADD COLUMN boost_days          smallint NOT NULL DEFAULT 0 CHECK (boost_days BETWEEN 0 AND 30),
  ADD COLUMN boost_fee_usd       numeric(20,6) NOT NULL DEFAULT 0 CHECK (boost_fee_usd >= 0),
  ADD COLUMN boosted_until       timestamptz;

CREATE INDEX jobs_subcategory_idx ON jobs (subcategory_id);
CREATE INDEX jobs_boosted_until_idx ON jobs (boosted_until) WHERE boosted_until IS NOT NULL;
CREATE INDEX jobs_target_countries_gin ON jobs USING gin (target_countries);

-- Wizard now has five steps: Location, Category, Job information, Budget & settings, Review.
-- Old steps 2–4 move up by one (old step 1 "Basics" maps to the new step 1).
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_wizard_step_check;
UPDATE jobs SET wizard_step = wizard_step + 1 WHERE wizard_step >= 2;
ALTER TABLE jobs ADD CONSTRAINT jobs_wizard_step_check CHECK (wizard_step BETWEEN 1 AND 5);

-- Seed data (also run by seed-base.sql) -----------------------------------
-- Post-a-job options added with migration 0002 (location, subcategory, boost, schedule).
-- Idempotent: safe to run on every seed. Included by seed-base.sql and run by migration 0002.

-- Subcategories (wizard step 2). Slugs are global; names show as chips under the category.
INSERT INTO subcategories (category_id, slug, name, sort_order)
SELECT c.id, v.slug, v.name, v.sort
FROM (VALUES
  ('data-entry',      'data-entry-spreadsheet',   'Spreadsheet entry',     1),
  ('data-entry',      'data-entry-copy-paste',    'Copy & paste',          2),
  ('data-entry',      'data-entry-cleanup',       'Data cleanup',          3),
  ('data-entry',      'data-entry-forms',         'Form filling',          4),
  ('surveys',         'surveys-short',            'Short survey',          1),
  ('surveys',         'surveys-product-feedback', 'Product feedback',      2),
  ('surveys',         'surveys-opinion-poll',     'Opinion poll',          3),
  ('surveys',         'surveys-market-research',  'Market research',       4),
  ('website-testing', 'website-testing-signup',   'Sign-up flow',          1),
  ('website-testing', 'website-testing-checkout', 'Checkout flow',         2),
  ('website-testing', 'website-testing-bugs',     'Bug hunting',           3),
  ('website-testing', 'website-testing-usability','Usability feedback',    4),
  ('app-testing',     'app-testing-install',      'Install & test',        1),
  ('app-testing',     'app-testing-pre-launch',   'Pre-launch tester',     2),
  ('app-testing',     'app-testing-bugs',         'Bug report',            3),
  ('app-testing',     'app-testing-feedback',     'App feedback',          4),
  ('writing',         'writing-product-copy',     'Product description',   1),
  ('writing',         'writing-article',          'Article / blog',        2),
  ('writing',         'writing-translation',      'Translation',           3),
  ('writing',         'writing-proofreading',     'Proofreading',          4),
  ('image-tagging',   'image-tagging-labels',     'Photo tagging',         1),
  ('image-tagging',   'image-tagging-categorize', 'Image categorizing',    2),
  ('image-tagging',   'image-tagging-boxes',      'Bounding boxes',        3),
  ('image-tagging',   'image-tagging-moderation', 'Content moderation',    4),
  ('social-media',    'social-media-facebook',    'Facebook',              1),
  ('social-media',    'social-media-instagram',   'Instagram',             2),
  ('social-media',    'social-media-youtube',     'YouTube',               3),
  ('social-media',    'social-media-tiktok',      'TikTok',                4),
  ('social-media',    'social-media-x',           'X (Twitter)',           5),
  ('social-media',    'social-media-telegram',    'Telegram',              6),
  ('social-media',    'social-media-linkedin',    'LinkedIn',              7),
  ('social-media',    'social-media-reddit',      'Reddit',                8),
  ('social-media',    'social-media-github',      'GitHub',                9),
  ('social-media',    'social-media-other',       'Other platform',       10),
  ('research',        'research-web',             'Web research',          1),
  ('research',        'research-contacts',        'Contact lookup',        2),
  ('research',        'research-maps',            'Map & location check',  3),
  ('research',        'research-prices',          'Price check',           4),
  ('other',           'other-task',               'Other task',            1)
) AS v(cat, slug, name, sort)
JOIN categories c ON c.slug = v.cat
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, category_id = EXCLUDED.category_id;

-- Settings (admin-editable). Boost prices are placeholders until the client confirms them.
INSERT INTO platform_settings (key, value, value_type, description, source_ref, is_public) VALUES
 ('job_min_spend_usd',        '0.80',    'number',  'Minimum worker payout per job (slots × reward) before it can be published.', 'CR-2026-11', true),
 ('boost_price_per_day_usd',  '0.50',    'number',  'Price of one day of job boost (pinned as Top job). Charged at publish, not refunded.', 'CR-2026-11', true),
 ('boost_days_options',       '[1,3,7]', 'json',    'Boost period options in days shown in the post-a-job wizard.', 'CR-2026-11', true),
 ('job_schedule_max_days',    '30',      'integer', 'How far ahead (days) an employer can schedule a job to go live.', 'CR-2026-11', true)
ON CONFLICT (key) DO NOTHING;
