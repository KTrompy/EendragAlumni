-- ============================================================
-- Update 60: stop broadcasting live changes for two tables nobody listens to.
-- Run this in the Supabase SQL Editor. (Already run on 2026-10-05.)
-- ============================================================
--
-- Supabase Realtime only needs to watch tables the app actually subscribes to
-- with supabase.channel(...).on('postgres_changes', ...). A search of src/
-- shows nothing subscribes to `post_likes` or `event_comments` (likes and
-- event comments are read with normal queries), so announcing their changes
-- was wasted work for the database.
--
-- Nothing else changes: likes and event comments still work exactly as
-- before. The other 11 tables stay in the publication.
--
-- TO UNDO, run:
--     alter publication supabase_realtime add table public.post_likes, public.event_comments;
--
-- Not safe to re-run as-is (it errors if the tables are already removed).

alter publication supabase_realtime drop table public.post_likes, public.event_comments;
