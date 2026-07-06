import { useEffect } from 'react'

// A styled stand-in for window.confirm() — same modal chrome as ProfileModal,
// so a destructive action gets an on-brand prompt instead of the browser's
// native confirm() dialog.
export default function ConfirmDialog({
  title = 'Are you sure?',
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onCancel])

  return (
    <div className="modal-backdrop" onClick={onCancel} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="confirm-dialog-title">{title}</h2>
          <button className="modal-close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        {message && (
          <div className="modal-body">
            <p>{message}</p>
          </div>
        )}
        <div className="modal-footer">
          <button className="btn ghost" onClick={onCancel}>{cancelLabel}</button>
          <button className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
