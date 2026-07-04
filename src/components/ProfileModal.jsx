import { useEffect } from 'react'
import { PhotoBlock } from './Directory.jsx'

// Displays every field on record for one person, styled like the SACS
// alumni-detail popup: label · value rows, big photo up top, action bar at foot.
export default function ProfileModal({ person: p, isMe, onClose, onMessage }) {
  // Escape to close, and lock body scroll while open.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const rows = [
    ['Status', p.is_current_resident ? 'Current Eendragter' : 'Alumnus'],
    ['Year left Eendrag', p.grad_year || dash],
    ['Section', p.section || dash],
    ['Industry', p.industry || dash],
    ['Occupation', p.occupation || dash],
    ['Occupation description', p.occupation_description || dash],
    ['Company', p.company || dash],
    ['City', p.city || dash],
    ['Province', p.province || dash],
    ['Country', p.country || dash],
    ['Available for mentorship', renderMentorship(p)],
    ['Bio', p.bio || dash],
  ]

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="modal-title">{p.full_name || 'Alumnus'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <PhotoBlock url={p.avatar_url} name={p.full_name} className="modal-photo" />
          {rows.map(([label, value]) => (
            <div className="detail-row" key={label}>
              <div className="detail-label">{label}</div>
              <div className={
                value === dash ? 'detail-value muted' : 'detail-value'
              }>{value}</div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          {p.linkedin_url && (
            <a className="linkedin-link" href={p.linkedin_url} target="_blank" rel="noopener noreferrer">
              <LinkedInIconSmall /> LinkedIn
            </a>
          )}
          <button className="btn ghost" onClick={onClose}>Close</button>
          {!isMe && (
            <button className="btn primary" onClick={onMessage}>
              Send a message
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const dash = '—'

function renderMentorship(p) {
  if (!p.available_for_mentorship) return <span className="detail-mentorship-no">Not currently</span>
  return (
    <span>
      <span className="detail-mentorship-yes">Yes</span>
      {p.mentorship_description ? ` — ${p.mentorship_description}` : ''}
    </span>
  )
}

function LinkedInIconSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.13 1 2.5 1s2.48 1.13 2.48 2.5zM.24 8h4.52v14H.24V8zm7.5 0h4.34v1.92h.06c.6-1.14 2.07-2.34 4.26-2.34 4.56 0 5.4 3 5.4 6.9V22h-4.52v-6.14c0-1.46-.02-3.34-2.04-3.34-2.04 0-2.36 1.6-2.36 3.24V22H7.74V8z"/>
    </svg>
  )
}
