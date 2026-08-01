import { useState } from 'react'
import { supabase } from '../supabaseClient'

// Full-screen gate shown to signed-in members who haven't been approved
// yet — the app itself stays locked until the alumni committee verifies
// them against Eendrag residence records (Admin → Pending approval).
// A confirmation email on approval is planned once an email provider
// (e.g. Resend) is wired up — see Admin.jsx's setApproved.
export default function PendingVerification({ session, profile, onProfileChange }) {
  const email = session.user.email
  const name = (profile?.full_name || '').split(' ')[0]
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState(null) // { type: 'pending' | 'error', text }

  // "Check my status" used to be a bare window.location.reload(), which
  // looked broken: the page flashed and landed on this same screen with no
  // word either way. Now it actually re-reads the approval flag and says
  // what it found — and on approval hands the fresh row up to App.jsx,
  // which swaps this gate out for the real app without a reload.
  async function checkStatus() {
    setChecking(true)
    setResult(null)
    // Same auth-not-settled race guarded against in App.jsx's profile
    // load — wait for the client to have its auth header attached before
    // querying, or RLS silently matches nothing.
    await supabase.auth.getSession()
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
    setChecking(false)

    if (error) {
      setResult({ type: 'error', text: "Couldn't reach the server just now — try again in a moment." })
      return
    }
    if (!data) {
      // Profile row is gone: an admin removed the account while they were
      // sitting on this screen. Nothing to come back to, so sign them out.
      await supabase.auth.signOut()
      return
    }
    if (data.approved) {
      onProfileChange?.(data)
      return
    }
    setResult({ type: 'pending', text: 'Not verified yet — the committee still has your details to review. We’ll email you the moment it’s done.' })
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/eendrag-logo.png" alt="Eendrag logo" className="auth-logo" />
        <div className="pending-verify-icon" aria-hidden="true">⏳</div>
        <h1 className="auth-title">{name ? `Thanks, ${name}!` : 'Thanks for joining!'}</h1>
        <p className="auth-verify-note">
          Your details are being verified against Eendrag residence records by
          the alumni committee. You&rsquo;ll receive an email at{' '}
          <strong>{email}</strong> as soon as you&rsquo;re confirmed — then you
          can sign in and meet everyone.
        </p>
        {result && (
          <p className={result.type === 'error' ? 'form-error' : 'auth-verify-status'} role="status">
            {result.text}
          </p>
        )}
        <button className="btn primary wide" onClick={checkStatus} disabled={checking}>
          {checking ? 'Checking…' : 'Check my status'}
        </button>
        <button className="link-btn" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
}
