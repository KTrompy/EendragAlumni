// "+ New ghost account" on Members. A ghost signs in with its own email and
// password, can browse everything, and is invisible and read-only to every
// other member (schema-update-58). The password is shown once, here, because
// nothing emails it anywhere.
import { useState } from 'react'
import { AdminDialog } from './AdminUI.jsx'
import { createGhost } from './adminApi.js'
import { useAdmin } from './AdminUI.jsx'
import { useToast } from '../Toast.jsx'

function passwordProblem(pw) {
  if (pw.length < 8) return 'Use at least 8 characters.'
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use a lowercase letter, a capital and a number.'
  return null
}

export default function GhostAccountModal({ onClose }) {
  const { bump, refreshCounts } = useAdmin()
  const showToast = useToast()
  const [label, setLabel] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [created, setCreated] = useState(null)

  async function submit() {
    if (busy) return
    const e = email.trim()
    if (!e || !e.includes('@')) { setError('Enter the email address they will sign in with.'); return }
    const pwErr = passwordProblem(password)
    if (pwErr) { setError(pwErr); return }
    setBusy(true)
    setError(null)
    const r = await createGhost({ email: e, password, label: label.trim() || 'Ghost account' })
    setBusy(false)
    if (r.error) { setError(r.error.message); return }
    setCreated({ email: e, password, label: label.trim() || 'Ghost account' })
    bump('members')
    refreshCounts()
    showToast('Ghost account created')
  }

  if (created) {
    return (
      <AdminDialog title="Ghost account created" cancelLabel="Done" hideConfirm onCancel={onClose}>
        <p>Write these down now. They aren&rsquo;t emailed anywhere and the password won&rsquo;t be shown again.</p>
        <dl className="adm-dl adm-credentials">
          <dt>Label</dt><dd>{created.label}</dd>
          <dt>Email</dt><dd><code>{created.email}</code></dd>
          <dt>Password</dt><dd><code>{created.password}</code></dd>
        </dl>
      </AdminDialog>
    )
  }

  return (
    <AdminDialog
      title="New ghost account"
      confirmLabel="Create account"
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={submit}
    >
      <p className="adm-muted">A browse-only login that no other member can see, and that can&rsquo;t post, message or apply.</p>
      <form onSubmit={(ev) => { ev.preventDefault(); submit() }} className="adm-form">
        <label className="adm-field">
          <span>Label <span className="adm-muted">(only admins see this)</span></span>
          <input value={label} onChange={(ev) => setLabel(ev.target.value)} placeholder="e.g. Committee observer" autoComplete="off" data-autofocus />
        </label>
        <label className="adm-field">
          <span>Email</span>
          <input type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} placeholder="observer@example.com" autoComplete="off" required />
        </label>
        <label className="adm-field">
          <span>Password</span>
          {/* Visible on purpose: the admin has to copy it down accurately. */}
          <input type="text" value={password} onChange={(ev) => setPassword(ev.target.value)} placeholder="8+ characters, a capital and a number" autoComplete="off" spellCheck={false} required />
        </label>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </AdminDialog>
  )
}
