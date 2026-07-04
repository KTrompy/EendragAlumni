import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import ProfileModal from './ProfileModal.jsx'

// Round avatar used elsewhere in the app (Feed, Profile page).
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

// Rectangular "wall card" photo, SACS-style. Sits at the top of person cards
// and inside the profile modal.
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

const EMPTY_FILTERS = {
  status: STATUS.ALL,
  yearFrom: '',
  yearTo: '',
  country: '',
  province: '',
  industry: '',
  occupation: '',
}

export default function Directory({ session, onMessage }) {
  const [people, setPeople] = useState([])
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [openProfile, setOpenProfile] = useState(null)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, grad_year, section, occupation, occupation_description, industry, company, city, country, province, is_current_resident, bio, avatar_url, linkedin_url, available_for_mentorship, mentorship_description, approved')
      .order('grad_year', { ascending: false, nullsFirst: false })
      .then(({ data }) => setPeople(data || []))
  }, [])

  // Distinct values for the dropdowns, sorted, no blanks.
  const options = useMemo(() => {
    const uniq = (key) =>
      [...new Set(people.map((p) => (p[key] || '').trim()).filter(Boolean))].sort()
    return {
      countries: uniq('country'),
      provinces: uniq('province'),
      industries: uniq('industry'),
    }
  }, [people])

  function set(k, v) { setFilters((f) => ({ ...f, [k]: v })) }
  function clearFilters() { setFilters(EMPTY_FILTERS); setQ('') }

  const needle = q.trim().toLowerCase()
  const shown = people.filter((p) => {
    // Free-text search first
    if (needle) {
      const hay = [p.full_name, p.occupation, p.company, p.city, p.section, p.industry, String(p.grad_year || '')]
        .join(' ').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    // Status
    if (filters.status === STATUS.CURRENT && !p.is_current_resident) return false
    if (filters.status === STATUS.ALUMNI && p.is_current_resident) return false
    // Year
    if (filters.yearFrom && (!p.grad_year || p.grad_year < Number(filters.yearFrom))) return false
    if (filters.yearTo && (!p.grad_year || p.grad_year > Number(filters.yearTo))) return false
    // Country / Province / Industry
    if (filters.country && p.country !== filters.country) return false
    if (filters.province && p.province !== filters.province) return false
    if (filters.industry && p.industry !== filters.industry) return false
    // Occupation (substring, case-insensitive)
    if (filters.occupation) {
      const occ = (p.occupation || '').toLowerCase()
      if (!occ.includes(filters.occupation.toLowerCase())) return false
    }
    return true
  })

  const activeFilterCount = Object.entries(filters).filter(
    ([k, v]) => v && !(k === 'status' && v === STATUS.ALL)
  ).length

  return (
    <section className="panel">
      <h2 className="panel-title">Eendragters</h2>
      <p className="panel-sub">The house, out in the world — and still in it.</p>

      <div className="directory-layout">
        <aside className="filter-panel" aria-label="Filter alumni">
          <h3>Filter · {activeFilterCount || 'none'}</h3>

          <FilterSection title="Status">
            <div className="filter-radio-row">
              <button
                className={filters.status === STATUS.ALL ? 'on' : ''}
                onClick={() => set('status', STATUS.ALL)}
              >All</button>
              <button
                className={filters.status === STATUS.CURRENT ? 'on' : ''}
                onClick={() => set('status', STATUS.CURRENT)}
              >In house</button>
              <button
                className={filters.status === STATUS.ALUMNI ? 'on' : ''}
                onClick={() => set('status', STATUS.ALUMNI)}
              >Alumni</button>
            </div>
          </FilterSection>

          <FilterSection title="Year left Eendrag">
            <div className="filter-year-row">
              <input
                type="number" placeholder="From"
                value={filters.yearFrom}
                onChange={(e) => set('yearFrom', e.target.value)}
              />
              <span aria-hidden="true">–</span>
              <input
                type="number" placeholder="To"
                value={filters.yearTo}
                onChange={(e) => set('yearTo', e.target.value)}
              />
            </div>
          </FilterSection>

          <FilterSection title="Country">
            <select value={filters.country} onChange={(e) => set('country', e.target.value)}>
              <option value="">All countries</option>
              {options.countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FilterSection>

          <FilterSection title="Province">
            <select value={filters.province} onChange={(e) => set('province', e.target.value)}>
              <option value="">All provinces</option>
              {options.provinces.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FilterSection>

          <FilterSection title="Industry">
            <select value={filters.industry} onChange={(e) => set('industry', e.target.value)}>
              <option value="">All industries</option>
              {options.industries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FilterSection>

          <FilterSection title="Occupation" defaultOpen={false}>
            <input
              type="text"
              placeholder="e.g. engineer"
              value={filters.occupation}
              onChange={(e) => set('occupation', e.target.value)}
            />
          </FilterSection>

          <button className="filter-clear" onClick={clearFilters}>Clear all filters</button>
        </aside>

        <div className="directory-main">
          <input
            className="search directory-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, company, city…"
          />
          <p className="result-count">
            Showing {shown.length} of {people.length} Eendragters
          </p>

          {shown.length === 0 && <p className="empty">No matching Eendragters found.</p>}

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
        </div>
      </div>

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

/* ---------- Person card (SACS-style: photo up top, icons at foot) ---------- */
function PersonCard({ person: p, isMe, onOpen, onMessage }) {
  // Keyboard: card is a role="button". Enter or space opens the modal.
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
          {p.grad_year && (
            <p className="person-occupation">
              <span className="person-year-badge">Class of {p.grad_year}</span>
            </p>
          )}
        </div>
        <div className="person-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="person-action primary"
            onClick={onMessage}
            disabled={isMe}
            title={isMe ? "That's you" : 'Send a message'}
            aria-label="Send a message"
          >
            <EnvelopeIcon />
          </button>
          <button
            className="person-action"
            onClick={onOpen}
            title="View profile"
            aria-label="View profile"
          >
            <InfoIcon />
          </button>
          {p.linkedin_url ? (
            <a
              className="person-action"
              href={p.linkedin_url}
              target="_blank" rel="noopener noreferrer"
              title="LinkedIn"
              aria-label="LinkedIn"
              onClick={(e) => e.stopPropagation()}
            >
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

/* ---------- Icons (inline SVG, current colour) ---------- */
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
