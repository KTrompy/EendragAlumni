-- ============================================================
-- Update 62: admin redesign — security fixes, a complete activity log,
-- paged member lists and a few small admin RPCs.
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================
--
-- The new admin area (src/components/admin/*) works before this is run — it
-- falls back to the old admin_list_members() call — but it is slower, has no
-- avatars in the member table, and the security fix in section 1 is not in
-- place until this runs. Run it as soon as the new admin is deployed.
--
--   1. Only an admin can feature a business            (security fix)
--   2. Activity log: decline / undo decline
--   3. Activity log: legends created / edited / hidden / shown / deleted
--   4. admin_reorder_legends(): reorder in one statement
--   5. legends.link_url must be http(s)
--   6. admin_members_page() / admin_member_counts() / admin_get_member()
--   7. Admins can delete the files behind content they remove
--   8. Admins are notified when a member files a report
--
-- TO UNDO: every object below is new or a `create or replace` of an existing
-- function. The previous versions of the replaced functions are in
-- schema-update-52.sql (log_profile_admin_change, log_business_promotion).


/* ------------------------------------------------------------------
   1. Only an admin can feature a business.

   The businesses UPDATE/INSERT policies (schema-update-48) let the owner
   write every column, `promoted` included — "the UI is the gate". One REST
   call was enough for an owner to pin their own listing to the top of the
   directory, and log_business_promotion then recorded it in the admin log as
   if an admin had featured it.

   SECURITY INVOKER on purpose: current_user is then the caller's role
   ('authenticated' / 'anon' for anything arriving through the API). Inside a
   SECURITY DEFINER function current_user would be the owner and this check
   would always pass. Service-role calls and the SQL Editor are not
   restricted — those are already trusted.
   ------------------------------------------------------------------ */
create or replace function public.guard_business_promotion()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if current_user = 'authenticated' and public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.promoted, false) then
      raise exception 'Only an admin can feature a business.' using errcode = '42501';
    end if;
  elsif new.promoted is distinct from old.promoted then
    raise exception 'Only an admin can feature a business.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists on_business_promotion_guard on public.businesses;
create trigger on_business_promotion_guard
  before insert or update of promoted on public.businesses
  for each row execute function public.guard_business_promotion();

-- The log entry is now only written for a real admin. With the guard above a
-- non-admin can't change the flag through the API anyway; this also keeps
-- service-role or dashboard edits from appearing as "an admin featured…".
create or replace function public.log_business_promotion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.promoted is distinct from old.promoted and public.is_admin() then
    perform public.log_admin_action(
      case when new.promoted then 'feature_business' else 'unfeature_business' end,
      'business', new.id::text, new.name, null);
  end if;
  return new;
end; $$;


/* ------------------------------------------------------------------
   2. Membership changes: the full set.

   schema-update-52 logged approve/unapprove and admin grant/revoke. Missing:
   decline and undo decline.
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
   3. Legends: created / edited / hidden / shown / deleted.

   Only admins can write to legends (schema-update-54), so is_admin() here
   just keeps dashboard edits from being attributed to nobody. A change to
   sort_order alone (reordering) isn't logged — it would fill the log with
   noise every time someone nudges a tile up one place.
   ------------------------------------------------------------------ */
create or replace function public.log_legend_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform public.log_admin_action('create_legend', 'legend', new.id::text, new.name, null);
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.log_admin_action('delete_legend', 'legend', old.id::text, old.name, null);
    return old;
  end if;

  if new.active is distinct from old.active then
    perform public.log_admin_action(
      case when new.active then 'show_legend' else 'hide_legend' end,
      'legend', new.id::text, new.name, null);
  end if;

  if (new.name, new.years, new.degree, new.category, new.headline, new.story,
      new.photo_url, new.link_url, new.link_label)
     is distinct from
     (old.name, old.years, old.degree, old.category, old.headline, old.story,
      old.photo_url, old.link_url, old.link_label) then
    perform public.log_admin_action('edit_legend', 'legend', new.id::text, new.name, null);
  end if;

  return new;
end;
$$;

drop trigger if exists on_legend_change on public.legends;
create trigger on_legend_change
  after insert or update or delete on public.legends
  for each row execute function public.log_legend_change();


/* ------------------------------------------------------------------
   4. Reorder legends in one statement.

   The old ↑/↓ fired one UPDATE per legend in parallel. Two quick clicks
   interleaved those batches and could leave sort_order mixed between the two
   orders. This takes the whole order at once and locks the rows first, so
   concurrent reorders queue instead of interleaving.
   ------------------------------------------------------------------ */
create or replace function public.admin_reorder_legends(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    return;
  end if;

  perform 1 from public.legends where id = any(p_ids) for update;

  update public.legends l
     set sort_order = o.ord - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where l.id = o.id
     and l.sort_order is distinct from (o.ord - 1)::int;
end;
$$;

revoke all on function public.admin_reorder_legends(uuid[]) from public;
revoke execute on function public.admin_reorder_legends(uuid[]) from anon;
grant execute on function public.admin_reorder_legends(uuid[]) to authenticated;


/* ------------------------------------------------------------------
   5. A legend's "read more" link must be http(s).

   It's rendered as an href on the legend page. Admin-only input, but a
   javascript: link would run in every member's session. NOT VALID so an
   existing row can't block the migration; new writes are checked.
   ------------------------------------------------------------------ */
alter table public.legends drop constraint if exists legends_link_url_http;
alter table public.legends
  add constraint legends_link_url_http
  check (link_url is null or link_url = '' or link_url ~* '^https?://')
  not valid;


/* ------------------------------------------------------------------
   6. Member lists for the admin area.

   admin_list_members() returns every account in one go and is what fed both
   the queue and the member list. These page, filter and count in the
   database instead. All three are SECURITY DEFINER (they read auth.users for
   the email address) and refuse anyone who isn't an admin.

   Filters (match the chips in Admin → Members):
     all · pending (ready for a decision) · unconfirmed (email not confirmed)
     · incomplete (never finished signing up) · declined · admins
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
   7. Admins can delete the files behind content they remove.

   Every content bucket only lets the uploader delete (foldername = their
   uid). When an admin removed a post, event, job or business, the row went
   but its images stayed in storage for good. Delete only — admins get no new
   upload or overwrite rights here.
   ------------------------------------------------------------------ */
drop policy if exists "Admins can delete member content files" on storage.objects;
create policy "Admins can delete member content files"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('post-images', 'post-videos', 'event-images', 'business-logos',
                  'business-covers', 'job-logos', 'job-attachments')
    and public.is_admin()
  );


/* ------------------------------------------------------------------
   8. Tell the admins when something is reported.

   Reports were only discovered by opening the admin page. Same shape as the
   new-signup alert in schema-update-46; the bell sends it to Admin → Reports.
   A failure here must never stop the report itself from being filed.
   ------------------------------------------------------------------ */
create or replace function public.notify_admins_new_report()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  select a.id,
         new.reporter_id,
         'new_report',
         'report',
         new.id,
         'A ' || case new.entity_type
                   when 'post' then 'post'
                   when 'job' then 'job listing'
                   when 'business' then 'business listing'
                   when 'profile' then 'member profile'
                   else 'item'
                 end || ' was reported and needs a decision.'
    from public.profiles a
   where a.is_admin and a.id <> new.reporter_id;
  return new;
exception when others then
  raise warning 'notify_admins_new_report failed for report % — %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_report_filed on public.reports;
create trigger on_report_filed
  after insert on public.reports
  for each row execute function public.notify_admins_new_report();


/* ---------- keep trigger functions off the REST surface ---------- */
revoke execute on function public.guard_business_promotion()  from public, anon, authenticated;
revoke execute on function public.log_business_promotion()    from public, anon, authenticated;
revoke execute on function public.log_profile_admin_change()  from public, anon, authenticated;
revoke execute on function public.log_legend_change()         from public, anon, authenticated;
revoke execute on function public.notify_admins_new_report()  from public, anon, authenticated;


-- ---------- CHECKS ----------
-- Expected after a successful run (each should return one row / true):
--
-- select count(*) = 1 from pg_trigger where tgname = 'on_business_promotion_guard';
-- select count(*) = 1 from pg_trigger where tgname = 'on_legend_change';
-- select count(*) = 1 from pg_trigger where tgname = 'on_report_filed';
-- select proname from pg_proc where proname in
--   ('admin_members_page', 'admin_member_counts', 'admin_get_member', 'admin_reorder_legends');
