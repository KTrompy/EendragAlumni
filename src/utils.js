// Small shared helpers used across components.
import { useEffect, useState } from 'react'

// Tracks whether the viewport is at/above `breakpoint` (default: the
// desktop breakpoint the app already uses elsewhere, e.g. .sidebar /
// .mobile-tabbar switch at 720px). Used to switch a filter panel between
// "persistent sidebar column" (wide) and "slide-in drawer" (narrow)
// without duplicating the panel's markup for each layout.
// "Online" for the Directory's green dot / "Recently online" sort means
// "had a heartbeat in the last few minutes" (see the App.jsx interval that
// writes profiles.last_seen) — a deliberately loose window since the
// heartbeat itself only fires every couple of minutes, not on every click.
const ONLINE_WINDOW_MS = 5 * 60 * 1000
export function isRecentlyOnline(lastSeen) {
  if (!lastSeen) return false
  return Date.now() - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS
}

export function useIsWide(breakpoint = 900) {
  const [isWide, setIsWide] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= breakpoint : true
  )
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`)
    const handler = (e) => setIsWide(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [breakpoint])
  return isWide
}

// Normalizes a profile's "expertise" value into a clean string array.
//
// This field is meant to be a text[] column, but if it's ever saved while
// the column is still plain text (e.g. before schema-update-13.sql has
// been run against Supabase), the array gets silently JSON-stringified —
// so what comes back on load is the literal string
// '["Financial Accounting & Reporting"]' instead of a real array. Detect
// and unwrap that case so the UI never shows raw brackets/quotes, on top
// of the older legacy case where expertise was a single plain string.
export function normalizeExpertise(value) {
  if (Array.isArray(value)) {
    // A real text[] column can still end up holding a single element that's
    // itself the JSON-stringified array (saved back before the column was
    // migrated, then re-saved as one text[] entry instead of several) —
    // e.g. ['["Financial Accounting & Reporting","Personal Tax"]'] instead
    // of ['Financial Accounting & Reporting', 'Personal Tax']. Unwrap that
    // one level so the UI never shows raw brackets/quotes in a single chip.
    if (value.length === 1 && typeof value[0] === 'string') return normalizeExpertise(value[0])
    return value.filter((v) => typeof v === 'string' && v)
  }
  if (!value) return []
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === 'string' && v)
      } catch {
        // Not valid JSON after all — fall through and treat as plain text.
      }
    }
    return [trimmed]
  }
  return []
}
