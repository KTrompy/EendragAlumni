-- ============================================================
-- Update 65: signup / onboarding journey (2026-10-06)
-- Run this in the Supabase SQL Editor AFTER schema-update-64.sql.
-- Safe to re-run. All one transaction: if anything fails, nothing changes.
-- ============================================================
--
-- 1. profiles.application_email_sent_at
--    The "We've received your Eendrag Alumni application" email is now sent
--    by the send-member-email Edge Function when the applicant first reaches
--    the "under review" screen — i.e. AFTER their email is confirmed, which
--    is the only point every applicant passes through. (It used to be sent
--    from the signup form, which never has a session when email
--    confirmation is on, so normal email signups never got it.)
--    The function claims this column before sending, so the email goes out
--    at most once per account however many times the screen is opened.
--
--    Backfill: every account that has already finished signing up is marked
--    as sent, so nobody who already got the old "we've got your details"
--    email is sent a second one. (We can't tell from the database which
--    pending applicants got it, so none of the existing ones get the new one.)
--
-- 2. Admin → Members shows Eendrag years as "2015–2018", not just the final
--    year, so admin_members_page and admin_get_member now also return
--    start_year (and search matches it, and country). Their return shape
--    changes, so they are dropped and recreated — same bodies as
--    schema-update-63 otherwise.
--
-- Nothing here touches RLS, approval, or the self-escalation triggers.

begin;

/* ------------------------------------------------------------------
   1. application_email_sent_at
   ------------------------------------------------------------------ */
alter table public.profiles
  add column if not exists application_email_sent_at timestamptz;

-- start_year has been written by signup since schema-update-46 but no
-- migration file in the repo ever creates it (it was added by hand). Listed
-- here so a fresh database built from these files matches the live one.
-- A no-op on the live database.
alter table public.profiles
  add column if not exists start_year int;

update public.profiles
   set application_email_sent_at = coalesce(consented_at, created_at, now())
 where consented_at is not null
   and application_email_sent_at is null;


/* ------------------------------------------------------------------
   2. Admin member list + detail return start_year
   ------------------------------------------------------------------ */
drop function if exists public.admin_members_page(text, text, text, boolean, integer, integer);

create function public.admin_members_page(
  p_filter text default 'all',
  p_search text default null,
  p_sort   text default 'joined',
  p_desc   boolean default true,
  p_limit  integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  email text,
  email_confirmed_at timestamptz,
  full_name text,
  first_name text,
  preferred_name text,
  last_name text,
  start_year int,
  grad_year int,
  city text,
  country text,
  avatar_url text,
  approved boolean,
  is_admin boolean,
  created_at timestamptz,
  consented_at timestamptz,
  declined_at timestamptz,
  declined_reason text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  -- Escape LIKE wildcards so a search for "50%" means 50%.
  if v_q is not null then
    v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  end if;

  return query
    select p.id, u.email::text, u.email_confirmed_at, p.full_name,
           p.first_name, p.preferred_name, p.last_name,
           p.start_year, p.grad_year, p.city, p.country, nullif(p.avatar_url, ''),
           p.approved, p.is_admin,
           p.created_at, p.consented_at, p.declined_at, p.declined_reason,
           count(*) over ()
      from public.profiles p
      join auth.users u on u.id = p.id
     where (case coalesce(p_filter, 'all')
              when 'pending'     then not p.approved and p.declined_at is null
                                      and p.consented_at is not null and u.email_confirmed_at is not null
              when 'unconfirmed' then not p.approved and p.declined_at is null
                                      and u.email_confirmed_at is null
              when 'incomplete'  then not p.approved and p.declined_at is null
                                      and p.consented_at is null
              when 'declined'    then p.declined_at is not null
              when 'admins'      then p.is_admin
              when 'approved'    then p.approved
              else true
            end)
       and (v_q is null or concat_ws(' ', p.full_name, p.first_name, p.preferred_name, p.last_name,
                                     u.email, p.city, p.country, p.start_year::text, p.grad_year::text) ilike '%' || v_q || '%')
     order by
       case when p_sort = 'name'  and not p_desc then lower(p.full_name) end asc  nulls last,
       case when p_sort = 'name'  and p_desc     then lower(p.full_name) end desc nulls last,
       case when p_sort = 'class' and not p_desc then p.grad_year end asc  nulls last,
       case when p_sort = 'class' and p_desc     then p.grad_year end desc nulls last,
       case when p_sort = 'joined' and not p_desc then p.created_at end asc,
       p.created_at desc,
       p.id
     limit v_limit offset v_offset;
end;
$$;

revoke all on function public.admin_members_page(text, text, text, boolean, integer, integer) from public;
revoke execute on function public.admin_members_page(text, text, text, boolean, integer, integer) from anon;
grant execute on function public.admin_members_page(text, text, text, boolean, integer, integer) to authenticated;


drop function if exists public.admin_get_member(uuid);

create function public.admin_get_member(p_id uuid)
returns table (
  id uuid,
  email text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  full_name text,
  first_name text,
  preferred_name text,
  last_name text,
  start_year int,
  grad_year int,
  city text,
  country text,
  avatar_url text,
  approved boolean,
  is_admin boolean,
  created_at timestamptz,
  consented_at timestamptz,
  declined_at timestamptz,
  declined_reason text,
  last_seen timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select p.id, u.email::text, u.email_confirmed_at, u.last_sign_in_at, p.full_name,
           p.first_name, p.preferred_name, p.last_name,
           p.start_year, p.grad_year, p.city, p.country, nullif(p.avatar_url, ''),
           p.approved, p.is_admin,
           p.created_at, p.consented_at, p.declined_at, p.declined_reason, p.last_seen
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.id = p_id;
end;
$$;

revoke all on function public.admin_get_member(uuid) from public;
revoke execute on function public.admin_get_member(uuid) from anon;
grant execute on function public.admin_get_member(uuid) to authenticated;

commit;
