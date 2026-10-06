// Shared rules for the two ways into Eendrag Alumni: the email signup wizard
// (Auth.jsx) and the "complete your application" screen Google joiners land
// on (FinishSignup.jsx). Both used to carry their own copy of the year lists,
// the validation messages and the draft helpers, and the copies had already
// drifted apart (Google joiners were never asked where they live). Anything
// both screens need lives here so they can't drift again.
import { MAX_RESIDENCE_YEARS } from './constants.js'
import { passwordProblem } from './passwordRules.jsx'

// Eendrag opened in 1961 — nobody can have started before that.
export const FOUNDING_YEAR = 1961
const THIS_YEAR = new Date().getFullYear()
// Start years run 1961..now. End years allow a few years into the future so
// current residents can pick their expected final year.
export const START_YEARS = []
for (let y = THIS_YEAR; y >= FOUNDING_YEAR; y--) START_YEARS.push(y)
export const END_YEARS = []
for (let y = THIS_YEAR + 7; y >= FOUNDING_YEAR; y--) END_YEARS.push(y)

export const DEFAULT_COUNTRY = 'South Africa'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function cleanEmail(value) {
  return String(value ?? '').trim()
}

// Email addresses are case-insensitive in practice, and a stray space from a
// paste is invisible — neither should count as "doesn't match".
export function emailsMatch(a, b) {
  return cleanEmail(a).toLowerCase() === cleanEmail(b).toLowerCase()
}

// Display name: the preferred first name wins over the legal one, because
// that's the name other alumni know you by. The legal parts are kept in their
// own columns for the committee (schema-update-57).
export function composeFullName(firstName, preferredName, lastName) {
  return `${(preferredName || '').trim() || (firstName || '').trim()} ${(lastName || '').trim()}`.trim()
}

// Coordinates are only trustworthy alongside the exact label they came from.
// CityAutocomplete reports { lat, lng, label } when a suggestion is picked;
// if the text has been edited since, the pin no longer describes it.
export function coordsForCity(city, coords) {
  if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') return null
  if ((coords.label || '').trim() !== (city || '').trim()) return null
  return { lat: coords.lat, lng: coords.lng }
}

/* ---------- Validation ----------
   Every validator returns an object of { fieldName: message } containing only
   the fields that are currently wrong. The screens show a field's message next
   to the field itself, and because the object is recomputed from the current
   values on every render, a message disappears the moment the field is fixed. */

export function nameErrors({ firstName, lastName }) {
  const e = {}
  if (!String(firstName ?? '').trim()) e.firstName = 'Enter your first name.'
  if (!String(lastName ?? '').trim()) e.lastName = 'Enter your last name.'
  return e
}

export function credentialErrors({ email, confirmEmail, password, confirmPassword }) {
  const e = {}
  const addr = cleanEmail(email)
  if (!addr) e.email = 'Enter your email address.'
  else if (!EMAIL_RE.test(addr)) e.email = 'Enter a valid email address, like name@example.com.'
  if (!cleanEmail(confirmEmail)) e.confirmEmail = 'Type your email address again.'
  else if (!emailsMatch(email, confirmEmail)) e.confirmEmail = 'Email addresses don’t match.'
  const pw = passwordProblem(password, { emptyMessage: 'Choose a password.' })
  if (pw) e.password = pw
  if (!confirmPassword) e.confirmPassword = 'Type your password again.'
  else if (confirmPassword !== password) e.confirmPassword = 'Passwords don’t match.'
  return e
}

export function yearErrors({ startYear, endYear }) {
  const e = {}
  if (!startYear) e.startYear = 'Select the year you arrived at Eendrag.'
  if (!endYear) {
    e.endYear = 'Select the year you left, or your expected final year.'
  } else if (startYear) {
    const span = Number(endYear) - Number(startYear)
    if (span < 0) e.endYear = 'Your final year can’t be before the year you arrived.'
    // Nobody lives in res for more than about a decade. Catches the common
    // slip of picking the wrong decade in one of the two dropdowns.
    else if (span > MAX_RESIDENCE_YEARS) e.endYear = `That’s more than ${MAX_RESIDENCE_YEARS} years in Eendrag — please check both years.`
  }
  return e
}

export function locationErrors({ city, country }) {
  const e = {}
  if (!String(city ?? '').trim()) e.city = 'Enter the city or town you live in.'
  if (!String(country ?? '').trim()) e.country = 'Enter the country you live in.'
  return e
}

export function consentErrors({ newsOptIn, dataConsent }) {
  const e = {}
  if (newsOptIn !== true && newsOptIn !== false) e.newsOptIn = 'Choose whether you’d like news and event emails.'
  if (!dataConsent) e.dataConsent = 'Tick the box to agree — we can’t create your account without it.'
  return e
}

/* ---------- Drafts ----------
   A refresh, a stray back-gesture or a closed tab used to throw away
   everything typed. Both signup screens keep a week-long draft in
   localStorage instead.

   Never drafted: passwords (never written to storage, full stop) and the
   data-consent tick (an affirmation someone has to make on purpose, not
   something to restore on their behalf). */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

// Coerce each stored value back to the type the form expects instead of
// trusting storage. A value that had become a number or object (hand-edited
// storage, or a draft from an older build) would otherwise reach state and
// throw on `.trim()` — permanently, since drafts are re-read on every load.
function coerce(key, v) {
  if (key === 'newsOptIn') return typeof v === 'boolean' ? v : undefined
  if (key === 'cityCoords') {
    return v && typeof v === 'object' && typeof v.lat === 'number' && typeof v.lng === 'number'
      ? { lat: v.lat, lng: v.lng, label: String(v.label ?? '') }
      : undefined
  }
  return String(v)
}

export function readDraft(key, fields) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(key)
      return {}
    }
    const values = parsed.values
    if (!values || typeof values !== 'object') return {}
    const clean = {}
    for (const field of fields) {
      const v = values[field]
      if (v === null || v === undefined) continue
      const c = coerce(field, v)
      if (c !== undefined) clean[field] = c
    }
    return clean
  } catch {
    return {}
  }
}

export function writeDraft(key, fields, values) {
  try {
    localStorage.setItem(key, JSON.stringify({
      savedAt: Date.now(),
      values: Object.fromEntries(fields.map((f) => [f, values[f] ?? null])),
    }))
  } catch { /* private mode / quota — the form still works, just not resumable */ }
}

export function clearDraft(key) {
  try { localStorage.removeItem(key) } catch { /* private mode */ }
}

// Moves keyboard focus (and the viewport) to the first field a screen has
// marked invalid. Called after a failed Continue/submit so the person lands
// on the problem instead of hunting for it — on a phone the error is often
// off-screen above the keyboard.
export function focusFirstInvalid(container) {
  if (!container) return
  requestAnimationFrame(() => {
    const el = container.querySelector('[aria-invalid="true"]')
    if (!el) return
    el.focus({ preventScroll: true })
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

// "Cape Town, Western Cape, South Africa" + "South Africa" shouldn't read as
// "…South Africa, South Africa": a picked suggestion already ends with the
// country, so only append it when it isn't there.
export function formatLocation(city, country) {
  const c = String(city ?? '').trim()
  const k = String(country ?? '').trim()
  if (!c) return k
  if (!k || c.toLowerCase().endsWith(k.toLowerCase())) return c
  return `${c}, ${k}`
}
