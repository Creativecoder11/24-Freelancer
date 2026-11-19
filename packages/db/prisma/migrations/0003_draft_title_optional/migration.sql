-- 0003: the post-a-job wizard now starts with Location, so a draft is created before it has a title.
-- The 10-character title rule applies once the job leaves draft (publish validates step 3 first).
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_title_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_title_check CHECK (status = 'draft' OR length(btrim(title)) >= 10);
