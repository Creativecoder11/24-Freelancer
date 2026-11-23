-- Promotions and extra workers (CR-2026-11c).
-- Pin costs $5. Pin on its own needs Top first; Combo (Top + Pin) has no condition.
UPDATE platform_settings
   SET value = '5.00'::jsonb, updated_at = now()
 WHERE key = 'job_pin_price_usd';

-- Admin fee per worker added to a posted job (Add workers, or a higher worker count in Edit job).
INSERT INTO platform_settings (key, value, value_type, description, source_ref, is_public) VALUES
 ('job_extra_worker_fee_usd', '0.001', 'number', 'Admin fee per worker added to a posted job (Add workers or a higher worker count in Edit job). Not refunded.', 'CR-2026-11c', true)
ON CONFLICT (key) DO NOTHING;

-- Mobile wallet account type is now a choice: "Personal number" or "Merchant number".
UPDATE platform_settings
   SET value = CASE WHEN value::text ILIKE '%merchant%' THEN '"Merchant number"'::jsonb ELSE '"Personal number"'::jsonb END,
       description = replace(description, '(Personal / Merchant / Agent)', '(Personal number / Merchant number)'),
       updated_at = now()
 WHERE key IN ('bkash_manual_account_type', 'nagad_manual_account_type', 'rocket_manual_account_type');
