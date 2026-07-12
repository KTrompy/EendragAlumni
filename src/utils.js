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

// Experience dates are stored as "YYYY-MM" (from a native <input type="month">).
// Renders "Jan 2022 – Present" style ranges, or nothing if both are blank.
// Shared by the profile editor's collapsed entry cards and the read-only
// person-profile timeline, so the two always agree on formatting.
export function formatExperienceRange(from, to) {
  const fmt = (v) => {
    if (!v) return ''
    const [y, m] = v.split('-')
    const d = new Date(Number(y), Number(m) - 1)
    return isNaN(d) ? v : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }
  const fromLabel = fmt(from)
  const toLabel = to ? fmt(to) : (from ? 'Present' : '')
  if (!fromLabel && !toLabel) return ''
  return [fromLabel, toLabel].filter(Boolean).join(' – ')
}

// LinkedIn-style rough duration ("2 yrs 3 mos") for an experience entry. A
// blank `to` is treated as ongoing (counts up to today). Returns '' when
// `from` is missing/unparseable, since a duration without a start point
// isn't meaningful, or when the range comes out to less than a month.
export function formatExperienceDuration(from, to) {
  if (!from) return ''
  const [fy, fm] = from.split('-').map(Number)
  if (!fy || !fm) return ''

  let ey, em
  if (to) {
    [ey, em] = to.split('-').map(Number)
    if (!ey || !em) return ''
  } else {
    const now = new Date()
    ey = now.getFullYear()
    em = now.getMonth() + 1
  }

  const months = (ey - fy) * 12 + (em - fm) + 1 // inclusive of both start/end months
  if (months < 1) return ''

  const years = Math.floor(months / 12)
  const rem = months % 12
  const parts = []
  if (years) parts.push(`${years} yr${years === 1 ? '' : 's'}`)
  if (rem || !years) parts.push(`${rem} mo${rem === 1 ? '' : 's'}`)
  return parts.join(' ')
}
