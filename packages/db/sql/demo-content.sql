-- DEV/DEMO ONLY: draft FAQ answers built from the documented rules (Doc 01 BR, Canonical §17).
-- Replace with the client's approved copy before launch (G-14).
BEGIN;
UPDATE faqs SET is_published = true, answer_md = CASE question
 WHEN 'When do I get paid?' THEN 'The reward is added to your balance the moment your task is approved. Employers review within the window shown on each job (usually 72 hours); if they don''t, the task is approved automatically.'
 WHEN 'What happens if my task is rejected?' THEN 'Every rejection includes the employer''s reason. If they ask for a fix, you can correct your proof and resubmit before the deadline shown on the task. If you think a decision is wrong, you can open a dispute.'
 WHEN 'What is the minimum withdrawal?' THEN 'Each payout method shows its minimum, fee and usual timing before you confirm. For mobile wallets the minimum is $5.00.'
 WHEN 'How do I post a job, and what does it cost?' THEN 'Post a job in four steps: describe it, add numbered steps and the proof you need, set the reward and slots, then review and publish. You pay the reward only for approved tasks; the full budget (slots × reward) is reserved when you publish and unused budget returns to your deposit.'
 WHEN 'How does the referral commission work?' THEN 'Share your invite link. You earn 5% of your friends'' approved task rewards and 5% of their deposits, added to your balance automatically. Self-referrals and duplicate accounts don''t earn commission.'
 WHEN 'Why was my task rejected?' THEN 'Open the task in My tasks to read the employer''s reason. Most rejections are for incomplete proof or steps that weren''t followed.'
 WHEN 'Can I resubmit a rejected task?' THEN 'Yes, when the employer asks for a fix. Upload new proof before the resubmit deadline. A final rejection can''t be resubmitted, but you can open a dispute.'
 WHEN 'Why do I need to verify my account?' THEN 'We verify your identity with your National ID before your first withdrawal. It protects your balance and keeps duplicate accounts out.'
 WHEN 'How do employers get refunded for unused slots?' THEN 'When a job closes, ends or is paused, the budget for slots nobody used returns to your deposit balance automatically.'
 WHEN 'My account was restricted — how do I appeal?' THEN 'Contact support from the Help center with your account ID. Our team reviews every appeal and replies by email.'
 ELSE answer_md END
WHERE NOT is_published;
COMMIT;
