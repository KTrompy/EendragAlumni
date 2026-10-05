-- ============================================================
-- Update 61: add indexes for five foreign keys that had none.
-- Run this in the Supabase SQL Editor. Safe to re-run. (Already run on 2026-10-05.)
-- ============================================================
--
-- Supabase's performance advisor flagged these five foreign keys as having no
-- covering index. Without one, deleting or updating a row in the parent table
-- (e.g. a profile) has to scan the child table to check nothing points at it.
-- At today's size that is instant; the indexes keep it that way as the tables grow.
--
-- Purely additive: no data or behaviour changes.
--
-- TO UNDO, run:
--     drop index if exists public.legends_created_by_idx,
--                          public.mentorship_goals_created_by_idx,
--                          public.mentorship_sessions_logged_by_idx,
--                          public.mentorships_ended_by_idx,
--                          public.mentorships_initiated_by_idx;

create index if not exists legends_created_by_idx on public.legends (created_by);
create index if not exists mentorship_goals_created_by_idx on public.mentorship_goals (created_by);
create index if not exists mentorship_sessions_logged_by_idx on public.mentorship_sessions (logged_by);
create index if not exists mentorships_ended_by_idx on public.mentorships (ended_by);
create index if not exists mentorships_initiated_by_idx on public.mentorships (initiated_by);
