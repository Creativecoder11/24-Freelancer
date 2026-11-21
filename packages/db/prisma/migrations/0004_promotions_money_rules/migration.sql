-- 0004: job promotion (Top, Pin, Combo) replaces the per-day boost, plus money rules
-- (client change request, Nov 2026). Settings stay admin-editable after this runs.

-- Promotion state on jobs ---------------------------------------------------
-- topped_at: last Top purchase; a newer Top ranks above an older one.
-- pinned_until: a Pin keeps the job above every other job until this time.
ALTER TABLE jobs
  ADD COLUMN topped_at    timestamptz,
  ADD COLUMN pinned_until timestamptz;

CREATE INDEX jobs_listing_rank_idx ON jobs (pinned_until DESC NULLS LAST, topped_at DESC NULLS LAST, published_at DESC)
  WHERE status = 'running' AND deleted_at IS NULL;

-- Boosts already paid for keep their top place until they end, now as a Pin.
UPDATE jobs SET pinned_until = boosted_until WHERE boosted_until > now();

-- Promotion prices and Pin length ------------------------------------------
INSERT INTO platform_settings (key, value, value_type, description, source_ref, is_public) VALUES
 ('job_top_price_usd',   '5.00',  'number',  'Top: moves a running job to the top of standard listings. A newer Top goes above an older one.', 'CR-2026-11b', true),
 ('job_pin_price_usd',   '10.00', 'number',  'Pin: keeps a running job above all other jobs for job_pin_hours.', 'CR-2026-11b', true),
 ('job_combo_price_usd', '8.00',  'number',  'Combo: Pin and Top together at a discount.', 'CR-2026-11b', true),
 ('job_pin_hours',       '24',    'integer', 'How long one Pin lasts. Buying again extends it.', 'CR-2026-11b', true)
ON CONFLICT (key) DO NOTHING;

DELETE FROM platform_settings WHERE key IN ('boost_price_per_day_usd', 'boost_days_options');

-- Withdrawals: $5 minimum on every payout method ---------------------------
UPDATE payout_method_configs SET min_usd = 5.00, quick_amounts_usd = '[5.00, 10.00]'::jsonb, updated_at = now() WHERE min_usd <> 5.00;
UPDATE payout_method_configs SET enabled = true, updated_at = now() WHERE method_type = 'usdt_trc20' AND NOT enabled;

-- Deposits: $10 minimum; card off; manual bKash, Nagad, Rocket, Binance Pay, USDT TRC20 --------
UPDATE platform_settings SET value = '10.00'::jsonb, updated_at = now() WHERE key = 'deposit_min_usd';
UPDATE platform_settings SET value = '["mobile_wallet","crypto"]'::jsonb,
  description = 'Deposit groups shown on Add funds: mobile_wallet (bKash, Nagad, Rocket), crypto (Binance Pay, USDT TRC20), card.',
  updated_at = now()
  WHERE key = 'deposit_methods_enabled';

-- Receiving accounts start empty: a method shows on Add funds only once its account is set
-- (Admin → Settings → Deposits), so nobody is sent to a placeholder number.
INSERT INTO platform_settings (key, value, value_type, description, source_ref, is_public) VALUES
 ('nagad_manual_enabled',        'true',  'boolean', 'Enable manual Nagad deposits.', 'CR-2026-11b', true),
 ('nagad_manual_number',         '""',    'string',  'Official Nagad number for manual deposits. Empty hides Nagad.', 'CR-2026-11b', true),
 ('nagad_manual_account_type',   '"Personal (Send Money)"', 'string', 'Nagad account type (Personal / Merchant / Agent).', 'CR-2026-11b', true),
 ('rocket_manual_enabled',       'true',  'boolean', 'Enable manual Rocket deposits.', 'CR-2026-11b', true),
 ('rocket_manual_number',        '""',    'string',  'Official Rocket number for manual deposits. Empty hides Rocket.', 'CR-2026-11b', true),
 ('rocket_manual_account_type',  '"Personal (Send Money)"', 'string', 'Rocket account type (Personal / Merchant / Agent).', 'CR-2026-11b', true),
 ('binance_pay_manual_enabled',  'true',  'boolean', 'Enable manual Binance Pay deposits.', 'CR-2026-11b', true),
 ('binance_pay_manual_id',       '""',    'string',  'Binance Pay ID that receives deposits. Empty hides Binance Pay.', 'CR-2026-11b', true),
 ('usdt_trc20_manual_enabled',   'true',  'boolean', 'Enable manual USDT (TRC20) deposits.', 'CR-2026-11b', true),
 ('usdt_trc20_manual_address',   '""',    'string',  'TRC20 wallet address that receives USDT deposits. Empty hides USDT.', 'CR-2026-11b', true)
ON CONFLICT (key) DO NOTHING;

-- Exchange rate: 1 USD = 110 BDT for deposits and withdrawals ---------------
-- New rows (not updates) keep the rate history. Manual rates never go stale.
INSERT INTO exchange_rates (quote_currency, direction, rate, source, effective_from, note) VALUES
 ('BDT', 'payout',  110.000000, 'manual', now(), '1 USD = 110 BDT (client, Nov 2026).'),
 ('BDT', 'deposit', 110.000000, 'manual', now(), '1 USD = 110 BDT (client, Nov 2026).')
ON CONFLICT (quote_currency, direction, effective_from) DO NOTHING;
