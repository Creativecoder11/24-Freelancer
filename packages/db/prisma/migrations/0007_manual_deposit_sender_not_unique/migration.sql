-- Manual deposits (bKash/Nagad/Rocket/USDT "…_manual") store the payer's sender number in
-- provider_payment_id. That number repeats on every deposit from the same wallet, so the unique
-- index made an employer's second deposit from the same number fail (500), and let anyone block a
-- number by submitting it first. Keep uniqueness for gateway payment IDs only. The manual TrxID is
-- guarded in code instead (locked check on create and on credit).
-- Narrowing a unique index can't fail on existing rows.
DROP INDEX IF EXISTS dep_provider_payment_uq;
CREATE UNIQUE INDEX dep_provider_payment_uq ON deposits (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL AND provider NOT LIKE '%\_manual' ESCAPE '\';

-- Speeds up the duplicate-TrxID check.
CREATE INDEX IF NOT EXISTS dep_tx_hash_idx ON deposits (tx_hash) WHERE tx_hash IS NOT NULL;
