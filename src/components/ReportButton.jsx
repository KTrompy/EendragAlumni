import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from './Toast.jsx'

const REASONS = [
  { id: 'spam', label: 'Spam or misleading' },
  { id: 'harassment', label: 'Harassment or abuse' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'scam', label: 'Scam or fraud' },
  { id: 'other', label: 'Something else' },
]

// One shared "flag this" button + modal, dropped into any post/job/
// business/profile's action row so reporting looks and behaves
// identically everywhere instead of every feature reinventing it. Writes
// to the `reports` table (see schema-update-28.sql) — an admin reviews
// everything filed here from the new Reports tab in Admin.jsx. Not gated
// behind account approval (unlike posting/messaging): flagging something
// is a safety action, not a content-creation privilege.
export default function ReportButton({ session, entityType, entityId, className = 'post-action', label = 'Report', title = 'Report this' }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const showToast = useToast()

  async function submit() {
    if (!reason) return
    setBusy(true)
    const { error } = await supabase.from('reports').insert({
      reporter_id: session.user.id,
      entity_type: entityType,
      entity_id: String(entityId),
      reason,
      details: details.trim(),
    })
    setBusy(false)
    if (error) {
      showToast('Could not submit report.', { type: 'error' })
      return
    }
    setDone(true)
  }

  function close(e) {
    e?.stopPropagation()
    setOpen(false)
    setTimeout(() => { setReason(''); setDetails(''); setDone(false) }, 200)
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        title={title}
        aria-label={title}
      >
        <FlagIcon />{label && ` ${label}`}
      </button>

      {open && (
        <div className="modal-backdrop" onClick={close} role="dialog" aria-modal="true" aria-label="Report content">
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h2>{done ? 'Thanks — we got it' : 'Report this'}</h2>
              <button className="modal-close" onClick={close} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              {done ? (
                <p>An admin will take a look. The person you flagged won't be told who reported it.</p>
              ) : (
                <>
                  <label className="field"><span>What's wrong?</span>
                    <select value={reason} onChange={(e) => setReason(e.target.value)}>
                      <option value="">Choose a reason…</option>
                      {REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>Anything else? (optional)</span>
                    <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={500} />
                  </label>
                </>
              )}
            </div>
            <div className="modal-footer">
              {done ? (
                <button className="btn primary" onClick={close}>Done</button>
              ) : (
                <>
                  <button className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
                  <button className="btn primary" onClick={submit} disabled={busy || !reason}>{busy ? 'Sending…' : 'Submit report'}</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function FlagIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 21V4" />
      <path d="M5 4h13l-3 4 3 4H5" />
    </svg>
  )
}
