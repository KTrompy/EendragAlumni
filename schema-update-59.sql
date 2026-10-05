-- ============================================================
-- Update 59: TEMPORARY — let the September 2026 intake straight in.
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================
--
-- *** CLOSED 2026-10-05 — the intake is over. ***
-- The approval gate was put back by running (in the SQL Editor):
--     alter table public.profiles alter column approved set default false;
-- and "Confirm email" is switched back on in the Supabase dashboard
-- (custom SMTP is enabled). New signups wait in the admin queue again.
-- Do NOT re-run the line below unless you want to open the gate again.
--
-- A large batch of Eendragters is signing up at once and neither gate is
-- worth making them wait on right now:
--
--   * the confirmation email  — turned off in the dashboard, not here
--     (Authentication → Sign In / Providers → Email → "Confirm email").
--   * committee approval      — this file.
--
-- NOTHING IS REMOVED. The `approved` column, the admin queue, the approval
-- and decline RPCs, PendingVerification.jsx and every is_approved() check in
-- RLS all stay exactly as they are. The only change is which value a brand
-- new profile row starts at.
--
-- TO PUT THE GATE BACK, run this one line:
--     alter table public.profiles alter column approved set default false;
-- Members approved while the gate was open stay approved; anyone who signs
-- up after that lands in the admin queue again as before.

alter table public.profiles alter column approved set default true;

comment on column public.profiles.approved is
  'Verified against Eendrag residence records. TEMPORARILY defaults to true (schema-update-59, Sept 2026 intake) so new signups are not queued — set the default back to false to re-enable committee approval.';


-- ---------- OPTIONAL: let the people already waiting in ----------
-- Uncomment the whole block and run it if you also want everyone currently
-- sitting on the "we're verifying you" screen to be let in.
--
-- The trigger dance is required, not optional: prevent_self_privilege_escalation
-- (schema-update-57/58) refuses any change to `approved` unless is_admin() is
-- true, and in the SQL Editor auth.uid() is null, so is_admin() is false and a
-- plain UPDATE here fails. Disable it for the statement and put it straight back.
--
-- The WHERE clause deliberately skips anyone who was declined and anyone whose
-- email address is still unconfirmed — require_confirmed_email_for_approval
-- would reject those rows and take the whole statement down with them.
--
-- begin;
--   alter table public.profiles disable trigger on_self_privilege_escalation;
--   update public.profiles p
--      set approved = true
--    where p.approved = false
--      and p.declined_at is null
--      and p.consented_at is not null
--      and exists (
--        select 1 from auth.users u
--         where u.id = p.id and u.email_confirmed_at is not null
--      );
--   alter table public.profiles enable trigger on_self_privilege_escalation;
-- commit;


-- ---------- CHECKS ----------
-- Expected after a successful run: 'true'
-- select column_default from information_schema.columns
--  where table_schema = 'public' and table_name = 'profiles'
--    and column_name = 'approved';
--
-- Who is still waiting (should only be people who signed up before this ran,
-- unless you ran the optional block above):
-- select count(*) from public.profiles where not approved and declined_at is null;
