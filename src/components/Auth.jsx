import { useState } from 'react'
import { supabase } from '../supabaseClient'
import ClearableInput from './ClearableInput.jsx'

export default function Auth() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)

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
        })
        if (error) throw error
        setNotice("If that email's registered, a reset link is on its way — check your inbox.")
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setNotice('Check your email to confirm your account, then sign in.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/eendrag-logo.png" alt="Eendrag logo" className="auth-logo" />
        <h1 className="auth-title">Eendrag Alumni</h1>
        <p className="auth-sub">Character · Style · Pride · Since 1961</p>

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
              placeholder="At least 6 characters"
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

        {error && <p className="form-error">{error}</p>}
        {notice && <p className="form-notice">{notice}</p>}

        <button className="btn primary wide" onClick={submit} disabled={busy}>
          {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
        </button>

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
