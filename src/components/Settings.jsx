import { useEffect, useState } from 'react'
import { supabase, deleteOwnAccount } from '../supabaseClient'
import ConfirmDialog from './ConfirmDialog.jsx'
import LoadingState from './LoadingState.jsx'
import { useToast } from './Toast.jsx'

const SETTINGS_TABS = [
  { id: 'account', label: 'Account' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'privacy', label: 'Privacy' },
]

// Real categories only — these are the notification types Eendrag Hub
// actually generates today (see the notify_* triggers in schema-update-9,
// schema-update-21, and schema-update-28 for mentoring). No group-invite /
// business / admin-broadcast rows, because those features don't send
// notifications yet — adding them here would just be UI with nothing
// behind it.
const NOTIF_CATEGORIES = [
  { key: 'notify_message', label: 'Someone sends you a message' },
  { key: 'notify_post_activity', label: 'Someone likes or comments on your post' },
  { key: 'notify_event_rsvp', label: "Someone RSVPs to an event you created" },
  { key: 'notify_event_comment', label: 'Someone comments on an event you created' },
  { key: 'notify_mentoring', label: 'A mentoring match is requested or responded to' },
]

const PRIVACY_FIELDS = [
  { key: 'privacy_phone', label: 'Who can see your phone number?' },
  { key: 'privacy_email', label: 'Who can see your email address?' },
  { key: 'privacy_location', label: 'Who can see your location (city, country)?' },
  { key: 'privacy_messages', label: 'Who can send you messages?' },
]

const PRIVACY_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'mentoring', label: 'Mentoring Relationships' },
  { value: 'hide', label: 'Hide' },
]

export default function Settings({ session, profile, onSaved }) {
  const [tab, setTab] = useState('account')

  return (
    <section className="panel">
      <h2 className="panel-title">Settings</h2>

      <div className="settings-tabs" role="tablist">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'settings-tab active' : 'settings-tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="settings-panel">
        {tab === 'account' && <AccountTab session={session} profile={profile} onSaved={onSaved} />}
        {tab === 'notifications' && <NotificationsTab session={session} />}
        {tab === 'privacy' && <PrivacyTab session={session} profile={profile} onSaved={onSaved} />}
      </div>
    </section>
  )
}

/* ---------- Account ---------- */
function AccountTab({ session, profile, onSaved }) {
  const showToast = useToast()
  const [language, setLanguage] = useState(profile?.language || 'en')
  const [email, setEmail] = useState(session.user.email || '')
  const [emailMsg, setEmailMsg] = useState(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [passwordMsg, setPasswordMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [deleting, setDeleting] = useState(false)

  async function saveLanguage(next) {
    const prev = language
    setLanguage(next)
    const { data, error } = await supabase.from('profiles').update({ language: next }).eq('id', session.user.id).select().single()
    if (error) {
      setLanguage(prev)
      showToast('Could not save language preference.', { type: 'error' })
      return
    }
    onSaved?.(data)
  }

  async function saveEmail() {
    setEmailMsg(null)
    if (email.trim() === session.user.email) return
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ email: email.trim() })
    setBusy(false)
    setEmailMsg(error ? error.message : 'Check your inbox to confirm the new email address.')
  }

  async function savePassword() {
    setPasswordMsg(null)
    if (!currentPassword) { setPasswordMsg('Enter your current password.'); return }
    if (password.length < 6) { setPasswordMsg('Password must be at least 6 characters.'); return }
    if (password !== passwordConfirm) { setPasswordMsg('Passwords don’t match.'); return }
    setBusy(true)

    // Re-authenticate with the current password first — updateUser() alone
    // will happily change the password for whoever is holding the current
    // (still-valid) session, with no proof they know the existing one.
    // Anyone with a few minutes on an unlocked, already-signed-in device
    // could lock the real owner out. signInWithPassword re-checks the
    // current password against Supabase before anything changes.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password: currentPassword,
    })
    if (reauthError) {
      setBusy(false)
      setPasswordMsg('Current password is incorrect.')
      return
    }

    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setPasswordMsg(error.message); return }
    setCurrentPassword('')
    setPassword('')
    setPasswordConfirm('')
    setPasswordMsg('Password updated.')
  }

  async function deleteAccount() {
    setDeleting(true)
    setDeleteError(null)
    // Was calling the delete_own_account() DB RPC, which schema-update-3.sql
    // documents as SUPERSEDED: hosted Supabase silently no-ops a plain SQL
    // DELETE against auth.users even from a SECURITY DEFINER function, so
    // this returned success without actually deleting the account. Now
    // uses the same Edge-Function-backed helper Profile.jsx uses — see
    // deleteOwnAccount() in supabaseClient.js.
    const { error } = await deleteOwnAccount()
    if (error) {
      setDeleteError(error.message)
      setDeleting(false)
      return
    }
    await supabase.auth.signOut()
    // Without this, the app was left rendering a signed-out user's stale
    // state — same reload Profile.jsx's delete flow already does.
    window.location.reload()
  }

  return (
    <div className="settings-section-group">
      <div className="settings-section">
        <h3>Language</h3>
        <label className="field settings-field">
          <select value={language} onChange={(e) => saveLanguage(e.target.value)}>
            <option value="en">English (UK)</option>
            <option value="af">Afrikaans</option>
          </select>
        </label>
        <p className="hint">More languages, and full translation of the site, are on the way — this just saves your preference for now.</p>
      </div>

      <div className="settings-section">
        <h3>Login options</h3>

        <label className="field settings-field"><span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button className="btn ghost" disabled={busy || email.trim() === session.user.email} onClick={saveEmail}>Save</button>
        {emailMsg && <p className="hint">{emailMsg}</p>}

        <div className="settings-divider" />

        <label className="field settings-field"><span>Current password</span>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </label>
        <label className="field settings-field"><span>New password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
        </label>
        <label className="field settings-field"><span>Confirm new password</span>
          <input type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} />
        </label>
        <button className="btn ghost" disabled={busy || !password || !currentPassword} onClick={savePassword}>Change password</button>
        {passwordMsg && <p className="hint">{passwordMsg}</p>}
      </div>

      <div className="settings-section settings-danger">
        <h3>Delete account</h3>
        <p className="hint">Permanently deletes your account, profile, posts, photos, messages and group/mentoring memberships. This can't be undone.</p>
        <button className="btn danger" onClick={() => setConfirmingDelete(true)}>Delete account</button>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete your account?"
          message={deleteError || "This permanently deletes your Eendrag Hub account and everything in it — there's no undo."}
          confirmLabel={deleting ? 'Deleting…' : 'Delete permanently'}
          onConfirm={deleteAccount}
          onCancel={() => { setConfirmingDelete(false); setDeleteError(null) }}
        />
      )}
    </div>
  )
}

/* ---------- Notifications ---------- */
function NotificationsTab({ session }) {
  const showToast = useToast()
  const [prefs, setPrefs] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setPrefs(data || { notify_message: true, notify_post_activity: true, notify_event_rsvp: true, notify_event_comment: true, notify_mentoring: true })
        setLoading(false)
      })
  }, [session.user.id])

  async function toggle(key) {
    const prev = prefs
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    // Upsert the whole row, not just the one changed column. When a
    // preferences row doesn't exist yet, upserting a single column creates
    // a row where every *other* preference falls back to whatever the
    // table's column defaults are — which may not match the "all on"
    // defaults this UI assumes, silently flipping toggles the person never
    // touched.
    const { error } = await supabase.from('notification_preferences').upsert({ user_id: session.user.id, ...next })
    if (error) {
      setPrefs(prev)
      showToast('Could not save notification preference.', { type: 'error' })
    }
  }

  if (loading) return <LoadingState message="Loading your notification settings…" />

  return (
    <div className="settings-section">
      <h3>Personal activity</h3>
      <p className="hint">Email and mobile push notifications aren't available yet — Platform (in-app, via the bell icon) is live today.</p>

      <div className="notif-prefs-table">
        <div className="notif-prefs-row notif-prefs-head">
          <span />
          <span>Email</span>
          <span>Mobile</span>
          <span>Platform</span>
        </div>
        {NOTIF_CATEGORIES.map((c) => (
          <div key={c.key} className="notif-prefs-row">
            <span className="notif-prefs-label">{c.label}</span>
            <Toggle checked={false} disabled />
            <Toggle checked={false} disabled />
            <Toggle checked={!!prefs[c.key]} onChange={() => toggle(c.key)} />
          </div>
        ))}
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={checked ? 'settings-toggle on' : 'settings-toggle'}
      onClick={onChange}
    >
      <span className="settings-toggle-knob" />
    </button>
  )
}

/* ---------- Privacy ---------- */
function PrivacyTab({ session, profile, onSaved }) {
  const showToast = useToast()

  async function setValue(key, value) {
    const { data, error } = await supabase.from('profiles').update({ [key]: value }).eq('id', session.user.id).select().single()
    if (error) {
      showToast('Could not save privacy setting.', { type: 'error' })
      return
    }
    onSaved?.(data)
  }

  return (
    <div className="settings-section">
      <h3>General</h3>
      <p className="hint">"Mentoring Relationships" means an active mentor/mentee match with that person — see Mentoring.</p>

      <div className="privacy-table">
        <div className="privacy-row privacy-row-head">
          <span />
          {PRIVACY_OPTIONS.map((o) => <span key={o.value}>{o.label}</span>)}
        </div>
        {PRIVACY_FIELDS.map((f) => (
          <div key={f.key} className="privacy-row">
            <span className="privacy-row-label">{f.label}</span>
            {PRIVACY_OPTIONS.map((o) => (
              <label key={o.value} className="privacy-radio">
                <input
                  type="radio"
                  name={f.key}
                  checked={profile?.[f.key] === o.value}
                  onChange={() => setValue(f.key, o.value)}
                />
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
