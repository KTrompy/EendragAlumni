import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { COUNTRIES, INDUSTRIES, SA_CITIES } from '../constants.js'
import ProfileModal from './ProfileModal.jsx'
import EmptyState from './EmptyState.jsx'
import { buildIcebreaker, matchReason } from '../icebreaker.js'
import LoadingState from './LoadingState.jsx'
import MultiSelectAutocomplete from './MultiSelectAutocomplete.jsx'

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

const EMPTY_FILTERS = {
  status: STATUS.ALL,
  yearFrom: '',
  yearTo: '',
  countries: [],
  industries: [],
}

export default function Directory({ session, onMessage, hideHeader = false, refetchTrigger }) {
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  // `filters` is what's actually applied to the list below. `draftFilters`
  // is what the open filter panel is editing — nothing in `filters` changes
  // until "Show N results" is clicked, so adjusting Country/Industry/Status/
  // etc. doesn't reshuffle the list out from under someone mid-adjustment.
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS)
  const [openProfile, setOpenProfile] = useState(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [filterOpen, setFilterOpen] = useState(false)

  async function fetchPeople() {
    setLoading(true)
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, grad_year, degree, occupation, industry, company, city, country, is_current_resident, bio, avatar_url, linkedin_url, approved, expertise, services_offered, business_website, looking_to_connect, business_categories, availability, geographic_focus, is_open_to_opportunities')
      .order('grad_year', { ascending: false, nullsFirst: false })
    setPeople(data || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchPeople()
  }, [])

  // Refetch when triggered from parent (e.g. after profile update)
  useEffect(() => {
    if (refetchTrigger) fetchPeople()
  }, [refetchTrigger])

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

  // Decade chips ("'90s", "2000s"...) built from whatever grad years are
  // actually in the data, so we're never showing a decade with nobody in it.
  const decadeOptions = useMemo(() => {
    const years = people.map((p) => p.grad_year).filter(Boolean)
    if (years.length === 0) return []
    const startDecade = Math.floor(Math.min(...years) / 10) * 10
    const endDecade = Math.floor(Math.max(...years) / 10) * 10
    const out = []
    for (let d = startDecade; d <= endDecade; d += 10) out.push(d)
    return out
  }, [people])

  function decadeLabel(d) { return d < 2000 ? `’${String(d).slice(2)}s` : `${d}s` }

  // Applied filters change the list immediately. Draft filters (used while
  // the panel is open) don't — see openFilterPanel/applyDraftFilters below.
  function setDraft(k, v) { setDraftFilters((f) => ({ ...f, [k]: v })) }

  function openFilterPanel() {
    setDraftFilters(filters) // start editing from whatever's currently applied
    setFilterOpen(true)
  }
  function applyDraftFilters() {
    setFilters(draftFilters)
    setFilterOpen(false)
  }
  function clearDraftFilters() { setDraftFilters(EMPTY_FILTERS) }
  function clearAllFilters() {
    setFilters(EMPTY_FILTERS)
    setDraftFilters(EMPTY_FILTERS)
    setQ('')
  }

  function toggleDecade(startYear) {
    const isActive = Number(draftFilters.yearFrom) === startYear && Number(draftFilters.yearTo) === startYear + 9
    if (isActive) {
      setDraftFilters((f) => ({ ...f, yearFrom: '', yearTo: '' }))
    } else {
      setDraftFilters((f) => ({ ...f, yearFrom: String(startYear), yearTo: String(startYear + 9) }))
    }
  }

  function matches(p, f) {
    if (needle) {
      const hay = [p.full_name, p.occupation, p.company, p.city, p.industry, String(p.grad_year || '')]
        .join(' ').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    if (f.status === STATUS.CURRENT && !p.is_current_resident) return false
    if (f.status === STATUS.ALUMNI && p.is_current_resident) return false
    if (f.yearFrom && (!p.grad_year || p.grad_year < Number(f.yearFrom))) return false
    if (f.yearTo && (!p.grad_year || p.grad_year > Number(f.yearTo))) return false
    // Multiple selections within one filter are OR'd together (e.g. Country:
    // South Africa OR United Kingdom), while different filter types still
    // AND together — same convention as every other filter here.
    if (f.countries.length && !f.countries.includes(p.country)) return false
    if (f.industries.length && !f.industries.includes(p.industry)) return false
    return true
  }

  const needle = q.trim().toLowerCase()
  const filtered = people.filter((p) => matches(p, filters))
  // What the panel's "Show N results" button previews — based on the draft,
  // not yet applied, so it tells you what you'll get if you confirm.
  const previewCount = people.filter((p) => matches(p, draftFilters)).length

  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [q, filters, people.length])

  const shown = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  function countActive(f) {
    return Object.entries(f).filter(([k, v]) => {
      if (Array.isArray(v)) return v.length > 0
      return v && !(k === 'status' && v === STATUS.ALL)
    }).length
  }
  const activeFilterCount = countActive(filters)
  const draftActiveFilterCount = countActive(draftFilters)

  // Already in `people` (the directory fetches everyone, including you) —
  // no extra request needed to know who "you" are for icebreakers/matching.
  const me = useMemo(() => people.find((p) => p.id === session.user.id), [people, session.user.id])

  function messageWithIcebreaker(p) {
    onMessage(p, buildIcebreaker(me, p))
  }

  // "Connection suggestions" — browsing today means already knowing who you're
  // looking for. This surfaces a few Eendragters who share something with
  // your own profile (grad year, city, or industry), so there's something
  // to discover even without a search term. Only shown on the default,
  // unfiltered view so it doesn't compete with an active search.
  const similarPeople = useMemo(() => {
    if (!me || !me.industry) return []
    return people
      .filter((p) => p.id !== me.id && p.industry && p.industry === me.industry)
      .slice(0, 6)
  }, [people, me])

  return (
    <section className={hideHeader ? '' : 'panel'}>
      {!hideHeader && (
        <>
          <h2 className="panel-title">Eendragters</h2>
          <p className="panel-sub">The house, out in the world — and still in it.</p>
        </>
      )}

      <div className="directory-toolbar">
        <div className="search-wrap">
          <input
            className="search directory-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, company, city…"
          />
          {q && (
            <button className="search-clear" onClick={() => setQ('')} aria-label="Clear search">×</button>
          )}
        </div>
        <div className="toolbar-buttons">
          {!needle && similarPeople.length > 0 && me?.industry && (
            <button
              className={`suggestions-btn ${filters.industries.includes(me.industry) ? 'on' : ''}`}
              onClick={() => {
                if (filters.industries.includes(me.industry)) {
                  // Clear the industry filter
                  setFilters(EMPTY_FILTERS)
                } else {
                  // Apply the industry filter
                  setFilters({ ...EMPTY_FILTERS, industries: [me.industry] })
                }
                setVisibleCount(PAGE_SIZE)
                setQ('')
              }}
              aria-label={filters.industries.includes(me.industry) ? 'Clear industry filter' : 'Filter by your industry'}
            >
              <span>👥 Your Industry</span>
            </button>
          )}
          <button className="filters-toggle-btn" onClick={openFilterPanel}>
            <FilterIcon />
            Filters
            {activeFilterCount > 0 && <span className="filters-toggle-badge">{activeFilterCount}</span>}
          </button>
        </div>
      </div>

      <p className="result-count">
        Showing {shown.length} of {filtered.length} Eendragters
      </p>

      {loading ? (
        <LoadingState message="Loading Eendragters…" />
      ) : filtered.length === 0 && (
        <EmptyState
          icon="search"
          message="No matching Eendragters found."
          subMessage="Try widening a filter or clearing them all."
          actionLabel="Clear filters"
          onAction={clearAllFilters}
        />
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
            Load more ({filtered.length - shown.length} remaining)
          </button>
        </div>
      )}

      {filterOpen && (
        <>
          <div className="filter-backdrop" onClick={() => setFilterOpen(false)} />
          <aside className="filter-panel open" aria-label="Filter alumni">
            <div className="filter-panel-header">
              <h3>Filter · {draftActiveFilterCount || 'none'}</h3>
              <button className="modal-close" onClick={() => setFilterOpen(false)} aria-label="Close filters">×</button>
            </div>

            <FilterSection title="Status">
              <div className="filter-radio-row">
                <button className={draftFilters.status === STATUS.ALL ? 'on' : ''} onClick={() => setDraft('status', STATUS.ALL)}>All</button>
                <button className={draftFilters.status === STATUS.CURRENT ? 'on' : ''} onClick={() => setDraft('status', STATUS.CURRENT)}>In house</button>
                <button className={draftFilters.status === STATUS.ALUMNI ? 'on' : ''} onClick={() => setDraft('status', STATUS.ALUMNI)}>Alumni</button>
              </div>
            </FilterSection>

            <FilterSection title="Year left / leaving Eendrag">
              {decadeOptions.length > 0 && (
                <div className="filter-radio-row decade-row">
                  {decadeOptions.map((d) => {
                    const active = Number(draftFilters.yearFrom) === d && Number(draftFilters.yearTo) === d + 9
                    return (
                      <button key={d} className={active ? 'on' : ''} onClick={() => toggleDecade(d)}>
                        {decadeLabel(d)}
                      </button>
                    )
                  })}
                </div>
              )}
              <div className="filter-year-row">
                <div className="input-clear-wrap">
                  <input type="number" placeholder="From" value={draftFilters.yearFrom} onChange={(e) => setDraft('yearFrom', e.target.value)} />
                  {draftFilters.yearFrom && (
                    <button type="button" className="search-clear" onClick={() => setDraft('yearFrom', '')} aria-label="Clear from year">×</button>
                  )}
                </div>
                <span aria-hidden="true">–</span>
                <div className="input-clear-wrap">
                  <input type="number" placeholder="To" value={draftFilters.yearTo} onChange={(e) => setDraft('yearTo', e.target.value)} />
                  {draftFilters.yearTo && (
                    <button type="button" className="search-clear" onClick={() => setDraft('yearTo', '')} aria-label="Clear to year">×</button>
                  )}
                </div>
              </div>
            </FilterSection>

            <FilterSection title="Country">
              <MultiSelectAutocomplete
                options={COUNTRIES}
                values={draftFilters.countries}
                onChange={(v) => setDraft('countries', v)}
                placeholder="All countries — start typing to add one"
              />
            </FilterSection>

            <FilterSection title="Industry">
              <MultiSelectAutocomplete
                options={INDUSTRIES}
                values={draftFilters.industries}
                onChange={(v) => setDraft('industries', v)}
                placeholder="All industries — start typing to add one"
              />
            </FilterSection>

            <div className="filter-panel-footer">
              <button className="filter-clear" onClick={clearDraftFilters}>Clear all filters</button>
              <button className="btn primary wide" onClick={applyDraftFilters}>
                Show {previewCount} {previewCount === 1 ? 'result' : 'results'}
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
          onMessage={() => { const p = openProfile; setOpenProfile(null); messageWithIcebreaker(p) }}
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

  const locationLine = p.city && p.country
    ? `${p.city}, ${p.country}`
    : (p.country || p.city || '')

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
        {p.grad_year && (
          <span className="person-grad-badge">{p.is_current_resident ? 'In house' : `’${String(p.grad_year).slice(2)}`}</span>
        )}
        <PhotoBlock url={p.avatar_url} name={p.full_name} />
        <div className="person-info">
          <h3 className="person-name">
            {p.full_name || 'Alumnus'}
            {isMe && <span className="person-name-you">You</span>}
          </h3>
          <p className="person-occupation">{roleLine || ' '}</p>
          <p className="person-location">{locationLine || ' '}</p>
          <p className="person-industry">{p.industry || ' '}</p>
          {p.expertise && <p className="person-expertise">{p.expertise}</p>}
          {p.business_categories && p.business_categories.length > 0 && (
            <div className="person-tags">
              {p.business_categories.slice(0, 2).map((cat) => (
                <span key={cat} className="person-tag">{cat}</span>
              ))}
              {p.business_categories.length > 2 && (
                <span className="person-tag-more">+{p.business_categories.length - 2}</span>
              )}
            </div>
          )}
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
