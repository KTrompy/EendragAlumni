# Ghost accounts — setup and handover

**Status: fully written, nothing deployed yet.** Every piece of code below already
exists in the repo. The four steps in "Go live" are all that stands between you and
a working browse-only login.

---

## What a ghost is

An ordinary approved member account with two differences:

1. **Nobody can see them.** They don't appear in Eendragters (list or map), Global
   Search, Who's Online, Mentoring, or the community strip on Home, and their
   `/people/:id` page 404s for everyone else. This is not a UI filter — the
   `profiles` SELECT policy stops the row leaving the database, so every surface
   goes dark at once and any surface added later is covered by default.
2. **They can't write anything.** No posts, comments, likes, messages, events,
   RSVPs, jobs, applications, businesses, mentorship requests or reports — so they
   never leave a trace that would give them away.

They keep their own bookmarks (saved jobs/events), notifications and Settings,
because those are private to them and invisible to everyone else.

**A ghost is never an admin.** The two are contradictory and the database refuses
the combination outright (`prevent_ghost_admin`). The "Make admin" button is
disabled for ghosts, and the "Ghost" button is disabled for admins.

**Ghost is granted, never self-selected.** Only an admin can set the flag. A ghost
cannot clear it themselves — `prevent_self_privilege_escalation` raises on any
attempt, including a hand-rolled PostgREST PATCH.

---

## Go live — 4 steps

### 1. Run the migration

Supabase Dashboard → SQL Editor → paste the whole of **`schema-update-58.sql`** →
Run. It's safe to re-run.

Verify with:

```sql
select count(*) from public.profiles where is_ghost;              -- 0
select count(*) from pg_policies
  where schemaname = 'public' and policyname like 'Ghosts cannot%'; -- 54
select count(*) from pg_trigger where tgname = 'enforce_ghost_read_only'; -- 18
```

54 = 18 tables x 3 commands (insert/update/delete). If you get fewer, check the
`skipping <table>, table not present` notices — that's expected for any table
that's been ripped out, and harmless.

### 2. Deploy the Edge Function

This is the only new function. It needs the service-role key to create an auth
user, which is why it isn't an RPC.

**No CLI needed** — do it in the browser:

1. Supabase Dashboard → **Edge Functions** → **Deploy a new function** → *Via editor*.
2. Name it exactly **`admin-create-ghost`**. The name is what the app calls; a
   typo here fails silently as a 404 at the moment an admin presses the button.
3. Delete the sample code, then paste the entire contents of
   **`supabase/functions/admin-create-ghost/index.dashboard-paste.ts`**.
4. Deploy.

That paste-version is behaviourally identical to
`supabase/functions/admin-create-ghost/index.ts` — the only difference is that
`getCorsHeaders()` and `json()` are inlined rather than imported from
`../_shared/accountCleanup.ts`, so it's a single self-contained file.

No secrets to set. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` are injected into every function automatically.

**Drift warning:** there are now two copies of this function's source. If you
ever change the CORS allowlist in `_shared/accountCleanup.ts` — which you'd need
to do the day the site moves domain — change the inlined `ALLOWED_ORIGINS` in
the paste-version too, and redeploy. Whichever copy you deployed last is the one
that's live.

<details>
<summary>If you'd rather use the CLI</summary>

The command is `supabase functions deploy admin-create-ghost`, run in PowerShell
from the `eendrag-hub` folder. It needs the Supabase CLI installed (`npx supabase`
or Scoop — global `npm install -g supabase` is no longer supported), plus
`supabase login` and `supabase link --project-ref <your-ref>` first. Deploy the
repo's `index.ts` this way, not the paste-version.

</details>

### 3. Rebuild and deploy the site

Normal Vercel deploy. Confirm afterwards that **Admin → Members** shows the
"Ghost accounts" panel with an **Add ghost account** button.

### 4. Create the account

Admin → Members → **Add ghost account**, then fill in:

| Field | Value |
|---|---|
| Label | `Committee observer` (admin-only; how you tell one ghost from another) |
| Email | `ghost@eendragalumni.org` |
| Password | `Lanternmeadow89@` |

Alternatives if you'd rather use a different password: `Quarryanchor66$` or
`Cobaltharbour30#`. Any password works as long as it's 8+ characters with a
lowercase letter, an uppercase letter and a number — the server enforces the same
rules the signup form does.

**The password is shown once, on screen, immediately after creation and never
again.** It isn't emailed anywhere. Write it down at that moment.

The email address doesn't need to be a real mailbox — nothing is ever sent to it,
and the account is created already-confirmed and already-approved, so it skips
both the verification email and the committee queue.

---

## Using it

Sign in at the normal login page with those credentials. The account lands on Home
like any member, with a slim banner across the top:

> **Browse-only account.** You can look around the whole site, but you're hidden
> from other members and can't post, comment, message, RSVP or apply.

Messages, notifications-that-need-a-reply and every create/post/apply control are
hidden rather than shown-and-broken. Admin doesn't appear at all.

---

## Turning an existing member into a ghost

Admin → Members has a **Ghost** / **Un-ghost** button on each row, and ghosts carry
a "Ghost" badge in the list.

One thing to know before you use it on a **long-standing member**: ghosting hides
the profile, but it does not retroactively delete what they already posted. Their
old posts, comments, jobs and events stay where they are, now authored by a profile
nobody can load. Whether that renders as a blank name or gets filtered out varies
by surface. For a clean invisible account, create a fresh ghost (step 4) rather
than converting an active member — the conversion path is really meant for a
brand-new account that hasn't done anything yet, or for temporarily pulling someone
out of view.

---

## Where it's enforced

Nothing in the frontend is a security boundary. `src/ghost.js` exists only so a
ghost isn't shown controls that would fail if they pressed them. The real
enforcement is all in `schema-update-58.sql`:

| Concern | Mechanism |
|---|---|
| Invisibility | `profiles` SELECT policy — excludes ghost rows from everyone but themselves and admins |
| No writes (normal path) | Restrictive RLS policies on 18 tables, per-command |
| No writes (RPC path) | `enforce_ghost_read_only` BEFORE trigger — catches the SECURITY DEFINER RPCs that bypass RLS |
| Can't un-ghost self | `prevent_self_privilege_escalation` trigger |
| Can't be an admin | `prevent_ghost_admin` trigger |
| Contact details | `get_profile_contact()` returns an empty set for a ghost |
| Incoming messages | `get_or_create_conversation()` refuses, worded identically to the ordinary privacy refusal so a ghost can't be detected by the error |

Both write-blocks are deliberate belt-and-braces: RLS is evaluated first, so a
direct write fails with the usual RLS error and only the RPC path reaches the
trigger's friendlier message.
