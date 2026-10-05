-- ============================================================
-- Update 63: remove ghost accounts completely.
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================
--
-- Undoes everything schema-update-58 added, and the ghost parts of
-- schema-update-62, and puts each function and policy back to what it was
-- before ghosts existed:
--
--   * 54 restrictive "Ghosts cannot insert/update/delete" policies
--   * 18 enforce_ghost_read_only triggers + the function behind them
--   * public.is_ghost(), prevent_ghost_admin() and its trigger
--   * profiles.is_ghost (column + index)
--   * the ghost clause in the profiles SELECT policy        -> schema-update-48
--   * the ghost clause in prevent_self_privilege_escalation -> schema-update-57
--   * the ghost clause in get_profile_contact               -> schema-update-47
--   * the ghost clause in get_or_create_conversation        -> schema-update-21
--   * is_ghost in admin_list_members                        -> schema-update-57
--   * ghost logging in log_profile_admin_change / the admin_members_page,
--     admin_member_counts and admin_get_member functions    -> schema-update-62
--   * ghost rows in the admin activity log
--
-- NOTE: schema-update-58 itself kept a stale copy of get_profile_contact (it
-- copied schema-update-21 and so lost schema-update-47's "account must be
-- approved" check). Section 6 restores the schema-update-47 version, so this
-- also puts that check back.
--
-- It is all one transaction: if anything fails, nothing changes.
--
-- Run it AFTER the new site (the version with ghosts removed) is live, not
-- before: the old admin screens ask for profiles.is_ghost and would error
-- once the column is gone.

begin;

/* ------------------------------------------------------------------
   0. Refuse to run while any ghost account still exists.

   A ghost is an invisible, browse-only login. Removing the feature would
   turn each remaining one into an ordinary, visible, fully-able member, and
   that must be a decision, not a side effect. Delete them first (Admin ->
   Members -> open the account -> Delete account) or, if one is a real
   member who should simply carry on, run
       update public.profiles set is_ghost = false where is_ghost;
   and then run this file again.
   ------------------------------------------------------------------ */
do $$
declare
  n bigint := 0;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_ghost') then
    execute 'select count(*) from public.profiles where is_ghost' into n;
    if n > 0 then
      raise exception 'Stopped: % ghost account(s) still exist. Delete them (or un-ghost them) first, then run this again. Nothing was changed.', n;
    end if;
  end if;
end
$$;


/* ------------------------------------------------------------------
   1. Drop the read-only enforcement: every restrictive policy and trigger.
   Done by name pattern rather than a table list so nothing is missed.
   ------------------------------------------------------------------ */
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
      from pg_policies
     where policyname in ('Ghosts cannot insert', 'Ghosts cannot update', 'Ghosts cannot delete')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;

  for r in
    select n.nspname as sch, c.relname as tbl, t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where t.tgname = 'enforce_ghost_read_only' and not t.tgisinternal
  loop
    execute format('drop trigger %I on %I.%I', r.tgname, r.sch, r.tbl);
  end loop;
end
$$;

drop function if exists public.enforce_ghost_read_only();


/* ------------------------------------------------------------------
   2. profiles SELECT policy back to schema-update-48's version.
   ------------------------------------------------------------------ */
drop policy if exists "Approved members can view profiles" on public.profiles;
create policy "Approved members can view profiles" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_approved())
    or (select public.is_admin())
  );


/* ------------------------------------------------------------------
   3. Admin-only flags: schema-update-57's version of the guard.
   ------------------------------------------------------------------ */
create or replace function public.prevent_self_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
  end if;
  return new;
end;
$$;

drop trigger if exists on_self_privilege_escalation on public.profiles;
create trigger on_self_privilege_escalation
  before update of approved, is_admin, declined_at on public.profiles
  for each row execute function public.prevent_self_privilege_escalation();

drop trigger if exists on_ghost_admin_conflict on public.profiles;
drop function if exists public.prevent_ghost_admin();


/* ------------------------------------------------------------------
   4. Activity log trigger without ghost logging (schema-update-62's
   version minus the ghost parts).
   ------------------------------------------------------------------ */
create or replace function public.log_profile_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
  v_declined boolean;
  v_undeclined boolean;
  v_approved boolean;
begin
  -- Self-service changes aren't admin actions.
  if new.id = auth.uid() then return new; end if;

  v_label := coalesce(
    nullif(new.full_name, ''),
    (select u.email from auth.users u where u.id = new.id),
    'a member'
  );

  v_declined   := new.declined_at is not null and old.declined_at is null;
  v_approved   := new.approved and not coalesce(old.approved, false);
  -- Approving a declined member clears declined_at (sync_approval_decline);
  -- that is an approval, not an "undo decline".
  v_undeclined := new.declined_at is null and old.declined_at is not null and not v_approved;

  if new.approved is distinct from old.approved and not v_declined then
    perform public.log_admin_action(
      case when new.approved then 'approve_member' else 'unapprove_member' end,
      'member', new.id::text, v_label, null);
  end if;

  if v_declined then
    perform public.log_admin_action('decline_member', 'member', new.id::text, v_label,
      nullif(btrim(coalesce(new.declined_reason, '')), ''));
  end if;

  if v_undeclined then
    perform public.log_admin_action('undo_decline', 'member', new.id::text, v_label, null);
  end if;

  if new.is_admin is distinct from old.is_admin then
    perform public.log_admin_action(
      case when new.is_admin then 'grant_admin' else 'revoke_admin' end,
      'member', new.id::text, v_label, null);
  end if;

  return new;
end;
$$;

drop trigger if exists on_profile_admin_change on public.profiles;
create trigger on_profile_admin_change
  after update of approved, is_admin, declined_at on public.profiles
  for each row execute function public.log_profile_admin_change();


/* ------------------------------------------------------------------
   5. Admin member lists without is_ghost.
   admin_list_members: schema-update-57's version.
   admin_members_page / admin_member_counts / admin_get_member:
   schema-update-62's versions minus the ghost parts.
   ------------------------------------------------------------------ */
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
           p.grad_year, p.city, p.country, p.approved, p.is_admin,
           p.created_at, p.consented_at, p.declined_at, p.declined_reason
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

revoke all on function public.admin_list_members() from public, anon;
grant execute on function public.admin_list_members() to authenticated;

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
           p.grad_year, p.city, p.country, nullif(p.avatar_url, ''),
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
                                     u.email, p.city, p.grad_year::text) ilike '%' || v_q || '%')
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


drop function if exists public.admin_member_counts();

create function public.admin_member_counts()
returns table (
  total bigint,
  pending bigint,
  unconfirmed bigint,
  incomplete bigint,
  declined bigint,
  admins bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select count(*),
           count(*) filter (where not p.approved and p.declined_at is null
                              and p.consented_at is not null and u.email_confirmed_at is not null),
           count(*) filter (where not p.approved and p.declined_at is null and u.email_confirmed_at is null),
           count(*) filter (where not p.approved and p.declined_at is null and p.consented_at is null),
           count(*) filter (where p.declined_at is not null),
           count(*) filter (where p.is_admin)
      from public.profiles p
      join auth.users u on u.id = p.id;
end;
$$;

revoke all on function public.admin_member_counts() from public;
revoke execute on function public.admin_member_counts() from anon;
grant execute on function public.admin_member_counts() to authenticated;


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
           p.grad_year, p.city, p.country, nullif(p.avatar_url, ''),
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


/* ------------------------------------------------------------------
   6. Contact lookup: schema-update-47's version (includes its
   "account must be approved" check).
   ------------------------------------------------------------------ */
create or replace function public.get_profile_contact(target_id uuid)
returns table(phone text, email text, city text, country text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text; v_privacy_phone text;
  v_email text; v_privacy_email text;
  v_city text; v_country text; v_privacy_location text;
  v_is_self boolean;
begin
  v_is_self := (target_id = auth.uid());

  -- Approval gate. Your own details are always readable (the pending screens
  -- need them); anyone else's requires a verified account.
  if not v_is_self and not public.is_approved() and not public.is_admin() then
    raise exception 'Account not yet approved';
  end if;

  select p.phone, p.privacy_phone, p.city, p.country, p.privacy_location
    into v_phone, v_privacy_phone, v_city, v_country, v_privacy_location
    from public.profiles p where p.id = target_id;

  select u.email, pr.privacy_email into v_email, v_privacy_email
    from auth.users u
    join public.profiles pr on pr.id = u.id
    where u.id = target_id;

  if v_is_self then
    return query select v_phone, v_email, v_city, v_country;
    return;
  end if;

  if v_privacy_phone = 'hide' then v_phone := null; end if;
  if v_privacy_email = 'hide' then v_email := null; end if;
  if v_privacy_location = 'hide' then v_city := null; v_country := null; end if;

  return query select v_phone, v_email, v_city, v_country;
end;
$function$;

revoke all on function public.get_profile_contact(uuid) from public;
revoke execute on function public.get_profile_contact(uuid) from anon;
grant execute on function public.get_profile_contact(uuid) to authenticated;


/* ------------------------------------------------------------------
   7. Start-a-conversation: schema-update-21's version.
   ------------------------------------------------------------------ */
create or replace function public.get_or_create_conversation(other_user uuid)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  conv bigint;
  v_privacy_messages text;
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
    select privacy_messages into v_privacy_messages from public.profiles where id = other_user;
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


/* ------------------------------------------------------------------
   8. Nothing refers to ghosts any more: drop the helper, the index and
   the column. No CASCADE on purpose — if something unexpected still
   depends on the column this fails and the whole run is rolled back.
   ------------------------------------------------------------------ */
drop function if exists public.is_ghost();
drop index if exists public.profiles_is_ghost_idx;
alter table public.profiles drop column if exists is_ghost;

-- Ghost entries in the admin activity log. (The table is write-protected
-- from the app; this runs as the database owner.)
delete from public.admin_actions
 where action in ('enable_ghost', 'disable_ghost', 'create_ghost');

commit;


-- ---------- CHECK ----------
-- Every number should be 0.
select
  (select count(*) from pg_policies where policyname like 'Ghosts cannot%')                                   as ghost_policies,
  (select count(*) from pg_trigger  where tgname in ('enforce_ghost_read_only', 'on_ghost_admin_conflict'))   as ghost_triggers,
  (select count(*) from pg_proc     where proname in ('is_ghost', 'enforce_ghost_read_only', 'prevent_ghost_admin')) as ghost_functions,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and column_name = 'is_ghost')                                                as ghost_columns,
  (select count(*) from public.admin_actions where action like '%ghost%')                                      as ghost_log_rows;
