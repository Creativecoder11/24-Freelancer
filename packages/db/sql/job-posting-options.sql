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

-- Settings (admin-editable). The per-day boost was replaced by Top / Pin / Combo (migration 0004).
INSERT INTO platform_settings (key, value, value_type, description, source_ref, is_public) VALUES
 ('job_min_spend_usd',        '0.80',    'number',  'Minimum worker payout per job (slots × reward) before it can be published.', 'CR-2026-11', true),
 ('job_schedule_max_days',    '30',      'integer', 'How far ahead (days) an employer can schedule a job to go live.', 'CR-2026-11', true),
 ('job_top_price_usd',        '5.00',    'number',  'Top: moves a running job to the top of standard listings. A newer Top goes above an older one.', 'CR-2026-11b', true),
 ('job_pin_price_usd',        '10.00',   'number',  'Pin: keeps a running job above all other jobs for job_pin_hours.', 'CR-2026-11b', true),
 ('job_combo_price_usd',      '8.00',    'number',  'Combo: Pin and Top together at a discount.', 'CR-2026-11b', true),
 ('job_pin_hours',            '24',      'integer', 'How long one Pin lasts. Buying again extends it.', 'CR-2026-11b', true)
ON CONFLICT (key) DO NOTHING;
