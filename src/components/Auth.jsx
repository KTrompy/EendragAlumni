import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'
import ClearableInput from './ClearableInput.jsx'

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY

export default function Auth() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)

  // Cloudflare Turnstile (CAPTCHA). Rendered manually via the global
  // `window.turnstile` API (loaded in index.html) rather than a React
  // wrapper package, since one token is required per Supabase auth call
  // (signUp / signInWithPassword / resetPasswordForEmail all check it when
  // CAPTCHA protection is enabled in the Supabase dashboard).
  const [captchaToken, setCaptchaToken] = useState(null)
  const [captchaError, setCaptchaError] = useState(false)
  const turnstileRef = useRef(null)
  const widgetIdRef = useRef(null)

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileRef.current) return

    let cancelled = false
    let pollAttempts = 0
    const MAX_POLL_ATTEMPTS = 100 // 100 * 150ms = 15s before giving up

    function renderWidget() {
      if (cancelled || !window.turnstile || !turnstileRef.current) return
      // Guard against a stale widget id surviving an effect replay (React
      // StrictMode intentionally mounts -> cleans up -> mounts again on the
      // *same* component instance in dev; a genuine remount elsewhere can
      // hit this too). Without clearing widgetIdRef here, the second pass
      // saw it still set from the first pass and bailed out silently —
      // that's the "checkbox just doesn't show up" symptom.
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
      // ready. If it never shows up (blocked by an ad/privacy blocker, or a
      // network hiccup on challenges.cloudflare.com) give up after ~15s and
      // surface that, rather than leaving a permanently blank box that
      // silently blocks form submission with no explanation.
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
    }
  }, [])

  function resetCaptcha() {
    setCaptchaToken(null)
    if (window.turnstile && widgetIdRef.current) window.turnstile.reset(widgetIdRef.current)
  }

  // Basic shape check — not trying to fully validate email syntax (the
  // server/Supabase does that), just catching the obvious "field left
  // blank" or "no @ at all" cases before spending a network round trip.
  function validate() {
    const cleanEmail = email.trim()
    if (!cleanEmail) return 'Enter your email address.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return 'Enter a valid email address.'
    if (mode !== 'forgot') {
      if (!password) return 'Enter your password.'
      // Kept in sync with Settings.jsx's change-password minimum (6 chars).
      // See also m11 in the audit — captcha/rate-limit changes live in the
      // Supabase dashboard, not this file.
      if (mode === 'signup' && password.length < 6) return 'Password must be at least 6 characters.'
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) return 'Please complete the security check.'
    return null
  }

  function handleSubmit(e) {
    e.preventDefault()
    const problem = validate()
    if (problem) { setError(problem); setNotice(null); return }
    submit()
  }

  async function submit() {
    setBusy(true); setError(null); setNotice(null)
    try {
      if (mode === 'forgot') {
        // Supabase emails a link that signs the browser into a real
        // (recovery-scoped) session and fires a PASSWORD_RECOVERY auth
        // event — App.jsx watches for that event and swaps in
        // ResetPassword.jsx instead of the normal signed-in app, so there's
        // no token/hash handling needed here beyond pointing the redirect
        // at this site.
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
          captchaToken,
        })
        if (error) throw error
        setNotice("If that email's registered, a reset link is on its way — check your inbox.")
      } else if (mode === 'signup') {
        // Seamless signup: create the account, then drop them straight into
        // the app. If the Supabase project has "Confirm email" disabled the
        // signUp response already carries a session and App.jsx picks it up
        // from the auth listener — nothing more to do. If confirmation is
        // still enabled (or the response otherwise comes back session-less),
        // fall through to an immediate signInWithPassword so the user isn't
        // stranded on the auth screen waiting for an email. First-time
        // users with no full_name are then routed into Onboarding by
        // App.jsx (see the checkedFirstRun effect there).
        const { data, error } = await supabase.auth.signUp({ email, password, options: { captchaToken } })
        if (error) throw error
        if (!data?.session) {
          // Turnstile tokens are single-use, so we can't reuse the one from
          // the signUp call. Reset the widget and prompt for a fresh tick
          // rather than silently failing the sign-in.
          resetCaptcha()
          const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
          if (signInError) {
            // Most likely cause here is "Email not confirmed" — the project
            // still has confirmation on. Surface that clearly instead of
            // dumping the raw Supabase message.
            if (/confirm/i.test(signInError.message)) {
              setNotice("Account created. Check your email to confirm, then sign in.")
              return
            }
            throw signInError
          }
        }
        // Success path: the onAuthStateChange listener in App.jsx will pick
        // up the new session and swap Auth out for the app (which shows
        // Onboarding automatically on first login).
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } })
        if (error) throw error
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
      // Turnstile tokens are single-use — reset the widget after every
      // attempt (success or failure) so the next submit gets a fresh one.
      resetCaptcha()
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/eendrag-logo.png" alt="Eendrag logo" className="auth-logo" />
        <h1 className="auth-title">Eendrag Alumni</h1>
        <p className="auth-sub">Character · Style · Pride · Since 1961</p>

        <form onSubmit={handleSubmit} noValidate>
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
          {mode !== 'forgot' && (
            <label className="field">
              <span>Password</span>
              <ClearableInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onClear={() => setPassword('')}
                placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </label>
          )}

          {mode === 'signin' && (
            <button
              type="button"
              className="link-btn auth-forgot-link"
              onClick={() => { setMode('forgot'); setError(null); setNotice(null) }}
            >
              Forgot password?
            </button>
          )}

          {TURNSTILE_SITE_KEY && <div ref={turnstileRef} className="auth-captcha" />}
          {TURNSTILE_SITE_KEY && captchaError && (
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
            {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
          </button>
        </form>

        {mode === 'forgot' ? (
          <button
            className="link-btn"
            onClick={() => { setMode('signin'); setError(null); setNotice(null) }}
          >
            Back to sign in
          </button>
        ) : (
          <button
            className="link-btn"
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setNotice(null) }}
          >
            {mode === 'signin'
              ? 'New here? Create an account'
              : 'Already registered? Sign in'}
          </button>
        )}

        <p className="auth-note">
          New accounts are approved against alumni records before posting and
          messaging unlock — you can browse straight away.
        </p>
      </div>
    </div>
  )
}
