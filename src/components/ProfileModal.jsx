import { useEffect } from 'react'
import { PhotoBlock } from './Directory.jsx'
import { normalizeExpertise } from '../utils.js'

const dash = '—'

// A handful of structured facts read better as a compact strip (short label
// above a short value) than as full-width rows once the header block above
// already covers role, company and location — this only needs to carry
// what's left: background and field.
function Fact({ label, value }) {
  return (
    <div className="profile-fact">
      <span className="profile-fact-label">{label}</span>
      <span className={value === dash ? 'profile-fact-value muted' : 'profile-fact-value'}>{value}</span>
    </div>
  )
}

// Read-only tag list — same look as the card grid's expertise/category
// chips, reused here so a business profile section reads consistently
// whether you're scanning the grid or looking at the full modal.
function Chips({ items }) {
  if (!items || items.length === 0) return null
  return (
    <ul className="person-tags modal-chips">
      {items.map((item) => (
        <li key={item} className="person-tag">{item}</li>
      ))}
    </ul>
  )
}

export default function ProfileModal({ person: p, isMe, onClose, onMessage }) {
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

  const roleLine = p.occupation && p.company
    ? `${p.occupation} @ ${p.company}`
    : (p.occupation || p.company || '')

  const locationLine = p.city && p.country
    ? `${p.city}, ${p.country}`
    : (p.country || p.city || '')

  const expertise = normalizeExpertise(p.expertise)
  const servicesOffered = Array.isArray(p.services_offered) ? p.services_offered : []
  const businessCategories = Array.isArray(p.business_categories) ? p.business_categories : []
  const geographicFocus = Array.isArray(p.geographic_focus) ? p.geographic_focus : []
  // Only show the business section at all if there's something in it —
  // most fields here default to blank/true and shouldn't clutter the
  // profile of someone who never opened that part of the form.
  const hasBusinessProfile = expertise.length > 0 || servicesOffered.length > 0
    || businessCategories.length > 0 || geographicFocus.length > 0
    || !!p.business_website || !!p.availability

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="modal-title">{p.full_name || 'Alumnus'}{isMe && <span className="person-name-you">You</span>}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <div className="profile-card-header">
            <PhotoBlock url={p.avatar_url} name={p.full_name} className="modal-photo" />
            <div className="profile-card-heading">
              {roleLine && <p className="profile-card-role">{roleLine}</p>}
              {locationLine && (
                <p className="profile-card-location">
                  <LocationIcon /> {locationLine}
                </p>
              )}
              <span className="profile-status-pill">
                {p.is_current_resident ? 'Current Eendragter · in house' : 'Alumnus'}
              </span>
            </div>
          </div>

          <div className="profile-fact-strip">
            <Fact label="Year left / leaving Eendrag" value={p.grad_year || dash} />
            <Fact label="Degree studied" value={p.degree || dash} />
            <Fact label="Industry" value={p.industry || dash} />
          </div>

          {p.bio && (
            <div className="profile-card-section">
              <h3 className="profile-card-section-title">About</h3>
              <p className="profile-card-bio">{p.bio}</p>
            </div>
          )}

          {hasBusinessProfile && (
            <div className="profile-card-section">
              <h3 className="profile-card-section-title">Business profile</h3>

              <div className="profile-fact-strip">
                <Fact label="Open to opportunities" value={p.is_open_to_opportunities ? 'Yes' : 'Not right now'} />
                {p.availability && <Fact label="Availability" value={p.availability} />}
                {p.business_website && (
                  <div className="profile-fact">
                    <span className="profile-fact-label">Website</span>
                    <a
                      className="profile-fact-value"
                      href={p.business_website}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {p.business_website.replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
              </div>

              {expertise.length > 0 && (
                <div className="profile-card-subsection">
                  <span className="profile-fact-label">Main areas of expertise</span>
                  <Chips items={expertise} />
                </div>
              )}

              {servicesOffered.length > 0 && (
                <div className="profile-card-subsection">
                  <span className="profile-fact-label">Can offer other Eendragters</span>
                  <Chips items={servicesOffered} />
                </div>
              )}

              {businessCategories.length > 0 && (
                <div className="profile-card-subsection">
                  <span className="profile-fact-label">Business categories</span>
                  <Chips items={businessCategories} />
                </div>
              )}

              {geographicFocus.length > 0 && (
                <div className="profile-card-subsection">
                  <span className="profile-fact-label">Geographic focus</span>
                  <Chips items={geographicFocus} />
                </div>
              )}
            </div>
          )}
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

function LinkedInIconSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.13 1 2.5 1s2.48 1.13 2.48 2.5zM.24 8h4.52v14H.24V8zm7.5 0h4.34v1.92h.06c.6-1.14 2.07-2.34 4.26-2.34 4.56 0 5.4 3 5.4 6.9V22h-4.52v-6.14c0-1.46-.02-3.34-2.04-3.34-2.04 0-2.36 1.6-2.36 3.24V22H7.74V8z"/>
    </svg>
  )
}

function LocationIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.4" />
    </svg>
  )
}
