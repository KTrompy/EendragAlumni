import { useEffect, useState } from 'react'
import ProfileModal from './ProfileModal.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import { buildIcebreaker } from '../icebreaker.js'
import { normalizeExpertise, isRecentlyOnline } from '../utils.js'

const PAGE_SIZE = 12

// Round avatar used elsewhere in the app (Feed, Profile page, Messages).
export function Avatar({ url, name, size = 72 }) {
  const initials = (name || 'A')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return url ? (
    <img className="avatar" src={url} alt={name || 'Alumnus'} style={{ width: size, height: size }} loading="lazy" />
  ) : (
    <div className="avatar avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials}
    </div>
  )
}

// Rectangular photo block for cards and modal.
function PhotoBlock({ url, name, className = 'person-photo' }) {
  const initials = (name || 'A')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className={className}>
      {url
        ? <img src={url} alt={name || 'Alumnus'} loading="lazy" />
        : <span className="person-photo-initials">{initials}</span>}
    </div>
  )
}
export { PhotoBlock }

// Small green dot pinned to the bottom-right of an avatar — used here and
// in the alumni map's popups, both fed by the same profiles.last_seen
// heartbeat (see App.jsx) rather than each view tracking presence itself.
export function OnlineDot({ lastSeen }) {
  if (!isRecentlyOnline(lastSeen)) return null
  return <span className="online-dot" title="Recently online" />
}

// Directory's List view — the filtering/search/toolbar now live one level
// up in People.jsx (see DirectoryFilters.jsx) so switching to the Map view
// and back doesn't lose them. This component only owns what's specific to
// the *list* itself: sort order and how many rows are revealed so far.
export default function Directory({ session, people, loading, me, onMessage, hideHeader = false }) {
  const [openProfile, setOpenProfile] = useState(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [sort, setSort] = useState('alpha') // alpha | recent | online

  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [people])

  const sorted = [...people].sort((a, b) => {
    if (sort === 'alpha') return (a.full_name || '').localeCompare(b.full_name || '')
    if (sort === 'online') return new Date(b.last_seen || 0) - new Date(a.last_seen || 0)
    return new Date(b.created_at || 0) - new Date(a.created_at || 0)
  })
  const shown = sorted.slice(0, visibleCount)
  const hasMore = visibleCount < sorted.length

  function messageWithIcebreaker(p) {
    onMessage(p, buildIcebreaker(me, p))
  }

  return (
    <div className={hideHeader ? '' : 'panel'}>
      {!hideHeader && (
        <>
          <h2 className="panel-title">Eendragters</h2>
          <p className="panel-sub">The house, out in the world — and still in it.</p>
        </>
      )}

      <div className="directory-result-row">
        <p className="result-count">{sorted.length} Registered {sorted.length === 1 ? 'User' : 'Users'}</p>
        <div className="sort-switch" role="tablist" aria-label="Sort">
          <button role="tab" aria-selected={sort === 'alpha'} className={sort === 'alpha' ? 'on' : ''} onClick={() => setSort('alpha')}>Alphabetically</button>
          <button role="tab" aria-selected={sort === 'recent'} className={sort === 'recent' ? 'on' : ''} onClick={() => setSort('recent')}>Recently joined</button>
          <button role="tab" aria-selected={sort === 'online'} className={sort === 'online' ? 'on' : ''} onClick={() => setSort('online')}>Recently online</button>
        </div>
      </div>

      {loading ? (
        <LoadingState message="Loading Eendragters…" />
      ) : sorted.length === 0 && (
        <EmptyState icon="search" message="No matching Eendragters found." subMessage="Try widening a filter or clearing them all." />
      )}

      <ul className="card-grid">
        {shown.map((p) => (
          <PersonCard
            key={p.id}
            person={p}
            isMe={p.id === session.user.id}
            onOpen={() => setOpenProfile(p)}
            onMessage={() => messageWithIcebreaker(p)}
          />
        ))}
      </ul>

      {hasMore && (
        <div className="load-more-row">
          <button className="btn ghost" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
            Load more ({sorted.length - shown.length} remaining)
          </button>
        </div>
      )}

      {openProfile && (
        <ProfileModal
          person={openProfile}
          isMe={openProfile.id === session.user.id}
          onClose={() => setOpenProfile(null)}
          onMessage={() => { const p = openProfile; setOpenProfile(null); messageWithIcebreaker(p) }}
        />
      )}
    </div>
  )
}

/* ---------- Person card (grid layout) ---------- */
function PersonCard({ person: p, isMe, onOpen, onMessage }) {
  function onKey(e) {
    if (e.key === ‘Enter’ || e.key === ‘ ‘) { e.preventDefault(); onOpen() }
  }

  const roleLine = p.occupation && p.company
    ? `${p.occupation} @ ${p.company}`
    : (p.occupation || p.company || ‘’)

  const locationLine = p.city && p.country
    ? `${p.city}, ${p.country}`
    : (p.country || p.city || ‘’)

  const expertise = normalizeExpertise(p.expertise)
  const willingToHelp = (p.services_offered || []).length > 0

  return (
    <li>
      <div
        className="person-card"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={onKey}
        aria-label={`Open profile for ${p.full_name || ‘alumnus’}`}
      >
        {willingToHelp && <span className="person-card-ribbon">Willing to help!</span>}
        <PhotoBlock url={p.avatar_url} name={p.full_name} className="person-card-photo" />
        <div className="person-card-overlay">
          <OnlineDot lastSeen={p.last_seen} />
        </div>
        <div className="person-card-footer">
          <div className="person-card-info">
            <div className="person-card-name">
              {p.full_name || ‘Alumnus’}
              {isMe && <span className="person-card-you">You</span>}
            </div>
            <div className="person-card-meta">
              {p.is_current_resident ? ‘In house’ : ‘Alum’}
              {p.grad_year && <span> · ‘{String(p.grad_year).slice(2)}</span>}
            </div>
            {roleLine && <p className="person-card-role">{roleLine}</p>}
            {locationLine && <p className="person-card-location">{locationLine}</p>}
          </div>
          <div className="person-card-actions" onClick={(e) => e.stopPropagation()}>
            <button className="person-action primary" onClick={onMessage} disabled={isMe} title={isMe ? "That’s you" : ‘Send a message’} aria-label="Send a message">
              <EnvelopeIcon />
            </button>
            {p.linkedin_url ? (
              <a className="person-action linkedin-active" href={p.linkedin_url} target="_blank" rel="noopener noreferrer" title="LinkedIn" aria-label="LinkedIn" onClick={(e) => e.stopPropagation()}>
                <LinkedInIcon />
              </a>
            ) : (
              <button className="person-action" disabled title="No LinkedIn on file" aria-label="No LinkedIn on file">
                <LinkedInIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

/* ---------- Icons ---------- */
function EnvelopeIcon() {
  return (
    <svg className="icon-btn" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  )
}
function LinkedInIcon() {
  return (
    <svg className="icon-btn" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.13 1 2.5 1s2.48 1.13 2.48 2.5zM.24 8h4.52v14H.24V8zm7.5 0h4.34v1.92h.06c.6-1.14 2.07-2.34 4.26-2.34 4.56 0 5.4 3 5.4 6.9V22h-4.52v-6.14c0-1.46-.02-3.34-2.04-3.34-2.04 0-2.36 1.6-2.36 3.24V22H7.74V8z"/>
    </svg>
  )
}
function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}
