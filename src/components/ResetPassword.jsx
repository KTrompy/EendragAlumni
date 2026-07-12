import { useState } from 'react'
import { supabase } from '../supabaseClient'
import ClearableInput from './ClearableInput.jsx'

// Shown instead of the normal app when App.jsx detects a PASSWORD_RECOVERY
// auth event — i.e. someone arrived via the "reset your password" link
// Supabase emailed them (see Auth.jsx's forgot-password flow). Clicking
// that link already signs them into a real (recovery-scoped) session, so
// this just needs to collect a new password and call updateUser — no
// token handling of our own, supabase-js already parsed the link.
export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  async function submit() {
    setError(null)
    if (password.length < 6) { setError('Password needs to be at least 6 characters.'); return }
    if (password !== confirm) { setError("Passwords don't match."); return }
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) { setError(err.message); return }
    setDone(true)
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/eendrag-logo.png" alt="Eendrag logo" className="auth-logo" />
        <h1 className="auth-title">Set a new password</h1>
        <p className="auth-sub">Character · Style · Pride · Since 1961</p>

        {done ? (
          <>
            <p className="form-notice">Your password's been updated. You're signed in — head back in.</p>
            <button className="btn primary wide" onClick={onDone}>Continue to Eendrag Alumni</button>
          </>
        ) : (
          <>
            <label className="field">
              <span>New password</span>
              <ClearableInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onClear={() => setPassword('')}
                placeholder="At least 6 characters"
                autoComplete="new-password"
              />
            </label>
            <label className="field">
              <span>Confirm new password</span>
              <ClearableInput
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onClear={() => setConfirm('')}
                placeholder="Type it again"
                autoComplete="new-password"
              />
            </label>

            {error && <p className="form-error">{error}</p>}

            <button className="btn primary wide" onClick={submit} disabled={busy}>
              {busy ? 'Saving…' : 'Save new password'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
