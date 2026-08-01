# Sign-up / login flow audit — 1 Aug 2026

> **Status: all fixed except #2 and #12, which are Supabase dashboard toggles.**
> Code changes are in `schema-update-46.sql` (applied), `App.jsx`, `Auth.jsx`,
> `Settings.jsx`, `ResetPassword.jsx`, `PendingVerification.jsx`,
> `DirectoryFilters.jsx`, `NotificationBell.jsx`, plus two new shared modules
> (`passwordRules.jsx`, `authRedirect.js`). See "What's left for you" at the
> bottom.


Traced: `Auth.jsx` → `handle_new_user` trigger → `App.jsx` gates → `FinishSignup.jsx` →
`PendingVerification.jsx` → `Admin.jsx` approval → first-run profile prompt, plus
`ResetPassword.jsx` and `Settings.jsx` (email/password change). DB claims verified
against the live Supabase project (`nshvaejjkknugfuyailz`).

---

## Critical — the approval gate isn't actually a gate

### 1. Every SELECT policy is `qual: true` for `authenticated`

The "no browsing while pending" lock in `App.jsx:446` is **client-side only**. On the
database side, every read policy is:

| table | SELECT policy |
|---|---|
| profiles | `true` |
| posts, post_comments, post_likes | `true` |
| jobs, events, event_comments, event_rsvps | `true` |
| businesses, badges | `true` |

`is_approved()` appears **only on INSERT policies**. So anyone holding a valid JWT —
including an account created 10 seconds ago and never verified by the committee — can
hit the REST API directly and read the entire alumni database: every name, phone,
address line, postal code, lat/lng, occupation, employer, plus every post, job, event
and business listing.

No hacking required — open devtools on the PendingVerification screen and run one fetch
with the session token that's already in localStorage.

**Fix:** add `is_approved()` (or `is_approved() OR is_admin()`) to the SELECT policies
on `profiles`, `posts`, `jobs`, `events`, `businesses` and their child tables. This is
one migration and it's the single highest-value change on this list.

### 2. Email addresses are never verified

`Auth.jsx:322-338` calls `signUp`, then immediately `signInWithPassword` to force a
session. All 4 accounts in `auth.users` have `email_confirmed_at` set at signup time,
which means "Confirm email" is **off** in the project.

Consequences:

- I can sign up as `chairman@eendrag.example` without owning that mailbox.
- Combined with #1, sign-up is effectively an open door to the whole directory.
- The committee's verification step is the *only* control, and it happens after the
  person already has read access.
- The "Almost there — check your email" screen (`Auth.jsx:379-397`) is dead code. It
  only renders when `signInError.message` matches `/confirm/i`, which never happens.
  That string match is also brittle if you ever turn confirmation back on.

**Fix:** turn on email confirmation in the dashboard, then delete the auto-sign-in
fallback and let the `signupDone` screen be the real terminal state. Note the profile
`.update()` at `Auth.jsx:344` will no longer have a session to run under — the details
already land in `user_metadata`, so either read them in `handle_new_user` or lean on
`FinishSignup` as the fallback (it already exists for exactly this).

### 3. `profile === null` walks straight past both gates

```js
if (profile && !profile.consented_at) return <FinishSignup … />   // App.jsx:434
if (profile && !profile.approved)     return <PendingVerification … />  // App.jsx:446
```

Both are guarded on `profile` being truthy. `App.jsx:339-365` sets `profile` to `null`
whenever the fetch fails twice with a non-auth error (network blip, RLS hiccup, a
missing row). When that happens the user drops into the **full signed-in app** — nav,
directory, feed, everything — with `profile = null`.

Writes still fail (RLS), so it presents as a broken app rather than a breach, but a
pending member who gets one unlucky fetch sees the whole site.

**Fix:** invert it — render a retry/error screen when `profile` is null and `session`
is not, rather than falling through.

---

## High — flow dead ends

### 4. Half-created account with no recovery path

`Auth.jsx:312-336`: if `signUp` succeeds but the follow-up `signInWithPassword` fails
for any reason other than a `/confirm/i` message (network drop, rate limit, wrong
error wording), the code throws. The **auth user already exists**. The person sees a red
error, assumes it failed, and retries — and now gets "User already registered". They
can't sign up, and they don't know they can sign in.

**Fix:** on that path, show "Your account was created — try signing in" and switch to
`mode: 'signin'` rather than surfacing a raw error.

### 5. Pending members can't fix their own details

`PendingVerification.jsx` offers exactly two actions: "Check my status" and "Sign out".
If someone typed the wrong years, misspelt their surname, or used the wrong preferred
name, there is no way to correct it — the profile editor is behind the approval gate.
The committee is verifying against residence records using data the applicant can no
longer touch, and the likely outcome is a rejection they can't respond to.

**Fix:** either allow editing a small set of fields from this screen, or add a
"something wrong? contact us" mailto.

### 6. Nothing tells an admin a signup is waiting

`Admin.jsx:107-111` still carries the `TODO(approval email)`, so approval sends no mail.
There's also no notification going the *other* way — no trigger, no email, no badge —
so an admin only discovers a pending signup by manually visiting Admin → Pending.

The new member's screen says "You'll receive an email as soon as you're confirmed."
That's a promise the system currently can't keep, in both directions.

**Fix:** at minimum, soften the copy to point at the "Check my status" button. Better:
a `notifications` row (or Resend email) to admins on new signup, and the approval email
the TODO already describes.

### 7. Unapproved accounts appear in the directory

`DirectoryFilters.jsx:49` fetches all profiles with no `approved` filter:

```js
supabase.from('profiles').select(PEOPLE_SELECT).order('grad_year', …)
```

`Home.jsx:282,304` *does* filter with `.eq('approved', true)`. So the directory and the
alumni map show every pending account — including ones that only ever got as far as the
Google button, which have `full_name = ''` and render as blank cards.

Worse, `App.jsx:377-390`'s `last_seen` heartbeat runs above the render gates, so those
blank accounts also get a green "recently online" dot.

**Fix:** add `.eq('approved', true)` to `fetchPeople`, and move the heartbeat below the
approval check (or gate it on `profile?.approved`).

---

## Medium — inconsistencies and rough edges

### 8. Password rules disagree across three screens

| screen | minimum |
|---|---|
| `Auth.jsx:250` signup | 8 characters |
| `ResetPassword.jsx:20` | 6 characters |
| `Settings.jsx:113,149` | 6 characters |

Someone can sign up with a strong 8-char password and immediately weaken it to 6 via
"forgot password". The strength meter also only appears at signup.

**Fix:** one shared constant, 8 everywhere. `passwordStrength` is already exported from
`Auth.jsx` and could be reused on the other two screens.

### 9. Settings promises an email confirmation that probably doesn't happen

`Settings.jsx:105-107` calls `updateUser({ email })` and reports "Check your inbox to
confirm the new email address." With confirmations disabled project-wide, the change
almost certainly applies immediately and no mail is sent. The user waits for an email
that never arrives while their login email has already changed — a good way to lock
someone out of their own account.

**Fix:** verify in the dashboard (Authentication → Email → "Secure email change"). Tie
this to #2; fixing confirmation fixes both.

### 10. Google-only accounts never get the current-password check

`Settings.jsx:87` derives `hasPassword` from `session.user.identities` containing an
`email` provider. Calling `updateUser({ password })` on a Google account **doesn't add
an email identity**, so after the user sets a password, `hasPassword` stays `false`
forever and they permanently get the no-re-auth "set password" form. Anyone with a
borrowed session can then change that password without knowing the old one.

**Fix:** check `session.user.app_metadata.providers` / re-fetch the user after setting a
password, or just always require the current password once one exists.

### 11. Clicking "Join with Google" mid-wizard silently discards the form

`SocialButtons` renders inside signup step 1 (`Auth.jsx:507`). Anyone who fills in name,
email and password, then notices the Google button, loses all of it and lands in
`FinishSignup` — which re-asks for name and years but prefills only `city` and
`country`, not the address lines, province or postal code.

**Fix:** move the social buttons above the step indicator, or persist the form state
into `FinishSignup`.

### 12. Turnstile guards nothing unless the Supabase secret is set

`VITE_TURNSTILE_SITE_KEY` is present in `.env`, but the token is only enforced if
"Enable CAPTCHA protection" is switched on in Supabase with the matching secret key. If
it isn't, `captchaToken` is passed and ignored, and there's no signup rate limiting at
all (a gap already noted in the 2026-07-22 security audit).

Also: the widget is only rendered on signup **step 3**. Steps 1 and 2 do no network
calls, so that's fine — but it means the email-existence probe in #13 is unprotected.

**Fix:** confirm the secret is set in the dashboard.

### 13. Signup leaks whether an email is registered

With confirmations off, `signUp` on an existing address returns "User already
registered". That's an account-enumeration oracle against the alumni list. Minor on its
own; worth noting alongside #2, since enabling confirmation makes Supabase return an
obfuscated response instead.

### 14. `handle_new_user` has no failure guard

```sql
insert into public.profiles (id, full_name)
values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
```

No `on conflict do nothing`, no exception block. If this insert ever fails — a future
NOT NULL column without a default, a constraint, a transient error — the trigger aborts
the `auth.users` insert and **all signups 500 site-wide** with an opaque
"Database error saving new user". It also ignores every other field the signup form
stuffed into `user_metadata`, which is why the fragile client-side `.update()` at
`Auth.jsx:344` has to exist at all.

**Fix:** `on conflict (id) do nothing`, and populate `start_year`, `grad_year`, `city`,
etc. from `raw_user_meta_data` here. That makes the post-signup update a no-op safety
net instead of the primary write path.

---

## Low

- **`Onboarding.jsx` is dead code.** Nothing imports it (`App.jsx` uses the
  `highlightMissing` nav-state prompt instead). It still writes `onboarding_complete`,
  so it looks live to anyone reading the repo. Delete it.
- **Recovery link doubles as a magic sign-in.** If someone clicks the reset email and
  then refreshes before submitting, `recoveryMode` resets to `false` and they're just
  signed in, old password intact. Standard Supabase behaviour, but worth knowing.
- **`redirectTo: window.location.origin`** on both OAuth and password reset means a
  reset requested from a Vercel preview URL sends the member back to the preview.
- **Year validation is loose.** `END_YEARS` runs to `THIS_YEAR + 7`, so a signup can
  claim 2026–2033. Only the committee catches this.
- **Post code is required for every country** and hinted `inputMode="numeric"`
  (`Auth.jsx:628`) — several countries use alphanumeric codes, some have none.
- **RLS lets an admin demote the last admin** (`Admin.jsx:126`), which would lock
  everyone out of the approval queue permanently.
- **`Admins can update any profile`** allows setting `is_admin = true` on an account
  that hasn't consented yet — the `WITH CHECK` only constrains `approved`.

---

---

## What was done

| # | Issue | Fix |
|---|---|---|
| 1 | Approval gate client-side only | `schema-update-46.sql` — every SELECT policy on profiles/posts/post_comments/post_likes/jobs/events/event_comments/event_rsvps/businesses now requires `is_approved() or is_admin()`. `profiles` keeps an `id = auth.uid()` escape hatch so the pending screen can still read its own row. |
| 2 | No email verification | **Deferred at your request** — see below. |
| 3 | Null profile skipped both gates | `App.jsx` — new `profileStatus` state ('loading'/'ready'/'error'); an unresolved profile renders a `ProfileLoadError` screen with Try again / Sign out instead of falling through. |
| 4 | Half-created account dead end | `Auth.jsx` — a failed post-signup sign-in, and a duplicate-email signUp, both now set `accountExists` and show a "Go to sign in" button that carries the email across. |
| 5 | Pending members can't fix details | `PendingVerification.jsx` — "Spotted a mistake?" mailto with the account's email pre-filled in the body. |
| 6 | Nothing told admins about signups | `schema-update-46.sql` — `notify_admins_new_signup` trigger fires on the `consented_at` null→set transition; `NotificationBell.jsx` routes `entity_type: 'member'` to the admin tab, and `App.jsx` now includes `ADMIN_TAB` in that lookup. |
| 7 | Unapproved accounts in the directory | `DirectoryFilters.jsx` — `.eq('approved', true)`. `App.jsx` heartbeat now also requires `profile?.approved`, so pending accounts stop showing a "recently online" dot. |
| 8 | Password minimums disagreed (8/6/6) | New `passwordRules.jsx` — one `PASSWORD_MIN = 8`, one message, one shared `PasswordStrengthMeter`, now used on all three screens (the meter previously only appeared at signup). |
| 9 | Settings promised an email that may not send | `Settings.jsx` — reads `data.user.new_email` and only says "check your inbox" when a confirmation is genuinely pending; otherwise says the change is already live. Also validates the address first. |
| 10 | Google accounts never got the re-auth check | `Settings.jsx` — `hasPassword` now also checks `app_metadata.providers` and a `passwordJustSet` flag, so the form flips to the current-password version as soon as one is set. |
| 11 | "Join with Google" discarded the form | `Auth.jsx` — social buttons moved above the wizard, so it's a choice made before typing rather than a trap discovered halfway through. |
| 12 | Turnstile may be inert | **Dashboard check** — see below. |
| 13 | Signup leaked account existence | Softened to a "try signing in / reset your password" message. Fully resolved by #2 when you enable it. |
| 14 | `handle_new_user` fragile and partial | `schema-update-46.sql` — minimal insert first (`on conflict do nothing`), then a guarded update that populates every field from `user_metadata` including `consented_at`. A failure now warns instead of taking the whole signup down. Verified: junk metadata no longer aborts a signup. |
| low | Dead `Onboarding.jsx` | Deleted; the stale reference in `Profile.jsx`'s comment updated. |
| low | `redirectTo` used preview URLs | New `authRedirect.js` — `VITE_SITE_URL` pins OAuth and reset links to the canonical site, falling back to `window.location.origin` when unset. |
| low | Loose year validation | `MAX_RESIDENCE_YEARS = 12` in `constants.js`, enforced by both signup forms. |
| low | Post code required + numeric-hinted | Now optional, and no numeric hint — it was blocking exactly the overseas alumni the directory most wants. |
| low | Last admin could be demoted | `prevent_last_admin_demotion` trigger. Verified: the demotion is refused. |
| low | Admin rights grantable pre-consent | The admin UPDATE policy's `WITH CHECK` now covers `is_admin` as well as `approved`. |

### Verified against the live database

- Unapproved member: sees **1** profile (their own) and nothing else.
- Approved member: sees all **4** profiles. Content tables are empty, so those counts prove nothing either way yet.
- New signup with full metadata: profile lands complete — years, city, country, post code, opt-in, lat/lng, `consented_at` — from the trigger alone, no client write needed.
- Google-style signup (name only, no consent flag): `consented_at` stays null, so `FinishSignup` still catches them.
- Junk metadata (`start_year: "not-a-year"`): account and profile still created.
- New-signup notification: delivered to the admin, with the right message and entity type.
- Sole admin demotion: refused, one admin remaining.
- `vite build`: clean, 178 modules.

---

## What's left for you

Both are Supabase dashboard toggles I can't flip from here.

1. **Email confirmation (#2, and #13 with it).** Authentication → Sign In / Providers →
   "Confirm email". You said you'd do this later — worth knowing that until you do,
   anyone can register with an address they don't own. The RLS lock-down means such an
   account can no longer *read* anything, so this is now an impersonation risk rather
   than a data-exposure one. The code is already written to cope: `Auth.jsx` detects the
   confirmation-required response and shows the "check your inbox" screen, and the
   signup details now land via the database trigger rather than a client write that
   needs a session, so nothing is lost when there's no session to write with.

2. **Confirm Turnstile is actually enforced (#12).** Authentication → Settings → Bot and
   Abuse Protection → "Enable CAPTCHA protection", with the Cloudflare *secret* key. The
   site key is in your `.env`, but if the secret isn't set server-side then the token
   the frontend sends is ignored and there's no signup rate limiting at all.

3. **Optional: set `VITE_SITE_URL`** in Vercel to your live domain, and add it under
   Authentication → URL Configuration → Redirect URLs. Without it, password-reset links
   requested from a preview deployment point back at that preview.
