import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { ApplicationProgress } from './SignupFields.jsx'
import { contactHref } from '../contact.js'
import { formatLocation } from '../signup.js'

// "Your application is under review" — the full-screen gate for signed-in
// members the committee hasn't verified yet. The lock itself is in the
// database (every SELECT policy requires is_approved(), schema-update-46);
// this screen's job is to make waiting feel like progress rather than being
// shut out: what's done, what's happening, what they'll get next, and a way
// to reach a person.
export default function PendingVerification({ session, profile, onProfileChange }) {
  const email = session.user.email
  const viaGoogle = session.user.app_metadata?.provider === 'google'
  const name = (profile?.preferred_name || profile?.first_name || (profile?.full_name || '').split(' ')[0] || '').trim()
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState(null) // { type: 'pending' | 'error' | 'removed', text }
  const [checkedAt, setCheckedAt] = useState(null)

  const onProfileChangeRef = useRef(onProfileChange)
  onProfileChangeRef.current = onProfileChange

  // "We've received your application" email.
  //
  // Sent from here, the first screen every applicant reaches once their email
  // is confirmed — whichever way they joined. It used to be sent from the
  // signup form itself, which only works when signup produces a session
  // straight away, so everyone on the email-confirmation path (i.e. every
  // normal email signup) never got it. The Edge Function is idempotent: it
  // records application_email_sent_at and sends at most once per account, so
  // reloading this screen can't send duplicates. The sessionStorage flag just
  // saves a pointless request on every reload.
  useEffect(() => {
    const key = `eendrag-received-email-${session.user.id}`
    // Flag first, cleared again on failure, so a double-mounted effect (React
    // StrictMode in dev) can't fire two requests before the first returns.
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch { /* private mode — the server-side claim still prevents duplicates */ }
    supabase.functions
      .invoke('send-member-email', { body: { kind: 'received' } })
      // functions.invoke never rejects — it resolves with { error } for
      // network, CORS and "not deployed" failures alike — so read the result
      // rather than chaining .catch().
      .then(({ error }) => {
        if (!error) return
        console.error('send-member-email (received) failed:', error)
        try { sessionStorage.removeItem(key) } catch { /* private mode */ }
      })
  }, [session.user.id])

  async function fetchProfile() {
    // Wait for the client's auth header before querying, or RLS silently
    // matches nothing (same race guarded in App.jsx's profile load).
    await supabase.auth.getSession()
    return supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
  }

  // A decision either way hands the fresh row up to App.jsx, which swaps this
  // screen for the app (approved) or the declined screen.
  function decided(row) {
    return row && (row.approved || row.declined_at)
  }

  async function checkStatus() {
    if (checking) return
    setChecking(true)
    setResult(null)
    const { data, error } = await fetchProfile()
    setChecking(false)
    setCheckedAt(new Date())

    if (error) {
      setResult({ type: 'error', text: 'We couldn’t reach the server just now. Check your connection and try again.' })
      return
    }
    if (!data) {
      // The account was removed while they sat here. Say so before signing
      // them out — a silent bounce to the sign-in page reads as a bug.
      setResult({ type: 'removed', text: 'This account is no longer registered — it looks like it was removed by an administrator. Signing you out. If you think that’s a mistake, get in touch.' })
      setTimeout(() => { supabase.auth.signOut() }, 6000)
      return
    }
    if (decided(data)) {
      onProfileChangeRef.current?.(data)
      return
    }
    setResult({ type: 'pending', text: 'Not verified yet. The committee still has your details to review.' })
  }

  // Quiet background check every minute while the tab is visible, so the gate
  // usually lifts on its own when someone clicks through from the approval
  // email to a tab already sitting here. Silent on failure: only the button
  // reports problems.
  useEffect(() => {
    let cancelled = false
    const interval = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      if (!cancelled && decided(data)) onProfileChangeRef.current?.(data)
    }, 60 * 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [session.user.id])

  const years = profile?.start_year && profile?.grad_year ? `${profile.start_year}–${profile.grad_year}` : profile?.grad_year || null
  const legalName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.full_name || ''
  const location = formatLocation(profile?.city, profile?.country)
  const contact = contactHref({
    subject: 'Eendrag Alumni — my application',
    body: `Hi,\n\nI applied to join Eendrag Alumni with ${email} and wanted to check on / correct my details:\n\n`,
  })

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/eendrag-logo.png" alt="Eendrag logo" className="auth-logo small" />
        <h1 className="su-title">Your application is under review</h1>
        <p className="su-lead">{name ? `Thanks, ${name}. ` : ''}We&rsquo;ve received your application.</p>

        <ApplicationProgress
          steps={[
            { label: 'Account created', state: 'done' },
            { label: viaGoogle ? 'Email verified by Google' : 'Email confirmed', state: 'done' },
            {
              label: 'Eendrag verification',
              state: 'current',
              detail: 'We’re checking your membership details against our records.',
            },
            { label: 'Approved', state: 'todo', detail: <>We&rsquo;ll email <strong className="su-email">{email}</strong> as soon as you&rsquo;re approved.</> },
          ]}
        />

        {(legalName || years || location) && (
          <div className="su-details">
            <p className="su-details-title">What the committee is checking</p>
            <dl>
              {legalName && (<><dt>Name</dt><dd>{legalName}</dd></>)}
              {years && (<><dt>In Eendrag</dt><dd>{years}</dd></>)}
              {location && (<><dt>Lives in</dt><dd>{location}</dd></>)}
            </dl>
          </div>
        )}

        {checking ? (
          <p className="su-status-line" role="status">Checking your application…</p>
        ) : result ? (
          <p className={result.type === 'pending' ? 'su-status-line is-pending' : 'form-error'} role="status">
            {result.text}
            {result.type === 'pending' && checkedAt && (
              <span className="su-checked-at">
                Last checked: {checkedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
              </span>
            )}
          </p>
        ) : null}

        <div className="su-actions">
          <button type="button" className="btn primary" onClick={checkStatus} disabled={checking || result?.type === 'removed'} aria-busy={checking}>
            {checking ? 'Checking…' : 'Check status'}
          </button>
          {/* The profile editor sits behind the approval gate, so this is the
              only way to correct a misspelt name or the wrong years before
              the committee looks — the account's email is already in it. */}
          <a className="btn ghost" href={contact}>Get in touch</a>
        </div>
        <p className="su-small su-center su-gap">Spotted a mistake in your details, or waited more than a week? Get in touch and we&rsquo;ll sort it out.</p>
        <button type="button" className="link-btn" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
}
