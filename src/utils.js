// Small shared helpers used across components.

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
  if (Array.isArray(value)) return value
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
