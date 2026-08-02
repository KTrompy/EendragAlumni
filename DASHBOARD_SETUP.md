# Dashboard setup — the seven things only you can do

Everything from `SIGNUP_LOGIN_AUDIT_2026_08_02.md` that couldn't be fixed in
code. All of it lives behind a login I don't have. **Do them in this order** —
step 1 has to be right before step 2 is safe.

Roughly 30 minutes total.

---

## 1. Point Supabase's email at Resend  (fixes H3) — DO THIS FIRST

**Correction to the first draft of this doc.** I originally wrote that the
built-in mailer only delivers to addresses on your Supabase account, so resets
were failing for everyone but you. That was wrong, and the database says so:
`4jandretruter@gmail.com` and `abnerpaul283@gmail.com` both received a
confirmation email in July and clicked it within 87 and 9 seconds. External
delivery works on this project today.

The real reasons to move anyway, in order of how much they matter:

1. **Volume.** The built-in service is capped per hour across the whole
   project. Fine for the trickle you've had so far; not fine for the evening
   you announce the site to a WhatsApp group and thirty people sign up at once.
   Step 2 roughly doubles the mail volume per signup, so this gets tighter.
2. **Best-effort delivery.** Supabase's own docs describe the built-in service
   as best-effort and explicitly not for production. There's no guarantee, no
   deliverability reporting, and nothing to look at when someone says "I never
   got the email".
3. **You're already paying for the alternative.** Resend is sending your
   approval emails from a verified `eendragalumni.org` domain, which is better
   for spam scoring than Supabase's shared sender.

Worth knowing: `recovery_sent_at` is null for all four accounts, so nobody has
ever actually used password reset in production. It has never been tested with
a real member — which is its own reason to do the test at the end of this step.

You already have Resend set up, so this is mostly copy-paste.

1. Go to **resend.com → API Keys → Create API Key**. Name it
   `supabase-smtp`, permission **Sending access**. Copy the key.
2. In Resend, check **Domains** shows `eendragalumni.org` as *Verified*. If it
   doesn't, fix that first or nothing will send.
3. Supabase Dashboard → **Authentication → Emails → SMTP Settings**.
4. Turn on **Enable Custom SMTP** and fill in:
   - Sender email: `no-reply@eendragalumni.org`
   - Sender name: `Eendrag Alumni`
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: *the API key from step 1*
5. Save.

**Check it worked:** open your site in a private window, click *Forgot
password?*, enter an address that isn't yours (ask someone), and confirm the
email arrives. Don't move on until it does.

---

## 2. Turn email confirmation back on  (fixes C1) — the important one

This is the serious finding. Until it's on, anyone can register with anyone
else's email address, and because Supabase treats every address as "confirmed",
a Google sign-in will merge into an account a stranger created first.

1. Supabase Dashboard → **Authentication → Sign In / Providers → Email**.
2. Turn **Confirm email** ON. Save.

The app is already ready for this — the "Check your email" screen, the resend
button and the duplicate-signup handling all went in today and are currently
unreachable code waiting for this switch.

3. While you're on that page, also check **Secure email change** is ON.

**Check it worked:** sign up with a throwaway address (e.g. a `+test` alias on
your own Gmail — `kyletrompeter0+test1@gmail.com`). You should see the new
**Check your email** screen, get a confirmation link, and only be able to sign
in after clicking it. Then delete that test account from Admin → Members.

---

## 3. Confirm the CAPTCHA setting  (settles C2)

I couldn't read this one over the API, and the right answer depends on what it
currently says.

Supabase Dashboard → **Authentication → Attack Protection**.

**If "Enable Captcha protection" is ON:** check the provider is *Cloudflare
Turnstile* and that the secret key is filled in. Nothing else to do — the code
fix for this shipped today, and the Settings password form now has its own
Turnstile widget, which it was missing entirely.

**If it's OFF:** turn it on. Your site key is already in the frontend, so the
widget is showing to members but nothing is checking it — meaning you have no
bot protection on signup at all.
   - Provider: **Cloudflare Turnstile**
   - Secret key: from **dash.cloudflare.com → Turnstile → your site → Settings**.
     It's the *Secret* key, not the site key that's in `.env`.

**Check it worked:** sign out, sign in normally. Then go to Settings → Login
options and change your password — the security check should appear above the
button and the change should succeed. That combination is what was broken.

---

## 4. Strengthen the password rules  (fixes H5, partly)

**Where these actually are:** the Sign In / Providers page shows a list of
providers (Email — Enabled, Google — Enabled, and 20-odd disabled ones). The
password settings are *not* on that list page. **Click the "Email" row** to
expand it, and they're inside: minimum length, password requirements, leaked
password protection, and the current-password setting from step 5.

1. Set **Minimum password length** to `8`. It's almost certainly still the
   default 6, which means the 8-character rule the app shows people is enforced
   in the browser only — anything that isn't your signup form can ignore it.
2. Set **Password Requirements** to *Letters and digits* (or stronger).

3. **Prevent use of leaked passwords** — this checks new passwords against
   HaveIBeenPwned without ever sending the password itself. **This one is Pro
   plan only, and this project is on the free plan**, so the toggle will be
   disabled. Two options:
   - Leave it. Steps 1, 2 and 5 still meaningfully raise the floor, and this is
     a small private community, not a bank.
   - Or upgrade to Pro (~$25/month) if you want it. That also lifts the daily
     active user limits and gives you 7-day log retention, which would have made
     this audit easier. Your call — it isn't required for the site to be safe.

**Check it worked:** try setting your password to `abcdefg` (7 characters) —
it should be rejected, and the app will now show a plain-English reason rather
than a raw Supabase error.

---

## 5. Require the current password when changing password  (fixes M7)

Same page as step 4 (**Authentication → Sign In / Providers → Email**). Turn on
**Require current password when changing password**.

This is what makes the current-password check a real security boundary rather
than a UI convention. Without it, anyone holding a borrowed session — an
unlocked laptop, a phone left signed in — can change the password without
knowing the old one, no matter what the form on screen asks for. The app already
sends `current_password` on every change; this is the setting that makes the
server actually check it.

There's a related setting, **Require reauthentication for password update**,
which sends a one-time code by email instead. Don't turn that one on: the app
doesn't implement the `reauthenticate()` nonce flow, so password changes would
start failing.

---

## 6. Check the rate limits  (settles M4)

Supabase Dashboard → **Authentication → Rate Limits**.

**Note:** there are two separate email limits and they're easy to confuse.

- The number on this **Rate Limits** page (you saw ~30/hour) is a *GoTrue*
  setting — it's yours to change, and it applies whichever mail provider you
  use.
- The built-in Supabase mailer has its own, separate cap on top of that, plus
  best-effort delivery. Configuring custom SMTP in step 1 is what removes that
  second ceiling. Raising the number on this page alone does nothing about it.

So: 30/hour is a fine value and you probably don't need to touch it — but it
only becomes the real limit once step 1 is done. If you're expecting a burst
(announcing the site to a WhatsApp group, say), raise it to 100 for that week.

The rest:

- **Sign in / sign up:** default is fine.
- **Token refresh / verification:** leave at defaults.

---

## 7. Set `VITE_SITE_URL` in Vercel  (fixes H7)

Without it, password-reset and Google sign-in links point at whatever URL served
the page — so a reset requested from a preview deployment emails a link back to
a build that may not exist next week.

1. Vercel → your project → **Settings → Environment Variables**.
2. Add `VITE_SITE_URL` = `https://www.eendragalumni.org`, scoped to
   **Production** only. Leave Preview and Development unset — that's deliberate,
   so local and preview builds keep redirecting to themselves.
3. **Redeploy.** Vite bakes env vars in at build time, so an existing deployment
   won't pick this up on its own.
4. Supabase Dashboard → **Authentication → URL Configuration**. Confirm:
   - Site URL: `https://www.eendragalumni.org`
   - Redirect URLs include `https://www.eendragalumni.org/**` and, if you use
     preview deploys, `https://*-your-team.vercel.app/**`

**Check it worked:** request a password reset from the live site and hover the
link in the email — it should point at `www.eendragalumni.org`.

---

## Also worth doing while you're in there

- **Confirm `RESEND_API_KEY` is set** for Edge Functions: Supabase → **Project
  Settings → Edge Functions → Secrets**. Without it the approval email silently
  fails (the code logs it and moves on by design, so you'd never notice).
  Test by approving a pending member and checking they get the email.
- **`dist-audit/`** — a build folder I created to verify the changes compile.
  OneDrive wouldn't let the sandbox delete it. Safe to bin, along with the old
  `dist.old`, `dist.old.2/3/4` and `dist-test` folders.

---

## Once all seven are done

Run through this end to end, in a private window:

1. Sign up with a fresh address → "Check your email" screen appears
2. Click the confirmation link → lands on the pending-verification screen
3. Approve from Admin → the pending screen clears itself within a minute
   (without touching "Check my status") and the approval email arrives
4. Sign out, use *Forgot password?* → email arrives, link works
5. Click that same link a second time → "That link has expired or has already
   been used", and you land on the forgot-password form
6. Settings → change password, with the security check
7. Settings → "Sign out of all devices" → you're signed out
