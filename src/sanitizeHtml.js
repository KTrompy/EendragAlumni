import DOMPurify from 'dompurify'

// Only what the rich text toolbar can produce (bold, italic, bullets, line
// breaks). No attributes at all — that also strips any pasted inline
// `style=` or `on*=` handlers. Used both right before saving to Supabase and
// again right before rendering, so it's safe even if old data or a future
// code path ever puts something unexpected in the column.
const CONFIG = {
  ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'ul', 'li', 'br', 'div', 'p'],
  ALLOWED_ATTR: [],
}

export function sanitizeHtml(html) {
  if (!html) return ''
  return DOMPurify.sanitize(html, CONFIG)
}
