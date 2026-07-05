import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { COUNTRIES, INDUSTRIES, SA_CITIES } from '../constants.js'
import ProfileModal from './ProfileModal.jsx'
import EmptyState from './EmptyState.jsx'

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

/* ---------- Filter accordion section ---------- */
function FilterSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={open ? 'filter-section open' : 'filter-section'}>
      <button
        className="filter-section-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className="chev" aria-hidden="true">▸</span>
      </button>
      {open && <div className="filter-section-body">{children}</div>}
    </div>
  )
}

const STATUS = { ALL: 'all', CURRENT: 'current', ALUMNI: 'alumni' }
const MENTOR = { ALL: 'all', YES: 'yes' }

const EMPTY_FILTERS = {
  status: STATUS.ALL,
  mentor: MENTOR.ALL,
  yearFrom: '',
  yearTo: '',
  country: '',
  city: '',
  industry: '',
  occupation: '',
}

export default function Directory({ session, onMessage }) {
  const [people, setPeople] = useState([])
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [openProfile, setOpenProfile] = useState(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [filterOpen, setFilterOpen] = useState(false)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, grad_year, section, occupation, industry, company, city, country, province, is_current_resident, bio, avatar_url, linkedin_url, available_for_mentorship, mentorship_description, approved')
      .order('grad_year', { ascending: false, nullsFirst: false })
      .then(({ data }) => setPeople(data || []))
  }, [])

  // Lock body scroll while the filter drawer is open, and let Escape close it.
  useEffect(() => {
    if (!filterOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e) { if (e.key === 'Escape') setFilterOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [filterOpen])

  const cityOptions = useMemo(() => {
    const fromData = people.map((p) => (p.city || '').trim()).filter(Boolean)
    return [...new Set([...SA_CITIES, ...fromData])].sort()
  }, [people])

  function set(k, v) { setFilters((f) => ({ ...f, [k]: v })) }
  function clearFilters() { setFilters(EMPTY_FILTERS); setQ('') }

  const needle = q.trim().toLowerCase()
  const filtered = people.filter((p) => {
    if (needle) {
      const hay = [p.full_name, p.occupation, p.company, p.city, p.section, p.industry, String(p.grad_year || '')]
        .join(' ').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    if (filters.status === STATUS.CURRENT && !p.is_current_resident) return false
    if (filters.status === STATUS.ALUMNI && p.is_current_resident) return false
    if (filters.mentor === MENTOR.YES && !p.available_for_mentorship) return false
    if (filters.yearFrom && (!p.grad_year || p.grad_year < Number(filters.yearFrom))) return false
    if (filters.yearTo && (!p.grad_year || p.grad_year > Number(filters.yearTo))) return false
    if (filters.country && p.country !== filters.country) return false
    if (filters.city && p.city !== filters.city) return false
    if (filters.industry && p.industry !== filters.industry) return false
    if (filters.occupation) {
      const occ = (p.occupation || '').toLowerCase()
      if (!occ.includes(filters.occupation.toLowerCase())) return false
    }
    return true
  })

  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [q, filters, people.length])

  const shown = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  const activeFilterCount = Object.entries(filters).filter(
    ([k, v]) => v && !((k === 'status' && v === STATUS.ALL) || (k === 'mentor' && v === MENTOR.ALL))
  ).length

  return (
    <section className="panel">
      <h2 className="panel-title">Eendragters</h2>
      <p className="panel-sub">The house, out in the world — and still in it.</p>

      <div className="directory-toolbar">
        <input
          className="search directory-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, company, city…"
        />
        <button className="filters-toggle-btn" onClick={() => setFilterOpen(true)}>
          <FilterIcon />
          Filters
          {activeFilterCount > 0 && <span className="filters-toggle-badge">{activeFilterCount}</span>}
        </button>
      </div>

      <p className="result-count">
        Showing {shown.length} of {filtered.length} Eendragters
      </p>

      {filtered.length === 0 && (
        <EmptyState
          icon="search"
          message="No matching Eendragters found."
          subMessage="Try widening a filter or clearing them all."
        />
      )}

      <ul className="card-grid">
        {shown.map((p) => (
          <PersonCard
            key={p.id}
            person={p}
            isMe={p.id === session.user.id}
            onOpen={() => setOpenProfile(p)}
            onMessage={() => onMessage(p)}
          />
        ))}
      </ul>

      {hasMore && (
        <div className="load-more-row">
          <button className="btn ghost" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
            Load more ({filtered.length - shown.length} remaining)
          </button>
        </div>
      )}

      {filterOpen && (
        <>
          <div className="filter-backdrop" onClick={() => setFilterOpen(false)} />
          <aside className="filter-panel open" aria-label="Filter alumni">
            <div className="filter-panel-header">
              <h3>Filter · {activeFilterCount || 'none'}</h3>
              <button className="modal-close" onClick={() => setFilterOpen(false)} aria-label="Close filters">×</button>
            </div>

            <div className="filter-section filter-section-primary">
              <div className="filter-section-body">
                <div className="filter-radio-row">
                  <button
                    className={filters.mentor === MENTOR.ALL ? 'on' : ''}
                    onClick={() => set('mentor', MENTOR.ALL)}
                  >All</button>
                  <button
                    className={filters.mentor === MENTOR.YES ? 'on' : ''}
                    onClick={() => set('mentor', MENTOR.YES)}
                  >🤝 Open to mentoring</button>
                </div>
              </div>
            </div>

            <FilterSection title="Status">
              <div className="filter-radio-row">
                <button className={filters.status === STATUS.ALL ? 'on' : ''} onClick={() => set('status', STATUS.ALL)}>All</button>
                <button className={filters.status === STATUS.CURRENT ? 'on' : ''} onClick={() => set('status', STATUS.CURRENT)}>In house</button>
                <button className={filters.status === STATUS.ALUMNI ? 'on' : ''} onClick={() => set('status', STATUS.ALUMNI)}>Alumni</button>
              </div>
            </FilterSection>

            <FilterSection title="Year left / leaving Eendrag">
              <div className="filter-year-row">
                <input type="number" placeholder="From" value={filters.yearFrom} onChange={(e) => set('yearFrom', e.target.value)} />
                <span aria-hidden="true">–</span>
                <input type="number" placeholder="To" value={filters.yearTo} onChange={(e) => set('yearTo', e.target.value)} />
              </div>
            </FilterSection>

            <FilterSection title="City">
              <div className="select-wrap">
                <select value={filters.city} onChange={(e) => set('city', e.target.value)}>
                  <option value="">All cities</option>
                  {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </FilterSection>

            <FilterSection title="Country">
              <div className="select-wrap">
                <select value={filters.country} onChange={(e) => set('country', e.target.value)}>
                  <option value="">All countries</option>
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </FilterSection>

            <FilterSection title="Industry">
              <div className="select-wrap">
                <select value={filters.industry} onChange={(e) => set('industry', e.target.value)}>
                  <option value="">All industries</option>
                  {INDUSTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </FilterSection>

            <FilterSection title="Job title" defaultOpen={false}>
              <input
                type="text"
                placeholder="e.g. engineer, director"
                value={filters.occupation}
                onChange={(e) => set('occupation', e.target.value)}
              />
            </FilterSection>

            <div className="filter-panel-footer">
              <button className="filter-clear" onClick={clearFilters}>Clear all filters</button>
              <button className="btn primary wide" onClick={() => setFilterOpen(false)}>
                Show {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
              </button>
            </div>
          </aside>
        </>
      )}

      {openProfile && (
        <ProfileModal
          person={openProfile}
          isMe={openProfile.id === session.user.id}
          onClose={() => setOpenProfile(null)}
          onMessage={() => { const p = openProfile; setOpenProfile(null); onMessage(p) }}
        />
      )}
    </section>
  )
}

/* ---------- Person card ---------- */
function PersonCard({ person: p, isMe, onOpen, onMessage }) {
  function onKey(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
  }

  const roleLine = p.occupation && p.company
    ? `${p.occupation} @ ${p.company}`
    : (p.occupation || p.company || '')

  return (
    <li>
      <div
        className="person-card"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={onKey}
        aria-label={`Open profile for ${p.full_name || 'alumnus'}`}
      >
        <PhotoBlock url={p.avatar_url} name={p.full_name} />
        <div className="person-info">
          <h3 className="person-name">
            {p.full_name || 'Alumnus'}
            {isMe && <span className="person-name-you">You</span>}
            {p.is_current_resident && <span className="person-badge-current">In house</span>}
          </h3>
          {p.industry && <p className="person-industry">{p.industry}</p>}
          {roleLine && <p className="person-occupation">{roleLine}</p>}
          <p className="person-occupation">
            {p.grad_year && <span className="person-year-badge">Class of {p.grad_year}</span>}
            {p.available_for_mentorship && <span className="mentor-chip">🤝 Mentoring</span>}
          </p>
        </div>
        <div className="person-actions" onClick={(e) => e.stopPropagation()}>
          <button className="person-action primary" onClick={onMessage} disabled={isMe} title={isMe ? "That's you" : 'Send a message'} aria-label="Send a message">
            <EnvelopeIcon />
          </button>
          <button className="person-action" onClick={onOpen} title="View profile" aria-label="View profile">
            <InfoIcon />
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
function InfoIcon() {
  return (
    <svg className="icon-btn" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v5h1" />
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
function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  )
}
