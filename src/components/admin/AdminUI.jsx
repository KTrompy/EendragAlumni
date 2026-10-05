// Shared building blocks for the admin area: the section context (counts,
// cache), the query hook, and the small set of UI patterns every section
// uses — page header, load error, empty line, pager, status dot, dialog.
//
// Deliberately small. If a pattern appears in only one section it lives in
// that section's file.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import useModal from '../../useModal.js'
import { describeError } from './adminApi.js'

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

export const AdminContext = createContext(null)

export function useAdmin() {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin must be used inside the admin shell')
  return ctx
}

// Fetches through the shell's cache. A section you've just left and come back
// to within a minute renders straight from the cache with no request; any
// write in a namespace (bump('members')) makes the next read refetch.
//
//   const { data, error, loading, reload } = useAdminQuery('members', key, fetcher)
//
// `fetcher` must resolve to { error, ...rest }; everything but `error` is
// cached as `data`.
const FRESH_MS = 60_000

export function useAdminQuery(ns, key, fetcher) {
  const { cache, versions } = useAdmin()
  const version = versions[ns] || 0
  const fullKey = `${ns}:${key}`
  const cached = cache.current.get(fullKey)
  const usable = cached && cached.version === version && Date.now() - cached.at < FRESH_MS

  const [state, setState] = useState(() => (
    usable ? { data: cached.data, error: null, loading: false } : { data: cached?.data ?? null, error: null, loading: true }
  ))
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const seq = useRef(0)

  const run = useCallback(async () => {
    const mine = ++seq.current
    setState((s) => ({ ...s, loading: true, error: null }))
    let result
    try {
      result = await fetcherRef.current()
    } catch (e) {
      result = { error: e }
    }
    if (mine !== seq.current) return
    const { error, ...data } = result || {}
    if (error) {
      setState((s) => ({ ...s, loading: false, error }))
      return
    }
    cache.current.set(fullKey, { data, at: Date.now(), version })
    setState({ data, error: null, loading: false })
  }, [cache, fullKey, version])

  useEffect(() => {
    const c = cache.current.get(fullKey)
    if (c && c.version === version && Date.now() - c.at < FRESH_MS) {
      setState({ data: c.data, error: null, loading: false })
      return
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey, version])

  return { ...state, reload: run }
}

// A per-id "in flight" guard backed by a ref, so two clicks in the same frame
// can't both get through (the old guard read state from a stale closure).
export function useBusy() {
  const ref = useRef(new Set())
  const [, force] = useState(0)
  const run = useCallback(async (id, fn) => {
    if (ref.current.has(id)) return undefined
    ref.current.add(id)
    force((n) => n + 1)
    try {
      return await fn()
    } finally {
      ref.current.delete(id)
      force((n) => n + 1)
    }
  }, [])
  const isBusy = useCallback((id) => ref.current.has(id), [])
  return { run, isBusy }
}

// Per-row error messages, keyed by id. Replaces the old single page-wide
// error slot that showed every failure above every tab.
export function useRowErrors() {
  const [errors, setErrors] = useState({})
  const set = useCallback((id, err) => {
    setErrors((prev) => {
      const next = { ...prev }
      if (err) next[id] = typeof err === 'string' ? err : describeError(err)
      else delete next[id]
      return next
    })
  }, [])
  return [errors, set]
}

/* ------------------------------------------------------------------ */
/* Page furniture                                                      */
/* ------------------------------------------------------------------ */

export function PageHeader({ title, children }) {
  return (
    <header className="adm-head">
      <h1 className="adm-title">{title}</h1>
      {children && <div className="adm-head-actions">{children}</div>}
    </header>
  )
}

export function LoadError({ what, error, onRetry }) {
  return (
    <div className="adm-load-error" role="alert">
      <p>
        <strong>Couldn&rsquo;t load {what}.</strong>{' '}
        <span className="adm-muted">{describeError(error)}</span>
      </p>
      {onRetry && <button type="button" className="adm-btn" onClick={onRetry}>Retry</button>}
    </div>
  )
}

export function Loading({ label = 'Loading…' }) {
  return <p className="adm-loading" role="status">{label}</p>
}

export function Empty({ children }) {
  return <p className="adm-empty">{children}</p>
}

export function RowError({ message }) {
  if (!message) return null
  return <p className="adm-row-error" role="alert">{message}</p>
}

const STATUS_TONE = {
  approved: 'ok', pending: 'warn', unconfirmed: 'warn', incomplete: 'muted', declined: 'bad',
  open: 'warn', reviewed: 'ok', dismissed: 'muted',
  featured: 'accent', listed: 'muted', upcoming: 'ok', past: 'muted', closed: 'muted', live: 'ok',
  visible: 'ok', hidden: 'muted',
}

export function Status({ value, children }) {
  return <span className={`adm-status ${STATUS_TONE[value] || 'muted'}`}>{children}</span>
}

// "1–25 of 142   ‹ Previous  Next ›". `total` may be null when unknown.
export function Pager({ page, pageSize, total, shown, onPage, label = 'results' }) {
  if (!total && page === 0) return null
  const from = page * pageSize + (shown ? 1 : 0)
  const to = page * pageSize + shown
  const hasNext = total == null ? shown === pageSize : to < total
  if (page === 0 && !hasNext) {
    return <p className="adm-pager-summary">{total} {label}</p>
  }
  return (
    <nav className="adm-pager" aria-label="Pagination">
      <span className="adm-pager-summary">{shown ? `${from}–${to}` : '0'}{total != null ? ` of ${total}` : ''}</span>
      <button type="button" className="adm-btn" onClick={() => onPage(page - 1)} disabled={page === 0}>
        ‹ Previous
      </button>
      <button type="button" className="adm-btn" onClick={() => onPage(page + 1)} disabled={!hasNext}>
        Next ›
      </button>
    </nav>
  )
}

// Filter chips that read as one control. aria-pressed, not tabs: they filter
// a single list rather than switching between panels.
export function Segmented({ label, options, value, onChange }) {
  return (
    <div className="adm-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          className={value === o.id ? 'on' : undefined}
          onClick={() => onChange(o.id)}
        >
          {o.label}
          {o.count > 0 && <span className="adm-seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

// The admin area's one dialog. Built on useModal (focus trap, Escape, focus
// return). Stays open while the action runs and shows its error inside, so a
// failure is reported where the decision was made.
//
// `requireText`: the confirm button stays disabled until this exact text is
// typed — used for the irreversible actions on another admin.
export function AdminDialog({
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy = false,
  error = null,
  requireText = null,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  hideConfirm = false,
}) {
  const ref = useModal({ onClose: busy ? undefined : onCancel, history: false, closeOnEscape: !busy })
  const [typed, setTyped] = useState('')
  const titleId = useRef(`adm-dlg-${Math.random().toString(36).slice(2, 8)}`).current
  const matches = !requireText || typed.trim().toLowerCase() === requireText.trim().toLowerCase()

  return createPortal(
    <div className="adm-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel?.() }}>
      <div className="adm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <h2 id={titleId} className="adm-dialog-title">{title}</h2>
        <div className="adm-dialog-body">
          {children}
          {requireText && (
            <label className="adm-field">
              <span>Type <strong>{requireText}</strong> to confirm</span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                data-autofocus
              />
            </label>
          )}
          {error && <p className="adm-row-error" role="alert">{typeof error === 'string' ? error : describeError(error)}</p>}
        </div>
        <div className="adm-dialog-actions">
          <button type="button" className="adm-btn" onClick={onCancel} disabled={busy} data-autofocus={requireText ? undefined : true}>
            {cancelLabel}
          </button>
          {!hideConfirm && (
            <button
              type="button"
              className={`adm-btn ${tone}`}
              onClick={onConfirm}
              disabled={busy || !matches || confirmDisabled}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// Wraps an async action for AdminDialog: tracks busy + error, closes on success.
export function useDialogAction(onDone) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const run = useCallback(async (fn) => {
    setBusy(true)
    setError(null)
    let r
    try {
      r = await fn()
    } catch (e) {
      r = { error: e }
    }
    setBusy(false)
    if (r?.error) { setError(r.error); return false }
    onDone?.(r)
    return true
  }, [onDone])
  const reset = useCallback(() => { setBusy(false); setError(null) }, [])
  return { busy, error, run, reset }
}

export function formatDate(iso, withTime = false) {
  if (!iso) return ''
  const d = new Date(iso)
  return withTime
    ? d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
