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
  const turnstileRef = useRef(null)
  const widgetIdRef = useRef(null)

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileRef.current) return

    let cancelled = false
    function renderWidget() {
      if (cancelled || !window.turnstile || widgetIdRef.current) return
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => setCaptchaToken(token),
        'expired-callback': () => setCaptchaToken(null),
        'error-callback': () => setCaptchaToken(null),
      })
    }

    if (window.turnstile) {
      renderWidget()
    } else {
      // api.js loads async/defer in index.html — poll briefly until it's ready.
      const interval = setInterval(() => {
        if (window.turnstile) {
          clearInterval(interval)
          renderWidget()
        }
      }, 100)
      return () => { cancelled = true; clearInterval(interval) }
    }

    return () => { cancelled = true }
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
      // 10 chars is the shortest length that meaningfully resists the kind
      // of low-effort password-spraying attack an alumni directory (with
      // real people's contact details behind it) actually has to worry
      // about. Below that, Supabase's default rate limiter isn't enough on
      // its own. See also m11 in the audit — captcha/rate-limit changes
      // live in the Supabase dashboard, not this file.
      if (mode === 'signup' && password.length < 10) return 'Password must be at least 10 characters.'
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
        const { error } = await supabase.auth.signUp({ email, password, options: { captchaToken } })
        if (error) throw error
        setNotice('Check your email to confirm your account, then sign in.')
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
                placeholder={mode === 'signup' ? 'At least 10 characters' : 'Your password'}
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
          New accounts are verified against alumni records before posting and
          messaging are enabled.
        </p>
      </div>
    </div>
  )
}
