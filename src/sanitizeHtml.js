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

// contentEditable (the rich text editor used for job/post descriptions)
// often leaves a trailing empty <div><br></div> or two behind if someone
// hits Enter a few extra times while composing. Nothing was stripping
// that before saving, so it rendered as real, visible blank lines after
// the actual text — the "big empty gap at the bottom of the card" bug.
// Removing trailing empty elements/whitespace makes the card end where
// the content actually does.
export function trimTrailingHtml(html) {
  if (!html) return html
  const container = document.createElement('div')
  container.innerHTML = html
  while (container.lastChild) {
    const node = container.lastChild
    const isEmpty =
      (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) ||
      (node.nodeType === Node.ELEMENT_NODE && !node.textContent.trim())
    if (!isEmpty) break
    container.removeChild(node)
  }
  return container.innerHTML
}
