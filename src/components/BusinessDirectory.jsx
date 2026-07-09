import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../supabaseClient'
import { geocodeCity } from '../geocode.js'
import { Avatar } from './Directory.jsx'
import ProfileModal from './ProfileModal.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import { useToast } from './Toast.jsx'
import { buildIcebreaker } from '../icebreaker.js'
import { useIsWide } from '../utils.js'
import { COUNTRIES } from '../constants.js'

const MAX_LOGO_SIZE = 3 * 1024 * 1024

// A distinct list from the profile-level BUSINESS_CATEGORIES (which
// classifies a *person's* relationship to business — "Founder", "Investor",
// etc.) — this classifies the *listing itself*, so someone browsing can
// filter "show me the lawyers" the way the reference's directory does.
export const LISTING_CATEGORIES = [
  'Professional Services',
  'Technology & IT',
  'Retail & E-commerce',
  'Food & Beverage',
  'Health & Wellness',
  'Finance & Insurance',
  'Real Estate & Construction',
  'Legal',
  'Consulting',
  'Education & Training',
  'Creative & Media',
  'Travel & Hospitality',
  'Agriculture',
  'Manufacturing',
  'Non-Profit',
  'Other',
]

const POSTER_FIELDS =
  'id, full_name, avatar_url, grad_year, degree, industry, occupation, company, city, country, ' +
  'is_current_resident, linkedin_url, bio, expertise, services_offered, business_website, ' +
  'business_categories, availability, geographic_focus, is_open_to_opportunities'

const EMPTY_FILTERS = { category: '', country: '' }

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

function pinIcon(count) {
  return L.divIcon({
    className: 'alumni-pin-wrap',
    html: `<div class="alumni-pin business-pin">${count > 1 ? count : '★'}</div>`,
    iconSize: [count > 9 ? 36 : 30, count > 9 ? 36 : 30],
    iconAnchor: [count > 9 ? 18 : 15, count > 9 ? 18 : 15],
    popupAnchor: [0, -14],
  })
}

export default function BusinessDirectory({ session, profile, onMessage }) {
  const [businesses, setBusinesses] = useState([])
  const [loading, setLoading] = useState(true)
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'map' ? 'map' : 'list'
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [openBusiness, setOpenBusiness] = useState(null)
  const [openOwner, setOpenOwner] = useState(null)
  const isWide = useIsWide(900)
  const showToast = useToast()

  const canPost = profile?.approved
  const isAdmin = !!profile?.is_admin

  async function loadBusinesses() {
    setLoading(true)
    const { data, error } = await supabase
      .from('businesses')
      .select(`*, profiles!businesses_owner_id_fkey ( ${POSTER_FIELDS} )`)
      .order('promoted', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) { console.error(error); setLoading(false); return }
    setBusinesses(data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadBusinesses()
    const channel = supabase
      .channel('businesses')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'businesses' }, () => loadBusinesses())
      .subscribe()
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!filterOpen || isWide) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e) { if (e.key === 'Escape') setFilterOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [filterOpen, isWide])

  function setView(next) {
    const p = new URLSearchParams(params)
    if (next === 'list') p.delete('view')
    else p.set('view', next)
    setParams(p, { replace: true })
  }

  async function removeBusiness(id) {
    const { error } = await supabase.from('businesses').delete().eq('id', id)
    if (error) { showToast('Could not delete listing.', { type: 'error' }); return }
    setBusinesses((prev) => prev.filter((b) => b.id !== id))
    showToast('Listing deleted')
  }

  async function togglePromote(b) {
    const next = !b.promoted
    setBusinesses((prev) => prev.map((x) => (x.id === b.id ? { ...x, promoted: next } : x)))
    const { error } = await supabase.from('businesses').update({ promoted: next }).eq('id', b.id)
    if (error) {
      setBusinesses((prev) => prev.map((x) => (x.id === b.id ? { ...x, promoted: !next } : x)))
      showToast('Could not update featured status.', { type: 'error' })
    } else {
      showToast(next ? 'Business featured' : 'Business unfeatured')
    }
  }

  const countryOptions = useMemo(
    () => [...new Set(businesses.map((b) => (b.country || '').trim()).filter(Boolean))].sort(),
    [businesses]
  )

  function set(k, v) { setFilters((f) => ({ ...f, [k]: v })) }
  function clearFilters() { setFilters(EMPTY_FILTERS); setQ('') }

  const needle = q.trim().toLowerCase()
  const shown = businesses.filter((b) => {
    if (needle) {
      const hay = [b.name, b.category, b.description, b.city, b.country, b.profiles?.full_name]
        .join(' ').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    if (filters.category && b.category !== filters.category) return false
    if (filters.country && b.country !== filters.country) return false
    return true
  })

  const promotedShown = shown.filter((b) => b.promoted)
  const regularShown = shown.filter((b) => !b.promoted)
  const activeFilterCount = Object.values(filters).filter(Boolean).length

  const pinned = useMemo(
    () => shown.filter((b) => typeof b.lat === 'number' && typeof b.lng === 'number'),
    [shown]
  )
  const clusters = useMemo(() => {
    const map = new Map()
    for (const b of pinned) {
      const key = `${(b.city || '').toLowerCase()}|${(b.country || '').toLowerCase()}` || `${b.lat},${b.lng}`
      if (!map.has(key)) map.set(key, { key, latSum: 0, lngSum: 0, items: [] })
      const c = map.get(key)
      c.latSum += b.lat
      c.lngSum += b.lng
      c.items.push(b)
    }
    return [...map.values()].map((c) => ({
      key: c.key, lat: c.latSum / c.items.length, lng: c.lngSum / c.items.length, items: c.items,
    }))
  }, [pinned])

  const filterFields = (
    <>
      <FilterSection title="Category">
        <div className="select-wrap">
          <select value={filters.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">All categories</option>
            {LISTING_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </FilterSection>
      <FilterSection title="Location">
        <div className="select-wrap">
          <select value={filters.country} onChange={(e) => set('country', e.target.value)}>
            <option value="">All countries</option>
            {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </FilterSection>
    </>
  )

  function openMessageWithOwner(b) {
    onMessage(
      { id: b.owner_id, full_name: b.profiles?.full_name },
      `Hi! I saw "${b.name}" on the Eendrag Business Directory and wanted to reach out.`
    )
  }

  return (
    <section className="panel">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">Business Directory</h2>
          <p className="panel-sub">Eendragter-owned and Eendragter-run businesses, all in one place.</p>
        </div>
        {canPost && !showForm && isWide && (
          <button className="btn primary" onClick={() => setShowForm(true)}>List your business</button>
        )}
      </div>

      {showForm && (
        <BusinessForm
          session={session}
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); loadBusinesses(); showToast('Business listed') }}
        />
      )}

      {!showForm && businesses.length > 0 && (
        <div className="jobs-encourage-banner">
          <span>
            🏢 {businesses.length} {businesses.length === 1 ? 'business has' : 'businesses have'} been listed by fellow Eendragters.{' '}
            {canPost
              ? "Run something of your own? List it — it takes about two minutes."
              : "Once your account's approved, you'll be able to list your own."}
          </span>
          {canPost && (
            <button className="btn primary small" onClick={() => setShowForm(true)}>List your business</button>
          )}
        </div>
      )}

      <div className="directory-toolbar">
        <div className="search-wrap">
          <input
            className="search directory-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, category, location…"
          />
          {q && <button className="search-clear" onClick={() => setQ('')} aria-label="Clear search">×</button>}
        </div>
        <div className="view-switch" role="tablist" aria-label="Business directory view">
          <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
            <ListViewIcon /> List
          </button>
          <button role="tab" aria-selected={view === 'map'} className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
            <MapViewIcon /> Map
          </button>
        </div>
        {!isWide && (
          <button className="filters-toggle-btn" onClick={() => setFilterOpen(true)}>
            <FilterIcon />
            Filters
            {activeFilterCount > 0 && <span className="filters-toggle-badge">{activeFilterCount}</span>}
          </button>
        )}
      </div>

      <p className="result-count">
        Showing {shown.length} of {businesses.length} {businesses.length === 1 ? 'business' : 'businesses'}
      </p>

      <div className="directory-layout">
        <div className="directory-main">
          {loading ? (
            <LoadingState message="Loading businesses…" />
          ) : shown.length === 0 ? (
            <EmptyState
              icon="business"
              message={businesses.length === 0 ? 'No businesses listed yet.' : 'No matching businesses found.'}
              subMessage={businesses.length === 0 ? 'Be the first to list yours.' : 'Try widening a filter or clearing them all.'}
              actionLabel={businesses.length === 0 ? (canPost && !showForm ? 'List your business' : undefined) : 'Clear filters'}
              onAction={businesses.length === 0 ? () => setShowForm(true) : clearFilters}
            />
          ) : view === 'map' ? (
            pinned.length === 0 ? (
              <EmptyState
                icon="search"
                message="No businesses on the map yet."
                subMessage="A pin appears automatically once a listing has a city — try widening or clearing your filters."
              />
            ) : (
              <div className="map-shell">
                <MapContainer center={[20, 10]} zoom={2} scrollWheelZoom className="alumni-map">
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {clusters.map((c) => {
                    const place = [c.items[0].city, c.items[0].country].filter(Boolean).join(', ')
                    return (
                      <Marker key={c.key} position={[c.lat, c.lng]} icon={pinIcon(c.items.length)}>
                        <Popup maxWidth={280} minWidth={220}>
                          <div className="map-popup">
                            <div className="map-popup-title">{place || 'Unknown location'}</div>
                            <ul className="map-popup-list">
                              {c.items.map((b) => (
                                <li key={b.id}>
                                  <button className="map-popup-person" onClick={() => setOpenBusiness(b)}>
                                    <BusinessLogo url={b.logo_url} name={b.name} />
                                    <span className="map-popup-info">
                                      <strong>{b.name}{b.promoted && <span className="business-featured-tag">Featured</span>}</strong>
                                      <span className="map-popup-meta">{b.category}</span>
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </Popup>
                      </Marker>
                    )
                  })}
                </MapContainer>
                <p className="map-hint">Tap a pin to see who's there, view the listing, or send a message.</p>
              </div>
            )
          ) : (
            <>
              {promotedShown.length > 0 && (
                <div className="pinned-posts-section">
                  <p className="feed-section-label">Featured businesses</p>
                  <ul className="business-list">
                    {promotedShown.map((b) => (
                      <BusinessCard
                        key={b.id}
                        b={b}
                        session={session}
                        isAdmin={isAdmin}
                        editingId={editingId}
                        setEditingId={setEditingId}
                        onOpen={() => setOpenBusiness(b)}
                        onOpenOwner={() => setOpenOwner(b.profiles)}
                        onMessage={() => openMessageWithOwner(b)}
                        onDelete={() => removeBusiness(b.id)}
                        onTogglePromote={() => togglePromote(b)}
                        onUpdated={() => { setEditingId(null); loadBusinesses(); showToast('Listing updated') }}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {regularShown.length > 0 && (
                <>
                  {promotedShown.length > 0 && <p className="feed-section-label">All businesses</p>}
                  <ul className="business-list">
                    {regularShown.map((b) => (
                      <BusinessCard
                        key={b.id}
                        b={b}
                        session={session}
                        isAdmin={isAdmin}
                        editingId={editingId}
                        setEditingId={setEditingId}
                        onOpen={() => setOpenBusiness(b)}
                        onOpenOwner={() => setOpenOwner(b.profiles)}
                        onMessage={() => openMessageWithOwner(b)}
                        onDelete={() => removeBusiness(b.id)}
                        onTogglePromote={() => togglePromote(b)}
                        onUpdated={() => { setEditingId(null); loadBusinesses(); showToast('Listing updated') }}
                      />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>

        {isWide && (
          <aside className="filter-panel persistent" aria-label="Filter businesses">
            <div className="filter-panel-header"><h3><FilterIcon /> Filter by</h3></div>
            {filterFields}
            <div className="filter-panel-footer static">
              <button className="filter-clear" onClick={clearFilters}>Reset</button>
            </div>
            {canPost && (
              <div className="jobs-panel-post-cta">
                <button className="btn primary wide" onClick={() => setShowForm(true)}>List your business</button>
              </div>
            )}
          </aside>
        )}
      </div>

      {!isWide && filterOpen && (
        <>
          <div className="filter-backdrop" onClick={() => setFilterOpen(false)} />
          <aside className="filter-panel open" aria-label="Filter businesses">
            <div className="filter-panel-header">
              <h3>Filter · {activeFilterCount || 'none'}</h3>
              <button className="modal-close" onClick={() => setFilterOpen(false)} aria-label="Close filters">×</button>
            </div>
            {filterFields}
            <div className="filter-panel-footer">
              <button className="filter-clear" onClick={clearFilters}>Clear all filters</button>
              <button className="btn primary wide" onClick={() => setFilterOpen(false)}>
                Show {shown.length} {shown.length === 1 ? 'result' : 'results'}
              </button>
            </div>
          </aside>
        </>
      )}

      {openBusiness && (
        <BusinessModal
          b={openBusiness}
          isMine={openBusiness.owner_id === session.user.id}
          isAdmin={isAdmin}
          onOpenOwner={() => setOpenOwner(openBusiness.profiles)}
          onMessage={() => { setOpenBusiness(null); openMessageWithOwner(openBusiness) }}
          onEdit={() => { setEditingId(openBusiness.id); setOpenBusiness(null) }}
          onDelete={() => { removeBusiness(openBusiness.id); setOpenBusiness(null) }}
          onTogglePromote={() => togglePromote(openBusiness)}
          onClose={() => setOpenBusiness(null)}
        />
      )}

      {openOwner && (
        <ProfileModal
          person={openOwner}
          isMe={openOwner.id === session.user.id}
          onClose={() => setOpenOwner(null)}
          onMessage={() => {
            const p = openOwner
            setOpenOwner(null)
            onMessage({ id: p.id, full_name: p.full_name }, buildIcebreaker(profile, p))
          }}
        />
      )}
    </section>
  )
}

/* ---------- One business card (used in both Featured and All sections) ---------- */
function BusinessCard({ b, session, isAdmin, editingId, setEditingId, onOpen, onOpenOwner, onMessage, onDelete, onTogglePromote, onUpdated }) {
  const isMine = b.owner_id === session.user.id

  if (editingId === b.id) {
    return (
      <li className="job-card business-card">
        <BusinessForm session={session} initial={b} onCancel={() => setEditingId(null)} onCreated={onUpdated} />
      </li>
    )
  }

  return (
    <li className="job-card business-card">
      {isAdmin && (
        <button
          type="button"
          className={b.promoted ? 'job-save-btn saved' : 'job-save-btn'}
          onClick={(e) => { e.stopPropagation(); onTogglePromote() }}
          aria-pressed={b.promoted}
          title={b.promoted ? 'Remove from Featured' : 'Feature this business'}
        >
          <StarIcon filled={b.promoted} />
        </button>
      )}
      <div
        className="job-card-main job-card-clickable"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
        aria-label={`Open details for ${b.name}`}
      >
        <BusinessLogo url={b.logo_url} name={b.name} />
        <div className="job-card-content">
          <h3 className="job-title">
            {b.name}
            {b.promoted && <span className="job-badge business-featured-tag">Featured</span>}
            {b.category && <span className="job-badge">{b.category}</span>}
          </h3>
          <p className="job-meta">
            {[b.city, b.country].filter(Boolean).join(', ') || 'Location not set'}
          </p>
          <div className="job-poster-row" onClick={(e) => e.stopPropagation()}>
            <button className="job-poster" onClick={onOpenOwner}>
              <Avatar url={b.profiles?.avatar_url} name={b.profiles?.full_name} size={22} />
              <span>Run by {b.profiles?.full_name || 'a member'} · {timeAgo(b.created_at)}</span>
            </button>
          </div>
          {b.description && <p className="job-desc">{b.description}</p>}
          <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
            {b.website && (
              <a className="btn primary small" href={/^https?:\/\//.test(b.website) ? b.website : `https://${b.website}`} target="_blank" rel="noopener noreferrer">
                Visit website
              </a>
            )}
            {!isMine && (
              <button className="btn ghost small" onClick={onMessage}>Message about this business</button>
            )}
            {isMine && (
              <button className="btn ghost small" onClick={() => setEditingId(b.id)}>Edit</button>
            )}
            {(isMine || isAdmin) && (
              <DeleteButton
                onConfirm={onDelete}
                label="Delete listing"
                message="This removes the business listing. This can't be undone."
                className="btn ghost small delete-danger"
              >
                Delete
              </DeleteButton>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

/* ---------- Detail modal ---------- */
function BusinessModal({ b, isMine, isAdmin, onOpenOwner, onMessage, onEdit, onDelete, onTogglePromote, onClose }) {
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

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="business-modal-title">
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="business-modal-title">{b.name}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <div className="profile-card-header">
            <BusinessLogo url={b.logo_url} name={b.name} />
            <div className="profile-card-heading">
              <p className="profile-card-role">
                {[b.city, b.country].filter(Boolean).join(', ') || 'Location not set'}
              </p>
              <div className="job-modal-badges">
                {b.promoted && <span className="job-badge business-featured-tag">Featured</span>}
                {b.category && <span className="job-badge">{b.category}</span>}
              </div>
            </div>
          </div>

          <div className="job-poster-row">
            <button className="job-poster" onClick={onOpenOwner}>
              <Avatar url={b.profiles?.avatar_url} name={b.profiles?.full_name} size={22} />
              <span>Run by {b.profiles?.full_name || 'a member'} · {timeAgo(b.created_at)}</span>
            </button>
          </div>

          {b.description && (
            <div className="profile-card-section">
              <h3 className="profile-card-section-title">About</h3>
              <p>{b.description}</p>
            </div>
          )}

          {(b.website || b.contact_email || b.phone) && (
            <div className="profile-card-section">
              <h3 className="profile-card-section-title">Contact</h3>
              {b.website && <p><a href={/^https?:\/\//.test(b.website) ? b.website : `https://${b.website}`} target="_blank" rel="noopener noreferrer">{b.website}</a></p>}
              {b.contact_email && <p>{b.contact_email}</p>}
              {b.phone && <p>{b.phone}</p>}
            </div>
          )}
        </div>
        <div className="modal-footer">
          {b.website && (
            <a className="btn primary small" href={/^https?:\/\//.test(b.website) ? b.website : `https://${b.website}`} target="_blank" rel="noopener noreferrer">
              Visit website
            </a>
          )}
          {!isMine && <button className="btn ghost small" onClick={onMessage}>Message about this business</button>}
          {isAdmin && (
            <button className="btn ghost small" onClick={onTogglePromote}>
              {b.promoted ? 'Remove from Featured' : 'Feature this business'}
            </button>
          )}
          {isMine && <button className="btn ghost small" onClick={onEdit}>Edit</button>}
          {(isMine || isAdmin) && (
            <DeleteButton
              onConfirm={onDelete}
              label="Delete listing"
              message="This removes the business listing. This can't be undone."
              className="btn ghost small delete-danger"
            >
              Delete
            </DeleteButton>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- Create/edit form ---------- */
const DRAFT_FIELDS = ['name', 'category', 'description', 'website', 'contact_email', 'phone', 'city', 'country']

function BusinessForm({ session, onCancel, onCreated, initial = null }) {
  const isEdit = !!initial
  const draftKey = `eendrag-business-draft-${session.user.id}`
  const draftRestoredRef = useRef(false)
  const showToast = useToast()
  const [form, setForm] = useState({
    name: initial?.name || '',
    category: initial?.category || LISTING_CATEGORIES[0],
    description: initial?.description || '',
    website: initial?.website || '',
    contact_email: initial?.contact_email || '',
    phone: initial?.phone || '',
    city: initial?.city || '',
    country: initial?.country || '',
  })
  const [logoFile, setLogoFile] = useState(null)
  const [logoUrl, setLogoUrl] = useState(initial?.logo_url || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [isClosing, setIsClosing] = useState(false)
  const logoRef = useRef(null)

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  useEffect(() => {
    if (isEdit) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isEdit || draftRestoredRef.current) return
    draftRestoredRef.current = true
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const saved = JSON.parse(raw)
      const meaningful = DRAFT_FIELDS.some((k) => (saved[k] || '').trim())
      if (!meaningful) return
      setForm((f) => ({ ...f, ...saved }))
      showToast('Draft restored')
    } catch { /* corrupt/unavailable storage — nothing to restore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isEdit) return
    const t = setTimeout(() => {
      try {
        const meaningful = DRAFT_FIELDS.some((k) => (form[k] || '').trim())
        if (!meaningful) localStorage.removeItem(draftKey)
        else localStorage.setItem(draftKey, JSON.stringify(form))
      } catch { /* storage full/unavailable — draft just won't persist this time */ }
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, isEdit])

  function handleCancel() {
    if (isEdit) { onCancel(); return }
    setIsClosing(true)
    setTimeout(onCancel, 200)
  }

  function pickLogo(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_LOGO_SIZE) { setError('Logo image is over 3MB.'); e.target.value = ''; return }
    setLogoFile(f)
    setError(null)
    e.target.value = ''
  }

  function removeLogo() { setLogoFile(null); setLogoUrl('') }

  async function uploadLogo() {
    const ext = logoFile.name.split('.').pop().toLowerCase()
    const path = `${session.user.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('business-logos')
      .upload(path, logoFile, { upsert: false, contentType: logoFile.type })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('business-logos').getPublicUrl(path)
    return data.publicUrl
  }

  async function submit() {
    if (!form.name.trim() || !form.category || !form.description.trim()) {
      setError('Name, category and description are required.'); return
    }
    if (!form.website.trim() && !form.contact_email.trim() && !form.phone.trim()) {
      setError('Please provide at least one way to get in touch — website, email or phone.'); return
    }
    setBusy(true); setError(null)
    try {
      const finalLogoUrl = logoFile ? await uploadLogo() : logoUrl

      // Re-geocode only when the city/country actually changed (or a brand
      // new listing) — same "don't hit Nominatim on every unrelated edit"
      // rule Profile.jsx already follows for people's pins.
      let coords = { lat: initial?.lat ?? null, lng: initial?.lng ?? null }
      const cityChanged = !isEdit || form.city !== initial?.city || form.country !== initial?.country
      if (cityChanged && form.city.trim()) {
        const geo = await geocodeCity(form.city, form.country)
        coords = { lat: geo?.lat ?? null, lng: geo?.lng ?? null }
      } else if (cityChanged && !form.city.trim()) {
        coords = { lat: null, lng: null }
      }

      const payload = {
        ...form,
        name: form.name.trim(),
        description: form.description.trim(),
        website: form.website.trim(),
        contact_email: form.contact_email.trim(),
        phone: form.phone.trim(),
        logo_url: finalLogoUrl,
        ...coords,
      }
      const { error } = isEdit
        ? await supabase.from('businesses').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', initial.id)
        : await supabase.from('businesses').insert({ ...payload, owner_id: session.user.id })
      if (error) {
        setError(error.message.includes('policy')
          ? 'Listing a business unlocks once your account is approved.'
          : error.message)
        setBusy(false)
      } else {
        if (!isEdit) { try { localStorage.removeItem(draftKey) } catch { /* ignore */ } }
        onCreated()
      }
    } catch (e) {
      setError(e.message || 'Logo upload failed.')
      setBusy(false)
    }
  }

  const logoPreview = logoFile ? URL.createObjectURL(logoFile) : logoUrl

  return (
    <div className={isEdit ? '' : `create-panel-backdrop ${isClosing ? 'closing' : ''}`} onClick={isEdit ? undefined : (e) => e.target === e.currentTarget && handleCancel()}>
      <div className={isEdit ? 'create-panel inline' : `create-panel ${isClosing ? 'closing' : ''}`}>
        <h3>{isEdit ? 'Edit business' : 'List your business'}</h3>
        <div className="create-panel-content">
          <p className="form-hint">Takes about two minutes — fellow Eendragters love supporting their own.</p>

          <div className="field-row">
            <label className="field"><span>Business name *</span>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Eendrag Coffee Co." />
            </label>
            <label className="field"><span>Category *</span>
              <div className="select-wrap">
                <select value={form.category} onChange={(e) => set('category', e.target.value)}>
                  {LISTING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </label>
          </div>

          <label className="field"><span>Logo (optional)</span></label>
          <div className="job-logo-picker">
            {logoPreview ? (
              <img className="job-logo job-logo-preview" src={logoPreview} alt="Logo preview" />
            ) : (
              <div className="job-logo job-logo-fallback" aria-hidden="true">{(form.name || '?').trim().charAt(0).toUpperCase()}</div>
            )}
            <div className="job-logo-picker-actions">
              <button type="button" className="btn ghost small" onClick={() => logoRef.current?.click()}>
                {logoPreview ? 'Replace image' : 'Upload image'}
              </button>
              {logoPreview && <button type="button" className="btn ghost small" onClick={removeLogo}>Remove</button>}
            </div>
            <input ref={logoRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={pickLogo} />
          </div>

          <label className="field"><span>Description *</span>
            <textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What you do, who you serve, why a fellow Eendragter should reach out…" />
          </label>

          <div className="field-row">
            <label className="field"><span>City</span>
              <input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Cape Town" />
            </label>
            <label className="field"><span>Country</span>
              <div className="select-wrap">
                <select value={form.country} onChange={(e) => set('country', e.target.value)}>
                  <option value="">Select…</option>
                  {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </label>
          </div>

          <div className="field-row" style={{ marginTop: 14 }}>
            <label className="field"><span>Website</span>
              <input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
            </label>
            <label className="field"><span>Contact email</span>
              <input type="email" value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)} placeholder="you@business.com" />
            </label>
          </div>
          <label className="field"><span>Phone</span>
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+27 …" />
          </label>
          <p className="form-hint">At least one of website, email or phone is required so people can reach you.</p>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="btn-row">
          <button className="btn ghost" onClick={handleCancel} disabled={isClosing}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'List business')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- Small pieces ---------- */
function BusinessLogo({ url, name }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase()
  return url ? (
    <img className="job-logo" src={url} alt={name ? `${name} logo` : 'Business logo'} loading="lazy" />
  ) : (
    <div className="job-logo job-logo-fallback" aria-hidden="true">{initial}</div>
  )
}

function FilterSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={open ? 'filter-section open' : 'filter-section'}>
      <button className="filter-section-header" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{title}</span>
        <span className="chev" aria-hidden="true">▸</span>
      </button>
      {open && <div className="filter-section-body">{children}</div>}
    </div>
  )
}

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  )
}

function StarIcon({ filled = false }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.5l3 6.5 7 1-5.2 5 1.3 7-6.1-3.4-6.1 3.4 1.3-7-5.2-5 7-1z" />
    </svg>
  )
}

function ListViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  )
}
function MapViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4.5L3.5 6.7v13l5.5-2.2 6 2.2 5.5-2.2v-13L15 6.7l-6-2.2z" />
      <path d="M9 4.5v13.2M15 6.7v13.2" />
    </svg>
  )
}
