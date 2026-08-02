# Sign-up / Sign-in audit — 2026-08-02

Scope: every screen and code path a person can hit before they are inside the
app. `Auth.jsx`, `FinishSignup.jsx`, `PendingVerification.jsx`,
`ResetPassword.jsx`, the gates in `App.jsx`, `Settings.jsx` → Login options,
`authRedirect.js`, `passwordRules.jsx`, `supabaseClient.js`, the approval half
of `Admin.jsx`, plus the live Supabase project (`nshvaejjkknugfuyailz`): RLS
policies on `profiles`, the `handle_new_user` trigger, the approval RPCs, the
three Edge Functions, and the live GoTrue settings endpoint.

Nothing in here is speculative unless it says so. Where a finding depends on a
dashboard toggle I couldn't read over the API, it's marked **VERIFY**.

**Verdict: not done.** The code is in good shape — the flow logic, the error
handling and the RLS are genuinely solid, better than most. The gaps are almost
all in configuration and in the seams between the app and the Supabase
dashboard. One of them (C1) is serious.

---

## STATUS — updated 2026-08-02, after the fix pass

Everything that could be fixed in code or SQL has been. See
`DASHBOARD_SETUP.md` for the rest, which needs your login.

| # | Finding | Status |
|---|---------|--------|
| C1 | Email addresses never verified | **YOURS** — dashboard toggle. Code is ready for it. |
| C1a | "Almost there" screen didn't mention the email | Fixed — new screen + resend button |
| C2 | Captcha token missing on two sign-in calls | Fixed — Settings has a widget; the signup one was removed entirely |
| C3 | Auth user with no profile row was bricked | Fixed — `ensure_profile()`, migration 53 (applied) |
| H1 | Deleted member saw "Your account is fine" | Fixed — new `AccountRemoved` screen |
| H2 | Expired reset link showed a sign-in error | Fixed — reads `error_code`, opens the forgot form |
| H3 | Password-reset mail via Supabase's built-in SMTP | **YOURS** — dashboard |
| H4 | Duplicate signup breaks when confirmation is on | Fixed — `identities: []` check |
| H5 | Leaked-password protection off | **YOURS** — dashboard toggle |
| H6 | Dead `admin_delete_member()` still callable | Fixed — dropped, migration 53 (applied) |
| H7 | `VITE_SITE_URL` unset | **YOURS** — Vercel env var |
| M1 | No live region on auth errors | Fixed — `role="alert"` throughout, plus the ARIA tab fix |
| M2 | No password reveal toggle | Fixed — new `PasswordInput.jsx`, used on all 7 password fields |
| M3 | Raw GoTrue error strings | Fixed — new `authErrors.js` |
| M4 | Rate limits unverified | **YOURS** — dashboard |
| M5 | Unapproved accounts could file reports | Fixed — policy gated, migration 53 (applied). The `get_or_create_conversation` half of this finding was **wrong**: it already checks `is_approved()`. |
| M6 | `PendingVerification` didn't auto-refresh | Fixed — 60s background poll |
| M7 | `has_password` is a UI-only guard | **YOURS** — dashboard toggle |
| M8 | Silent gap after successful signup | Fixed — confirmation state |
| L1 | Password not carried into sign-in recovery | Fixed |
| L2 | Draft never expired | Fixed — 7-day expiry |
| L3 | Re-auth issues a new session | Documented, no change needed |
| L4 | No MFA | Optional, not done |
| L5 | No "sign out everywhere" | Fixed — added to Settings |
| L6 | Address block unexplained | Fixed — hint on both forms |

Verified after the changes: `npx vite build` succeeds; migration 53 applied and
confirmed against the live schema; the Supabase security advisor no longer
flags `admin_delete_member`. `ensure_profile` now appears in that advisor list
instead, which is expected — it's meant to be called by signed-in users and
guards itself (`auth.uid()` only, defaults left alone).

---

## What's already right

Worth stating, because it's most of the surface area:

- The approval gate is enforced in the database, not just in the UI. Every
  content table's SELECT policy runs through `is_approved()`, and `messages`
  INSERT does too. An unapproved session can't read the directory by hitting
  the REST API directly.
- `prevent_self_privilege_escalation` blocks a member from setting their own
  `approved` / `is_admin` even though the profiles UPDATE policy's `WITH CHECK`
  is only `id = auth.uid()`. `prevent_last_admin_demotion` stops you locking
  yourself out of admin.
- The admin UPDATE policy refuses to approve anyone whose `consented_at` is
  null, so a half-finished Google signup can't be let in.
- `handle_new_user` writes the whole profile from `user_metadata`, so signup
  details survive even when the client-side follow-up update can't run.
- `profileStatus` being its own state (rather than `profile === null` doing
  double duty) is what stops a failed profile fetch rendering the whole app
  past both approval gates. That was the right fix.
- Turnstile re-renders on `(mode, signupStep)` and resets after every attempt —
  single-use tokens handled correctly on the paths that pass them.
- `resetPasswordForEmail` returns the same "if that email's registered…"
  message either way. No account enumeration there.
- CSP, HSTS, X-Frame-Options and friends are all set in `vercel.json`.
- All three Edge Functions (`delete-account`, `admin-delete-member`,
  `send-approval-email`) are deployed and ACTIVE, and each re-checks the
  caller's identity server-side rather than trusting a client claim.
- All seven auth-path files parse cleanly (esbuild).

---

## CRITICAL

### C1 — Email addresses are never verified

Live check:

```
GET /auth/v1/settings  →  "mailer_autoconfirm": true
```

"Confirm email" is **off**. Every account is auto-confirmed at the moment of
signup. This wasn't always true: all four existing users have a
`confirmation_sent_at` and an `email_confirmed_at` several seconds later, so
confirmation was on when they joined (5–29 July) and has since been turned off.

Why this matters more here than on a normal site:

1. **The whole vetting model rests on the email address.** An admin approves
   someone against residence records, `send-approval-email` mails that address,
   and `Settings.jsx` deliberately makes the address read-only *because* "it's
   the one your membership was approved against". None of that means anything
   if nobody proved they own it.
2. **Identity linking turns it into an account-takeover path.** Supabase links
   a Google identity into an existing user when the email matches and is
   confirmed — and with autoconfirm, every address is "confirmed". So: someone
   registers `real.alumnus@gmail.com` with a password of their choosing; later
   the actual alumnus clicks "Continue with Google" and is signed into that
   account. Both parties now have access, and the attacker knows the password.
3. **Front-running.** Register under a real Eendragter's name and email, get
   approved on the strength of the name, and the real person is locked out —
   their address is taken and they can't self-serve a change (by design).
4. Open signup (`disable_signup: false`) with no address verification means the
   pending queue is spammable with throwaway addresses.

**Fix:** Dashboard → Authentication → Sign In / Providers → Email → turn
**Confirm email** back on. Then see C1a and H4 below, which are the code changes
that have to land at the same time.

### C1a — With confirmation on, the "Almost there" screen doesn't mention the email

`Auth.jsx:363` already handles the case: signUp returns no session, the
follow-up sign-in fails with "Email not confirmed", `/confirm/i` matches, and
the `signupDone` screen renders. But that screen (lines 433–451) says:

> Your details will be verified against Eendrag residence records. Once you're
> confirmed as an Eendragter, you'll receive an email at **x@y.com** and can
> sign in.

It never says *"we've sent you a link — click it to confirm your address."*
Someone reading that will sit and wait for the committee, never click, and then
fail to sign in with "Email not confirmed" and no idea why.

Needs: new copy, and a **Resend confirmation email** button
(`supabase.auth.resend({ type: 'signup', email })`). Right now there's no
resend path anywhere in the app.

### C2 — Two `signInWithPassword` calls send no captcha token

**VERIFY:** whether CAPTCHA is enforced in Supabase (Dashboard → Authentication
→ Attack Protection). `VITE_TURNSTILE_SITE_KEY` is set in `.env`, so the widget
renders; whether GoTrue validates the token is a dashboard setting I couldn't
read over the API. If it's **on**, both of these are broken today.

- **`Settings.jsx:181`** — the re-auth before a password change. No
  `options.captchaToken`, and there's no Turnstile widget on the Settings page
  at all. If captcha is enforced, this call always fails, and the error handler
  maps every non-network failure to **"Current password is incorrect."** So
  every member trying to change their password is told their correct password is
  wrong, forever. This is the single worst latent bug in the flow, and unlike
  the one below it isn't acknowledged anywhere in the code.
- **`Auth.jsx:355`** — the post-signup sign-in fallback. The comment at 372–375
  admits this one. Mostly moot while autoconfirm is on (signUp returns a session
  and the fallback never runs), but it becomes live the moment C1 is fixed.

**Fix:** render a Turnstile widget in Settings' Login options and pass the token
into the re-auth; or drop the client-side re-auth (guard 1) and rely on GoTrue's
`current_password` check (guard 2) — but only if "Require current password when
changing password" is confirmed on. The code comments correctly note guard 2 is
a dashboard toggle, so removing guard 1 without confirming that would leave
nothing.

*If captcha is NOT enforced:* the opposite finding applies — the widget is
decorative, and there is no bot protection on signup at all. Set the Turnstile
**secret** in Supabase.

### C3 — An auth user with no `profiles` row is permanently bricked

Three things line up badly:

1. `handle_new_user` swallows everything: `exception when others then raise
   warning …; return new`. A failed insert doesn't fail the signup.
2. `profiles` has **no INSERT policy** for `authenticated` (verified against
   `pg_policies` — only one SELECT and two UPDATE policies exist). The row can
   only ever be created by the trigger.
3. `App.jsx` correctly refuses to render the app without a profile, and shows
   `ProfileLoadError` with **Try again** and **Sign out**.

So if the trigger ever warns instead of inserting, that person has a working
login that lands on an error screen whose only two buttons both do nothing
useful, forever. Only direct DB access fixes it. `App.jsx:423-427` explicitly
anticipates this ("a session with no profile row is a real possibility") but
provides no recovery.

**Fix:** an `ensure_profile()` SECURITY DEFINER RPC that inserts the row if
missing, called from the "Try again" button — or a self-insert RLS policy
(`with check (id = auth.uid())`), which is the smaller change.

---

## HIGH

### H1 — A deleted member sees "Your account is fine"

`PendingVerification.checkStatus` gets this right: no row → "This account is no
longer registered — it looks like it was removed by an administrator", then
signs out.

`App.jsx`'s profile fetch doesn't. `.single()` on a missing row returns
PostgREST error `PGRST116`, `isAuthError()` is false, so it lands in the generic
branch and renders `ProfileLoadError`, which says **"Your account is fine — we
just couldn't reach it this time."** For an approved member deleted while signed
in, that's the wrong message and an infinite Try-again loop.

**Fix:** switch to `.maybeSingle()` and branch on `data === null` the same way
`PendingVerification` does.

### H2 — Expired password-reset links show a sign-in error

An expired or already-used recovery link comes back as
`#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`.

`App.jsx:352-370` reads `error` but not `error_code`, and maps *any*
`access_denied` to:

> "That sign-in was cancelled before it finished. You can try again, or use your
> email and password."

Told to someone who just clicked a password-reset link, that is actively
misleading — it implies they cancelled something, and points them at the
password they're trying to reset. It's also the most common failure in the whole
reset flow (links expire in 1 hour by default, and email scanners silently burn
single-use links before the human clicks).

**Fix:** branch on `error_code === 'otp_expired'` → "That reset link has expired
or has already been used — request a new one," and open `Auth` in `forgot` mode
with the button ready.

### H3 — Password-reset and confirmation emails go through Supabase's built-in SMTP

**VERIFY** in Dashboard → Authentication → Emails → SMTP Settings.

`send-approval-email` uses Resend, but that's the *only* mail the app sends
itself. Password resets, and (once C1 is fixed) confirmation emails, go through
GoTrue. Supabase's built-in SMTP is explicitly not for production and is rate
limited to a handful of emails per hour **project-wide** — and it only delivers
to addresses on the project's team. If custom SMTP isn't configured, turning on
"Confirm email" will stop signups working entirely, and password resets are
already silently failing for anyone who isn't you.

You already have a Resend account and a verified `eendragalumni.org` sender.
Point Supabase's SMTP at Resend and this goes away.

### H4 — Duplicate-email signup breaks the moment confirmation is turned on

Right now (autoconfirm on) a duplicate signup errors with "User already
registered" and `Auth.jsx:419` catches it properly.

With "Confirm email" on, Supabase deliberately **does not error** — it returns a
fake success with an obfuscated user and `identities: []`, to prevent account
enumeration. The code never checks that, so it falls through to the sign-in
fallback and tells someone who already has an account:

> "Your account was created, but we couldn't sign you in just now."

**Fix:** after `signUp`, `if (data?.user && data.user.identities?.length === 0)`
→ treat as existing account (the same `accountExists` path, or better: "if that
address is already registered, check your inbox / try signing in").

### H5 — Leaked-password protection is off

Flagged by the Supabase security advisor. HaveIBeenPwned checking is one toggle
(Authentication → Password settings) and is table stakes for "industry
standard". Your client-side `passwordStrength` meter is cosmetic — it happily
scores `Password1!` as Strong.

Consider also raising the server-side minimum to 8 to match `PASSWORD_MIN`, and
requiring a character class. Right now GoTrue's own minimum is likely still 6,
so the 8-char rule is client-side only.

### H6 — `admin_delete_member()` is still in the database and callable

Advisor: *"Function `public.admin_delete_member(target_id uuid)` can be executed
by the `authenticated` role."* It's `SECURITY DEFINER`, checks `is_admin()`
correctly — and then does `delete from auth.users`, which your own
`schema-update-3.sql` documents as the path hosted Supabase **silently no-ops**.

The app doesn't call it any more (Admin.jsx uses the `admin-delete-member` Edge
Function). But leaving a superseded, callable, silently-succeeding delete
function in the schema is exactly how it gets re-wired by accident later.

**Fix:** `drop function public.admin_delete_member(uuid);`

### H7 — `VITE_SITE_URL` is unset

`.env` has `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MAPBOX_TOKEN`,
`VITE_TURNSTILE_SITE_KEY` — and no `VITE_SITE_URL`. Locally that's correct and
intended. **VERIFY** it's set to `https://www.eendragalumni.org` in Vercel's
Production environment, and that the same URL is listed under Authentication →
URL Configuration → Redirect URLs.

Without it, `authRedirectTo()` falls back to `window.location.origin`, which is
what the file's own comment warns about: a reset requested from a preview
deployment emails a link back to a build that may not exist tomorrow.

---

## MEDIUM

### M1 — No live region on any auth error

None of `Auth.jsx`, `FinishSignup.jsx` or `ResetPassword.jsx` put `role="alert"`
or `aria-live` on their `<p className="form-error">`. A screen-reader user
submitting the signup wizard gets no announcement that validation failed — the
step just doesn't advance. (`PendingVerification` does use `role="status"`, so
the pattern exists.)

Also on the signup wizard: the step dots aren't announced, and the tabs have
`role="tablist"`/`role="tab"` with no `aria-controls` and no matching
`role="tabpanel"`, which is worse than no ARIA at all.

### M2 — No password reveal toggle on the signup wizard

Sign-in uses `ClearableInput`; the three password fields in the signup wizard
and the two in Settings are plain `<input type="password">`. A show/hide eye is
standard now, and it's the main thing that makes "confirm password" fields
unnecessary. Mobile especially.

### M3 — Errors are inconsistently raw

Most paths have careful hand-written copy, but several still surface
`error.message` straight from GoTrue (`Auth.jsx:423`, `ResetPassword.jsx:54`,
`Settings.jsx:215/255`, `FinishSignup.jsx:131`). Worth mapping at least the
common ones — `Invalid login credentials`, `Email not confirmed`, `For security
purposes, you can only request this after N seconds`, `over_email_send_rate_limit`
— to plain English. The last two are what people actually hit.

### M4 — No client-side throttle, and rate limits unverified

**VERIFY** Dashboard → Authentication → Rate Limits. There's no client-side
throttle or lockout on repeated sign-in attempts; the entire defence is GoTrue's
per-IP limits plus Turnstile. That's a defensible position, but only if you know
what those limits are set to.

### M5 — Unapproved accounts can still write to two tables

`messages` INSERT is correctly gated on `is_approved()`. But:

- `reports` INSERT only checks `reporter_id = auth.uid()` — an unapproved
  account can file reports via the API.
- `get_or_create_conversation()` is `SECURITY DEFINER` and executable by any
  `authenticated` role with no approval check — an unapproved account can create
  empty conversations against arbitrary user ids.

Neither leaks data (they can't send or read messages) and neither is reachable
through the UI, since the gate is above the router. But it's inconsistent with
every other write path, and it's free to fix: add `and public.is_approved()` to
the reports INSERT policy and an approval check at the top of
`get_or_create_conversation`.

### M6 — `PendingVerification` doesn't auto-refresh

Someone approved while sitting on that screen stays there until they click
"Check my status". A 60-second poll (or a realtime subscription to their own
profile row) turns "I clicked the button in the email, went to the site, still
says pending" into a non-event. The button should stay, as the manual override.

### M7 — `has_password` is a UI guard on user-writable data

Acknowledged honestly in the `Settings.jsx` comments, so this is just
confirmation: `user_metadata.has_password` is writable by the user, so the
"which password form do I show" decision can be flipped by anyone determined.
The real boundary is Supabase's **"Secure password change"** / require
re-authentication setting. **VERIFY** it's on. If it is, C2's suggested
simplification becomes safe.

### M8 — Successful signup has a silent gap

After `handleSignupSubmit` succeeds, `busy` goes false and the wizard re-renders
with no feedback at all until `App.jsx`'s auth listener swaps the screen. It's
usually instant, but on a slow connection the "Join our community" button just
un-greys and nothing appears to happen. Keep `busy` true (or set a "Setting up
your account…" state) until the screen actually changes.

---

## LOW

- **L1** — `goToSignIn()` carries the email across but leaves `password` empty
  while `signupPassword` still holds the value the person just chose. Prefilling
  it (or at least focusing the field) removes the last step of that recovery.
- **L2** — `FinishSignup`'s localStorage draft is never expired. Harmless, but a
  half-typed address sits in localStorage indefinitely on a shared machine.
- **L3** — `Settings.savePassword`'s re-auth `signInWithPassword` issues a brand
  new session as a side effect. Works fine; worth a comment so nobody is
  surprised when the refresh token changes on a password *validation*.
- **L4** — No MFA/TOTP anywhere. Not expected for an alumni directory, but it's
  the one item on a standard auth checklist that's entirely absent. Supabase
  supports it if you ever want it for admin accounts specifically.
- **L5** — No "sign out of all devices" control. `supabase.auth.signOut({ scope:
  'global' })` is a two-line addition to Settings and is the standard companion
  to a password change.
- **L6** — Signup collects a full postal address but never explains why. One
  line of hint text ("so we can post reunion invitations") measurably reduces
  drop-off on optional address blocks.

---

## Suggested order

1. **H3** first — confirm SMTP is Resend, not Supabase's built-in. Everything
   below depends on mail actually arriving.
2. **C1 + C1a + H4** together — turn on Confirm email, fix the "Almost there"
   copy, add resend, add the `identities: []` check. These must ship as one
   change; turning the toggle on without the code changes makes signup worse,
   not better.
3. **C2** — establish whether captcha is enforced, then fix Settings either way.
4. **C3, H1, H2** — three small, self-contained code fixes to the recovery
   paths.
5. **H5, H6, H7** — three dashboard/SQL one-liners.
6. Medium and low as time allows. **M1** is the one with an actual compliance
   dimension.

## Things I could not check over the API

These all need a look in the Supabase dashboard:

- CAPTCHA enforcement + Turnstile secret (Attack Protection)
- SMTP provider (Authentication → Emails)
- Rate limits (Authentication → Rate Limits)
- "Secure password change" / require re-authentication
- Server-side minimum password length
- Google OAuth client config + the Redirect URLs allow-list
- Whether `RESEND_API_KEY` is actually set as an Edge Function secret
- `VITE_SITE_URL` in Vercel's Production environment
