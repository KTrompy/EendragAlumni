// The biggest blocker to alumni cold-messaging a stranger usually isn't
// lack of interest — it's not knowing what to say first. Wherever a
// "Message" button doesn't already have a specific reason attached (e.g.
// "about your job post"), this builds a short opener from whatever the two
// profiles actually have in common, so the message box never starts truly
// blank.
export function buildIcebreaker(me, them) {
  if (!them) return ''
  const firstName = (them.full_name || '').trim().split(/\s+/)[0] || 'there'

  if (!me) return `Hi ${firstName}!`

  if (me.grad_year && them.grad_year && me.grad_year === them.grad_year) {
    return `Hi ${firstName}! Saw we're both Class of ${them.grad_year} — how's it going?`
  }
  if (me.city && them.city && me.city.trim().toLowerCase() === them.city.trim().toLowerCase()) {
    return `Hi ${firstName}! Saw we're both in ${them.city} — good to connect with a fellow Eendragter nearby.`
  }
  if (me.industry && them.industry && me.industry === them.industry) {
    return `Hi ${firstName}! Saw we're both in ${them.industry} — would love to connect.`
  }
  return `Hi ${firstName}!`
}

// A short label describing *why* two profiles were matched for the
// "People like you" row — same fields the similarity score in Directory.jsx
// is built from (grad year, city, industry). Returns every criterion that
// matched (not just the first) so the badge reflects the full overlap.
export function matchReason(me, them) {
  if (!me || !them) return null
  const reasons = []
  if (me.grad_year && them.grad_year && me.grad_year === them.grad_year) {
    reasons.push(`Class of ${them.grad_year}`)
  }
  if (me.city && them.city && me.city.trim().toLowerCase() === them.city.trim().toLowerCase()) {
    reasons.push(them.city)
  }
  if (me.industry && them.industry && me.industry === them.industry) {
    reasons.push(them.industry)
  }
  return reasons.length ? reasons.join(' · ') : null
}

// Event-specific opener — once you've both RSVP'd "going" to the same
// event, that's a stronger, more concrete hook than anything buildIcebreaker
// can infer from profile fields alone, so attendee-list messages get their
// own opener instead of falling back to the generic one.
export function eventIcebreaker(them, eventTitle) {
  const firstName = (them?.full_name || '').trim().split(/\s+/)[0] || 'there'
  return `Hi ${firstName}! Saw you're also going to "${eventTitle}" — see you there!`
}
