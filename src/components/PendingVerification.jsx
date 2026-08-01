import { supabase } from '../supabaseClient'

// Full-screen gate shown to signed-in members who haven't been approved
// yet — the app itself stays locked until the alumni committee verifies
// them against Eendrag residence records (Admin → Pending approval).
// A confirmation email on approval is planned once an email provider
// (e.g. Resend) is wired up — see Admin.jsx's setApproved.
export default function PendingVerification({ session, profile }) {
  const email = session.user.email
  const name = (profile?.full_name || '').split(' ')[0]

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
        <button className="btn primary wide" onClick={() => window.location.reload()}>
          Check my status
        </button>
        <button className="link-btn" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
}
