import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'
import ClearableInput from './ClearableInput.jsx'

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

// Social providers configured in the Supabase dashboard (Authentication →
// Providers). LinkedIn's modern provider id is linkedin_oidc — the plain
// "linkedin" id is the deprecated legacy OAuth flow.
const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'linkedin_oidc', label: 'LinkedIn' },
]

// Rough client-side strength score, 0..4 — mirrors the usual zxcvbn-style
// buckets without pulling in a library. Server-side rules (min length etc.)
// still apply regardless of what this says.
export function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '', percent: 0 }
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^a-zA-Z0-9]/.test(pw)) score++
  score = Math.min(4, score)
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong']
  return { score, label: labels[score], percent: (score / 4) * 100 }
}

function SocialButtons({ prefix, onError }) {
  async function social(provider) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
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

function ProviderIcon({ id }) {
  if (id === 'google') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.6 2.8c2.2-2 3.8-5 3.8-8.5z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5l-4 3.1C3.3 21.4 7.3 24 12 24z" />
        <path fill="#FBBC05" d="M5.2 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3l-4-3.1C.4 8.3 0 10.1 0 12s.4 3.7 1.2 5.4l4-3.1z" />
        <path fill="#EA4335" d="M12 4.8c2.2 0 3.7.9 4.5 1.7l3.4-3.3C17.9 1.2 15.2 0 12 0 7.3 0 3.3 2.6 1.2 6.6l4 3.1c1-2.9 3.7-4.9 6.8-4.9z" />
      </svg>
    )
  }
  if (id === 'facebook') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#1877F2" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.6-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12z" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#0A66C2" d="M20.4 20.4h-3.5v-5.6c0-1.3 0-3-1.9-3-1.9 0-2.1 1.4-2.1 2.9v5.7H9.4V9h3.4v1.6c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.2 2.4 4.2 5.4v6.3zM5.3 7.4a2 2 0 1 1 0-4.1 2 2 0 0 1 0 4.1zM7.1 20.4H3.6V9h3.5v11.4z" />
    </svg>
  )
}

export default function Auth() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup' | 'forgot'
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
  const [newsOptIn, setNewsOptIn] = useState(null) // null until they choose
  const [dataConsent, setDataConsent] = useState(false)
  const [signupDone, setSignupDone] = useState(false)

  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)

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
    setBusy(true); setError(null); setNotice(null)
    try {
      if (mode === 'forgot') {
        // Supabase emails a link that signs the browser into a recovery
        // session and fires PASSWORD_RECOVERY — App.jsx swaps in
        // ResetPassword.jsx on that event.
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
          captchaToken,
        })
        if (error) throw error
        setNotice("If that email's registered, a reset link is on its way — check your inbox.")
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } })
        if (error) throw error
      }
    } catch (e2) {
      setError(e2.message)
    } finally {
      setBusy(false)
      // Turnstile tokens are single-use — reset after every attempt.
      resetCaptcha()
    }
  }

  /* ---------- Signup wizard ---------- */

  function validateStep1() {
    if (!firstName.trim()) return 'Enter your first name.'
    if (!lastName.trim()) return 'Enter your last name.'
    const cleanEmail = signupEmail.trim()
    if (!cleanEmail) return 'Enter your email address.'
    if (!EMAIL_RE.test(cleanEmail)) return 'Enter a valid email address.'
    if (cleanEmail.toLowerCase() !== confirmEmail.trim().toLowerCase()) return "Email addresses don't match."
    if (!signupPassword) return 'Choose a password.'
    if (signupPassword.length < 8) return 'Password must be at least 8 characters.'
    if (signupPassword !== confirmPassword) return "Passwords don't match."
    return null
  }

  function validateStep2() {
    if (!startYear) return 'Select the year you arrived at Eendrag.'
    if (!endYear) return 'Select your final year (or expected final year).'
    if (Number(endYear) < Number(startYear)) return 'Your final year can’t be before your first year.'
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

      let session = data?.session
      if (!session) {
        // Turnstile tokens are single-use — can't reuse the signUp one.
        resetCaptcha()
        const { data: signinData, error: signInError } =
          await supabase.auth.signInWithPassword({ email: signupEmail.trim(), password: signupPassword })
        if (signInError) {
          if (/confirm/i.test(signInError.message)) {
            // Project still has "Confirm email" on. They'll land in the
            // pending-verification flow after confirming.
            setSignupDone(true)
            return
          }
          throw signInError
        }
        session = signinData?.session
      }

      if (session) {
        // The handle_new_user trigger has already created the profile row —
        // fill in everything collected during signup. consented_at doubles
        // as the "signup details captured" marker App.jsx checks.
        const { error: profErr } = await supabase
          .from('profiles')
          .update({
            full_name: details.full_name,
            start_year: details.start_year,
            grad_year: details.grad_year,
            email_news_opt_in: details.email_news_opt_in,
            consented_at: new Date().toISOString(),
          })
          .eq('id', session.user.id)
        // Non-fatal: FinishSignup in App.jsx will catch anything missed.
        if (profErr) console.warn('Profile update after signup failed:', profErr.message)
      }
      // App.jsx's auth listener picks the session up and shows the
      // pending-verification screen (accounts start unapproved).
    } catch (e2) {
      setError(e2.message)
      resetCaptcha()
    } finally {
      setBusy(false)
    }
  }

  /* ---------- Render ---------- */

  const strength = passwordStrength(signupPassword)

  if (signupDone) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <img src="/eendrag-logo.png" alt="Eendrag logo" className="auth-logo" />
          <h1 className="auth-title">Almost there</h1>
          <p className="auth-sub">Thanks for joining, {preferredName.trim() || firstName}!</p>
          <p className="auth-verify-note">
            Your details will be verified against Eendrag residence records. Once
            you&rsquo;re confirmed as an Eendragter, you&rsquo;ll receive an email at{' '}
            <strong>{signupEmail}</strong> and can sign in.
          </p>
          <button className="link-btn" onClick={() => { setSignupDone(false); switchMode('signin') }}>
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
          <div className="auth-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={mode === 'signin'}
              className={mode === 'signin' ? 'auth-tab on' : 'auth-tab'}
              onClick={() => switchMode('signin')}
            >
              Sign in
            </button>
            <button
              role="tab"
              aria-selected={mode === 'signup'}
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
                  <ClearableInput
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onClear={() => setPassword('')}
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
              <p className="form-error">
                Security check failed to load. Disable any ad/privacy blocker for this
                site and{' '}
                <button type="button" className="link-btn" onClick={() => window.location.reload()}>
                  refresh the page
                </button>.
              </p>
            )}

            {error && <p className="form-error">{error}</p>}
            {notice && <p className="form-notice">{notice}</p>}

            <button type="submit" className="btn primary wide" disabled={busy}>
              {busy ? 'One moment…' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <button className="link-btn" onClick={() => switchMode('signin')}>
            Back to sign in
          </button>
        )}

        {mode === 'signup' && (
          <form onSubmit={handleSignupSubmit} noValidate>
            <div className="auth-steps">
              {[1, 2, 3].map((n) => (
                <span key={n} className={`auth-step-dot ${signupStep === n ? 'on' : ''} ${signupStep > n ? 'done' : ''}`}>
                  {signupStep > n ? '✓' : n}
                </span>
              ))}
            </div>

            {signupStep === 1 && (
              <>
                <SocialButtons prefix="Join with" onError={setError} />
                <div className="auth-divider"><span>or complete the form</span></div>
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
                  <input
                    type="password"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                  />
                </label>
                {signupPassword && (
                  <div className="pw-strength">
                    <div className="pw-strength-bar">
                      <div className={`pw-strength-fill s${strength.score}`} style={{ width: `${strength.percent}%` }} />
                    </div>
                    <span className="pw-strength-label">{strength.label}</span>
                  </div>
                )}
                <label className="field">
                  <span>Confirm password *</span>
                  <input
                    type="password"
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
                  <p className="form-error">
                    Security check failed to load. Disable any ad/privacy blocker for
                    this site and{' '}
                    <button type="button" className="link-btn" onClick={() => window.location.reload()}>
                      refresh the page
                    </button>.
                  </p>
                )}
              </>
            )}

            {error && <p className="form-error">{error}</p>}

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
          </form>
        )}

        <p className="auth-note">
          New accounts are verified against Eendrag residence records — you&rsquo;ll
          get an email as soon as you&rsquo;re confirmed.
        </p>
      </div>
    </div>
  )
}
