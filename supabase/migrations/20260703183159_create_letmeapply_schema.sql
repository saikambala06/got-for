/*
# LetMeApply Schema

1. New Tables
   - `users` — app user profiles linked to auth.users (id, name, email, avatar, plan, usage counters)
   - `job_applications` — job tracking per user (company, title, status, applied_on, notes, etc.)
   - `resumes` — resume storage per user (name, content, file_url, is_default)
   - `stats` — daily activity stats per user (jobs_viewed, jobs_applied)

2. Security
   - RLS enabled on all tables
   - Each table scoped to authenticated owner via auth.uid() = user_id
   - users table scoped via auth.uid() = id

3. Notes
   - users.id matches auth.users.id (no separate user_id column on users)
   - All other tables use user_id referencing auth.users(id) ON DELETE CASCADE
   - plan enum: 'free' | 'pro'
   - job_applications.status enum: 'applied' | 'interviewing' | 'offer' | 'rejected' | 'saved'
*/

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  avatar text DEFAULT '',
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  job_extractions int NOT NULL DEFAULT 0,
  job_extractions_limit int NOT NULL DEFAULT 6,
  tailored_resumes int NOT NULL DEFAULT 0,
  tailored_resumes_limit int NOT NULL DEFAULT 2,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  company text NOT NULL,
  title text NOT NULL,
  location text DEFAULT '',
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'interviewing', 'offer', 'rejected', 'saved')),
  applied_on timestamptz DEFAULT now(),
  notes text DEFAULT '',
  url text DEFAULT '',
  salary text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resumes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  content text DEFAULT '',
  file_url text DEFAULT '',
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  jobs_viewed int NOT NULL DEFAULT 0,
  jobs_applied int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_job_applications_user_id ON job_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_applied_on ON job_applications(applied_on);
CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_stats_user_id_date ON stats(user_id, date);

-- RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE stats ENABLE ROW LEVEL SECURITY;

-- users policies
DROP POLICY IF EXISTS "select_own_user" ON users;
CREATE POLICY "select_own_user" ON users FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_user" ON users;
CREATE POLICY "insert_own_user" ON users FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_user" ON users;
CREATE POLICY "update_own_user" ON users FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "delete_own_user" ON users;
CREATE POLICY "delete_own_user" ON users FOR DELETE TO authenticated USING (auth.uid() = id);

-- job_applications policies
DROP POLICY IF EXISTS "select_own_jobs" ON job_applications;
CREATE POLICY "select_own_jobs" ON job_applications FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_jobs" ON job_applications;
CREATE POLICY "insert_own_jobs" ON job_applications FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_jobs" ON job_applications;
CREATE POLICY "update_own_jobs" ON job_applications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_jobs" ON job_applications;
CREATE POLICY "delete_own_jobs" ON job_applications FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- resumes policies
DROP POLICY IF EXISTS "select_own_resumes" ON resumes;
CREATE POLICY "select_own_resumes" ON resumes FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_resumes" ON resumes;
CREATE POLICY "insert_own_resumes" ON resumes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_resumes" ON resumes;
CREATE POLICY "update_own_resumes" ON resumes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_resumes" ON resumes;
CREATE POLICY "delete_own_resumes" ON resumes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- stats policies
DROP POLICY IF EXISTS "select_own_stats" ON stats;
CREATE POLICY "select_own_stats" ON stats FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_stats" ON stats;
CREATE POLICY "insert_own_stats" ON stats FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_stats" ON stats;
CREATE POLICY "update_own_stats" ON stats FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_stats" ON stats;
CREATE POLICY "delete_own_stats" ON stats FOR DELETE TO authenticated USING (auth.uid() = user_id);
