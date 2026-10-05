// Member actions shared by Overview, the Members table and the member drawer:
// one place that performs the write, reports the result in a toast (with
// Undo where undo is meaningful) and tells the rest of the admin area that
// the member data changed.
import { useCallback, useState } from 'react'
import { useToast } from '../Toast.jsx'
import Turnstile, { TURNSTILE_SITE_KEY } from '../Turnstile.jsx'
import { AdminDialog, useAdmin, useDialogAction } from './AdminUI.jsx'
import {
  approveMember, unapproveMember, declineMember, undoDecline, setMemberAdmin,
  deleteMember, resendConfirmation, describeError,
} from './adminApi.js'

export function memberName(m) {
  return (m?.full_name || '').trim() || m?.email || 'This member'
}

export function useMemberActions() {
  const showToast = useToast()
  const { bump, refreshCounts } = useAdmin()

  const changed = useCallback(() => {
    bump('members')
    refreshCounts()
  }, [bump, refreshCounts])

  // Runs an undo and reports it. Undo failures are shown as an error toast,
  // because by then the row the action came from may be gone.
  const undo = useCallback(async (fn, doneText) => {
    const { error } = await fn()
    if (error) { showToast(`Couldn't undo: ${describeError(error)}`, { type: 'error' }); return }
    changed()
    showToast(doneText)
  }, [changed, showToast])

  const approve = useCallback(async (m) => {
    const r = await approveMember(m.id)
    if (r.error) return r
    changed()
    const name = memberName(m)
    const undoAction = { label: 'Undo', onClick: () => undo(() => unapproveMember(m.id), `${name} moved back to pending`) }
    if (r.emailSent) {
      showToast(`${name} approved · approval email sent`, { action: undoAction })
    } else {
      showToast(`${name} is approved, but the approval email didn't send (${r.emailError?.message || 'unknown error'}). Let them know another way.`, { type: 'error', action: undoAction })
    }
    return r
  }, [changed, showToast, undo])

  const unapprove = useCallback(async (m) => {
    const r = await unapproveMember(m.id)
    if (r.error) return r
    changed()
    showToast(`${memberName(m)} moved back to pending`)
    return r
  }, [changed, showToast])

  const decline = useCallback(async (m, reason) => {
    const r = await declineMember(m.id, reason)
    if (r.error) return r
    changed()
    const name = memberName(m)
    const undoAction = { label: 'Undo', onClick: () => undo(() => undoDecline(m.id), `${name} moved back to pending`) }
    if (r.emailSent) {
      showToast(`${name} declined · email sent`, { action: undoAction })
    } else {
      showToast(`${name} is declined, but the email explaining why didn't send (${r.emailError?.message || 'unknown error'}). Please tell them directly.`, { type: 'error', action: undoAction })
    }
    return r
  }, [changed, showToast, undo])

  const restore = useCallback(async (m) => {
    const r = await undoDecline(m.id)
    if (r.error) return r
    changed()
    showToast(`${memberName(m)} moved back to pending`)
    return r
  }, [changed, showToast])

  const setAdmin = useCallback(async (m, value) => {
    const r = await setMemberAdmin(m.id, value)
    if (r.error) return r
    changed()
    showToast(value ? `${memberName(m)} is now an admin` : `${memberName(m)} is no longer an admin`)
    return r
  }, [changed, showToast])

  const remove = useCallback(async (m) => {
    const r = await deleteMember(m.id)
    if (r.error) return r
    changed()
    showToast(`${memberName(m)}'s account was deleted`)
    return r
  }, [changed, showToast])

  const resend = useCallback(async (m, captchaToken) => {
    const r = await resendConfirmation(m.email, captchaToken)
    if (r.error) return r
    showToast(`Confirmation link sent to ${m.email}`)
    return r
  }, [showToast])

  return { approve, unapprove, decline, restore, setAdmin, remove, resend }
}

/* ---------- Decline ---------- */

export function DeclineDialog({ member, onClose, onDeclined }) {
  const actions = useMemberActions()
  const [reason, setReason] = useState('')
  const { busy, error, run } = useDialogAction(() => { onDeclined?.(); onClose() })

  return (
    <AdminDialog
      title={`Decline ${memberName(member)}?`}
      confirmLabel="Decline and email them"
      tone="primary"
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={() => run(() => actions.decline(member, reason.trim()))}
    >
      <p>They&rsquo;ll get an email saying we couldn&rsquo;t match them to residence records, and see the same message when they sign in. Nothing is deleted, and you can undo it.</p>
      <label className="adm-field">
        <span>Reason <span className="adm-muted">(optional, they will see it)</span></span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="e.g. No record of these years in Eendrag"
          data-autofocus
        />
      </label>
    </AdminDialog>
  )
}

/* ---------- Resend confirmation ---------- */

// Supabase's /resend endpoint wants a captcha token when Turnstile is on for
// the project. The old page kept a captcha widget on screen permanently; now
// it only appears, in a dialog, when someone actually clicks Resend.
export function ResendButton({ member, className = 'adm-btn', label = 'Resend link', onError }) {
  const actions = useMemberActions()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function sendDirect() {
    if (busy) return
    setBusy(true)
    onError?.(null)
    const r = await actions.resend(member)
    setBusy(false)
    if (r.error) onError?.(r.error)
  }

  if (!member?.email) return null
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => (TURNSTILE_SITE_KEY ? setOpen(true) : sendDirect())}
      >
        {busy ? 'Sending…' : label}
      </button>
      {open && <ResendDialog member={member} onClose={() => setOpen(false)} />}
    </>
  )
}

function ResendDialog({ member, onClose }) {
  const actions = useMemberActions()
  const [token, setToken] = useState(null)
  const [nonce, setNonce] = useState(0)
  const { busy, error, run } = useDialogAction(onClose)

  async function send() {
    const ok = await run(() => actions.resend(member, token))
    if (!ok) { setToken(null); setNonce((n) => n + 1) }
  }

  return (
    <AdminDialog
      title="Resend confirmation link"
      confirmLabel="Send link"
      busy={busy}
      error={error}
      confirmDisabled={!token}
      onCancel={onClose}
      onConfirm={send}
    >
      <p>A new confirmation link goes to <strong>{member.email}</strong>. They need to click it before you can approve them.</p>
      <Turnstile onToken={setToken} resetSignal={nonce} className="auth-captcha adm-captcha" />
    </AdminDialog>
  )
}
