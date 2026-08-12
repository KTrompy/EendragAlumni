-- ============================================================
-- Update 58: "ghost" accounts — browse-only, invisible members.
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================
--
-- A ghost is an ordinary approved member account with two differences:
--
--   1. Nobody can see them. They don't appear in Eendragters (list or map),
--      Global Search, Who's Online, Mentoring, or the community strip on
--      Home, and their /people/:id page 404s for everyone else. This is not
--      a UI filter — the profiles SELECT policy stops the row leaving the
--      database, so every one of those surfaces goes dark at once and any
--      surface added later is covered by default.
--   2. They can't write anything. No posts, comments, likes, messages,
--      events, RSVPs, jobs, applications, businesses, mentorship requests
--      or reports. They browse and that's it — so they never leave a trace
--      that would give them away.
--
-- Admins still see ghosts (in Admin → Members, flagged as such) — otherwise
-- the account would be unmanageable and impossible to un-ghost.
--
-- Ghost is granted, never self-selected: only an admin can set the flag, and
-- ghost accounts are created from Admin → Members → Add ghost account, which
-- issues them their own separate email + password via the admin-create-ghost
-- Edge Function. A ghost is not an admin and can never become one.

-- ---------- THE FLAG ----------
alter table public.profiles
  add column if not exists is_ghost boolean not null default false;

comment on column public.profiles.is_ghost is
  'Browse-only, invisible account. Hidden from every member-facing surface by the profiles SELECT policy and blocked from all writes by the enforce_ghost_read_only triggers. Admin-set only (see prevent_self_privilege_escalation).';

-- Partial index: ghosts are a handful of rows out of the whole membership,
-- and the only question ever asked of this column is "which ones are true".
create index if not exists profiles_is_ghost_idx
  on public.profiles (id) where is_ghost;

-- A ghost must never hold admin rights — the two are contradictory (an admin
-- is listed, contactable and accountable). Belt and braces alongside the
-- trigger check below.
create or replace function public.prevent_ghost_admin()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.is_ghost and new.is_admin then
    raise exception 'A ghost account cannot also be an admin.';
  end if;
  return new;
end;
$function$;

drop trigger if exists on_ghost_admin_conflict on public.profiles;
create trigger on_ghost_admin_conflict
  before insert or update of is_ghost, is_admin on public.profiles
  for each row execute function public.prevent_ghost_admin();

-- ---------- IS THE CALLER A GHOST? ----------
-- SECURITY DEFINER so it reads profiles with RLS out of the way — the same
-- pattern as is_admin()/is_approved(), and the reason it can be referenced
-- from a policy on profiles without the recursion trap that schema-update-48
-- fell into (see schema-update-50 for that story).
--
-- Returns false for a null auth.uid(), which is what the service-role client
-- in the Edge Functions runs as — those must keep working on a ghost's row.
create or replace function public.is_ghost()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select p.is_ghost from public.profiles p where p.id = auth.uid()), false);
$function$;

revoke execute on function public.is_ghost() from public;
revoke execute on function public.is_ghost() from anon;
grant execute on function public.is_ghost() to authenticated;

-- ---------- INVISIBILITY ----------
-- Replaces the schema-update-46 policy. Same three existing clauses, plus a
-- ghost exclusion.
--
-- `profiles.is_ghost` is written table-qualified on purpose: unqualified it
-- would still resolve to the column, but it sits one character away from
-- public.is_ghost() (the *caller's* flag) and those mean opposite things
-- here. This clause is about the row being read, not about who's reading.
--
-- `id = auth.uid()` stays first and unconditional so a ghost can still load
-- their own row — App.jsx's profile fetch, the last_seen heartbeat and
-- Settings all depend on it.
drop policy if exists "Approved members can view profiles" on public.profiles;
create policy "Approved members can view profiles"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (
      (public.is_approved() or public.is_admin())
      and (public.is_admin() or not profiles.is_ghost)
    )
  );

-- ---------- ADMIN-ONLY FLAG ----------
-- Extends the guard to cover is_ghost. Without this a ghost could clear their
-- own flag with a single PostgREST PATCH and walk into the directory —
-- "Users can update own profile" is a blanket id = auth.uid() policy with no
-- column list, which is exactly why approved/is_admin/declined_at are policed
-- in a trigger rather than in RLS (schema-update-50 explains why RLS can't do
-- it here without the recursion trap).
--
-- Carries forward schema-update-57's version verbatim, plus the is_ghost
-- clause and is_ghost added to the trigger's column list.
create or replace function public.prevent_self_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    if new.approved is distinct from old.approved then
      raise exception 'Only an admin can change approval status.';
    end if;
    if new.is_admin is distinct from old.is_admin then
      raise exception 'Only an admin can change admin status.';
    end if;
    if new.declined_at is distinct from old.declined_at then
      raise exception 'Only an admin can change declined status.';
    end if;
    if new.is_ghost is distinct from old.is_ghost then
      raise exception 'Only an admin can change ghost status.';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists on_self_privilege_escalation on public.profiles;
create trigger on_self_privilege_escalation
  before update of approved, is_admin, declined_at, is_ghost on public.profiles
  for each row execute function public.prevent_self_privilege_escalation();

-- ---------- READ-ONLY ENFORCEMENT ----------
-- Two mechanisms, deliberately, because neither one covers everything:
--
--   * RESTRICTIVE RLS policies stop writes that arrive through PostgREST
--     (every .insert()/.update()/.delete() in src/). Restrictive policies AND
--     with the existing permissive ones instead of ORing, so this adds a veto
--     without touching — or needing to know the names of — the twenty-odd
--     policies already on these tables. Declared per-command, never FOR ALL:
--     a FOR ALL restrictive policy's USING clause also applies to SELECT and
--     would blind the ghost to the whole site.
--
--   * A BEFORE trigger catches what RLS structurally cannot: the SECURITY
--     DEFINER RPCs (get_or_create_conversation, edit_message, delete_message,
--     request_mentorship, respond_to_mentorship, cancel_mentorship_request,
--     end_mentorship) run as the definer and bypass RLS entirely, so a ghost
--     calling supabase.rpc('request_mentorship', ...) by hand would otherwise
--     sail straight through. Triggers fire regardless of who the statement is
--     running as.
--
-- RLS is evaluated first, so a direct write fails with the usual RLS error
-- and only the RPC path reaches the trigger's friendlier message. Both are
-- backstops: the UI hides these controls from ghosts already.
--
-- Deliberately NOT in this list — writes that are private to the ghost and
-- invisible to everyone else, which they need for ordinary browsing:
--   profiles                (their own row: last_seen heartbeat, Settings)
--   saved_jobs, saved_events (their own bookmarks)
--   notifications, notification_preferences
create or replace function public.enforce_ghost_read_only()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.is_ghost() then
    raise exception 'This is a browse-only account and cannot post, message or apply.';
  end if;
  -- NEW is null on DELETE, so returning it unconditionally would silently
  -- cancel every delete this trigger is attached to.
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

do $do$
declare
  t text;
  guarded text[] := array[
    'posts', 'post_comments', 'post_likes',
    'businesses',
    'jobs', 'job_applications',
    'events', 'event_rsvps', 'event_comments',
    'conversations', 'conversation_participants', 'messages', 'message_reactions',
    'mentorships', 'mentorship_goals', 'mentorship_sessions',
    'legends', 'reports'
  ];
  -- admin_actions is deliberately absent: schema-update-52 revokes INSERT,
  -- UPDATE and DELETE on it from `authenticated` outright, which is a harder
  -- stop than any policy, and its only writer is the service-role client in
  -- the Edge Functions (auth.uid() null there, so is_ghost() is false anyway).
begin
  foreach t in array guarded loop
    -- Tables come and go in this codebase (groups, photos, merchandise and
    -- the old mentoring_* set have all been ripped out). Skipping missing
    -- ones keeps this re-runnable against any of those states.
    if to_regclass('public.' || t) is null then
      raise notice 'skipping %, table not present', t;
      continue;
    end if;

    execute format('drop policy if exists "Ghosts cannot insert" on public.%I', t);
    execute format(
      'create policy "Ghosts cannot insert" on public.%I as restrictive for insert to authenticated with check (not public.is_ghost())', t);

    execute format('drop policy if exists "Ghosts cannot update" on public.%I', t);
    execute format(
      'create policy "Ghosts cannot update" on public.%I as restrictive for update to authenticated using (not public.is_ghost())', t);

    execute format('drop policy if exists "Ghosts cannot delete" on public.%I', t);
    execute format(
      'create policy "Ghosts cannot delete" on public.%I as restrictive for delete to authenticated using (not public.is_ghost())', t);

    execute format('drop trigger if exists enforce_ghost_read_only on public.%I', t);
    execute format(
      'create trigger enforce_ghost_read_only before insert or update or delete on public.%I for each row execute function public.enforce_ghost_read_only()', t);
  end loop;
end
$do$;

-- ---------- CONTACT LOOKUP ----------
-- get_profile_contact() is SECURITY DEFINER and keyed by uuid, so it reads
-- straight past the profiles policy above. In practice a ghost's uuid never
-- reaches another member — it only travels inside profile rows they can't
-- read — but "you'd have to guess a uuid" is not an access control, and this
-- function returns the real email address off auth.users.
--
-- Body is otherwise byte-identical to schema-update-21; only the guard after
-- the self check is new.
create or replace function public.get_profile_contact(target_id uuid)
returns table (phone text, email text, city text, country text)
language plpgsql security definer set search_path = public
as $$
declare
  v_phone text; v_privacy_phone text;
  v_email text; v_privacy_email text;
  v_city text; v_country text; v_privacy_location text;
  v_is_self boolean;
  v_related boolean;
  v_is_ghost boolean;
begin
  v_is_self := (target_id = auth.uid());

  select p.phone, p.privacy_phone, p.city, p.country, p.privacy_location, p.is_ghost
    into v_phone, v_privacy_phone, v_city, v_country, v_privacy_location, v_is_ghost
    from public.profiles p where p.id = target_id;

  select u.email, pr.privacy_email into v_email, v_privacy_email
    from auth.users u
    join public.profiles pr on pr.id = u.id
    where u.id = target_id;

  if v_is_self then
    return query select v_phone, v_email, v_city, v_country;
    return;
  end if;

  -- Ghost: nothing, to anyone but themselves and an admin. Returns an empty
  -- set rather than a row of nulls so the caller can't distinguish "ghost"
  -- from "no such member".
  if coalesce(v_is_ghost, false) and not public.is_admin() then
    return;
  end if;

  v_related := public.has_mentoring_relationship(auth.uid(), target_id);

  if v_privacy_phone = 'hide' or (v_privacy_phone = 'mentoring' and not v_related) then v_phone := null; end if;
  if v_privacy_email = 'hide' or (v_privacy_email = 'mentoring' and not v_related) then v_email := null; end if;
  if v_privacy_location = 'hide' or (v_privacy_location = 'mentoring' and not v_related) then v_city := null; v_country := null; end if;

  return query select v_phone, v_email, v_city, v_country;
end;
$$;

revoke all on function public.get_profile_contact(uuid) from public;
revoke execute on function public.get_profile_contact(uuid) from anon;
grant execute on function public.get_profile_contact(uuid) to authenticated;

-- ---------- CONVERSATIONS ----------
-- The other half of the messaging story. enforce_ghost_read_only already
-- stops a *ghost* opening a thread; this stops anyone opening a thread with
-- a ghost, which would otherwise create a conversation the ghost can see and
-- can't answer. Same uuid-guessing argument as above.
--
-- Only the ghost check is new; the rest matches schema-update-21.
create or replace function public.get_or_create_conversation(other_user uuid)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  conv bigint;
  v_privacy_messages text;
  v_other_is_ghost boolean;
begin
  if not public.is_approved() then
    raise exception 'Account not yet approved';
  end if;
  if other_user = auth.uid() then
    raise exception 'Cannot message yourself';
  end if;

  select cp1.conversation_id into conv
  from public.conversation_participants cp1
  join public.conversation_participants cp2
    on cp1.conversation_id = cp2.conversation_id
  where cp1.user_id = auth.uid() and cp2.user_id = other_user
  limit 1;

  if conv is null then
    -- Both columns table-qualified: bare `is_ghost` one line under a call to
    -- public.is_ghost() is a misreading waiting to happen.
    select p.privacy_messages, p.is_ghost into v_privacy_messages, v_other_is_ghost
      from public.profiles p where p.id = other_user;

    -- Worded exactly like the privacy refusal below it, so a ghost can't be
    -- detected by the error message coming back.
    if coalesce(v_other_is_ghost, false) then
      raise exception 'This member is not accepting new messages right now';
    end if;

    if v_privacy_messages = 'hide'
       or (v_privacy_messages = 'mentoring' and not public.has_mentoring_relationship(auth.uid(), other_user)) then
      raise exception 'This member is not accepting new messages right now';
    end if;

    insert into public.conversations default values returning id into conv;
    insert into public.conversation_participants (conversation_id, user_id)
      values (conv, auth.uid()), (conv, other_user);
  end if;

  return conv;
end;
$$;

revoke all on function public.get_or_create_conversation(uuid) from public;
revoke execute on function public.get_or_create_conversation(uuid) from anon;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;

-- ---------- ADMIN MEMBER LIST ----------
-- Admin → Members needs to know which rows are ghosts so it can badge them
-- and offer the toggle. Return shape changes, so the old function has to be
-- dropped first (same dance as schema-update-45).
drop function if exists public.admin_list_members();

create function public.admin_list_members()
returns table (
  id uuid,
  email text,
  email_confirmed_at timestamptz,
  full_name text,
  first_name text,
  preferred_name text,
  last_name text,
  grad_year int,
  city text,
  country text,
  approved boolean,
  is_admin boolean,
  is_ghost boolean,
  created_at timestamptz,
  consented_at timestamptz,
  declined_at timestamptz,
  declined_reason text
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  return query
    select p.id, u.email::text, u.email_confirmed_at, p.full_name,
           p.first_name, p.preferred_name, p.last_name,
           p.grad_year, p.city, p.country, p.approved, p.is_admin, p.is_ghost,
           p.created_at, p.consented_at, p.declined_at, p.declined_reason
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

revoke all on function public.admin_list_members() from public;
revoke execute on function public.admin_list_members() from anon;
grant execute on function public.admin_list_members() to authenticated;

-- ---------- CHECKS ----------
-- Expected after a successful run:
--   is_ghost column present, default false, nobody flagged yet
--   54 restrictive policies (18 tables x 3 commands), 18 triggers
--
-- select count(*) from public.profiles where is_ghost;
-- select tablename, count(*) from pg_policies
--   where schemaname = 'public' and policyname like 'Ghosts cannot%'
--   group by tablename order by tablename;
-- select count(*) from pg_trigger where tgname = 'enforce_ghost_read_only';
