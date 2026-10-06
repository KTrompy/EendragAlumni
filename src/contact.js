// The one address members are pointed at when they need a human: the
// waiting and declined screens, the footer, the privacy policy, error
// screens. It used to be a personal Gmail address typed out by hand in seven
// places, so moving to a role address (alumni@… / committee@…) meant hunting
// through components.
//
// Set VITE_CONTACT_EMAIL in Vercel (and .env locally) to change it everywhere
// at once. The Edge Functions read their own CONTACT_EMAIL secret for the
// same purpose — keep the two in step.
export const CONTACT_EMAIL = (import.meta.env.VITE_CONTACT_EMAIL || 'kyletrompeter0@gmail.com').trim()

// mailto: link with an optional subject and body, encoded properly. A raw
// template string here is how the old links ended up with half-encoded
// subjects in some places and unencoded ones in others.
export function contactHref({ subject, body } = {}) {
  const params = []
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`)
  if (body) params.push(`body=${encodeURIComponent(body)}`)
  return `mailto:${CONTACT_EMAIL}${params.length ? `?${params.join('&')}` : ''}`
}
