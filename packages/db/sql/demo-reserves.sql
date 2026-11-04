-- DEV/DEMO ONLY: fund and reserve the extra demo jobs (demo-jobs.sql) through the ledger, so approvals work.
-- For each running demo job with no reserve: deposit (gateway_clearing → employer_available) of the expected reserve,
-- then job_reserve (employer_available → employer_reserved), and set jobs.reserve_outstanding_usd.
-- Expected reserve (running) = (reward + fee) × (slots_total − count_approved), matching employer-common.ts.
DO $$
DECLARE j record; amt numeric; gw uuid; avail uuid; resv uuid; t1 uuid; t2 uuid;
BEGIN
  SELECT id INTO gw FROM wallet_accounts WHERE system_code = 'gateway_clearing:bkash_checkout';
  FOR j IN
    SELECT jb.* FROM jobs jb
    WHERE jb.status = 'running' AND jb.reserve_outstanding_usd = 0 AND jb.public_id ~ '^WJ-584[0-9]{2}$'
  LOOP
    amt := round((j.reward_usd + j.fee_per_task_usd) * greatest(j.slots_total - j.count_approved, 0), 6);
    CONTINUE WHEN amt <= 0;
    SELECT id INTO avail FROM wallet_accounts WHERE owner_user_id = j.employer_user_id AND kind = 'employer_available';
    SELECT id INTO resv FROM wallet_accounts WHERE owner_user_id = j.employer_user_id AND kind = 'employer_reserved';
    t1 := uuid_generate_v7();
    INSERT INTO ledger_transactions(id, type, operation_id, idempotency_key, created_by_actor, description_params, job_id)
    VALUES (t1, 'deposit', t1, 'demo-deposit:' || j.public_id, 'system', jsonb_build_object('method', 'demo'), NULL);
    INSERT INTO ledger_entries(transaction_id, account_id, display_type, amount) VALUES (t1, gw, 'deposit', -amt), (t1, avail, 'deposit', amt);
    t2 := uuid_generate_v7();
    INSERT INTO ledger_transactions(id, type, operation_id, idempotency_key, created_by_actor, description_params, job_id)
    VALUES (t2, 'job_reserve', t2, 'demo-reserve:' || j.public_id, 'system',
            jsonb_build_object('slots', j.slots_total - j.count_approved, 'reward', j.reward_usd), j.id);
    INSERT INTO ledger_entries(transaction_id, account_id, display_type, amount) VALUES (t2, avail, 'job_reserve', -amt), (t2, resv, 'job_reserve', amt);
    UPDATE jobs SET reserve_outstanding_usd = amt WHERE id = j.id;
  END LOOP;
END $$;
