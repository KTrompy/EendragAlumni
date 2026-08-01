# Social login & signup flow — setup checklist

The app now shows Google / Facebook / LinkedIn buttons on both Sign in and Join. The buttons call Supabase OAuth, so each provider must be enabled in the Supabase dashboard before they work. Until a provider is configured, clicking its button shows an error — nothing breaks.

Your Supabase callback URL (needed by every provider below):

```
https://nshvaejjkknugfuyailz.supabase.co/auth/v1/callback
```

## 1. Google

1. Go to https://console.cloud.google.com → create a project (e.g. "Eendrag Alumni").
2. APIs & Services → OAuth consent screen → External → fill in app name, support email, and your site's domain. Add scopes `email` and `profile`.
3. APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.
   - Authorized redirect URI: the callback URL above.
4. Copy the Client ID and Client Secret.
5. Supabase dashboard → Authentication → Providers → Google → enable, paste both, save.

## 2. Facebook

1. Go to https://developers.facebook.com → My Apps → Create App → type "Authenticate and request data from users with Facebook Login".
2. Add the Facebook Login product → Settings → Valid OAuth Redirect URIs: the callback URL above.
3. App settings → Basic: copy App ID and App Secret.
4. To let anyone (not just test users) sign in, switch the app to Live mode and complete Facebook's App Review for `email` and `public_profile`.
5. Supabase → Authentication → Providers → Facebook → enable, paste, save.

## 3. LinkedIn

1. Go to https://developer.linkedin.com → Create app (needs a LinkedIn company page to attach to).
2. Products tab → request "Sign In with LinkedIn using OpenID Connect".
3. Auth tab → Authorized redirect URLs: the callback URL above. Copy Client ID and Client Secret.
4. Supabase → Authentication → Providers → **LinkedIn (OIDC)** → enable, paste, save. (The app uses the `linkedin_oidc` provider — not the deprecated plain LinkedIn one.)

## 4. Supabase auth settings

- Authentication → Sign In / Up → **turn OFF "Confirm email"**. Verification now happens via committee approval, not an email link — with confirm-email on, people would get a confusing Supabase email anyway. (The code handles both states, but off is the intended setup.)
- Authentication → URL Configuration → Site URL: set to your production domain (and add `http://localhost:5173` to additional redirect URLs for local dev). Social logins redirect back here.
- Attack protection → keep CAPTCHA (Turnstile) enabled, same site key as `VITE_TURNSTILE_SITE_KEY`.

## 5. Approval email (later, once you have a domain)

When you have a domain + Resend account:

1. Verify the domain in Resend, create an API key.
2. Create a Supabase Edge Function `send-approval-email` that emails the member.
3. Uncomment/wire the hook in `src/components/Admin.jsx` → `setApproved` (there's a TODO comment marking the exact spot).

## How the new flow works

- **Sign in**: email+password or a social button. Simple.
- **Join (form)**: 3 steps — details (name, email×2, password with strength meter), Eendrag years (from–to), consent (opt in/out + data consent + Turnstile). On submit the account is created, profile filled, and the user lands on a locked "your details are being verified" screen.
- **Join (social)**: after OAuth redirect, a "Nearly done" screen collects name (prefilled), years, and consent, then the same locked screen.
- **Approval**: Admin → Pending approval → Approve. On the member's next visit (or "Check my status") they get the trimmed profile wizard (name/years questions removed — already collected), then the app.
