import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'
import ClearableInput from './ClearableInput.jsx'
import PasswordInput from './PasswordInput.jsx'
import CountryAutocomplete from './CountryAutocomplete.jsx'
import CityAutocomplete from './CityAutocomplete.jsx'
import { PASSWORD_MIN, passwordProblem, PasswordStrengthMeter } from '../passwordRules.jsx'
import { authRedirectTo } from '../authRedirect.js'
import { friendlyAuthError } from '../authErrors.js'
import { MAX_RESIDENCE_YEARS } from '../constants.js'

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY

// Eendrag opened in 1961 — nobody can have started before that.
const FOUNDING_YEAR = 1961
const THIS_YEAR = new Date().getFullYear()
// Start years run 1961..now; end years allow a few years into the future so
// current residents can pick their expected final year.
const START_YEARS = []
for (let y = THIS_YEAR; y >= FOUNDING_YEAR; y--) START_YEARS.push(y)
const END_YEARS = []
for (let y = THIS_YEAR + 7; y >= FOUNDING_YEAR; y--) END_YEARS.push(y)

// Google only — Facebook/LinkedIn were dropped (each needs its own dev-app
// + review process for little extra coverage). Configured in the Supabase
// dashboard: Authentication → Providers → Google.
const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Google' },
]

// passwordStrength moved to ../passwordRules.jsx so ResetPassword.jsx and
// Settings.jsx can share it — see the note there about the three screens
// having drifted to different minimums.

function SocialButtons({ prefix, onError }) {
  async function social(provider) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: authRedirectTo() },
    })
    if (error) onError(error.message)
  }
  return (
    <div className="auth-social-row">
      {SOCIAL_PROVIDERS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`auth-social-btn provider-${p.id}`}
          onClick={() => social(p.id)}
        >
          <ProviderIcon id={p.id} />
          {prefix} {p.label}
        </button>
      ))}
    </div>
  )
}

function ProviderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.6 2.8c2.2-2 3.8-5 3.8-8.5z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5l-4 3.1C3.3 21.4 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.2 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3l-4-3.1C.4 8.3 0 10.1 0 12s.4 3.7 1.2 5.4l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c2.2 0 3.7.9 4.5 1.7l3.4-3.3C17.9 1.2 15.2 0 12 0 7.3 0 3.3 2.6 1.2 6.6l4 3.1c1-2.9 3.7-4.9 6.8-4.9z" />
    </svg>
  )
}

// `initialError` carries a message App.jsx pulled off the OAuth redirect —
// most often a cancelled Google consent screen, which otherwise dumped
// people back here with no explanation at all.
// `initialMode` lets App.jsx open a specific view — currently only used to
// land someone who clicked an expired password-reset link straight on the
// "Forgot password?" form, since the sign-in form is no use to them.
export default function Auth({ initialError = null, initialMode = null }) {
  const [mode, setMode] = useState(initialMode || 'signin') // 'signin' | 'signup' | 'forgot'
  // Same reason the initialError effect below exists: App.jsx resolves this in
  // an effect, which can land after this component has already mounted.
  useEffect(() => { if (initialMode) setMode(initialMode) }, [initialMode])
  const [signupStep, setSignupStep] = useState(1) // 1 details, 2 years, 3 consent

  // Sign-in fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Signup fields
  const [firstName, setFirstName] = useState('')
  const [preferredName, setPreferredName] = useState('')
  const [lastName, setLastName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [startYear, setStartYear] = useState('')
  const [endYear, setEndYear] = useState('')
  const [address1, setAddress1] = useState('')
  const [address2, setAddress2] = useState('')
  const [address3, setAddress3] = useState('')
  const [province, setProvince] = useState('')
  const [city, setCity] = useState('')
  // Coordinates captured when a City suggestion is picked (see
  // CityAutocomplete) — saved alongside the profile so the new member shows
  // up on the alumni map immediately.
  const [cityCoords, setCityCoords] = useState(null)
  const [postCode, setPostCode] = useState('')
  const [country, setCountry] = useState('South Africa')
  const [newsOptIn, setNewsOptIn] = useState(null) // null until they choose
  const [dataConsent, setDataConsent] = useState(false)
  // 'confirm'  — account created, Supabase has emailed a confirmation link and
  //              they must click it before they can sign in ("Confirm email" is
  //              on in the dashboard).
  // 'pending'  — account created and already signed in; nothing to click. The
  //              auth listener in App.jsx normally swaps this screen out for
  //              PendingVerification before it's even seen.
  const [signupDone, setSignupDone] = useState(null) // null | 'confirm' | 'pending'
  // Resend state for the confirmation email, used only on the 'confirm' screen.
  const [resendBusy, setResendBusy] = useState(false)
  const [resendMsg, setResendMsg] = useState(null)
  // Set when signUp succeeded but the follow-up sign-in didn't: the account
  // exists, so the only useful next step is signing in, not signing up
  // again. Drives the "Go to sign in" button under the error.
  const [accountExists, setAccountExists] = useState(false)

  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(initialError)
  // App.jsx reads the OAuth redirect error in an effect, which can resolve
  // after this component has already mounted — so the useState initialiser
  // above isn't enough on its own to catch it.
  useEffect(() => { if (initialError) setError(initialError) }, [initialError])

  // Cloudflare Turnstile (CAPTCHA). Rendered manually via the global
  // `window.turnstile` API (loaded in index.html). One token is required per
  // Supabase auth call. The widget container mounts/unmounts as the user
  // moves between sign-in / signup steps, so the render effect keys on
  // (mode, signupStep) — the old version only ran on mount, which is exactly
  // why the checkbox sometimes never appeared after switching views.
  const [captchaToken, setCaptchaToken] = useState(null)
  const [captchaError, setCaptchaError] = useState(false)
  const turnstileRef = useRef(null)
  const widgetIdRef = useRef(null)

  // Whether the current view actually shows the captcha: sign-in, forgot,
  // and the final signup (consent) step.
  const captchaVisible = TURNSTILE_SITE_KEY && !signupDone &&
    (mode !== 'signup' || signupStep === 3)

  useEffect(() => {
    if (!captchaVisible || !turnstileRef.current) return

    let cancelled = false
    let pollAttempts = 0
    const MAX_POLL_ATTEMPTS = 100 // 100 * 150ms = 15s before giving up

    function renderWidget() {
      if (cancelled || !window.turnstile || !turnstileRef.current) return
      // Clear any widget id left over from a previous render pass (StrictMode
      // replays, or the container re-mounting on a mode/step change) so
      // turnstile.render isn't silently skipped.
      if (widgetIdRef.current) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* already gone */ }
        widgetIdRef.current = null
      }
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => { setCaptchaToken(token); setCaptchaError(false) },
        'expired-callback': () => setCaptchaToken(null),
        'error-callback': () => { setCaptchaToken(null); setCaptchaError(true) },
      })
      setCaptchaError(false)
    }

    if (window.turnstile) {
      renderWidget()
    } else {
      // api.js loads async/defer in index.html — poll briefly until it's
      // ready. If it never shows up (ad/privacy blocker, or a network hiccup
      // on challenges.cloudflare.com) give up after ~15s and surface that,
      // rather than leaving a blank box that silently blocks submission.
      const interval = setInterval(() => {
        pollAttempts += 1
        if (window.turnstile) {
          clearInterval(interval)
          renderWidget()
        } else if (pollAttempts >= MAX_POLL_ATTEMPTS) {
          clearInterval(interval)
          setCaptchaError(true)
        }
      }, 150)
      return () => { cancelled = true; clearInterval(interval) }
    }

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* already gone */ }
      }
      widgetIdRef.current = null
      setCaptchaToken(null)
    }
  }, [captchaVisible, mode, signupStep])

  function resetCaptcha() {
    setCaptchaToken(null)
    if (window.turnstile && widgetIdRef.current) window.turnstile.reset(widgetIdRef.current)
  }

  function switchMode(next) {
    setMode(next)
    setSignupStep(1)
    setError(null)
    setNotice(null)
    setAccountExists(false)
  }

  // "Your account exists — go sign in" recovery. Carries the email across
  // so they only have to type the password.
  function goToSignIn() {
    setEmail(signupEmail.trim())
    // Carry the password across too. They chose it thirty seconds ago and it's
    // still in state — making them retype it (and risk a typo) to recover from
    // a failure that wasn't theirs is a pointless last hurdle.
    if (signupPassword) setPassword(signupPassword)
    switchMode('signin')
    setNotice('Your account is ready — sign in with the password you just chose.')
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  /* ---------- Sign in / forgot ---------- */

  function validateSignin() {
    const cleanEmail = email.trim()
    if (!cleanEmail) return 'Enter your email address.'
    if (!EMAIL_RE.test(cleanEmail)) return 'Enter a valid email address.'
    if (mode === 'signin' && !password) return 'Enter your password.'
    if (TURNSTILE_SITE_KEY && !captchaToken) return 'Please complete the security check.'
    return null
  }

  async function handleSigninSubmit(e) {
    e.preventDefault()
    const problem = validateSignin()
    if (problem) { setError(problem); setNotice(null); return }
    // validateSignin() has always checked `email.trim()`, but the auth calls
    // below used to send the raw value — so a pasted address with a trailing
    // space passed validation and then failed with "invalid login
    // credentials", which reads as a wrong password. Normalise once here and
    // write it back so the field shows what was actually submitted.
    const cleanEmail = email.trim()
    if (cleanEmail !== email) setEmail(cleanEmail)
    setBusy(true); setError(null); setNotice(null)
    try {
      if (mode === 'forgot') {
        // Supabase emails a link that signs the browser into a recovery
        // session and fires PASSWORD_RECOVERY — App.jsx swaps in
        // ResetPassword.jsx on that event.
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: authRedirectTo(),
          captchaToken,
        })
        if (error) throw error
        setNotice("If that email's registered, a reset link is on its way — check your inbox.")
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password, options: { captchaToken } })
        if (error) throw error
      }
    } catch (e2) {
      // friendlyAuthError rewrites the handful of GoTrue strings members
      // actually hit ("Invalid login credentials", the rate-limit countdown,
      // "Email not confirmed") and passes anything unrecognised through
      // untouched, so a novel error is never swallowed.
      setError(friendlyAuthError(e2))
    } finally {
      setBusy(false)
      // Turnstile tokens are single-use — reset after every attempt.
      resetCaptcha()
    }
  }

  // Re-sends the confirmation link, for the 'confirm' screen below. Only
  // reachable when "Confirm email" is on in the dashboard — without a resend
  // path, anyone whose confirmation email was eaten by a spam filter had no
  // way forward at all, because signing up again just fails.
  async function resendConfirmation() {
    setResendBusy(true)
    setResendMsg(null)
    const { error: err } = await supabase.auth.resend({
      type: 'signup',
      email: signupEmail.trim(),
      options: { emailRedirectTo: authRedirectTo() },
    })
    setResendBusy(false)
    setResendMsg(
      err
        // The rate-limit message ("you can only request this after N seconds")
        // is the expected outcome of an impatient double-click, so it needs to
        // read as information rather than as a failure.
        ? { type: 'error', text: friendlyAuthError(err) }
        : { type: 'ok', text: 'Sent — check your inbox again in a minute or two.' }
    )
  }

  /* ---------- Signup wizard ---------- */

  function validateStep1() {
    if (!firstName.trim()) return 'Enter your first name.'
    if (!lastName.trim()) return 'Enter your last name.'
    const cleanEmail = signupEmail.trim()
    if (!cleanEmail) return 'Enter your email address.'
    if (!EMAIL_RE.test(cleanEmail)) return 'Enter a valid email address.'
    if (cleanEmail.toLowerCase() !== confirmEmail.trim().toLowerCase()) return "Email addresses don't match."
    const pwProblem = passwordProblem(signupPassword)
    if (pwProblem) return pwProblem
    if (signupPassword !== confirmPassword) return "Passwords don't match."
    return null
  }

  function validateStep2() {
    if (!startYear) return 'Select the year you arrived at Eendrag.'
    if (!endYear) return 'Select your final year (or expected final year).'
    if (Number(endYear) < Number(startYear)) return 'Your final year can’t be before your first year.'
    // Nobody lives in res for more than about a decade. Catches the common
    // slip of picking the wrong decade in one of the two dropdowns, which
    // the committee otherwise has to spot by hand during verification.
    if (Number(endYear) - Number(startYear) > MAX_RESIDENCE_YEARS) {
      return `That's more than ${MAX_RESIDENCE_YEARS} years in Eendrag — check the years are right.`
    }
    if (!city.trim()) return 'Enter your city or town.'
    if (!country.trim()) return 'Enter your country.'
    return null
  }

  function validateStep3() {
    if (newsOptIn === null) return 'Choose whether you’d like news and events by email.'
    if (!dataConsent) return 'You’ll need to consent to your data being held to join.'
    if (TURNSTILE_SITE_KEY && !captchaToken) return 'Please complete the security check.'
    return null
  }

  function nextStep() {
    const problem = signupStep === 1 ? validateStep1() : validateStep2()
    if (problem) { setError(problem); return }
    setError(null)
    setSignupStep((s) => s + 1)
  }

  function prevStep() {
    setError(null)
    setSignupStep((s) => Math.max(1, s - 1))
  }

  async function handleSignupSubmit(e) {
    e.preventDefault()
    const problem = validateStep3()
    if (problem) { setError(problem); return }
    setBusy(true); setError(null)

    const fullName = `${(preferredName.trim() || firstName.trim())} ${lastName.trim()}`.trim()
    const details = {
      full_name: fullName,
      first_name: firstName.trim(),
      preferred_name: preferredName.trim(),
      last_name: lastName.trim(),
      start_year: Number(startYear),
      grad_year: Number(endYear),
      email_news_opt_in: newsOptIn === true,
      address_line1: address1.trim(),
      address_line2: address2.trim(),
      address_line3: address3.trim(),
      province: province.trim(),
      city: city.trim(),
      postal_code: postCode.trim(),
      country: country.trim(),
      // Ticked on step 3 to get here. handle_new_user (schema-update-46)
      // reads this and stamps consented_at server-side, so the details are
      // saved by the trigger itself rather than depending on the follow-up
      // update below having a session to run under.
      data_consent: true,
      // Only present when a City suggestion was picked — a null pair would
      // wipe coordinates the profile might already have.
      ...(cityCoords ? { lat: cityCoords.lat, lng: cityCoords.lng } : {}),
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: signupEmail.trim(),
        password: signupPassword,
        // Stashed in user_metadata too, so the details survive even if the
        // profile update below can't run (e.g. email confirmation enabled
        // → no session yet). App.jsx's FinishSignup fallback reads these.
        options: { captchaToken, data: details },
      })
      if (error) throw error

      // Duplicate signup, the quiet way.
      //
      // With "Confirm email" OFF, signUp on an existing address errors with
      // "User already registered" and the catch below handles it. With it ON,
      // Supabase deliberately returns a *fake success* instead — an obfuscated
      // user with an empty `identities` array — so an attacker can't use the
      // signup form to test whether an address is registered.
      //
      // Nothing checked for that, so a real member re-running signup got
      // "Your account was created, but we couldn't sign you in just now",
      // which is both wrong and alarming. The wording below is deliberately
      // symmetrical with the genuine case: it doesn't confirm or deny that the
      // address exists, so the anti-enumeration property is preserved.
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setAccountExists(true)
        setError(
          'If that email address is already registered, we’ve emailed you about it — ' +
          'otherwise check your inbox for a confirmation link. You can also sign in below, ' +
          'or reset your password if you’ve forgotten it.'
        )
        resetCaptcha()
        return
      }

      let session = data?.session
      if (!session && data?.user && !data.user.email_confirmed_at) {
        // Supabase withholds a session at signup for exactly one reason: the
        // address has to be confirmed first. That's readable straight off the
        // signUp response, so ask it here rather than probing with a second
        // sign-in call and reading the failure.
        //
        // The probe below used to be the only way this was detected, and it
        // had a hole: it sends no captchaToken (the signUp one is single-use
        // and already spent), so with CAPTCHA enforced GoTrue rejected it for
        // the captcha *before* it ever got as far as "Email not confirmed".
        // The /confirm/i branch then never matched, and someone who'd just
        // signed up perfectly successfully was told their account couldn't be
        // signed into — with a confirmation email sitting unmentioned in their
        // inbox. Checking the response instead can't miss.
        setSignupDone('confirm')
        return
      }
      if (!session) {
        // Turnstile tokens are single-use — can't reuse the signUp one.
        resetCaptcha()
        const { data: signinData, error: signInError } =
          await supabase.auth.signInWithPassword({ email: signupEmail.trim(), password: signupPassword })
        if (signInError) {
          // Whatever went wrong here, the auth user from signUp above
          // already exists. Rethrowing (the old behaviour) showed a raw
          // error that read like "signup failed", so people retried — and
          // got "User already registered", with no way forward and no hint
          // that the account they'd just made was sitting there waiting.
          // Every branch below has to leave them somewhere they can act.
          if (/confirm/i.test(signInError.message)) {
            // "Confirm email" is on in the project. Their details are
            // already saved by the handle_new_user trigger, so there's
            // nothing left to do but confirm and come back.
            setSignupDone('confirm')
            return
          }
          setAccountExists(true)
          // This retry deliberately sends no captchaToken (the signUp one is
          // single-use and already spent). If CAPTCHA is enforced on sign-in
          // too, it therefore *always* fails here — and the generic message
          // below made that look like a broken signup rather than "your
          // account is fine, just sign in and tick the box".
          setError(
            /captcha/i.test(signInError.message)
              ? 'Your account was created. Please sign in below — you’ll need to complete the security check once more.'
              : "Your account was created, but we couldn't sign you in just now. " +
                'Try signing in below with the email and password you just chose.'
          )
          return
        }
        session = signinData?.session
      }

      if (session) {
        // Belt-and-braces. As of schema-update-46 handle_new_user writes
        // all of this from user_metadata the moment the auth user is
        // created, so this update is a safety net for anything the trigger
        // couldn't apply — not the primary write path it used to be.
        const { error: profErr } = await supabase
          .from('profiles')
          .update({
            full_name: details.full_name,
            start_year: details.start_year,
            grad_year: details.grad_year,
            email_news_opt_in: details.email_news_opt_in,
            address_line1: details.address_line1,
            address_line2: details.address_line2,
            address_line3: details.address_line3,
            province: details.province,
            city: details.city,
            postal_code: details.postal_code,
            country: details.country,
            ...(cityCoords ? { lat: cityCoords.lat, lng: cityCoords.lng } : {}),
            consented_at: new Date().toISOString(),
          })
          .eq('id', session.user.id)
        // Non-fatal: FinishSignup in App.jsx will catch anything missed.
        if (profErr) console.warn('Profile update after signup failed:', profErr.message)
        // App.jsx's auth listener picks the session up and swaps in the
        // pending-verification screen (accounts start unapproved). That's
        // usually instant — but on a slow connection the "Join our community"
        // button used to just un-grey with nothing else happening, which reads
        // as "my click didn't register" and gets clicked again. Showing a
        // confirmation state means there's never a moment where the wizard is
        // sitting there looking untouched after a successful submit.
        setSignupDone('pending')
        return
      }
    } catch (e2) {
      // Someone re-running a signup they thought had failed lands here.
      // Point them at sign-in rather than leaving them to work out that
      // "User already registered" means "you're fine, just log in".
      if (/already registered|already exists|user_already_exists/i.test(e2.message || '')) {
        setAccountExists(true)
        setError('There’s already an account with that email address. Try signing in instead — or reset your password if you’ve forgotten it.')
      } else {
        setError(friendlyAuthError(e2))
      }
      resetCaptcha()
    } finally {
      setBusy(false)
    }
  }

  /* ---------- Render ---------- */

  if (signupDone) {
    // Two very different situations that used to share one screen and one
    // message. The old copy talked only about committee verification, so
    // someone who actually needed to click a link in their inbox was told to
    // sit and wait — then hit "Email not confirmed" at sign-in with no idea
    // why. Getting a person to check their email needs to be the whole point
    // of the screen when that's what's required, and absent when it isn't.
    const needsConfirm = signupDone === 'confirm'
    return (
      <div className="auth-page">
        <div className="auth-card">
          <img src="/eendrag-logo.png" alt="Eendrag logo" className="auth-logo" />
          <h1 className="auth-title">{needsConfirm ? 'Check your email' : 'Almost there'}</h1>
          <p className="auth-sub">Thanks for joining, {preferredName.trim() || firstName}!</p>

          {needsConfirm ? (
            <>
              <p className="auth-verify-note">
                We&rsquo;ve sent a confirmation link to <strong>{signupEmail}</strong>.
                Click it to confirm the address is yours &mdash; you won&rsquo;t be
                able to sign in until you do.
              </p>
              <p className="auth-verify-note">
                After that, your details go to the alumni committee to be checked
                against Eendrag residence records, and we&rsquo;ll email you again
                once you&rsquo;re confirmed as an Eendragter.
              </p>
              <p className="hint">
                No email after a few minutes? Check your spam or junk folder first
                &mdash; it&rsquo;s almost always there.
              </p>
              {resendMsg && (
                <p className={resendMsg.type === 'ok' ? 'form-notice' : 'form-error'} role="status">
                  {resendMsg.text}
                </p>
              )}
              <button type="button" className="btn ghost wide" onClick={resendConfirmation} disabled={resendBusy}>
                {resendBusy ? 'Sending…' : 'Resend the confirmation email'}
              </button>
            </>
          ) : (
            <p className="auth-verify-note">
              Your details will be verified against Eendrag residence records. Once
              you&rsquo;re confirmed as an Eendragter, you&rsquo;ll receive an email at{' '}
              <strong>{signupEmail}</strong> and can sign in.
            </p>
          )}

          <button type="button" className="link-btn" onClick={() => { setSignupDone(null); setResendMsg(null); switchMode('signin') }}>
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/eendrag-logo.png" alt="Eendrag logo" className="auth-logo" />
        <h1 className="auth-title">Eendrag Alumni</h1>
        <p className="auth-sub">Character · Style · Pride · Since 1961</p>

        {mode !== 'forgot' && (
          // Deliberately NOT role="tablist"/"tab". That markup promises a
          // matching role="tabpanel" and arrow-key navigation between tabs;
          // neither existed here, and ARIA that lies about the structure is
          // worse for a screen-reader user than no ARIA at all (they're told
          // to arrow between panels that aren't there). These are two buttons
          // that swap the form, so that's what they now announce as, with
          // aria-pressed carrying the on/off state.
          <div className="auth-tabs">
            <button
              type="button"
              aria-pressed={mode === 'signin'}
              className={mode === 'signin' ? 'auth-tab on' : 'auth-tab'}
              onClick={() => switchMode('signin')}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === 'signup'}
              className={mode === 'signup' ? 'auth-tab on' : 'auth-tab'}
              onClick={() => switchMode('signup')}
            >
              Join
            </button>
          </div>
        )}

        {mode !== 'signup' && (
          <form onSubmit={handleSigninSubmit} noValidate>
            {mode === 'signin' && (
              <>
                <SocialButtons prefix="Continue with" onError={setError} />
                <div className="auth-divider"><span>or with your email</span></div>
              </>
            )}
            <label className="field">
              <span>Email</span>
              <ClearableInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onClear={() => setEmail('')}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            {mode === 'signin' && (
              <>
                <label className="field">
                  <span>Password</span>
                  <PasswordInput
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                    autoComplete="current-password"
                  />
                </label>
                <button
                  type="button"
                  className="link-btn auth-forgot-link"
                  onClick={() => switchMode('forgot')}
                >
                  Forgot password?
                </button>
              </>
            )}

            {captchaVisible && <div ref={turnstileRef} className="auth-captcha" />}
            {captchaVisible && captchaError && (
              <p className="form-error" role="alert">
                Security check failed to load. Disable any ad/privacy blocker for this
                site and{' '}
                <button type="button" className="link-btn" onClick={() => window.location.reload()}>
                  refresh the page
                </button>.
              </p>
            )}

            {/* role="alert" so a validation failure is announced. Without it a
                screen-reader user submitting this form got silence — the error
                appeared visually and nothing else happened. */}
            {error && <p className="form-error" role="alert">{error}</p>}
            {notice && <p className="form-notice" role="status">{notice}</p>}

            <button type="submit" className="btn primary wide" disabled={busy}>
              {busy ? 'One moment…' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <button type="button" className="link-btn" onClick={() => switchMode('signin')}>
            Back to sign in
          </button>
        )}

        {mode === 'signup' && (
          <>
            {/* Above the wizard, not inside step 1. Sitting below the name
                and password fields, this button was a trap: anyone who
                filled the form in and only then noticed it lost everything
                they'd typed, because OAuth navigates away and FinishSignup
                can't recover form state it never saw. Offering the choice
                before the form starts means it's a choice, not a mistake. */}
            <SocialButtons prefix="Join with" onError={setError} />
            <div className="auth-divider"><span>or complete the form</span></div>

            <form onSubmit={handleSignupSubmit} noValidate>
            {/* The dots are decoration — three bare numerals read aloud tell
                you nothing. The real progress statement lives in the live
                region beside them, so moving between steps is announced. */}
            <div className="auth-steps" aria-hidden="true">
              {[1, 2, 3].map((n) => (
                <span key={n} className={`auth-step-dot ${signupStep === n ? 'on' : ''} ${signupStep > n ? 'done' : ''}`}>
                  {signupStep > n ? '✓' : n}
                </span>
              ))}
            </div>
            <p className="sr-only" role="status">
              Step {signupStep} of 3
              {signupStep === 1 ? ': your details' : signupStep === 2 ? ': your years in Eendrag' : ': consent'}
            </p>

            {signupStep === 1 && (
              <>
                <div className="auth-field-row">
                  <label className="field">
                    <span>First name *</span>
                    <input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
                  </label>
                  <label className="field">
                    <span>Last name *</span>
                    <input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
                  </label>
                </div>
                <label className="field">
                  <span>Preferred first name</span>
                  <input
                    value={preferredName}
                    onChange={(e) => setPreferredName(e.target.value)}
                    placeholder="If different — e.g. JP, Wikus"
                  />
                </label>
                <label className="field">
                  <span>Email *</span>
                  <input type="email" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} autoComplete="email" />
                </label>
                <label className="field">
                  <span>Confirm email *</span>
                  <input type="email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} autoComplete="email" />
                </label>
                <label className="field">
                  <span>Password *</span>
                  <PasswordInput
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder={`At least ${PASSWORD_MIN} characters`}
                    autoComplete="new-password"
                  />
                </label>
                <PasswordStrengthMeter password={signupPassword} />
                <label className="field">
                  <span>Confirm password *</span>
                  <PasswordInput
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
              </>
            )}

            {signupStep === 2 && (
              <>
                <h2 className="auth-step-heading">Your years in Eendrag</h2>
                <p className="auth-step-sub">
                  When did you live in Eendrag? An expected final year is fine if
                  you&rsquo;re still there.
                </p>
                <div className="auth-field-row">
                  <label className="field">
                    <span>From *</span>
                    <div className="select-wrap">
                      <select value={startYear} onChange={(e) => setStartYear(e.target.value)}>
                        <option value="">Year</option>
                        {START_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                  </label>
                  <label className="field">
                    <span>To *</span>
                    <div className="select-wrap">
                      <select value={endYear} onChange={(e) => setEndYear(e.target.value)}>
                        <option value="">Year</option>
                        {END_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                  </label>
                </div>

                {/* See the matching note in FinishSignup.jsx — an unexplained
                    home-address block mid-signup is a well-known drop-off
                    point, and the answer ("map + posted invitations, not shown
                    on your profile") is one sentence. */}
                <p className="hint" style={{ marginTop: 14 }}>
                  Your address is optional. It&rsquo;s used to place you on the alumni
                  map and to post you reunion invitations, and it isn&rsquo;t
                  displayed on your profile.
                </p>
                <label className="field" style={{ marginTop: 10 }}>
                  <span>Address line 1</span>
                  <input value={address1} onChange={(e) => setAddress1(e.target.value)} autoComplete="address-line1" />
                </label>
                <label className="field">
                  <span>Address line 2</span>
                  <input value={address2} onChange={(e) => setAddress2(e.target.value)} autoComplete="address-line2" />
                </label>
                <label className="field">
                  <span>Address line 3</span>
                  <input value={address3} onChange={(e) => setAddress3(e.target.value)} autoComplete="address-line3" />
                </label>
                <div className="auth-field-row">
                  <label className="field">
                    <span>Province</span>
                    <input value={province} onChange={(e) => setProvince(e.target.value)} autoComplete="address-level1" />
                  </label>
                  <label className="field">
                    <span>City *</span>
                    {/* Same live Mapbox suggestions as the profile editor — a
                        picked suggestion also gives us coordinates, so new
                        members land on the alumni map straight away instead
                        of waiting for a later geocode of free-typed text. */}
                    <CityAutocomplete
                      value={city}
                      country={country}
                      onChange={setCity}
                      onSelectCoords={setCityCoords}
                      placeholder="Start typing…"
                    />
                  </label>
                </div>
                <div className="auth-field-row">
                  <label className="field">
                    {/* Optional, and no longer hinted as numeric: plenty of
                        countries use letters in theirs (UK, Canada,
                        Netherlands) and a few have none at all, so
                        requiring a numeric post code blocked exactly the
                        overseas alumni this directory most wants to find. */}
                    <span>Post code</span>
                    <input
                      value={postCode}
                      onChange={(e) => setPostCode(e.target.value)}
                      autoComplete="postal-code"
                    />
                  </label>
                  <label className="field">
                    <span>Country *</span>
                    <CountryAutocomplete value={country} onChange={setCountry} placeholder="Start typing…" />
                  </label>
                </div>
              </>
            )}

            {signupStep === 3 && (
              <>
                <h2 className="auth-step-heading">Consent</h2>
                <fieldset className="auth-consent-group">
                  <legend>I&rsquo;m happy to hear about news and events by email. *</legend>
                  <div className="auth-consent-row">
                    <button
                      type="button"
                      className={newsOptIn === true ? 'onboarding-choice on' : 'onboarding-choice'}
                      onClick={() => setNewsOptIn(true)}
                    >
                      Opt in
                    </button>
                    <button
                      type="button"
                      className={newsOptIn === false ? 'onboarding-choice on' : 'onboarding-choice'}
                      onClick={() => setNewsOptIn(false)}
                    >
                      Opt out
                    </button>
                  </div>
                </fieldset>
                <label className="auth-consent-check">
                  <input
                    type="checkbox"
                    checked={dataConsent}
                    onChange={(e) => setDataConsent(e.target.checked)}
                  />
                  <span>
                    I consent to my personal data being held on the Eendrag Alumni
                    database and used to run this community, and to receiving
                    occasional system emails about my profile. *
                  </span>
                </label>

                {captchaVisible && <div ref={turnstileRef} className="auth-captcha" />}
                {captchaVisible && captchaError && (
                  <p className="form-error" role="alert">
                    Security check failed to load. Disable any ad/privacy blocker for
                    this site and{' '}
                    <button type="button" className="link-btn" onClick={() => window.location.reload()}>
                      refresh the page
                    </button>.
                  </p>
                )}
              </>
            )}

            {/* Same reasoning as the sign-in form: without a live region, a
                failed "Continue" on the wizard is silent to a screen reader —
                the step simply doesn't advance and nothing says why. */}
            {error && <p className="form-error" role="alert">{error}</p>}

            {accountExists ? (
              // The account is already there — retrying the wizard can only
              // fail. Sign-in is the only route forward, so it's the only
              // button we show.
              <button type="button" className="btn primary wide" onClick={goToSignIn}>
                Go to sign in
              </button>
            ) : (
              <div className="auth-wizard-actions">
                {signupStep > 1 && (
                  <button type="button" className="btn ghost" onClick={prevStep} disabled={busy}>
                    Back
                  </button>
                )}
                {signupStep < 3 ? (
                  <button type="button" className="btn primary" onClick={nextStep} disabled={busy}>
                    Continue
                  </button>
                ) : (
                  <button type="submit" className="btn primary" disabled={busy}>
                    {busy ? 'One moment…' : 'Join our community'}
                  </button>
                )}
              </div>
            )}
            </form>
          </>
        )}

        <p className="auth-note">
          New accounts are verified against Eendrag residence records — you&rsquo;ll
          get an email as soon as you&rsquo;re confirmed.
        </p>
      </div>
    </div>
  )
}
