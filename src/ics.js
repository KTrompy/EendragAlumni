// Minimal RFC 5545 (iCalendar) writer — just enough to export Eendrag Hub
// events as .ics files that Google/Apple/Outlook calendar can import. No
// external dependency; the format is simple enough that pulling one in
// isn't worth it for what's otherwise a few dozen lines of string building.

function pad(n) { return String(n).padStart(2, '0') }

// UTC, "basic" format per RFC 5545 (YYYYMMDDTHHMMSSZ). Using UTC throughout
// avoids needing to ship VTIMEZONE definitions just for a South
// Africa-based alumni network's calendar exports — every calendar client
// converts a UTC timestamp to the viewer's local time correctly on its own.
function toIcsDate(iso) {
  const d = new Date(iso)
  return (
    d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
    'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'
  )
}

// Escapes text per RFC 5545 §3.3.11 — commas, semicolons, backslashes and
// newlines are all meaningful to the format and need escaping so a title
// or description containing them doesn't corrupt the file.
function escapeText(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// The spec caps content lines at 75 octets, folding longer ones onto a
// continuation line that starts with a space. Without this, a long
// description can get truncated or rejected outright by stricter clients
// (Outlook in particular).
function foldLine(line) {
  if (line.length <= 75) return line
  let out = ''
  let rest = line
  while (rest.length > 75) {
    out += rest.slice(0, 75) + '\r\n '
    rest = rest.slice(75)
  }
  return out + rest
}

function icsLine(key, value) {
  return foldLine(`${key}:${value}`)
}

function eventToVevent(e, siteUrl) {
  const start = e.event_start_time || e.event_date
  // No end time set — default to a 2-hour block rather than a zero-length
  // event, which some calendar apps render oddly (or not at all).
  const end = e.event_end_time || new Date(new Date(start).getTime() + 2 * 60 * 60 * 1000).toISOString()
  const lines = [
    'BEGIN:VEVENT',
    icsLine('UID', `event-${e.id}@eendraghub`),
    icsLine('DTSTAMP', toIcsDate(new Date().toISOString())),
    icsLine('DTSTART', toIcsDate(start)),
    icsLine('DTEND', toIcsDate(end)),
    icsLine('SUMMARY', escapeText(e.title || 'Eendrag Hub event')),
  ]
  if (e.description) lines.push(icsLine('DESCRIPTION', escapeText(e.description)))
  if (e.location) lines.push(icsLine('LOCATION', escapeText(e.location)))
  if (siteUrl) lines.push(icsLine('URL', `${siteUrl}/events/${e.id}`))
  lines.push('END:VEVENT')
  return lines
}

// Builds a full .ics file's contents for one event or a list of them (the
// latter for a "export all my saved/upcoming events" download).
export function buildIcs(events, { calendarName } = {}) {
  const list = Array.isArray(events) ? events : [events]
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Eendrag Hub//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  if (calendarName) lines.push(icsLine('X-WR-CALNAME', escapeText(calendarName)))
  for (const e of list) lines.push(...eventToVevent(e, siteUrl))
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

// Triggers a browser download of the given .ics content via a temporary
// object URL — no server round-trip needed since everything's already in
// hand client-side.
export function downloadIcs(filename, icsContent) {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.ics') ? filename : `${filename}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Filesystem-safe-ish filename from an event title, e.g. for
// "Cape Town Golf Day!" -> "cape-town-golf-day.ics".
export function icsFilenameFor(title) {
  const slug = (title || 'event')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'event'}.ics`
}
