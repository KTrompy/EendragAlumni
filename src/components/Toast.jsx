import { createContext, useCallback, useContext, useState } from 'react'

// Lightweight global toast/snackbar system. Most actions in the app (post,
// RSVP, delete, save a draft, bookmark a job…) used to complete silently —
// the only feedback loop was a confirm dialog before destructive actions.
// This gives every action a brief, dismissible confirmation instead of
// leaving people to guess whether something actually happened.
const ToastContext = createContext(null)

let idCounter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  // showToast(message, { type: 'success' | 'error', duration })
  const showToast = useCallback((message, opts = {}) => {
    const { type = 'success', duration = 3200 } = opts
    const id = ++idCounter
    setToasts((t) => [...t, { id, message, type }])
    if (duration) setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`toast toast-${t.type}`}
            onClick={() => dismiss(t.id)}
          >
            {t.type === 'success' ? <CheckIcon /> : <ErrorIcon />}
            <span>{t.message}</span>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// Returns a showToast(message, opts) function. Falls back to a no-op
// outside the provider instead of throwing, so components stay easy to
// test/reuse without always needing the full app tree.
export function useToast() {
  const ctx = useContext(ToastContext)
  return ctx || (() => {})
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}
