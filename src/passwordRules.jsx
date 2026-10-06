// Single source of truth for password rules and the strength meter.
//
// These used to disagree across three screens: Auth.jsx required 8
// characters at signup, while ResetPassword.jsx and Settings.jsx both
// accepted 6. So anyone could sign up with a strong password and then
// immediately weaken it below the signup minimum via "forgot password" —
// the strictest gate was the one people passed through once, and the
// loosest were the ones they could come back to any time.
//
// The strength meter lived in Auth.jsx and only ever appeared at signup,
// for the same reason: nothing else could import it without pulling in the
// whole auth page. It lives here now so every screen that takes a password
// shows the same feedback.

export const PASSWORD_MIN = 8

// Rough client-side strength score, 0..4 — mirrors the usual zxcvbn-style
// buckets without pulling in a library. Server-side rules (min length etc.)
// still apply regardless of what this says.
export function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '', percent: 0 }
  let score = 0
  if (pw.length >= PASSWORD_MIN) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^a-zA-Z0-9]/.test(pw)) score++
  score = Math.min(4, score)
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong']
  return { score, label: labels[score], percent: (score / 4) * 100 }
}

// The one message every screen shows when a password is too short, so the
// wording can't drift either.
export const PASSWORD_TOO_SHORT = `Password must be at least ${PASSWORD_MIN} characters.`

// A pure length check let eight spaces through as a "valid" password on
// every screen. Callers should use this instead of testing `.length`
// directly, so the whitespace rule can't drift back apart the way the
// minimum length once did.
export function passwordProblem(pw, { emptyMessage = 'Choose a password.' } = {}) {
  if (!pw) return emptyMessage
  if (pw.length < PASSWORD_MIN) return PASSWORD_TOO_SHORT
  if (!pw.trim()) return 'Your password can’t be made up only of spaces.'
  if (!hasLetterAndDigit(pw)) return PASSWORD_NEEDS_MIX
  return null
}

// Mirrors Supabase → Authentication → Email → Password requirements, which
// is set to "Letters and digits". Without this check the form accepted a
// password like "correct horse battery" and Supabase then rejected it at the
// very last step with its own error. If that dashboard setting changes,
// change this too.
export function hasLetterAndDigit(pw) {
  return /[A-Za-z]/.test(pw) && /\d/.test(pw)
}
export const PASSWORD_NEEDS_MIX = 'Password must include at least one letter and one number.'

// Shared strength-meter markup. Renders nothing for an empty field so
// callers can drop it in unconditionally.
export function PasswordStrengthMeter({ password }) {
  if (!password) return null
  const { score, label, percent } = passwordStrength(password)
  return (
    <div className="pw-strength">
      <div className="pw-strength-bar">
        <div className={`pw-strength-fill s${score}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="pw-strength-label">{label}</span>
    </div>
  )
}

// Signup guidance under the "Password" field: the one hard rule shown as a
// checklist item that ticks itself off, plus the strength bar once there's
// something to score. Kept quiet on purpose — a tip only appears when it's
// useful, and nothing is red until the person has actually left the field
// (that part is the field's own error message, not this).
export function PasswordGuidance({ password, id }) {
  const longEnough = password.length >= PASSWORD_MIN
  const mixed = hasLetterAndDigit(password)
  const { score, label, percent } = passwordStrength(password)
  const edgeSpace = !!password.trim() && password !== password.trim()
  return (
    <div className="pw-guide" id={id}>
      <p className={longEnough ? 'pw-rule met' : 'pw-rule'}>
        <span className="pw-rule-mark" aria-hidden="true">{longEnough ? '✓' : ''}</span>
        At least {PASSWORD_MIN} characters
      </p>
      <p className={mixed ? 'pw-rule met' : 'pw-rule'}>
        <span className="pw-rule-mark" aria-hidden="true">{mixed ? '✓' : ''}</span>
        At least one letter and one number
      </p>
      {password && (
        <div className="pw-strength">
          <div className="pw-strength-bar" aria-hidden="true">
            <div className={`pw-strength-fill s${score}`} style={{ width: `${percent}%` }} />
          </div>
          <span className="pw-strength-label">{label}</span>
        </div>
      )}
      {longEnough && mixed && score < 3 && (
        <p className="pw-tip">A few random words together make a strong password that&rsquo;s easy to remember.</p>
      )}
      {edgeSpace && (
        <p className="pw-tip">Your password starts or ends with a space &mdash; make sure that&rsquo;s intended.</p>
      )}
    </div>
  )
}
