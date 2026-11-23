-- Deposit methods (Admin → Settings → Deposit methods): USDT on BEP20 and ERC20, and editable
-- instructions for every manual rail. Accounts start empty, so a new method stays hidden on
-- Add funds until an admin sets its receiving address. Empty instructions use the default text.
INSERT INTO platform_settings (key, value, value_type, description, source_ref, is_public) VALUES
 ('usdt_bep20_manual_enabled',        'true', 'boolean', 'Enable manual USDT (BEP20) deposits.', 'Admin', true),
 ('usdt_bep20_manual_address',        '""',   'string',  'BEP20 wallet address that receives USDT deposits. Empty hides USDT (BEP20).', 'Admin', true),
 ('usdt_bep20_manual_instructions',   '""',   'string',  'Instructions shown on Add funds for USDT (BEP20). Empty uses the default text.', 'Admin', true),
 ('usdt_erc20_manual_enabled',        'true', 'boolean', 'Enable manual USDT (ERC20) deposits.', 'Admin', true),
 ('usdt_erc20_manual_address',        '""',   'string',  'ERC20 wallet address that receives USDT deposits. Empty hides USDT (ERC20).', 'Admin', true),
 ('usdt_erc20_manual_instructions',   '""',   'string',  'Instructions shown on Add funds for USDT (ERC20). Empty uses the default text.', 'Admin', true),
 ('nagad_manual_instructions',        '""',   'string',  'Instructions shown on Add funds for Nagad. Empty uses the default text.', 'Admin', true),
 ('rocket_manual_instructions',       '""',   'string',  'Instructions shown on Add funds for Rocket. Empty uses the default text.', 'Admin', true),
 ('binance_pay_manual_instructions',  '""',   'string',  'Instructions shown on Add funds for Binance Pay. Empty uses the default text.', 'Admin', true),
 ('usdt_trc20_manual_instructions',   '""',   'string',  'Instructions shown on Add funds for USDT (TRC20). Empty uses the default text.', 'Admin', true)
ON CONFLICT (key) DO NOTHING;

UPDATE platform_settings
   SET description = 'Deposit groups shown on Add funds: mobile_wallet (bKash, Nagad, Rocket), crypto (Binance Pay, USDT TRC20/BEP20/ERC20), card.'
 WHERE key = 'deposit_methods_enabled';
