-- Fixture for validating Doc 05: Figma sample data, loaded after schema.sql + seed.sql
BEGIN;
CREATE FUNCTION pg_temp.uid(n text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('0192aaaa-0000-7000-8000-' || lpad(n,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.d(t text) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$ SELECT (t||' 2026')::timestamp AT TIME ZONE 'Asia/Dhaka' $$;
CREATE FUNCTION pg_temp.acct(u uuid, k wallet_account_kind) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM wallet_accounts WHERE owner_user_id=u AND kind=k $$;
CREATE FUNCTION pg_temp.sys(c text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM wallet_accounts WHERE system_code=c $$;
CREATE FUNCTION pg_temp.post(s bigint, t ledger_tx_type, idem text, at_ timestamptz, params jsonb, lines jsonb,
   job uuid DEFAULT NULL, sub uuid DEFAULT NULL, dep uuid DEFAULT NULL, wd uuid DEFAULT NULL, rc uuid DEFAULT NULL,
   actor actor_type DEFAULT 'system', adm uuid DEFAULT NULL, why text DEFAULT NULL, rcode text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE tid uuid := uuid_generate_v7(); r jsonb;
BEGIN
  INSERT INTO ledger_transactions(id,seq,type,operation_id,idempotency_key,job_id,submission_id,deposit_id,withdrawal_id,referral_commission_id,
     created_by_actor,created_by_admin_id,reason_code,reason,description_params,occurred_at)
  VALUES (tid,s,t,tid,idem,job,sub,dep,wd,rc,actor,adm,rcode,why,params,at_);
  FOR r IN SELECT * FROM jsonb_array_elements(lines) LOOP
    INSERT INTO ledger_entries(transaction_id,account_id,display_type,amount,tx_seq)
    VALUES (tid,(r->>0)::uuid,(r->>1)::ledger_tx_type,(r->>2)::numeric,s);
  END LOOP;
  RETURN tid;
END $$;
CREATE FUNCTION pg_temp.mkuser(n text, pub text, name text, em text, ph text, role active_mode, at_ timestamptz) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE u uuid := pg_temp.uid(n);
BEGIN
  INSERT INTO users(id,public_id,full_name,email,email_verified_at,phone_e164,phone_verified_at,password_hash,password_changed_at,country_code,active_mode,default_mode,signup_role,terms_accepted_at,terms_version,onboarding_step,onboarding_completed_at,created_at)
  VALUES (u,pub,name,em,at_,ph,CASE WHEN ph IS NULL THEN NULL ELSE at_ END,'$argon2id$v=19$m=65536,t=3,p=4$c2FtcGxl$c2FtcGxlaGFzaA','2026-08-02T04:00:00Z','BD',role,role,role,at_,'2026-01-01',4,at_,at_);
  INSERT INTO wallet_accounts(owner_user_id,kind) VALUES (u,'worker_earnings'),(u,'employer_available'),(u,'employer_reserved');
  RETURN u;
END $$;

DO $main$
DECLARE
  nus uuid; shelf uuid; orbit uuid; rah uuid; kas uuid; joy uuid; adm uuid; mod_ uuid; bad uuid;
  j1 uuid:=pg_temp.uid('58213'); j2 uuid:=pg_temp.uid('58102'); j3 uuid:=pg_temp.uid('57990');
  j4 uuid:=pg_temp.uid('57412'); j5 uuid:=pg_temp.uid('58344'); j6 uuid:=pg_temp.uid('58300');
  t uuid; t2 uuid; wd uuid; dep uuid; rc uuid; sub uuid; res uuid; att uuid; ref_r uuid; ref_k uuid; ref_j uuid; i int; w uuid;
  up_shot uuid:=pg_temp.uid('900001'); up_front uuid:=pg_temp.uid('900002'); up_back uuid:=pg_temp.uid('900003'); up_selfie uuid:=pg_temp.uid('900004');
  pm_b uuid:=pg_temp.uid('800001'); pm_u uuid:=pg_temp.uid('800002'); pm_n uuid:=pg_temp.uid('800003');
  fx_b uuid; fx_u uuid; link uuid; shot uuid; note text;
BEGIN
  SELECT id INTO fx_b FROM exchange_rates WHERE quote_currency='BDT' AND direction='payout';
  SELECT id INTO fx_u FROM exchange_rates WHERE quote_currency='USDT';
  -- admins
  adm := pg_temp.uid('700001'); mod_ := pg_temp.uid('700002');
  INSERT INTO admin_users(id,email,full_name,password_hash,totp_enrolled_at,totp_secret_enc) VALUES
    (adm,'finance@24freelancing.com','Tanvir Hasan','$argon2id$sample',pg_temp.d('Jan 05 10:00'),'\x00'),
    (mod_,'moderation@24freelancing.com','Sadia Karim','$argon2id$sample',pg_temp.d('Jan 05 10:00'),'\x00');
  INSERT INTO admin_user_roles(admin_user_id,admin_role_id) SELECT adm,id FROM admin_roles WHERE code='finance_admin';
  INSERT INTO admin_user_roles(admin_user_id,admin_role_id) SELECT mod_,id FROM admin_roles WHERE code='moderator';
  -- users
  nus  := pg_temp.mkuser('482910','482910','Nusrat Jahan','nusrat.j@example.com','+8801712345569','worker',pg_temp.d('Aug 01 10:00'));
  shelf:= pg_temp.mkuser('120774','120774','Shelfwise Ltd.','accounts@shelfwise.example',NULL,'employer',pg_temp.d('Mar 11 10:00'));
  orbit:= pg_temp.mkuser('120801','120801','Orbit Research','team@orbitresearch.example',NULL,'employer',pg_temp.d('Apr 02 10:00'));
  rah  := pg_temp.mkuser('731546','731546','Rahima Akter','rahima.a@example.com',NULL,'worker',pg_temp.d('Oct 02 11:00'));
  kas  := pg_temp.mkuser('644018','644018','Kasem Mia','kasem.m@example.com',NULL,'employer',pg_temp.d('Sep 14 11:00'));
  joy  := pg_temp.mkuser('905233','905233','Joya Saha','joya.s@example.com',NULL,'worker',pg_temp.d('Oct 24 11:00'));
  bad  := pg_temp.mkuser('318844','318844','Samir Khan','samir.k@example.com',NULL,'worker',pg_temp.d('Oct 05 11:00'));
  UPDATE users SET referral_code='NUSRAT24', two_step_enabled=true, kyc_status='verified', kyc_verified_at=pg_temp.d('Oct 03 12:00'), last_login_at=pg_temp.d('Oct 26 09:50') WHERE id=nus;
  UPDATE users SET referral_code='RAHIMA51' WHERE id=rah;
  UPDATE users SET status='restricted' WHERE id=bad;
  INSERT INTO worker_profiles(user_id,interest_time,interest_device,approval_rate_pct,approved_30d,rejected_30d,approved_total,stats_refreshed_at,first_withdrawal_at) VALUES
    (nus,'15_60','phone',94,58,4,142,pg_temp.d('Oct 26 03:00'),pg_temp.d('Sep 24 13:10')),(rah,'under_15','phone',NULL,2,0,2,pg_temp.d('Oct 26 03:00'),NULL),(joy,NULL,NULL,NULL,0,0,0,NULL,NULL);
  INSERT INTO employer_profiles(user_id,business_name,website_url,industry,billing_email,about,verification_status,verification_submitted_at,employer_verified_at,approval_rate_pct,avg_review_seconds,jobs_posted_count,stats_refreshed_at,created_at) VALUES
    (shelf,'Shelfwise Ltd.','https://shelfwise.example','Retail & e-commerce','accounts@shelfwise.example','We catalogue products for online shops and post short data-entry and photo-tagging jobs.','verified',pg_temp.d('Mar 12 10:00'),pg_temp.d('Mar 13 10:00'),96,50400,41,pg_temp.d('Oct 26 03:00'),pg_temp.d('Mar 11 10:00')),
    (orbit,'Orbit Research',NULL,'Market research','team@orbitresearch.example',NULL,'not_submitted',NULL,NULL,NULL,NULL,1,NULL,pg_temp.d('Apr 02 10:00'));
  INSERT INTO employer_profiles(user_id,business_name,industry) VALUES (kas,'Kasem Traders','Retail & e-commerce');
  INSERT INTO user_interests(user_id,category_id) SELECT nus,id FROM categories WHERE slug IN ('data-entry','surveys','app-testing');
  -- uploads, KYC, payout methods, auth
  INSERT INTO uploads(id,owner_user_id,purpose,status,storage_bucket,storage_key,original_filename,mime_type,size_bytes,sha256,phash,width_px,height_px,completed_at,delete_after,created_at) VALUES
   (up_shot,nus,'proof_screenshot','uploaded','24f-proofs','proofs/2026/10/019…/sheet-screenshot.png','sheet-screenshot.png','image/png',1258291,'\xabcd',-4323597412345678901,1440,900,pg_temp.d('Oct 26 10:10'),NULL,pg_temp.d('Oct 26 10:09'));
  INSERT INTO uploads(id,owner_user_id,purpose,status,storage_bucket,storage_key_enc,original_filename,mime_type,size_bytes,completed_at,delete_after,created_at) VALUES
   (up_front,nus,'kyc_document','uploaded','24f-kyc','\xdeadbeef','nid-front.jpg','image/jpeg',2202009,pg_temp.d('Oct 02 18:00'),pg_temp.d('Oct 03 12:00')+interval '5 years',pg_temp.d('Oct 02 18:00')),
   (up_back,nus,'kyc_document','uploaded','24f-kyc','\xdeadbeef','nid-back.jpg','image/jpeg',2097152,pg_temp.d('Oct 02 18:01'),pg_temp.d('Oct 03 12:00')+interval '5 years',pg_temp.d('Oct 02 18:01')),
   (up_selfie,nus,'kyc_selfie','uploaded','24f-kyc','\xdeadbeef','selfie.jpg','image/jpeg',1887436,pg_temp.d('Oct 02 18:02'),pg_temp.d('Oct 03 12:00')+interval '5 years',pg_temp.d('Oct 02 18:02'));
  INSERT INTO kyc_verifications(user_id,document_type,status,front_upload_id,back_upload_id,selfie_upload_id,document_number_enc,document_number_hash,document_last4,name_on_document,submitted_at,review_due_at,reviewed_at,reviewed_by_admin_id,verified_at,retain_until)
   VALUES (nus,'national_id','verified',up_front,up_back,up_selfie,'\xdeadbeef','\x1234','4471','Nusrat Jahan',pg_temp.d('Oct 02 18:05'),pg_temp.d('Oct 03 18:05'),pg_temp.d('Oct 03 12:00'),adm,pg_temp.d('Oct 03 12:00'),pg_temp.d('Oct 03 12:00')+interval '5 years');
  INSERT INTO payout_methods(id,user_id,method_type,account_label,account_encrypted,account_hash,account_masked,account_last3,key_id,is_default,verified_at,last_used_at) VALUES
   (pm_b,nus,'bkash','Personal','\xdeadbeef','\xaa01','017••• ••569','569','kms:v1',true,pg_temp.d('Aug 02 10:00'),pg_temp.d('Oct 26 10:15')),
   (pm_u,nus,'usdt_trc20',NULL,'\xdeadbeef','\xaa02','T9x…k2a','k2a','kms:v1',false,pg_temp.d('Aug 02 10:00'),pg_temp.d('Oct 24 11:05')),
   (pm_n,nus,'nagad',NULL,'\xdeadbeef','\xaa03','015•••105','105','kms:v1',false,pg_temp.d('Aug 02 10:00'),pg_temp.d('Oct 20 09:12'));
  INSERT INTO otp_challenges(user_id,purpose,channel,destination,code_hash,attempts,expires_at,resend_available_at,consumed_at,created_at) VALUES
   (nus,'signup','sms','+8801712345569','hmac-sha256:9f1c…',0,pg_temp.d('Aug 01 10:10'),pg_temp.d('Aug 01 10:01'),pg_temp.d('Aug 01 10:02'),pg_temp.d('Aug 01 10:00'));
  INSERT INTO auth_sessions(user_id,refresh_token_hash,family_id,keep_signed_in,device_label,ip_address,city,last_active_at,expires_at) VALUES
   (nus,'\x01',pg_temp.uid('600001'),true,'Chrome on Windows','103.120.0.10','Dhaka',pg_temp.d('Oct 26 11:00'),pg_temp.d('Nov 25 11:00')),
   (nus,'\x02',pg_temp.uid('600002'),true,'24 Freelancing app on Android','103.120.0.11','Dhaka',pg_temp.d('Oct 24 11:00'),pg_temp.d('Nov 23 11:00'));
  INSERT INTO password_history(user_id,password_hash,created_at) VALUES (nus,'$argon2id$sample-old',pg_temp.d('Aug 01 10:00'));
  -- jobs (draft shells first; counters computed at the end)
  INSERT INTO jobs(id,public_id,employer_user_id,category_id,title,time_per_task,est_minutes,display_minutes,task_link_url,proof_instructions,proof_types,reward_usd,slots_total,status,wizard_step,posting_rules_accepted_at,published_at,ends_at,created_at,first_submission_at)
  SELECT v.id,v.pub,v.emp,(SELECT id FROM categories WHERE slug=v.cat),v.title,v.tpt::time_per_task,v.m,v.dm,'https://docs.google.com/spreadsheets/d/1aX…/shelfwise-addresses',v.pi,v.pt::proof_type[],v.rw,v.sl,'running',4,v.pub_at,v.pub_at,v.pub_at+interval '7 days',v.pub_at-interval '10 min',NULL
  FROM (VALUES
   (j1,'WJ-58213',shelf,'data-entry','Enter 25 shop addresses from photos into a sheet','about_5',5,6,'Share the sheet link with “Anyone with the link can view” and add one screenshot that shows all 25 rows.','{link,screenshot}',0.180,40,pg_temp.d('Oct 24 09:30')),
   (j2,'WJ-58102',orbit,'surveys','Answer a 5-minute grocery shopping survey','about_5',5,5,'Screenshot of the survey thank-you page.','{screenshot}',0.120,120,pg_temp.d('Oct 22 12:02')),
   (j3,'WJ-57990',shelf,'data-entry','Categorize 12 shoe photos into a shared sheet','about_5',5,5,'Sheet link and one screenshot of all 12 rows.','{link,screenshot}',0.120,10,pg_temp.d('Oct 19 12:00')),
   (j4,'WJ-57412',shelf,'writing','Translate 5 sentences from English to Bangla','about_10',10,10,'Paste your translation as text.','{text}',0.300,5,pg_temp.d('Oct 12 12:00'))
  ) v(id,pub,emp,cat,title,tpt,m,dm,pi,pt,rw,sl,pub_at);
  INSERT INTO jobs(id,public_id,employer_user_id,category_id,title,time_per_task,est_minutes,display_minutes,task_link_url,proof_instructions,proof_types,reward_usd,slots_total,platform_fee_percent,fee_per_task_usd,status,wizard_step,posting_rules_accepted_at,published_at,ends_at,created_at)
   VALUES (j5,'WJ-58344',shelf,(SELECT id FROM categories WHERE slug='data-entry'),'Check 15 shop addresses on a map','about_2',2,3,'https://maps.example/list','One screenshot of the checked list.','{screenshot}',0.140,60,10,0.014,'running',4,pg_temp.d('Oct 26 08:00'),pg_temp.d('Oct 26 08:00'),pg_temp.d('Nov 02 08:00'),pg_temp.d('Oct 26 07:50'));
  INSERT INTO jobs(id,public_id,employer_user_id,category_id,title,proof_types,reward_usd,slots_total,status,wizard_step) VALUES
   (j6,'WJ-58300',shelf,(SELECT id FROM categories WHERE slug='image-tagging'),'Tag 30 photos as indoor or outdoor','{link}',0.150,100,'draft',3);
  INSERT INTO job_steps(job_id,position,body) VALUES
   (j1,1,'Open the photo folder and the shared sheet from the task link.'),
   (j1,2,'For each of the 25 photos, type the shop name, street address and area into a new row.'),
   (j1,3,'Check spelling against the photo, then copy the sheet’s share link and take one screenshot showing all rows.'),
   (j2,1,'Open the survey link and answer all questions.'),(j3,1,'Put each photo in one of the categories in the sheet.'),(j4,1,'Translate the sentences in the task link.'),(j5,1,'Check each address on the map and mark it in the list.');
  INSERT INTO job_proof_requirements(id,job_id,position,proof_type,title,field_label,helper) VALUES
   (pg_temp.uid('580001'),j1,1,'link','Share link to your copy of the sheet','Sheet share link','Anyone with the link must be able to view it.'),
   (pg_temp.uid('580002'),j1,2,'screenshot','One screenshot showing all 25 rows','Screenshot','Full sheet visible — cropped screenshots are usually returned for a fix.'),
   (pg_temp.uid('580003'),j2,1,'screenshot','Screenshot of the thank-you page','Screenshot',NULL),
   (pg_temp.uid('580004'),j3,1,'screenshot','One screenshot of all 12 rows','New screenshot',NULL),
   (pg_temp.uid('580005'),j4,1,'text','Your translation','Text answer',NULL),
   (pg_temp.uid('580006'),j5,1,'screenshot','Screenshot of the checked list','Screenshot',NULL);
  link:=pg_temp.uid('580001'); shot:=pg_temp.uid('580002');
  INSERT INTO job_views(job_id,viewer_user_id,viewer_key,first_viewed_at,last_viewed_at,view_count) VALUES
   (j1,nus,'u:'||nus,pg_temp.d('Oct 26 09:57'),pg_temp.d('Oct 26 10:12'),3),(j1,NULL,'a:8c21f0…',pg_temp.d('Oct 25 21:40'),pg_temp.d('Oct 25 21:40'),1);
  INSERT INTO job_reports(job_id,reporter_user_id,reason,details,created_at) VALUES (j2,rah,'broken_materials','The survey link shows a 404 page.',pg_temp.d('Oct 26 12:00'));

  -- LEDGER, in posting order -------------------------------------------------------------
  t:=pg_temp.post(76400,'adjustment','fixture:opening:482910',pg_temp.d('Sep 01 10:00'),'{"label":"Fixture opening balance"}',
     jsonb_build_array(jsonb_build_array(pg_temp.sys('adjustments'),'adjustment',-31.329),jsonb_build_array(pg_temp.acct(nus,'worker_earnings'),'adjustment',31.329)),actor=>'admin',adm=>adm,why=>'Fixture only: earnings before the worked examples',rcode=>'other');
  -- referrals
  ref_r:=pg_temp.uid('400001'); ref_k:=pg_temp.uid('400002'); ref_j:=pg_temp.uid('400003');
  INSERT INTO referrals(id,referrer_user_id,referred_user_id,code_used,attributed_via,status,eligible_at,activated_at,last_activity_at,created_at) VALUES
   (ref_r,nus,rah,'NUSRAT24','link','active',pg_temp.d('Oct 14 12:00'),pg_temp.d('Oct 14 12:00'),pg_temp.d('Oct 26 15:00'),pg_temp.d('Oct 02 11:00')),
   (ref_k,nus,kas,'NUSRAT24','code','active',pg_temp.d('Sep 14 12:00'),pg_temp.d('Sep 14 12:00'),pg_temp.d('Sep 14 12:00'),pg_temp.d('Sep 14 11:00'));
  INSERT INTO referrals(id,referrer_user_id,referred_user_id,code_used,attributed_via,status,created_at,reminder_count,last_reminded_at) VALUES
   (ref_j,nus,joy,'NUSRAT24','link','not_started',pg_temp.d('Oct 24 11:00'),1,pg_temp.d('Oct 25 10:00'));
  INSERT INTO referrals(referrer_user_id,referred_user_id,code_used,attributed_via,status,ineligible_reason,created_at) VALUES
   (nus,bad,'NUSRAT24','code','ineligible','duplicate_account',pg_temp.d('Oct 05 11:00'));
  -- Kasem deposit + commission
  dep:=pg_temp.uid('10290');
  INSERT INTO deposits(id,public_ref,employer_user_id,method,provider,provider_payment_id,provider_asset,amount_usd,status,initiated_at,created_at) VALUES (dep,'DP-10290',kas,'crypto','nowpayments','np_100290','USDT',20,'pending',pg_temp.d('Sep 14 11:40'),pg_temp.d('Sep 14 11:40'));
  t:=pg_temp.post(76410,'deposit','deposit:DP-10290:complete',pg_temp.d('Sep 14 11:50'),'{"method":"crypto","asset":"USDT"}',jsonb_build_array(jsonb_build_array(pg_temp.sys('gateway_clearing:nowpayments'),'deposit',-20),jsonb_build_array(pg_temp.acct(kas,'employer_available'),'deposit',20)),dep=>dep);
  UPDATE deposits SET status='completed',completed_at=pg_temp.d('Sep 14 11:50'),amount_received_usd=20,credited_amount_usd=20,credit_ledger_tx_id=t WHERE id=dep;
  rc:=pg_temp.uid('300001');
  INSERT INTO referral_commissions(id,referral_id,referrer_user_id,referred_user_id,source_type,deposit_id,base_amount,rate,amount,status,created_at) VALUES (rc,ref_k,nus,kas,'deposit',dep,20,0.05,1.00,'pending',pg_temp.d('Sep 14 11:50'));
  t:=pg_temp.post(76411,'referral_commission','referral:'||rc||':credit',pg_temp.d('Sep 14 11:50'),'{"friend":"Ka***m","source":"deposit"}',jsonb_build_array(jsonb_build_array(pg_temp.sys('referral_expense'),'referral_commission',-1.00),jsonb_build_array(pg_temp.acct(nus,'worker_earnings'),'referral_commission',1.00)),dep=>dep,rc=>rc);
  UPDATE referral_commissions SET status='credited',ledger_tx_id=t,credited_at=pg_temp.d('Sep 14 11:50') WHERE id=rc;
  -- Shelfwise funds
  dep:=pg_temp.uid('10300');
  INSERT INTO deposits(id,public_ref,employer_user_id,method,provider,provider_payment_id,provider_asset,amount_usd,fx_rate,charge_amount_bdt,status,initiated_at,created_at) VALUES (dep,'DP-10300',shelf,'card','sslcommerz','ssl_100300','Visa',10,121.5,1215,'pending',pg_temp.d('Sep 28 10:00'),pg_temp.d('Sep 28 10:00'));
  t:=pg_temp.post(76500,'deposit','deposit:DP-10300:complete',pg_temp.d('Sep 28 10:02'),'{"method":"card","asset":"Visa"}',jsonb_build_array(jsonb_build_array(pg_temp.sys('gateway_clearing:sslcommerz'),'deposit',-10),jsonb_build_array(pg_temp.acct(shelf,'employer_available'),'deposit',10)),dep=>dep);
  UPDATE deposits SET status='completed',completed_at=pg_temp.d('Sep 28 10:02'),amount_received_usd=10,credited_amount_usd=10,credit_ledger_tx_id=t WHERE id=dep;
  -- WJ-57412 reserve 5 x 0.300
  t:=pg_temp.post(76510,'job_reserve','job:WJ-57412:publish',pg_temp.d('Oct 12 12:00'),'{"title":"Translate 5 sentences","slots":5,"reward":"0.300"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(shelf,'employer_available'),'job_reserve',-1.50),jsonb_build_array(pg_temp.acct(shelf,'employer_reserved'),'job_reserve',1.50)),job=>j4,actor=>'user');
  -- Rahima approved on WJ-57412
  res:=pg_temp.uid('200001'); sub:=pg_temp.uid('204050');
  INSERT INTO slot_reservations(id,job_id,worker_user_id,status,started_at,expires_at,submitted_at) VALUES (res,j4,rah,'submitted',pg_temp.d('Oct 14 10:00'),pg_temp.d('Oct 14 11:00'),pg_temp.d('Oct 14 10:20'));
  INSERT INTO submissions(id,public_ref,job_id,reservation_id,worker_user_id,employer_user_id,reward_usd,first_submitted_at,last_submitted_at,review_due_at,created_at)
    VALUES (sub,'SB-204050',j4,res,rah,shelf,0.30,pg_temp.d('Oct 14 10:20'),pg_temp.d('Oct 14 10:20'),pg_temp.d('Oct 17 10:20'),pg_temp.d('Oct 14 10:20'));
  t:=pg_temp.post(76511,'job_spend','submission:SB-204050:approve',pg_temp.d('Oct 14 12:00'),'{"title":"Translate 5 sentences"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(shelf,'employer_reserved'),'job_spend',-0.30),jsonb_build_array(pg_temp.acct(rah,'worker_earnings'),'task_reward',0.30)),job=>j4,sub=>sub,actor=>'user');
  UPDATE submissions SET status='approved',decided_at=pg_temp.d('Oct 14 12:00'),decision_source='employer',decided_by_user_id=shelf,final_at=pg_temp.d('Oct 14 12:00'),paid_ledger_tx_id=t WHERE id=sub;
  att:=uuid_generate_v7();
  INSERT INTO submission_attempts(id,submission_id,attempt_no,attestation_accepted_at,steps_checked,submitted_at,decision,decided_at) VALUES (att,sub,1,pg_temp.d('Oct 14 10:20'),'{1}',pg_temp.d('Oct 14 10:20'),'approved',pg_temp.d('Oct 14 12:00'));
  INSERT INTO submission_proof_items(attempt_id,proof_requirement_id,proof_type,text_value) VALUES (att,pg_temp.uid('580005'),'text','আমি প্রতিদিন স্কুলে যাই।');
  rc:=pg_temp.uid('300002');
  INSERT INTO referral_commissions(id,referral_id,referrer_user_id,referred_user_id,source_type,submission_id,base_amount,rate,amount,status,created_at) VALUES (rc,ref_r,nus,rah,'task',sub,0.30,0.05,0.015,'pending',pg_temp.d('Oct 14 12:00'));
  t:=pg_temp.post(76512,'referral_commission','referral:'||rc||':credit',pg_temp.d('Oct 14 12:00'),'{"friend":"Ra***a","source":"task"}',jsonb_build_array(jsonb_build_array(pg_temp.sys('referral_expense'),'referral_commission',-0.015),jsonb_build_array(pg_temp.acct(nus,'worker_earnings'),'referral_commission',0.015)),sub=>sub,rc=>rc);
  UPDATE referral_commissions SET status='credited',ledger_tx_id=t,credited_at=pg_temp.d('Oct 14 12:00') WHERE id=rc;
  -- Oct 18 deposit
  dep:=pg_temp.uid('10420');
  INSERT INTO deposits(id,public_ref,employer_user_id,method,provider,provider_payment_id,provider_asset,amount_usd,fx_rate,charge_amount_bdt,status,initiated_at,created_at) VALUES (dep,'DP-10420',shelf,'mobile_wallet','bkash','TRX9QX71KL','bKash',35,121.5,4252.50,'pending',pg_temp.d('Oct 18 15:10'),pg_temp.d('Oct 18 15:10'));
  t:=pg_temp.post(76655,'deposit','deposit:DP-10420:complete',pg_temp.d('Oct 18 15:14'),'{"method":"mobile_wallet","asset":"bKash"}',jsonb_build_array(jsonb_build_array(pg_temp.sys('gateway_clearing:bkash_checkout'),'deposit',-35),jsonb_build_array(pg_temp.acct(shelf,'employer_available'),'deposit',35)),dep=>dep);
  UPDATE deposits SET status='completed',completed_at=pg_temp.d('Oct 18 15:14'),amount_received_usd=35,credited_amount_usd=35,credit_ledger_tx_id=t WHERE id=dep;
  -- WJ-57990 reserve 10 x 0.120
  t:=pg_temp.post(76690,'job_reserve','job:WJ-57990:publish',pg_temp.d('Oct 19 12:00'),'{"title":"Categorize 12 shoe photos","slots":10,"reward":"0.120"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(shelf,'employer_available'),'job_reserve',-1.20),jsonb_build_array(pg_temp.acct(shelf,'employer_reserved'),'job_reserve',1.20)),job=>j3,actor=>'user');
  -- Orbit deposit
  dep:=pg_temp.uid('10410');
  INSERT INTO deposits(id,public_ref,employer_user_id,method,provider,provider_payment_id,provider_asset,amount_usd,status,initiated_at,created_at) VALUES (dep,'DP-10410',orbit,'crypto','nowpayments','np_100410','USDT',20,'pending',pg_temp.d('Oct 19 09:00'),pg_temp.d('Oct 19 09:00'));
  t:=pg_temp.post(76700,'deposit','deposit:DP-10410:complete',pg_temp.d('Oct 19 09:05'),'{"method":"crypto","asset":"USDT"}',jsonb_build_array(jsonb_build_array(pg_temp.sys('gateway_clearing:nowpayments'),'deposit',-20),jsonb_build_array(pg_temp.acct(orbit,'employer_available'),'deposit',20)),dep=>dep);
  UPDATE deposits SET status='completed',completed_at=pg_temp.d('Oct 19 09:05'),amount_received_usd=20,credited_amount_usd=20,credit_ledger_tx_id=t WHERE id=dep;
  -- WD-90301 rejected (Nagad)
  wd:=pg_temp.uid('90301');
  t:=pg_temp.post(76720,'withdrawal','withdrawal:WD-90301:request',pg_temp.d('Oct 20 09:12'),'{"method":"nagad","masked":"••105","phase":"request"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(nus,'worker_earnings'),'withdrawal',-8.34),jsonb_build_array(pg_temp.sys('payout_clearing'),'withdrawal',8.34)),wd=>wd,actor=>'user');
  INSERT INTO withdrawals(id,public_ref,user_id,payout_method_id,method,destination_masked,destination_encrypted,key_id,amount_usd,fee_usd,payout_currency,exchange_rate_id,fx_rate,payout_amount,requested_at,request_ledger_tx_id,created_at)
    VALUES (wd,'WD-90301',nus,pm_n,'nagad','015•••105','\xdeadbeef','kms:v1',8.34,0,'BDT',fx_b,120,1000,pg_temp.d('Oct 20 09:12'),t,pg_temp.d('Oct 20 09:12'));
  t2:=pg_temp.post(76721,'withdrawal_reversal','withdrawal:WD-90301:reverse',pg_temp.d('Oct 20 16:00'),'{"method":"nagad","masked":"••105","cause":"rejected"}',jsonb_build_array(jsonb_build_array(pg_temp.sys('payout_clearing'),'withdrawal_reversal',-8.34),jsonb_build_array(pg_temp.acct(nus,'worker_earnings'),'withdrawal_reversal',8.34)),wd=>wd,actor=>'admin',adm=>adm);
  UPDATE withdrawals SET status='rejected',rejected_at=pg_temp.d('Oct 20 16:00'),reject_reason_code='invalid_account',reject_reason_text='The number isn’t a registered mobile wallet.',processed_by_admin_id=adm,reversal_ledger_tx_id=t2 WHERE id=wd;
  INSERT INTO withdrawal_events(withdrawal_id,from_status,to_status,actor_type,actor_user_id,occurred_at) VALUES (wd,NULL,'requested','user',nus,pg_temp.d('Oct 20 09:12'));
  INSERT INTO withdrawal_events(withdrawal_id,from_status,to_status,actor_type,actor_admin_id,note,occurred_at) VALUES (wd,'requested','rejected','admin',adm,'The number isn’t a registered mobile wallet.',pg_temp.d('Oct 20 16:00'));
  -- WJ-58102 reserve 120 x 0.120
  t:=pg_temp.post(76810,'job_reserve','job:WJ-58102:publish',pg_temp.d('Oct 22 12:02'),'{"title":"Answer a 5-minute grocery shopping survey","slots":120,"reward":"0.120"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(orbit,'employer_available'),'job_reserve',-14.40),jsonb_build_array(pg_temp.acct(orbit,'employer_reserved'),'job_reserve',14.40)),job=>j2,actor=>'user');
  -- DP-10421
  dep:=pg_temp.uid('10421');
  INSERT INTO deposits(id,public_ref,employer_user_id,method,provider,provider_payment_id,provider_asset,amount_usd,pay_currency,pay_amount,network,tx_hash,confirmations,status,initiated_at,expires_at,created_at) VALUES (dep,'DP-10421',shelf,'crypto','nowpayments','np_104210','USDT',25,'USDT',25,'TRC20','a3f1c7e90b…',20,'pending',pg_temp.d('Oct 24 09:05'),pg_temp.d('Oct 24 10:05'),pg_temp.d('Oct 24 09:05'));
  INSERT INTO payment_webhook_events(provider,direction,provider_event_id,event_type,signature_valid,raw_body,payload,processing_result,attempts,deposit_id,received_at,processed_at) VALUES ('nowpayments','payments','np_104210:finished','payment.finished',true,'\x7b7d','{"payment_id":"np_104210","payment_status":"finished","price_amount":25,"price_currency":"usd","pay_currency":"usdttrc20"}','credited',1,dep,pg_temp.d('Oct 24 09:12'),pg_temp.d('Oct 24 09:12'));
  t:=pg_temp.post(76988,'deposit','deposit:DP-10421:complete',pg_temp.d('Oct 24 09:12'),'{"method":"crypto","asset":"USDT"}',jsonb_build_array(jsonb_build_array(pg_temp.sys('gateway_clearing:nowpayments'),'deposit',-25),jsonb_build_array(pg_temp.acct(shelf,'employer_available'),'deposit',25)),dep=>dep);
  UPDATE deposits SET status='completed',completed_at=pg_temp.d('Oct 24 09:12'),amount_received_usd=25,credited_amount_usd=25,credit_ledger_tx_id=t WHERE id=dep;
  -- TX-77001 reserve WJ-58213
  t:=pg_temp.post(77001,'job_reserve','job:WJ-58213:publish',pg_temp.d('Oct 24 09:30'),'{"title":"Enter 25 shop addresses from photos into a sheet","slots":40,"reward":"0.180"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(shelf,'employer_available'),'job_reserve',-7.20),jsonb_build_array(pg_temp.acct(shelf,'employer_reserved'),'job_reserve',7.20)),job=>j1,actor=>'user');
  -- WD-90377 USDT paid (fee 1.00 per D-03)
  wd:=pg_temp.uid('90377');
  t:=pg_temp.post(77010,'withdrawal','withdrawal:WD-90377:request',pg_temp.d('Oct 24 11:05'),'{"method":"usdt_trc20","masked":"T9x…k2a","phase":"request"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(nus,'worker_earnings'),'withdrawal',-10),jsonb_build_array(pg_temp.sys('payout_clearing'),'withdrawal',10)),wd=>wd,actor=>'user');
  INSERT INTO withdrawals(id,public_ref,user_id,payout_method_id,method,destination_masked,destination_encrypted,key_id,amount_usd,fee_usd,payout_currency,exchange_rate_id,fx_rate,payout_amount,requested_at,request_ledger_tx_id,created_at)
    VALUES (wd,'WD-90377',nus,pm_u,'usdt_trc20','T9x…k2a','\xdeadbeef','kms:v1',10,1,'USDT',fx_u,1,9,pg_temp.d('Oct 24 11:05'),t,pg_temp.d('Oct 24 11:05'));
  t2:=pg_temp.post(77011,'withdrawal','withdrawal:WD-90377:paid',pg_temp.d('Oct 24 15:00'),'{"phase":"paid","provider_trx_id":"7f3e…91ab"}',jsonb_build_array(jsonb_build_array(pg_temp.sys('payout_clearing'),'withdrawal',-10),jsonb_build_array(pg_temp.sys('treasury:usdt_hot_wallet'),'withdrawal',9),jsonb_build_array(pg_temp.sys('platform_revenue'),'platform_fee',1)),wd=>wd,actor=>'admin',adm=>adm);
  UPDATE withdrawals SET status='paid',processing_at=pg_temp.d('Oct 24 12:00'),paid_at=pg_temp.d('Oct 24 15:00'),provider_trx_id='7f3e…91ab',processed_by_admin_id=adm,settle_ledger_tx_id=t2 WHERE id=wd;
  INSERT INTO withdrawal_events(withdrawal_id,from_status,to_status,actor_type,actor_admin_id,occurred_at) VALUES (wd,'processing','paid','admin',adm,pg_temp.d('Oct 24 15:00'));
  -- WD-90398 cancelled
  wd:=pg_temp.uid('90398');
  t:=pg_temp.post(77050,'withdrawal','withdrawal:WD-90398:request',pg_temp.d('Oct 25 08:00'),'{"method":"bkash","masked":"••569","phase":"request"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(nus,'worker_earnings'),'withdrawal',-5),jsonb_build_array(pg_temp.sys('payout_clearing'),'withdrawal',5)),wd=>wd,actor=>'user');
  INSERT INTO withdrawals(id,public_ref,user_id,payout_method_id,method,destination_masked,destination_encrypted,key_id,amount_usd,fee_usd,payout_currency,exchange_rate_id,fx_rate,payout_amount,requested_at,request_ledger_tx_id,created_at)
    VALUES (wd,'WD-90398',nus,pm_b,'bkash','017•••569','\xdeadbeef','kms:v1',5,0,'BDT',fx_b,121.5,607,pg_temp.d('Oct 25 08:00'),t,pg_temp.d('Oct 25 08:00'));
  t2:=pg_temp.post(77051,'withdrawal_reversal','withdrawal:WD-90398:reverse',pg_temp.d('Oct 25 08:20'),'{"method":"bkash","masked":"••569","cause":"cancelled"}',jsonb_build_array(jsonb_build_array(pg_temp.sys('payout_clearing'),'withdrawal_reversal',-5),jsonb_build_array(pg_temp.acct(nus,'worker_earnings'),'withdrawal_reversal',5)),wd=>wd,actor=>'user');
  UPDATE withdrawals SET status='cancelled',cancelled_at=pg_temp.d('Oct 25 08:20'),reversal_ledger_tx_id=t2 WHERE id=wd;
  -- TX-77093 close WJ-57412: release 4 x 0.300
  t:=pg_temp.post(77093,'job_release','job:WJ-57412:close',pg_temp.d('Oct 25 18:00'),'{"title":"Translate 5 sentences","reason":"job closed, unused slots"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(shelf,'employer_reserved'),'job_release',-1.20),jsonb_build_array(pg_temp.acct(shelf,'employer_available'),'job_release',1.20)),job=>j4);
  UPDATE jobs SET status='completed',close_reason='expired',closed_at=pg_temp.d('Oct 25 18:00') WHERE id=j4;
  -- WJ-58344 reserve with 10% fee (D-02 > 0 illustration)
  t:=pg_temp.post(77096,'job_reserve','job:WJ-58344:publish',pg_temp.d('Oct 26 08:00'),'{"title":"Check 15 shop addresses on a map","slots":60,"reward":"0.140","fee_percent":"10"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(shelf,'employer_available'),'job_reserve',-9.24),jsonb_build_array(pg_temp.acct(shelf,'employer_reserved'),'job_reserve',9.24)),job=>j5,actor=>'user');
  -- Nusrat: survey approved (TX 77100)
  res:=pg_temp.uid('200002'); sub:=pg_temp.uid('204101');
  INSERT INTO slot_reservations(id,job_id,worker_user_id,status,started_at,expires_at,submitted_at) VALUES (res,j2,nus,'submitted',pg_temp.d('Oct 26 07:00'),pg_temp.d('Oct 26 08:00'),pg_temp.d('Oct 26 07:10'));
  INSERT INTO submissions(id,public_ref,job_id,reservation_id,worker_user_id,employer_user_id,reward_usd,first_submitted_at,last_submitted_at,review_due_at,created_at)
    VALUES (sub,'SB-204101',j2,res,nus,orbit,0.12,pg_temp.d('Oct 26 07:10'),pg_temp.d('Oct 26 07:10'),pg_temp.d('Oct 29 07:10'),pg_temp.d('Oct 26 07:10'));
  t:=pg_temp.post(77100,'job_spend','submission:SB-204101:approve',pg_temp.d('Oct 26 09:40'),'{"title":"Grocery shopping survey","employer":"Orbit Research"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(orbit,'employer_reserved'),'job_spend',-0.12),jsonb_build_array(pg_temp.acct(nus,'worker_earnings'),'task_reward',0.12)),job=>j2,sub=>sub,actor=>'user');
  UPDATE submissions SET status='approved',decided_at=pg_temp.d('Oct 26 09:40'),decision_source='employer',decided_by_user_id=orbit,final_at=pg_temp.d('Oct 26 09:40'),paid_ledger_tx_id=t WHERE id=sub;
  att:=uuid_generate_v7();
  INSERT INTO submission_attempts(id,submission_id,attempt_no,attestation_accepted_at,steps_checked,submitted_at,decision,decided_at) VALUES (att,sub,1,pg_temp.d('Oct 26 07:10'),'{1}',pg_temp.d('Oct 26 07:10'),'approved',pg_temp.d('Oct 26 09:40'));
  INSERT INTO submission_proof_items(attempt_id,proof_requirement_id,proof_type) VALUES (att,pg_temp.uid('580003'),'screenshot');
  -- Nusrat: shoes needs_fix + dispute
  res:=pg_temp.uid('200003'); sub:=pg_temp.uid('204090');
  INSERT INTO slot_reservations(id,job_id,worker_user_id,status,started_at,expires_at,submitted_at) VALUES (res,j3,nus,'submitted',pg_temp.d('Oct 26 09:00'),pg_temp.d('Oct 26 10:00'),pg_temp.d('Oct 26 09:30'));
  INSERT INTO submissions(id,public_ref,job_id,reservation_id,worker_user_id,employer_user_id,status,reward_usd,first_submitted_at,last_submitted_at,review_due_at,decided_at,decision_source,decided_by_user_id,rejection_reason_code,rejection_reason_text,fix_allowed,resubmit_deadline,dispute_open,created_at)
    VALUES (sub,'SB-204090',j3,res,nus,shelf,'needs_fix',0.12,pg_temp.d('Oct 26 09:30'),pg_temp.d('Oct 26 09:30'),pg_temp.d('Oct 29 09:30'),pg_temp.d('Oct 26 13:05'),'employer',shelf,'proof_incomplete','The screenshot cuts off rows 9–12 of the sheet. Please include the whole sheet in one screenshot.',true,pg_temp.d('Oct 27 18:00'),true,pg_temp.d('Oct 26 09:30'));
  att:=uuid_generate_v7();
  INSERT INTO submission_attempts(id,submission_id,attempt_no,attestation_accepted_at,steps_checked,submitted_at,decision,decided_at,rejection_reason_code,rejection_reason_text,annotations) VALUES (att,sub,1,pg_temp.d('Oct 26 09:30'),'{1}',pg_temp.d('Oct 26 09:30'),'needs_fix',pg_temp.d('Oct 26 13:05'),'proof_incomplete','The screenshot cuts off rows 9–12 of the sheet. Please include the whole sheet in one screenshot.','[{"label":"Rows 9–12 missing","x":0.1,"y":0.62,"w":0.8,"h":0.3}]');
  INSERT INTO submission_proof_items(attempt_id,proof_requirement_id,proof_type) VALUES (att,pg_temp.uid('580004'),'screenshot');
  INSERT INTO disputes(public_ref,submission_id,worker_user_id,employer_user_id,status,disputed_decision,worker_statement,opened_at,sla_due_at,assigned_admin_id,under_review_at)
    VALUES ('DS-00412',sub,nus,shelf,'under_review','needs_fix','My screenshot shows all rows at full zoom. Please check the sheet link.',pg_temp.d('Oct 26 18:00'),pg_temp.d('Oct 28 18:00'),mod_,pg_temp.d('Oct 26 20:00'));
  INSERT INTO submission_events(reservation_id,submission_id,event_type,actor_type,actor_user_id,occurred_at) VALUES (res,sub,'dispute_opened','user',nus,pg_temp.d('Oct 26 18:00'));
  -- WD-90412 requested at 10:15, processing at 10:40
  wd:=pg_temp.uid('90412');
  t:=pg_temp.post(77105,'withdrawal','withdrawal:WD-90412:request',pg_temp.d('Oct 26 10:15'),'{"method":"bkash","masked":"••569","phase":"request"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(nus,'worker_earnings'),'withdrawal',-10),jsonb_build_array(pg_temp.sys('payout_clearing'),'withdrawal',10)),wd=>wd,actor=>'user');
  INSERT INTO withdrawals(id,public_ref,user_id,payout_method_id,method,destination_masked,destination_encrypted,key_id,amount_usd,fee_usd,payout_currency,exchange_rate_id,fx_rate,payout_amount,status,requested_at,processing_at,processed_by_admin_id,request_ledger_tx_id,created_at)
    VALUES (wd,'WD-90412',nus,pm_b,'bkash','017•••569','\xdeadbeef','kms:v1',10,0,'BDT',fx_b,121.5,1215,'processing',pg_temp.d('Oct 26 10:15'),pg_temp.d('Oct 26 10:40'),adm,t,pg_temp.d('Oct 26 10:15'));
  INSERT INTO withdrawal_events(withdrawal_id,from_status,to_status,actor_type,actor_user_id,occurred_at) VALUES (wd,NULL,'requested','user',nus,pg_temp.d('Oct 26 10:15'));
  INSERT INTO withdrawal_events(withdrawal_id,from_status,to_status,actor_type,actor_admin_id,occurred_at) VALUES (wd,'requested','processing','admin',adm,pg_temp.d('Oct 26 10:40'));
  -- Nusrat's in-review proof SB-204118 on WJ-58213
  res:=pg_temp.uid('200004'); sub:=pg_temp.uid('204118');
  INSERT INTO slot_reservations(id,job_id,worker_user_id,status,started_at,expires_at,steps_checked,submitted_at,draft,draft_saved_at) VALUES (res,j1,nus,'submitted',pg_temp.d('Oct 26 09:58'),pg_temp.d('Oct 26 10:58'),'{1,2,3}',pg_temp.d('Oct 26 10:12'),'{"link_url":"https://docs.google.com/spreadsheets/d/1aX…/edit?usp=sharing","note":"Photos 7 and 12 were blurry, so I placed them in “Other”."}',pg_temp.d('Oct 26 10:08'));
  INSERT INTO submissions(id,public_ref,job_id,reservation_id,worker_user_id,employer_user_id,reward_usd,first_submitted_at,last_submitted_at,review_due_at,auto_check,created_at)
    VALUES (sub,'SB-204118',j1,res,nus,shelf,0.18,pg_temp.d('Oct 26 10:12'),pg_temp.d('Oct 26 10:12'),pg_temp.d('Oct 29 10:12'),'{"link_ok":true,"link_status":200,"screenshot_present":true,"duplicate_suspected":false}',pg_temp.d('Oct 26 10:12'));
  att:=pg_temp.uid('500118');
  INSERT INTO submission_attempts(id,submission_id,attempt_no,worker_note,attestation_accepted_at,steps_checked,submitted_at) VALUES (att,sub,1,'Photos 7 and 12 were blurry, so I placed them in “Other”.',pg_temp.d('Oct 26 10:12'),'{1,2,3}',pg_temp.d('Oct 26 10:12'));
  INSERT INTO submission_proof_items(attempt_id,proof_requirement_id,proof_type,link_url,link_check_status) VALUES (att,link,'link','https://docs.google.com/spreadsheets/d/1aX…/edit?usp=sharing',200);
  INSERT INTO submission_proof_items(attempt_id,proof_requirement_id,proof_type,upload_id) VALUES (att,shot,'screenshot',up_shot);
  INSERT INTO submission_events(reservation_id,submission_id,event_type,actor_type,actor_user_id,occurred_at) VALUES
    (res,NULL,'job_opened','user',nus,pg_temp.d('Oct 26 09:57')),(res,NULL,'slot_reserved','user',nus,pg_temp.d('Oct 26 09:58')),(res,sub,'submitted','user',nus,pg_temp.d('Oct 26 10:12'));
  -- Other workers on WJ-58213: 7 approved, 4 in review, 1 rejected, 1 active
  FOR i IN 1..13 LOOP
    w := pg_temp.mkuser((100+i)::text, (510000+i)::text,
          (ARRAY['Arif Rahman','Bina Das','Chitra Roy','Dipu Sen','Eva Noor','Faisal Amin','Gita Pal','Rayhan Kabir','Tania Islam','Mikail Hossain','Salam Uddin','Hasan Ali','Imran Sheikh'])[i],
          'fixture'||i||'@example.com',NULL,'worker',pg_temp.d('Sep 01 10:00'));
    res:=uuid_generate_v7(); sub:=uuid_generate_v7();
    IF i = 13 THEN
      INSERT INTO slot_reservations(id,job_id,worker_user_id,status,started_at,expires_at,steps_checked) VALUES (res,j1,w,'active',now(),now()+interval '60 min','{1,2}');
      CONTINUE;
    END IF;
    INSERT INTO slot_reservations(id,job_id,worker_user_id,status,started_at,expires_at,submitted_at) VALUES (res,j1,w,'submitted',pg_temp.d('Oct 26 08:00'),pg_temp.d('Oct 26 09:00'),pg_temp.d('Oct 26 08:30'));
    INSERT INTO submissions(id,public_ref,job_id,reservation_id,worker_user_id,employer_user_id,reward_usd,first_submitted_at,last_submitted_at,review_due_at,created_at)
      VALUES (sub,fmt_ref('SB-',204200+i,6),j1,res,w,shelf,0.18,pg_temp.d('Oct 26 08:30'),pg_temp.d('Oct 26 08:30'),pg_temp.d('Oct 29 08:30'),pg_temp.d('Oct 26 08:30'));
    att:=uuid_generate_v7();
    INSERT INTO submission_attempts(id,submission_id,attempt_no,attestation_accepted_at,steps_checked,submitted_at) VALUES (att,sub,1,pg_temp.d('Oct 26 08:30'),'{1,2,3}',pg_temp.d('Oct 26 08:30'));
    IF i <= 7 THEN
      t:=pg_temp.post(77109+i,'job_spend','submission:'||fmt_ref('SB-',204200+i,6)||':approve',pg_temp.d('Oct 26 11:00')+(i*interval '20 min'),'{"title":"Enter 25 shop addresses from photos into a sheet"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(shelf,'employer_reserved'),'job_spend',-0.18),jsonb_build_array(pg_temp.acct(w,'worker_earnings'),'task_reward',0.18)),job=>j1,sub=>sub,actor=>'user');
      UPDATE submissions SET status='approved',decided_at=pg_temp.d('Oct 26 11:00')+(i*interval '20 min'),decision_source='employer',decided_by_user_id=shelf,final_at=pg_temp.d('Oct 26 11:00')+(i*interval '20 min'),paid_ledger_tx_id=t WHERE id=sub;
    ELSIF i = 12 THEN
      UPDATE submissions SET status='rejected',decided_at=pg_temp.d('Oct 26 13:00'),decision_source='employer',decided_by_user_id=shelf,final_at=pg_temp.d('Oct 26 13:00'),rejection_reason_code='wrong_or_copied',rejection_reason_text='The text matches another worker''s submission.',fix_allowed=false WHERE id=sub;
    END IF;
  END LOOP;
  -- Rahima approved on WJ-58213 (TX-77120 + TX-77121)
  res:=pg_temp.uid('200005'); sub:=pg_temp.uid('204119');
  INSERT INTO slot_reservations(id,job_id,worker_user_id,status,started_at,expires_at,submitted_at) VALUES (res,j1,rah,'submitted',pg_temp.d('Oct 26 09:00'),pg_temp.d('Oct 26 10:00'),pg_temp.d('Oct 26 09:30'));
  INSERT INTO submissions(id,public_ref,job_id,reservation_id,worker_user_id,employer_user_id,reward_usd,first_submitted_at,last_submitted_at,review_due_at,created_at)
    VALUES (sub,'SB-204119',j1,res,rah,shelf,0.18,pg_temp.d('Oct 26 09:30'),pg_temp.d('Oct 26 09:30'),pg_temp.d('Oct 29 09:30'),pg_temp.d('Oct 26 09:30'));
  t:=pg_temp.post(77120,'job_spend','submission:SB-204119:approve',pg_temp.d('Oct 26 14:40'),'{"title":"Enter 25 shop addresses from photos into a sheet"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(shelf,'employer_reserved'),'job_spend',-0.18),jsonb_build_array(pg_temp.acct(rah,'worker_earnings'),'task_reward',0.18)),job=>j1,sub=>sub,actor=>'user');
  UPDATE submissions SET status='approved',decided_at=pg_temp.d('Oct 26 14:40'),decision_source='employer',decided_by_user_id=shelf,final_at=pg_temp.d('Oct 26 14:40'),paid_ledger_tx_id=t WHERE id=sub;
  INSERT INTO submission_attempts(submission_id,attempt_no,attestation_accepted_at,submitted_at,decision,decided_at) VALUES (sub,1,pg_temp.d('Oct 26 09:30'),pg_temp.d('Oct 26 09:30'),'approved',pg_temp.d('Oct 26 14:40'));
  rc:=pg_temp.uid('300003');
  INSERT INTO referral_commissions(id,referral_id,referrer_user_id,referred_user_id,source_type,submission_id,base_amount,rate,amount,status,created_at) VALUES (rc,ref_r,nus,rah,'task',sub,0.18,0.05,0.009,'pending',pg_temp.d('Oct 26 14:40'));
  t:=pg_temp.post(77121,'referral_commission','referral:'||rc||':credit',pg_temp.d('Oct 26 14:40'),'{"friend":"Ra***a","source":"task"}',jsonb_build_array(jsonb_build_array(pg_temp.sys('referral_expense'),'referral_commission',-0.009),jsonb_build_array(pg_temp.acct(nus,'worker_earnings'),'referral_commission',0.009)),sub=>sub,rc=>rc);
  UPDATE referral_commissions SET status='credited',ledger_tx_id=t,credited_at=pg_temp.d('Oct 26 14:40') WHERE id=rc;
  -- Rahima approved on the fee job (TX-77130..77132)
  res:=pg_temp.uid('200006'); sub:=pg_temp.uid('204120');
  INSERT INTO slot_reservations(id,job_id,worker_user_id,status,started_at,expires_at,submitted_at) VALUES (res,j5,rah,'submitted',pg_temp.d('Oct 26 09:00'),pg_temp.d('Oct 26 10:00'),pg_temp.d('Oct 26 09:30'));
  INSERT INTO submissions(id,public_ref,job_id,reservation_id,worker_user_id,employer_user_id,reward_usd,fee_usd,first_submitted_at,last_submitted_at,review_due_at,created_at)
    VALUES (sub,'SB-204120',j5,res,rah,shelf,0.14,0.014,pg_temp.d('Oct 26 09:30'),pg_temp.d('Oct 26 09:30'),pg_temp.d('Oct 29 09:30'),pg_temp.d('Oct 26 09:30'));
  t:=pg_temp.post(77130,'job_spend','submission:SB-204120:approve',pg_temp.d('Oct 26 15:00'),'{"title":"Check 15 shop addresses on a map"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(shelf,'employer_reserved'),'job_spend',-0.14),jsonb_build_array(pg_temp.acct(rah,'worker_earnings'),'task_reward',0.14)),job=>j5,sub=>sub,actor=>'user');
  UPDATE submissions SET status='approved',decided_at=pg_temp.d('Oct 26 15:00'),decision_source='employer',decided_by_user_id=shelf,final_at=pg_temp.d('Oct 26 15:00'),paid_ledger_tx_id=t WHERE id=sub;
  t2:=pg_temp.post(77131,'platform_fee','submission:SB-204120:fee',pg_temp.d('Oct 26 15:00'),'{"title":"Check 15 shop addresses on a map","percent":"10"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(shelf,'employer_reserved'),'platform_fee',-0.014),jsonb_build_array(pg_temp.sys('platform_revenue'),'platform_fee',0.014)),job=>j5,sub=>sub);
  rc:=pg_temp.uid('300004');
  INSERT INTO referral_commissions(id,referral_id,referrer_user_id,referred_user_id,source_type,submission_id,base_amount,rate,amount,status,created_at) VALUES (rc,ref_r,nus,rah,'task',sub,0.14,0.05,0.007,'pending',pg_temp.d('Oct 26 15:00'));
  t:=pg_temp.post(77132,'referral_commission','referral:'||rc||':credit',pg_temp.d('Oct 26 15:00'),'{"friend":"Ra***a","source":"task"}',jsonb_build_array(jsonb_build_array(pg_temp.sys('referral_expense'),'referral_commission',-0.007),jsonb_build_array(pg_temp.acct(nus,'worker_earnings'),'referral_commission',0.007)),sub=>sub,rc=>rc);
  UPDATE referral_commissions SET status='credited',ledger_tx_id=t,credited_at=pg_temp.d('Oct 26 15:00') WHERE id=rc;
  -- Pause WJ-57990: release 9 free slots x 0.120 (one slot stays reserved for needs_fix)
  t:=pg_temp.post(77140,'job_release','job:WJ-57990:pause',pg_temp.d('Oct 26 20:00'),'{"title":"Categorize 12 shoe photos","reason":"paused, budget released"}',jsonb_build_array(jsonb_build_array(pg_temp.acct(shelf,'employer_reserved'),'job_release',-1.08),jsonb_build_array(pg_temp.acct(shelf,'employer_available'),'job_release',1.08)),job=>j3,actor=>'user');
  UPDATE jobs SET status='paused',pause_reason='employer',paused_at=pg_temp.d('Oct 26 20:00') WHERE id=j3;
  PERFORM setval('ledger_tx_seq', 77200);
  -- job counters from truth
  UPDATE jobs j SET
    count_active_reservations=(SELECT count(*) FROM slot_reservations r WHERE r.job_id=j.id AND r.status='active'),
    count_starts=(SELECT count(*) FROM slot_reservations r WHERE r.job_id=j.id),
    count_in_review=(SELECT count(*) FROM submissions s WHERE s.job_id=j.id AND s.status='in_review'),
    count_needs_fix=(SELECT count(*) FROM submissions s WHERE s.job_id=j.id AND s.status='needs_fix'),
    count_approved=(SELECT count(*) FROM submissions s WHERE s.job_id=j.id AND s.status='approved'),
    count_rejected=(SELECT count(*) FROM submissions s WHERE s.job_id=j.id AND s.status='rejected'),
    count_views=(SELECT coalesce(sum(1),0) FROM job_views v WHERE v.job_id=j.id),
    spent_usd=(SELECT coalesce(sum(s.reward_usd+s.fee_usd),0) FROM submissions s WHERE s.job_id=j.id AND s.status='approved'),
    first_submission_at=(SELECT min(s.first_submitted_at) FROM submissions s WHERE s.job_id=j.id),
    reserve_outstanding_usd=(SELECT coalesce(sum(le.amount),0) FROM ledger_entries le JOIN ledger_transactions lt ON lt.id=le.transaction_id JOIN wallet_accounts wa ON wa.id=le.account_id WHERE lt.job_id=j.id AND wa.kind='employer_reserved');
  -- notifications, prefs, content, admin
  INSERT INTO notifications(user_id,audience,category,type,title,body,link_path,data,is_mandatory,created_at,expires_at) VALUES
   (nus,'worker','tasks','task_approved','Task approved · +$0.120','“Answer a 5-minute grocery shopping survey” was approved by Orbit Research.','/worker/tasks/SB-204101','{"submission_ref":"SB-204101","amount":"0.120000"}',false,pg_temp.d('Oct 26 09:40'),pg_temp.d('Oct 26 09:40')+interval '90 days'),
   (nus,'worker','payments','withdrawal_paid','Withdrawal paid · $10.00','Sent to your mobile wallet ending 569.','/worker/wallet/withdrawals?ref=WD-90377','{"withdrawal_ref":"WD-90377"}',true,pg_temp.d('Oct 24 15:00'),pg_temp.d('Oct 24 15:00')+interval '90 days'),
   (shelf,'employer','tasks','new_submissions_digest','5 new submissions','5 submissions are waiting for your review.','/employer/submissions?job=WJ-58213&tab=to_review','{"count":5}',false,pg_temp.d('Oct 26 09:00'),pg_temp.d('Oct 26 09:00')+interval '90 days');
  UPDATE notifications SET read_at=pg_temp.d('Oct 24 16:00') WHERE type='withdrawal_paid';
  INSERT INTO notification_preferences(user_id,pref_key,in_app_enabled,email_enabled,is_locked) VALUES
   (nus,'task_approved',true,true,false),(nus,'payout_updates',true,true,true),(nus,'new_jobs_matching',false,false,false),(shelf,'monthly_spending_report',false,false,false);
  INSERT INTO contact_messages(user_id,full_name,email,topic,account_public_id,message,consent_at,ip_address,created_at) VALUES
   (nus,'Nusrat Jahan','nusrat.j@example.com','payments_withdrawals','482910','My withdrawal WD-90412 of $10.00 from Oct 26 is still processing. Please check.',pg_temp.d('Oct 26 18:30'),'103.120.0.10',pg_temp.d('Oct 26 18:30'));
  INSERT INTO help_articles(topic_id,slug,title,summary,body_md,is_popular,popular_label,sort_order,published_at,updated_by_admin_id)
   SELECT id,'minimum-withdrawal','What is the minimum withdrawal?','Minimums per payout method.','Each payout method has its own minimum, shown on the Withdraw page before you confirm.',true,'Minimum withdrawal',1,pg_temp.d('Oct 01 10:00'),mod_ FROM help_topics WHERE slug='payments-withdrawals';
  INSERT INTO legal_pages(slug,version,title,body_md,effective_at,is_current,published_by_admin_id) VALUES ('refund','2026-11-01','Refund policy','Refund text supplied by the client (D-17).',pg_temp.d('Nov 01 00:00'),true,adm);
  INSERT INTO account_restrictions(id,user_id,kind,reason_code,internal_note,public_message,created_by_admin_id,starts_at) VALUES
   (pg_temp.uid('110001'),bad,'restricted','duplicate_account','Same device and payout number as another account.','Your account is restricted while we review duplicate-account activity.',mod_,pg_temp.d('Oct 25 10:00'));
  INSERT INTO appeals(user_id,restriction_id,message,status,created_at) VALUES (bad,pg_temp.uid('110001'),'This is my only account. My brother uses the same phone.','open',pg_temp.d('Oct 25 16:00'));
  INSERT INTO audit_logs(actor_type,actor_admin_id,action,entity_type,entity_id,entity_ref,before_data,after_data,ip_address,request_id,created_at) VALUES
   ('admin',adm,'withdrawal.mark_processing','withdrawal',pg_temp.uid('90412'),'WD-90412','{"status":"requested"}','{"status":"processing"}','10.0.2.14','req_01J9XK3',pg_temp.d('Oct 26 10:40'));
  INSERT INTO withdrawal_quotes(id,user_id,payout_method_id,method,amount_usd,fee_usd,payout_currency,exchange_rate_id,fx_rate,receive_amount,expires_at,consumed_at,created_at) VALUES
   (pg_temp.uid('810412'),nus,pm_b,'bkash',10,0,'BDT',fx_b,121.5,1215,pg_temp.d('Oct 26 10:24'),pg_temp.d('Oct 26 10:15'),pg_temp.d('Oct 26 10:14'));
  UPDATE withdrawals SET quote_id=pg_temp.uid('810412') WHERE public_ref='WD-90412';
  INSERT INTO withdrawal_batches(id,method,row_count,total_amount_usd,created_by_admin_id,created_at) VALUES (pg_temp.uid('820001'),'bkash',1,10,adm,pg_temp.d('Oct 26 10:40'));
  UPDATE withdrawals SET batch_id=pg_temp.uid('820001') WHERE public_ref='WD-90412';
  INSERT INTO ledger_adjustment_requests(account_id,amount,reason_code,internal_note,visible_text,created_by_admin_id,expires_at,created_at) VALUES
   (pg_temp.acct(rah,'worker_earnings'),0.05,'goodwill','Rounding complaint in support ticket.','Goodwill credit',adm,pg_temp.d('Oct 29 18:00'),pg_temp.d('Oct 26 18:00'));
  INSERT INTO provider_settlement_lines(settlement_id,provider,provider_payment_id,gross_amount,fee_amount,net_amount,currency,settled_on,deposit_id,match_status) VALUES
   (pg_temp.uid('830001'),'nowpayments','np_104210',25,0.125,24.875,'USD','2026-10-25',pg_temp.uid('10421'),'matched');
  INSERT INTO provider_statement_lines(rail,provider_trx_id,direction,amount,currency,counterparty,occurred_at) VALUES ('treasury:usdt_hot_wallet','7f3e…91ab','out',9,'USDT','T9x…k2a',pg_temp.d('Oct 24 15:00'));
  INSERT INTO reconciliation_runs(id,job_name,status,started_at,finished_at,item_count,summary) VALUES (pg_temp.uid('840001'),'recon.ledger_integrity','passed',pg_temp.d('Oct 27 02:00'),pg_temp.d('Oct 27 02:01'),1,'{"checks":7}');
  INSERT INTO reconciliation_items(run_id,check_code,severity,entity_type,entity_ref,detail,resolved_at,resolution_note) VALUES (pg_temp.uid('840001'),'P-1','high','withdrawal','WD-90377','{"note":"statement not imported yet"}',pg_temp.d('Oct 27 09:00'),'Statement imported.');
  INSERT INTO idempotency_keys(actor_type,actor_id,key,method,path,request_hash,status,response_code,response_body,locked_until,created_at,expires_at) VALUES
   ('user',nus,'6f1d7c2a-8c9e-4a5b-9d31-2b6f0c7e1a44','POST','/api/v1/withdrawals','\x7a31','completed',201,'{"reference":"WD-90412","status":"requested"}',pg_temp.d('Oct 26 10:16'),pg_temp.d('Oct 26 10:15'),pg_temp.d('Oct 27 10:15'));
END $main$;
COMMIT;
