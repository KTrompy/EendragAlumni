import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import BusinessDescriptionEditor from './BusinessDescriptionEditor.jsx'
import { sanitizeBusinessHtml } from '../sanitizeHtml.js'

const MAX_LOGO_SIZE = 3 * 1024 * 1024
const MAX_COVER_SIZE = 5 * 1024 * 1024

// Does the HTML contain anything besides whitespace/empty tags? Used so an
// empty WYSIWYG description doesn't pass validation as "filled in".
function hasText(html) {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  return div.textContent.trim().length > 0
}

// Strips tags for search matching and the card's plain-text excerpt.
function plainText(html) {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  return div.textContent || ''
}

function truncate(text, max = 140) {
  const t = text.trim()
  return t.length > max ? t.slice(0, max).trim() + '…' : t
}

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
  const navigate = useNavigate()
  const [businesses, setBusinesses] = useState([])
  const [loading, setLoading] = useState(true)
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'map' ? 'map' : 'list'
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [openOwner, setOpenOwner] = useState(null)
  const isWide = useIsWide(900)
  const showToast = useToast()

  const canPost = profile?.approved
  const isAdmin = !!profile?.is_admin

  // Lets the detail page's sidebar "Start posting" CTA (and any other link)
  // land here with the form already open via /businesses?post=1, instead of
  // needing its own copy of the create form.
  useEffect(() => {
    if (params.get('post') === '1' && canPost) {
      setShowForm(true)
      const p = new URLSearchParams(params)
      p.delete('post')
      setParams(p, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      const hay = [b.name, b.tagline, b.category, plainText(b.description), b.city, b.country, b.profiles?.full_name]
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
                                  <button className="map-popup-person" onClick={() => navigate(`/businesses/${b.id}`)}>
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
                        onOpen={() => navigate(`/businesses/${b.id}`)}
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
                        onOpen={() => navigate(`/businesses/${b.id}`)}
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

  const excerpt = truncate(plainText(b.description), 160)

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
        className="job-card-main job-card-clickable business-card-main"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
        aria-label={`Open details for ${b.name}`}
      >
        {b.cover_image_url && (
          <div className="business-card-cover">
            <img src={b.cover_image_url} alt="" loading="lazy" />
          </div>
        )}
        <div className="business-card-body">
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
            {b.tagline && <p className="business-card-tagline">{b.tagline}</p>}
            {excerpt && (
              <p className="business-desc-excerpt">
                {excerpt}{' '}
                <button
                  type="button"
                  className="business-read-more"
                  onClick={(e) => { e.stopPropagation(); onOpen() }}
                >
                  Read more
                </button>
              </p>
            )}
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
      </div>
    </li>
  )
}

/* ---------- Create/edit form ---------- */
const DRAFT_FIELDS = ['name', 'tagline', 'category', 'description', 'website', 'contact_email', 'phone', 'city', 'country']

export function BusinessForm({ session, onCancel, onCreated, initial = null }) {
  const isEdit = !!initial
  const draftKey = `eendrag-business-draft-${session.user.id}`
  const draftRestoredRef = useRef(false)
  const showToast = useToast()
  const [form, setForm] = useState({
    name: initial?.name || '',
    tagline: initial?.tagline || '',
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
  const [coverFile, setCoverFile] = useState(null)
  const [coverUrl, setCoverUrl] = useState(initial?.cover_image_url || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [isClosing, setIsClosing] = useState(false)
  const logoRef = useRef(null)
  const coverRef = useRef(null)

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

  function pickCover(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_COVER_SIZE) { setError('Cover image is over 5MB.'); e.target.value = ''; return }
    setCoverFile(f)
    setError(null)
    e.target.value = ''
  }

  function removeCover() { setCoverFile(null); setCoverUrl('') }

  async function uploadCover() {
    const ext = coverFile.name.split('.').pop().toLowerCase()
    const path = `${session.user.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('business-covers')
      .upload(path, coverFile, { upsert: false, contentType: coverFile.type })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('business-covers').getPublicUrl(path)
    return data.publicUrl
  }

  async function submit() {
    if (!form.name.trim() || !form.category || !hasText(form.description)) {
      setError('Name, category and description are required.'); return
    }
    if (!form.website.trim() && !form.contact_email.trim() && !form.phone.trim()) {
      setError('Please provide at least one way to get in touch — website, email or phone.'); return
    }
    setBusy(true); setError(null)
    try {
      const finalLogoUrl = logoFile ? await uploadLogo() : logoUrl
      const finalCoverUrl = coverFile ? await uploadCover() : coverUrl

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
        tagline: form.tagline.trim(),
        description: sanitizeBusinessHtml(form.description),
        website: form.website.trim(),
        contact_email: form.contact_email.trim(),
        phone: form.phone.trim(),
        logo_url: finalLogoUrl,
        cover_image_url: finalCoverUrl,
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
  const coverPreview = coverFile ? URL.createObjectURL(coverFile) : coverUrl

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

          <label className="field"><span>Header / tagline (optional)</span>
            <input
              value={form.tagline}
              onChange={(e) => set('tagline', e.target.value)}
              placeholder="A fun and friendly beerhouse & bistro"
              maxLength={140}
            />
          </label>

          <label className="field"><span>Cover image (optional)</span></label>
          <p className="form-hint" style={{ marginTop: -8 }}>A big banner image shown above your listing's name — on the card preview and the full listing page.</p>
          <div className="job-logo-picker business-cover-picker">
            {coverPreview ? (
              <img className="business-cover-preview" src={coverPreview} alt="Cover preview" />
            ) : (
              <div className="business-cover-preview business-cover-fallback" aria-hidden="true"><ImagePlaceholderIcon /></div>
            )}
            <div className="job-logo-picker-actions">
              <button type="button" className="btn ghost small" onClick={() => coverRef.current?.click()}>
                {coverPreview ? 'Replace image' : 'Upload image'}
              </button>
              {coverPreview && <button type="button" className="btn ghost small" onClick={removeCover}>Remove</button>}
            </div>
            <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={pickCover} />
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

          <label className="field"><span>Description *</span></label>
          <BusinessDescriptionEditor
            value={form.description}
            onChange={(html) => set('description', html)}
            placeholder="What you do, who you serve, why a fellow Eendragter should reach out…"
          />

          <div className="field-row" style={{ marginTop: 14 }}>
            <label className="field"><span>Location</span>
              <input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Stellenbosch" />
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
export function BusinessLogo({ url, name }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase()
  return url ? (
    <img className="job-logo" src={url} alt={name ? `${name} logo` : 'Business logo'} loading="lazy" />
  ) : (
    <div className="job-logo job-logo-fallback" aria-hidden="true">{initial}</div>
  )
}

function ImagePlaceholderIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
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
