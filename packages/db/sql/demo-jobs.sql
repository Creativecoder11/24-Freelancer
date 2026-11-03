-- Demo marketplace data matching the Figma sample jobs (pages 01, 02, 04). Local/dev only.
-- Re-runnable: re-times existing demo jobs relative to now() and upserts the extra employers and jobs.
BEGIN;

CREATE TEMP TABLE demo_employers(pub text, name text, rate int, review_h int, posted int) ON COMMIT DROP;
INSERT INTO demo_employers VALUES
 ('120802','Lumen Apps',94,10,22),('120803','Pocketly',91,16,9),('120804','Crumb & Co.',97,8,6),
 ('120805','Pixelorb Studio',95,12,31),('120806','Kotha Translate',93,18,17),('120807','Pathfinder BD',96,9,26),
 ('120808','Cartly',92,20,11),('120809','Brightline Media',90,22,14),('120810','Tasty Bites',95,11,8),('120811','Formly',93,15,12);

INSERT INTO users(public_id, full_name, email, email_verified_at, password_hash, password_changed_at, country_code, active_mode, default_mode, signup_role, terms_accepted_at, terms_version, onboarding_step, onboarding_completed_at)
SELECT d.pub, d.name, lower(regexp_replace(d.name,'[^A-Za-z]','','g'))||'@example.com', now(), '$argon2id$v=19$m=65536,t=3,p=4$c2FtcGxl$c2FtcGxlaGFzaA', now(), 'BD', 'employer', 'employer', 'employer', now(), '2026-01-01', 4, now()
FROM demo_employers d ON CONFLICT (public_id) DO NOTHING;

INSERT INTO wallet_accounts(owner_user_id, kind)
SELECT u.id, k.kind::wallet_account_kind FROM users u JOIN demo_employers d ON d.pub=u.public_id
CROSS JOIN (VALUES ('worker_earnings'),('employer_available'),('employer_reserved')) k(kind)
ON CONFLICT DO NOTHING;

INSERT INTO employer_profiles(user_id, business_name, verification_status, employer_verified_at, approval_rate_pct, avg_review_seconds, jobs_posted_count)
SELECT u.id, d.name, 'verified', now() - interval '200 days', d.rate, d.review_h*3600, d.posted
FROM users u JOIN demo_employers d ON d.pub=u.public_id ON CONFLICT (user_id) DO NOTHING;

UPDATE employer_profiles SET verification_status='verified', employer_verified_at='2024-03-12',
  approval_rate_pct=coalesce(approval_rate_pct,96), avg_review_seconds=coalesce(avg_review_seconds,14*3600), jobs_posted_count=greatest(jobs_posted_count,41)
WHERE business_name IN ('Shelfwise Ltd.','Orbit Research');

-- Jobs: (public_id, employer, category, title, minutes(est), display, proof types, reward, slots, approved, minutes ago)
CREATE TEMP TABLE demo_jobs(pid text, emp text, cat text, title text, est int, disp int, proofs proof_type[], reward numeric, slots int, filled int, ago int) ON COMMIT DROP;
INSERT INTO demo_jobs VALUES
 ('WJ-58401','Orbit Research','surveys','Answer a 5-minute grocery shopping survey',5,5,'{screenshot}',0.120,120,61,9),
 ('WJ-58402','Lumen Apps','website-testing','Sign up on a beta website and report broken steps',10,12,'{text}',0.350,25,3,14),
 ('WJ-58403','Pocketly','app-testing','Install a budgeting app and finish onboarding',10,10,'{screenshot,text}',0.300,30,9,31),
 ('WJ-58404','Crumb & Co.','writing','Write 3 one-line product descriptions for a bakery',5,7,'{text}',0.250,30,22,48),
 ('WJ-58405','Pixelorb Studio','image-tagging','Tag 30 photos as indoor or outdoor',5,5,'{link}',0.150,100,75,60),
 ('WJ-58406','Shelfwise Ltd.','data-entry','Copy 40 product prices from a catalogue PDF',2,4,'{link}',0.160,50,32,120),
 ('WJ-58407','Brightline Media','surveys','Rate 10 short video ads for clarity (1–5)',2,4,'{text}',0.110,100,60,180),
 ('WJ-58408','Pathfinder BD','research','Find opening hours for 12 local pharmacies',10,8,'{link}',0.200,20,5,300),
 ('WJ-58410','Tasty Bites','surveys','Share feedback on a food delivery checkout',5,5,'{text}',0.200,50,38,125),
 ('WJ-58411','Shelfwise Ltd.','data-entry','Tag the mood of 30 customer comments',5,5,'{link}',0.150,100,75,190),
 ('WJ-58412','Lumen Apps','surveys','Pick the clearer of two app icons (20 pairs)',2,3,'{text}',0.080,200,110,245),
 ('WJ-58413','Formly','website-testing','Complete a short survey after testing a signup form',10,10,'{text,screenshot}',0.300,25,12,300),
 ('WJ-58414','Orbit Research','surveys','Tell us how you shop for groceries online (8 questions)',5,6,'{text}',0.150,150,70,360),
 ('WJ-58415','Kotha Translate','writing','Transcribe a 30-second voice note (Bangla)',5,6,'{text}',0.250,40,18,95),
 ('WJ-58416','Shelfwise Ltd.','data-entry','Categorize 20 product photos into a shared sheet',5,5,'{screenshot,link}',0.180,40,8,40),
 ('WJ-58417','Cartly','app-testing','Sign up and test a checkout flow on Android',10,12,'{screenshot,text}',0.350,30,11,210),
 ('WJ-58418','Pixelorb Studio','image-tagging','Draw boxes around street signs in 15 photos',10,9,'{file}',0.220,60,24,410),
 ('WJ-58419','Brightline Media','social-media','Follow our page and share honest feedback on one post',2,3,'{screenshot}',0.100,200,140,150),
 ('WJ-58420','Kotha Translate','writing','Translate 5 sentences from English to Bangla',10,8,'{text}',0.300,30,9,520),
 ('WJ-58421','Lumen Apps','website-testing','Test the password reset flow and note any errors',5,7,'{text}',0.280,20,4,640),
 ('WJ-58422','Pocketly','app-testing','Rate the onboarding screens of a savings app',5,6,'{text}',0.260,40,15,700),
 ('WJ-58423','Pathfinder BD','research','Collect phone numbers for 10 clinics from their websites',10,11,'{link}',0.240,25,7,820),
 ('WJ-58424','Crumb & Co.','social-media','Suggest 3 short captions for a cake photo',2,4,'{text}',0.120,60,33,900),
 ('WJ-58425','Tasty Bites','image-tagging','Mark which of 25 food photos are blurry',5,5,'{link}',0.140,80,46,980),
 ('WJ-58426','Formly','data-entry','Enter 30 survey answers from scanned forms',15,14,'{link}',0.400,30,6,1100);

INSERT INTO jobs(public_id, employer_user_id, category_id, title, time_per_task, est_minutes, display_minutes, proof_types, reward_usd,
  slots_total, count_approved, status, published_at, ends_at, posting_rules_accepted_at, wizard_step, task_link_url, proof_instructions, count_views, count_starts)
SELECT j.pid, u.id, c.id, j.title, ('about_'||j.est)::time_per_task, j.est, j.disp, j.proofs, j.reward, j.slots, j.filled, 'running',
  now() - make_interval(mins => j.ago), now() - make_interval(mins => j.ago) + interval '7 days', now() - make_interval(mins => j.ago), 4,
  'https://docs.google.com/spreadsheets/d/demo', 'Follow every step and add the proof listed below.', j.filled*30, j.filled*4
FROM demo_jobs j JOIN employer_profiles e ON e.business_name=j.emp JOIN users u ON u.id=e.user_id JOIN categories c ON c.slug=j.cat
ON CONFLICT (public_id) DO UPDATE SET published_at=EXCLUDED.published_at, ends_at=EXCLUDED.ends_at, status='running', count_approved=EXCLUDED.count_approved;

DELETE FROM jobs WHERE public_id='WJ-58409' AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.job_id=jobs.id);

-- Steps and proof items for the new jobs (generic, three steps).
INSERT INTO job_steps(job_id, position, body)
SELECT jb.id, s.pos, s.body FROM jobs jb JOIN demo_jobs j ON j.pid=jb.public_id
CROSS JOIN (VALUES (1,'Open the task link and read the brief once before you start.'),
                   (2,'Complete every item exactly as described in the brief.'),
                   (3,'Prepare the proof listed below and check it against the brief.')) s(pos,body)
WHERE NOT EXISTS (SELECT 1 FROM job_steps x WHERE x.job_id=jb.id);

INSERT INTO job_proof_requirements(job_id, position, proof_type, title, helper)
SELECT jb.id, p.ord, p.pt, CASE p.pt WHEN 'screenshot' THEN 'One screenshot of the finished work' WHEN 'link' THEN 'Share link to your work'
  WHEN 'text' THEN 'Your written answer' ELSE 'Upload the finished file' END,
  CASE p.pt WHEN 'link' THEN 'Anyone with the link must be able to view it.' WHEN 'screenshot' THEN 'Full screen visible — cropped screenshots are usually returned for a fix.' ELSE NULL END
FROM jobs jb JOIN demo_jobs j ON j.pid=jb.public_id CROSS JOIN LATERAL unnest(j.proofs) WITH ORDINALITY p(pt,ord)
WHERE NOT EXISTS (SELECT 1 FROM job_proof_requirements x WHERE x.job_id=jb.id);

-- Re-time the original fixture jobs so they are live today (Figma: posted 2 min ago etc.).
UPDATE jobs SET published_at = now() - interval '2 minutes', ends_at = now() + interval '5 days', count_approved = 14 - count_in_review - count_needs_fix - count_active_reservations
  WHERE public_id='WJ-58213';
UPDATE jobs SET published_at = now() - interval '9 days' + interval '8 days', ends_at = now() + interval '3 days' WHERE public_id='WJ-58102';
UPDATE jobs SET published_at = now() - interval '1 hour', ends_at = now() + interval '6 days' WHERE public_id='WJ-58344';

COMMIT;
