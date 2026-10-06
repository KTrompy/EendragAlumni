import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { invokeFunction } from '../supabaseClient'
import { useToast } from './Toast.jsx'
import useDiscardGuard from './useDiscardGuard.jsx'
import useModal from '../useModal.js'
import { Avatar } from './Directory.jsx'

const MAX_MESSAGE = 4000
const MAX_SUBJECT = 150
// How long the composer lingers on its "Sent" state before closing — long
// enough to read as confirmation, short enough not to feel like a delay.
const CLOSE_DELAY_MS = 650

// Every "Message" button in the app calls onMessage(targetProfile, draftText)
// (App.jsx's openMessage), and that opens this: a one-shot compose dialog that
// relays a single email through the send-contact-email Edge Function. There is
// no chat thread and nothing is stored, so closing the dialog loses the draft,
// same as closing a real email.
//
// `session` is only used to tell the sender which address replies will go to —
// the function itself identifies the sender from their token, never from
// anything this component sends.
export default function ContactModal({ target, draftText, profile, session, onClose }) {
  const showToast = useToast()
  const defaultSubject = `Message from ${profile?.full_name || 'a fellow Eendragter'} via Eendrag Alumni`
  const [subject, setSubject] = useState(defaultSubject)
  const [messageText, setMessageText] = useState(draftText || '')
  const [sendCopy, setSendCopy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)
  const closeTimer = useRef(null)

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  // The subject starts pre-filled, so only a changed subject or any message
  // text counts as something worth asking about before closing. A prefilled
  // icebreaker the person never touched doesn't either.
  const dirty = !sent && (
    (messageText.trim() !== '' && messageText.trim() !== (draftText || '').trim())
    || subject.trim() !== defaultSubject
  )

  const { requestClose, discardDialog } = useDiscardGuard({
    dirty: dirty && !busy,
    onDiscard: onClose,
    title: 'Discard this email?',
    message: "What you've written won't be sent.",
    confirmLabel: 'Discard',
  })

  const modalRef = useModal({ onClose: requestClose, closeOnEscape: !busy && !sent })

  const firstName = (target?.full_name || '').trim().split(/\s+/)[0] || 'this member'
  const myEmail = session?.user?.email || ''
  const remaining = MAX_MESSAGE - messageText.length
  const counterLow = remaining <= 200

  async function send() {
    if (!messageText.trim()) {
      setError('Write a message before sending.')
      return
    }
    setBusy(true)
    setError(null)
    // invokeFunction reads the function's own wording out of a 4xx/5xx body,
    // so "This member is not accepting messages…" reaches the screen instead
    // of a generic status-code message.
    const { data, error: fnError } = await invokeFunction('send-contact-email', {
      recipient_id: target.id,
      subject: subject.trim(),
      message: messageText.trim(),
      send_copy: sendCopy,
    })
    if (fnError) {
      setError(fnError.message || "Couldn't send that email. Please try again.")
      setBusy(false)
      return
    }
    // Hold on the confirmed state for a beat so the checkmark actually
    // registers before the dialog disappears.
    setSent(true)
    showToast(
      sendCopy && data?.copy_sent === false
        ? `Email sent to ${firstName}. (We couldn't send you a copy.)`
        : sendCopy
          ? `Email sent to ${firstName}. A copy is on its way to you.`
          : `Email sent to ${firstName}.`
    )
    closeTimer.current = setTimeout(onClose, CLOSE_DELAY_MS)
  }

  return createPortal(
    <>
      <div className="modal-backdrop" onClick={requestClose} role="dialog" aria-modal="true" aria-labelledby="contact-modal-title">
        <form
          className="modal modal-contact"
          ref={modalRef}
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => { e.preventDefault(); if (!busy && !sent) send() }}
          noValidate
        >
          <div className="modal-header contact-modal-header">
            <div className="contact-modal-recipient">
              <Avatar url={target?.avatar_url} name={target?.full_name} size={40} />
              <div className="contact-modal-recipient-text">
                <span className="contact-modal-eyebrow">New email</span>
                <h2 id="contact-modal-title">{target?.full_name || 'Member'}</h2>
              </div>
            </div>
            <button
              type="button"
              className="contact-modal-close"
              onClick={requestClose}
              disabled={sent}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="modal-body">
            <label className="field contact-modal-subject">
              <span>Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value.slice(0, MAX_SUBJECT))}
                maxLength={MAX_SUBJECT}
                disabled={sent}
              />
            </label>

            <label className="field contact-modal-message">
              <span>Message</span>
              <textarea
                className="contact-modal-textarea"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value.slice(0, MAX_MESSAGE))}
                placeholder={`Write your message to ${firstName}…`}
                rows={7}
                autoFocus
                disabled={sent}
              />
              <span className={`contact-modal-counter${counterLow ? ' is-low' : ''}`}>
                {messageText.length} / {MAX_MESSAGE}
              </span>
            </label>

            <label className="contact-modal-copy">
              <input
                type="checkbox"
                checked={sendCopy}
                onChange={(e) => setSendCopy(e.target.checked)}
                disabled={busy || sent}
              />
              <span>Email me a copy{myEmail ? ` (${myEmail})` : ''}</span>
            </label>

            {error && (
              <p className="form-error contact-modal-error" role="alert">
                <ErrorIcon />
                <span>{error}</span>
              </p>
            )}
          </div>

          <div className="modal-footer contact-modal-footer">
            <button
              type="button"
              className="btn ghost contact-modal-cancel"
              onClick={requestClose}
              disabled={busy || sent}
              title={busy ? 'Wait for the email to finish sending' : undefined}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`btn primary contact-modal-send${sent ? ' is-sent' : ''}`}
              disabled={busy || sent}
            >
              {sent ? (
                <>
                  <CheckIcon /> Sent
                </>
              ) : busy ? (
                <>
                  <Spinner /> Sending…
                </>
              ) : (
                'Send email'
              )}
            </button>
          </div>
        </form>
      </div>
      {discardDialog}
    </>,
    document.body
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function Spinner() {
  return <span className="contact-modal-spinner" aria-hidden="true" />
}
