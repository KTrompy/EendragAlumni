import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import RichTextEditor from './RichTextEditor.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import ReportButton from './ReportButton.jsx'
import { Avatar } from './Directory.jsx'
import ListAutocomplete from './ListAutocomplete.jsx'
import MultiSelectAutocomplete from './MultiSelectAutocomplete.jsx'
import CityAutocomplete from './CityAutocomplete.jsx'
import { useToast } from './Toast.jsx'
import { matchReason } from '../icebreaker.js'
import { sanitizeHtml, trimTrailingHtml } from '../sanitizeHtml.js'
import { useIsWide } from '../utils.js'
import { geocodeCity } from '../geocode.js'
import { INDUSTRIES } from '../constants.js'

const NEW_WINDOW_MS = 48 * 60 * 60 * 1000 // how recent counts as "New"
const PAGE_SIZE = 20

// Fields needed for the poster's profile modal + "in common with you" badge —
// same shape Directory/Events already pull for the same purpose.
export const POSTER_FIELDS =
  'id, full_name, avatar_url, grad_year, degree, industry, occupation, company, city, country, ' +
  'is_current_resident, linkedin_url, bio, expertise, services_offered, business_website, ' +
  'business_categories, availability, geographic_focus, is_open_to_opportunities'

// Everything the job board itself, the standalone job detail page, and the
// "saved jobs" query all need — kept in one place so the three stay in sync.
export const JOB_FIELDS =
  'id, title, company, location, employment_type, industry, description, apply_url, contact_email, ' +
  'additional_email, company_website, attachment_url, attachment_name, closing_date, logo_url, lat, lng, ' +
  'updated_at, created_at, posted_by'

const TYPES = ['Full-time', 'Part-time', 'Internship', 'Contract', 'Bursary']
const MAX_LOGO_SIZE = 3 * 1024 * 1024
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024

const EMPTY_FILTERS = {
  type: '',
  remoteOnly: false,
  companies: [],
  locations: [],
  industries: [],
  postedWithin: '', // '' | '7' | '30'
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

function plainText(html) {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  return div.textContent || ''
}

function hasText(html) {
  return plainText(html).trim().length > 0
}

// Opens the mail client without ever putting the raw address in the
// rendered HTML — a static scraper reading the page source won't find it,
// since it's only ever assembled at the moment of a real click.
function openMailto(address, subject) {
  window.location.href = `mailto:${address}?subject=${encodeURIComponent(subject)}`
}

export default function Jobs({ session, profile, onMessage }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [copiedId, setCopiedId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [savedIds, setSavedIds] = useState(new Set())
  const [savedOnly, setSavedOnly] = useState(false)
  const [savedJobs, setSavedJobs] = useState([])
  const [savedLoading, setSavedLoading] = useState(false)
  const showToast = useToast()
  const isWide = useIsWide(900)
  const navigate = useNavigate()

  // Clicking a job poster's name goes to their standalone profile page
  // rather than popping a modal over the job board.
  function goToProfile(person) {
    if (person?.id) navigate(`/people/${person.id}`)
  }

  async function loadSavedIds() {
    const { data } = await supabase.from('saved_jobs').select('job_id').eq('user_id', session.user.id)
    setSavedIds(new Set((data || []).map((r) => r.job_id)))
  }

  // "Saved" is its own query against whatever's bookmarked, not a filter
  // over the current page — otherwise a job you saved weeks ago could
  // silently disappear from "Saved" the moment it scrolls past whatever's
  // currently paginated in.
  useEffect(() => {
    if (!savedOnly) return
    if (savedIds.size === 0) { setSavedJobs([]); return }
    let cancelled = false
    setSavedLoading(true)
    supabase
      .from('jobs')
      .select(
        `${JOB_FIELDS}, profiles!jobs_posted_by_fkey ( ${POSTER_FIELDS} )`
      )
      .in('id', [...savedIds])
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (!cancelled) { setSavedJobs(data || []); setSavedLoading(false) } })
    return () => { cancelled = true }
  }, [savedOnly, savedIds])

  async function toggleSave(jobId) {
    const isSaved = savedIds.has(jobId)
    setSavedIds((prev) => {
      const next = new Set(prev)
      if (isSaved) next.delete(jobId); else next.add(jobId)
      return next
    })
    const { error } = isSaved
      ? await supabase.from('saved_jobs').delete().match({ job_id: jobId, user_id: session.user.id })
      : await supabase.from('saved_jobs').insert({ job_id: jobId, user_id: session.user.id })
    if (error) {
      setSavedIds((prev) => {
        const next = new Set(prev)
        if (isSaved) next.add(jobId); else next.delete(jobId)
        return next
      })
      showToast('Could not update saved jobs.', { type: 'error' })
    } else {
      showToast(isSaved ? 'Removed from saved' : 'Job saved')
    }
  }

  // Server-side paging (see the matching comment in Feed.jsx) — jobs used
  // to be capped at a flat 50 with no way to reach anything older.
  async function loadPage({ replace = false } = {}) {
    const offset = replace ? 0 : jobs.length
    const { data, error } = await supabase
      .from('jobs')
      .select(
        `${JOB_FIELDS}, profiles!jobs_posted_by_fkey ( ${POSTER_FIELDS} )`
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) { console.error(error); return }
    setJobs((prev) => (replace ? (data || []) : [...prev, ...(data || [])]))
    setHasMore((data || []).length === PAGE_SIZE)
  }

  async function loadFirstPage() {
    setLoading(true)
    await loadPage({ replace: true })
    setLoading(false)
  }

  async function loadMore() {
    setLoadingMore(true)
    await loadPage()
    setLoadingMore(false)
  }

  useEffect(() => {
    loadFirstPage()
    loadSavedIds()
    let debounceTimer
    const channel = supabase
      .channel('jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, (payload) => {
        // Skip reload if this is a deletion we just triggered locally
        if (payload.eventType === 'DELETE') return
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => loadPage({ replace: true }), 300)
      })
      .subscribe()
    return () => {
      clearTimeout(debounceTimer)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Lock body scroll while the filter drawer is open, and let Escape close it.
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

  async function removeJob(id) {
    const { error } = await supabase.from('jobs').delete().eq('id', id)
    if (error) {
      showToast('Could not delete listing.', { type: 'error' })
      return
    }
    setJobs((prev) => prev.filter((j) => j.id !== id))
    showToast('Listing deleted')
  }

  // Copies a plain-text summary so a listing can be forwarded on WhatsApp/
  // email — sharing outside the app is still a way of engaging with it, and
  // the person you send it to might apply even before they'd log in.
  async function shareJob(j) {
    const applyLine = j.apply_url || j.contact_email
      ? `Apply: ${j.apply_url || j.contact_email}`
      : null
    const lines = [
      `${j.title} @ ${j.company}`,
      [j.employment_type, j.location].filter(Boolean).join(' · '),
      applyLine,
      '(via the Eendrag Alumni job board)',
    ].filter(Boolean)
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopiedId(j.id)
      setTimeout(() => setCopiedId((id) => (id === j.id ? null : id)), 1500)
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — button just won't confirm.
    }
  }

  const companyOptions = useMemo(
    () => [...new Set(jobs.map((j) => (j.company || '').trim()).filter(Boolean))].sort(),
    [jobs]
  )
  const locationOptions = useMemo(
    () => [...new Set(jobs.map((j) => (j.location || '').trim()).filter(Boolean))].sort(),
    [jobs]
  )
  // Same canonical list the posting form offers, plus any legacy free-text
  // industry values already on a listing that don't happen to be in it —
  // so the filter always has something to suggest (unlike Company/Location,
  // which have no fixed list and are genuinely empty until jobs exist).
  const industryOptions = useMemo(() => {
    const extra = jobs.map((j) => (j.industry || '').trim()).filter((v) => v && !INDUSTRIES.includes(v))
    return [...INDUSTRIES, ...new Set(extra)]
  }, [jobs])
  const postedOptions = useMemo(
    () => [
      { value: '', label: 'Any time' },
      { value: '7', label: 'Past week' },
      { value: '30', label: 'Past month' },
    ],
    []
  )

  function set(k, v) { setFilters((f) => ({ ...f, [k]: v })) }
  function clearFilters() { setFilters(EMPTY_FILTERS); setQ('') }

  const canPost = profile?.approved

  const needle = q.trim().toLowerCase()
  const baseList = savedOnly ? savedJobs : jobs
  const shown = baseList.filter((j) => {
    if (needle) {
      const hay = [j.title, j.company, j.location, j.profiles?.full_name, plainText(j.description)]
        .join(' ').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    if (filters.type && j.employment_type !== filters.type) return false
    if (filters.remoteOnly && !(j.location || '').toLowerCase().includes('remote')) return false
    if (filters.companies.length > 0 && !filters.companies.includes(j.company)) return false
    if (filters.locations.length > 0 && !filters.locations.includes(j.location)) return false
    if (filters.industries.length > 0 && !filters.industries.includes(j.industry)) return false
    if (filters.postedWithin) {
      const cutoff = Date.now() - Number(filters.postedWithin) * 86400000
      if (new Date(j.created_at).getTime() < cutoff) return false
    }
    return true
  })

  const activeFilterCount = Object.values(filters).filter((v) => v !== '' && v !== false).length

  // Shared between the persistent "Filter by" sidebar (wide screens) and the
  // slide-in drawer (narrow) — same fields either way, just a different shell.
  const filterFields = (
    <>
      <div className="filter-section filter-section-primary">
        <div className="filter-section-body">
          <div className="filter-radio-row">
            <button className={filters.type === '' ? 'on' : ''} onClick={() => set('type', '')}>All</button>
            {TYPES.map((t) => (
              <button key={t} className={filters.type === t ? 'on' : ''} onClick={() => set('type', t)}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      <FilterSection title="Remote">
        <div className="filter-radio-row">
          <button className={!filters.remoteOnly ? 'on' : ''} onClick={() => set('remoteOnly', false)}>All</button>
          <button className={filters.remoteOnly ? 'on' : ''} onClick={() => set('remoteOnly', true)}>🌍 Remote-friendly</button>
        </div>
      </FilterSection>

      <FilterSection title="Posted">
        <div className="select-wrap">
          <select value={filters.postedWithin} onChange={(e) => set('postedWithin', e.target.value)}>
            {postedOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
      </FilterSection>

      <FilterSection title="Industry">
        <MultiSelectAutocomplete
          values={filters.industries}
          onChange={(v) => set('industries', v)}
          options={industryOptions}
          placeholder="Search or add industries"
        />
      </FilterSection>

      <FilterSection title="Company">
        <MultiSelectAutocomplete
          values={filters.companies}
          onChange={(v) => set('companies', v)}
          options={companyOptions}
          placeholder="Search or add companies"
          allowCustom
        />
      </FilterSection>

      <FilterSection title="Location">
        <MultiSelectAutocomplete
          values={filters.locations}
          onChange={(v) => set('locations', v)}
          options={locationOptions}
          placeholder="Search or add locations"
          allowCustom
        />
      </FilterSection>
    </>
  )

  return (
    <section className="panel">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">Career &amp; Volunteer Opportunities</h2>
          <p className="panel-sub">Roles and internships posted by Eendragters, for Eendragters.</p>
        </div>
      </div>

      {showForm && (
        <JobForm
          session={session}
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); loadFirstPage(); showToast('Job posted') }}
        />
      ) || null}

      {!showForm && jobs.length > 0 && (
        <div className="jobs-encourage-banner">
          <span>
            🎓 {jobs.length} {jobs.length === 1 ? 'role has' : 'roles have'} been shared by fellow Eendragters. Know of an opening? Add yours — it takes about two minutes.
          </span>
          {canPost && (
            <button className="btn primary small" onClick={() => setShowForm(true)}>Post one</button>
          )}
        </div>
      )}

      <div className="directory-layout">
      <div className="directory-main">
      <div className="directory-toolbar">
        <div className="search-wrap">
          <input
            className="search directory-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title, company, location…"
          />
          {q && (
            <button className="search-clear" onClick={() => setQ('')} aria-label="Clear search">×</button>
          )}
        </div>
        <button
          className={savedOnly ? 'filters-toggle-btn on' : 'filters-toggle-btn'}
          onClick={() => setSavedOnly((s) => !s)}
          aria-pressed={savedOnly}
        >
          <BookmarkIcon filled={savedOnly} />
          Saved
          {savedIds.size > 0 && <span className="filters-toggle-badge">{savedIds.size}</span>}
        </button>
        {!isWide && (
          <button className="filters-toggle-btn" onClick={() => setFilterOpen(true)}>
            <FilterIcon />
            Filters
            {activeFilterCount > 0 && <span className="filters-toggle-badge">{activeFilterCount}</span>}
          </button>
        )}
      </div>

      {!savedOnly && (
        <p className="result-count">
          Showing {shown.length} of {jobs.length}{hasMore ? '+' : ''} {jobs.length === 1 ? 'role' : 'roles'}
        </p>
      )}

      {(loading || (savedOnly && savedLoading)) ? (
        <LoadingState message="Loading roles…" />
      ) : shown.length === 0 && (
        savedOnly ? (
          <p className="empty small">You haven't saved any roles yet — tap the bookmark on a listing to keep it handy.</p>
        ) : (
          <EmptyState
            icon="jobs"
            message={jobs.length === 0 ? 'No listings yet.' : 'No matching roles found.'}
            subMessage={jobs.length === 0 ? 'Be the first to post a role.' : 'Try widening a filter or clearing them all.'}
            actionLabel={jobs.length === 0 ? (canPost && !showForm ? 'Post a role' : undefined) : 'Clear filters'}
            onAction={jobs.length === 0 ? () => setShowForm(true) : clearFilters}
          />
        )
      )}

      <ul className="job-list">
        {shown.map((j) => {
          const isMine = j.posted_by === session.user.id
          const isNew = Date.now() - new Date(j.created_at).getTime() < NEW_WINDOW_MS
          const reason = !isMine ? matchReason(profile, j.profiles) : null

          if (editingId === j.id) {
            return (
              <li className="job-card" key={j.id}>
                <JobForm
                  session={session}
                  initial={j}
                  onCancel={() => setEditingId(null)}
                  onCreated={() => { setEditingId(null); loadFirstPage(); showToast('Listing updated') }}
                />
              </li>
            )
          }

          return (
            <li className="job-card" key={j.id}>
              <button
                type="button"
                className={savedIds.has(j.id) ? 'job-save-btn saved' : 'job-save-btn'}
                onClick={() => toggleSave(j.id)}
                aria-pressed={savedIds.has(j.id)}
                aria-label={savedIds.has(j.id) ? 'Remove from saved' : 'Save this listing'}
                title={savedIds.has(j.id) ? 'Remove from saved' : 'Save this listing'}
              >
                <BookmarkIcon filled={savedIds.has(j.id)} />
              </button>
              {/* This is the actual click surface, not the <li> — keeps the
                  save button (an absolutely-positioned sibling) outside of
                  it entirely, and matches the pattern Directory's
                  PersonCard uses for the same "click card to open a modal,
                  except its own buttons" behaviour. */}
              <div
                className="job-card-main job-card-clickable"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/jobs/${j.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/jobs/${j.id}`) }
                }}
                aria-label={`Open details for ${j.title} at ${j.company}`}
              >
                <JobLogo url={j.logo_url} company={j.company} />
                <div className="job-card-content">
                  <h3 className="job-title">
                    {j.title}
                    {isNew && <span className="job-badge job-badge-new">New</span>}
                    {j.employment_type && <span className="job-badge">{j.employment_type}</span>}
                    {j.updated_at && <span className="edited-tag">edited</span>}
                  </h3>
                  <p className="job-meta">
                    <strong>{j.company}</strong>
                    {j.location && ` · ${j.location}`}
                  </p>
                <div className="job-poster-row" onClick={(e) => e.stopPropagation()}>
                  <button className="job-poster" onClick={() => goToProfile(j.profiles)}>
                    <Avatar url={j.profiles?.avatar_url} name={j.profiles?.full_name} size={22} />
                    <span>Posted by {j.profiles?.full_name || 'a member'} · {timeAgo(j.created_at)}</span>
                  </button>
                  {reason && (
                    <span className="job-match-badge" title="Something you have in common with the poster">
                      {reason}
                    </span>
                  )}
                </div>
                <div
                  className="job-desc rendered-html"
                  dangerouslySetInnerHTML={{ __html: trimTrailingHtml(sanitizeHtml(j.description)) }}
                />
                <div
                  style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {j.apply_url && (
                    <a className="btn primary small" href={j.apply_url} target="_blank" rel="noopener noreferrer">
                      Apply now
                    </a>
                  )}
                  {j.contact_email && (
                    <button
                      className="btn primary small"
                      onClick={() => openMailto(j.contact_email, `Application: ${j.title}`)}
                    >
                      Apply via email
                    </button>
                  )}
                  {!isMine && (
                    <button
                      className="btn ghost small"
                      onClick={() => onMessage(
                        { id: j.posted_by, full_name: j.profiles?.full_name },
                        `Hi! I saw your "${j.title}" post on the job board and wanted to reach out.`
                      )}
                    >
                      Message about this role
                    </button>
                  )}
                  <button className="btn ghost small" onClick={() => shareJob(j)}>
                    {copiedId === j.id ? 'Copied!' : 'Share'}
                  </button>
                  {!isMine && (
                    <ReportButton session={session} entityType="job" entityId={j.id} className="btn ghost small" />
                  )}
                  {isMine && (
                    <button className="btn ghost small" onClick={() => setEditingId(j.id)}>
                      Edit
                    </button>
                  )}
                  {isMine && (
                    <DeleteButton
                      onConfirm={() => removeJob(j.id)}
                      label="Delete listing"
                      message="This removes the job listing. This can't be undone."
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
        })}
      </ul>

      {/* Search/filters only narrow what's already loaded, so — like
          Feed — hide the pager while either is active rather than imply
          "load more" would surface additional matches. */}
      {!needle && activeFilterCount === 0 && hasMore && (
        <div className="load-more-row">
          <button className="btn ghost" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {/* End-of-list nudge — a second, quieter chance to post once someone's
          actually scrolled through what's here, rather than the ask only
          ever living above the fold. Only once every listing is truly
          loaded, so it doesn't contradict a "Load more" button above it. */}
      {shown.length > 0 && !hasMore && (
        <p className="jobs-end-nudge">
          That's every open role right now.{' '}
          {canPost
            ? <button className="link-btn" onClick={() => setShowForm(true)}>Post one</button>
            : 'Check back soon for more.'}
        </p>
      )}
      </div>

      {isWide && (
        <aside className="filter-panel persistent" aria-label="Filter roles">
          <div className="filter-panel-header"><h3><FilterIcon /> Filter by</h3></div>
          {filterFields}
          <div className="filter-panel-footer static">
            <button className="filter-clear" onClick={clearFilters}>Reset</button>
          </div>
          {canPost && (
            <div className="jobs-panel-post-cta">
              <button className="btn primary wide" onClick={() => setShowForm(true)}>Post a job</button>
            </div>
          )}
        </aside>
      )}
      </div>

      {!isWide && filterOpen && (
        <>
          <div className="filter-backdrop" onClick={() => setFilterOpen(false)} />
          <aside className="filter-panel open" aria-label="Filter roles">
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

    </section>
  )
}

/* ---------- Company/job logo shown on each card ---------- */
export function JobLogo({ url, company }) {
  const initial = (company || '?').trim().charAt(0).toUpperCase()
  return url ? (
    <img className="job-logo" src={url} alt={company ? `${company} logo` : 'Company logo'} loading="lazy" />
  ) : (
    <div className="job-logo job-logo-fallback" aria-hidden="true">{initial}</div>
  )
}

/* ---------- Filter accordion section (mirrors Directory's) ---------- */
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

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  )
}

function BookmarkIcon({ filled = false }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function PdfIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

// Fields worth persisting as a draft — the logo file itself can't survive
// a localStorage round-trip, so it's left out on purpose.
const JOB_DRAFT_FIELDS = [
  'title', 'company', 'location', 'employment_type', 'industry', 'description',
  'apply_method', 'apply_url', 'contact_email', 'additional_email', 'company_website', 'closing_date',
]

// Default "closing date" offered on a brand new listing — three months out,
// same span Maties Connect defaults to. Just a starting point; posters can
// change or clear it.
function defaultClosingDate() {
  const d = new Date()
  d.setMonth(d.getMonth() + 3)
  return d.toISOString().slice(0, 10)
}

export function JobForm({ session, onCancel, onCreated, initial = null }) {
  const isEdit = !!initial
  const draftKey = `eendrag-job-draft-${session.user.id}`
  const draftRestoredRef = useRef(false)
  const showToast = useToast()
  const [form, setForm] = useState({
    title: initial?.title || '',
    company: initial?.company || '',
    location: initial?.location || '',
    employment_type: initial?.employment_type || 'Full-time',
    industry: initial?.industry || '',
    description: initial?.description || '',
    // Which way candidates should apply — mirrors the radio choice on the
    // Maties Connect posting form instead of just offering both fields with
    // "at least one is required".
    apply_method: initial ? (initial.apply_url ? 'site' : 'email') : 'email',
    apply_url: initial?.apply_url || '',
    contact_email: initial?.contact_email || '',
    additional_email: initial?.additional_email || '',
    company_website: initial?.company_website || '',
    closing_date: initial?.closing_date || (isEdit ? '' : defaultClosingDate()),
  })
  const [logoFile, setLogoFile] = useState(null) // newly picked file, not yet uploaded
  const [logoUrl, setLogoUrl] = useState(initial?.logo_url || '') // existing/uploaded url
  const [attachmentFile, setAttachmentFile] = useState(null) // newly picked PDF, not yet uploaded
  const [attachmentUrl, setAttachmentUrl] = useState(initial?.attachment_url || '')
  const [attachmentName, setAttachmentName] = useState(initial?.attachment_name || '')
  // Coordinates from picking a Location suggestion, plus the label they
  // belong to — used on submit only while the location text still matches
  // what was picked; if it's since been edited (or was always free-typed,
  // e.g. "Remote"), submit falls back to geocoding the text instead.
  const [pickedCoords, setPickedCoords] = useState(
    initial?.lat != null && initial?.lng != null ? { lat: initial.lat, lng: initial.lng } : null
  )
  const [pickedLabel, setPickedLabel] = useState(initial?.location || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [isClosing, setIsClosing] = useState(false)
  const logoRef = useRef(null)
  const attachmentRef = useRef(null)

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  function handleLocationCoords(payload) {
    if (!payload) { setPickedCoords(null); setPickedLabel(''); return }
    setPickedCoords({ lat: payload.lat, lng: payload.lng })
    setPickedLabel(payload.label)
  }

  // Lock body scroll while the "Post a role" panel floats over its
  // backdrop — without this, the job list behind it keeps scrolling along
  // with the page. Skipped for inline edits, which aren't a floating
  // overlay in the first place.
  useEffect(() => {
    if (isEdit) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Draft autosave — new-listing flow only. An edit-in-progress isn't
  // persisted here, so it can't later bleed into (or get overwritten by) an
  // unrelated new-post draft.
  useEffect(() => {
    if (isEdit || draftRestoredRef.current) return
    draftRestoredRef.current = true
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const saved = JSON.parse(raw)
      const meaningful = JOB_DRAFT_FIELDS.some((k) => hasText(saved[k] || ''))
      if (!meaningful) return
      setForm((f) => ({ ...f, ...saved }))
      showToast('Draft restored')
    } catch {
      // corrupt/unavailable storage — nothing to restore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isEdit) return
    const t = setTimeout(() => {
      try {
        const meaningful = JOB_DRAFT_FIELDS.some((k) => hasText(form[k] || ''))
        if (!meaningful) localStorage.removeItem(draftKey)
        else localStorage.setItem(draftKey, JSON.stringify(form))
      } catch {
        // storage full/unavailable — draft just won't persist this time
      }
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
    if (f.size > MAX_LOGO_SIZE) {
      setError('Logo image is over 3MB.')
      e.target.value = ''
      return
    }
    setLogoFile(f)
    setError(null)
    e.target.value = ''
  }

  function removeLogo() {
    setLogoFile(null)
    setLogoUrl('')
  }

  async function uploadLogo() {
    const ext = logoFile.name.split('.').pop().toLowerCase()
    const path = `${session.user.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('job-logos')
      .upload(path, logoFile, { upsert: false, contentType: logoFile.type })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('job-logos').getPublicUrl(path)
    return data.publicUrl
  }

  function pickAttachment(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.type !== 'application/pdf') {
      setError('Attachment must be a PDF.')
      e.target.value = ''
      return
    }
    if (f.size > MAX_ATTACHMENT_SIZE) {
      setError('Attachment is over 10MB.')
      e.target.value = ''
      return
    }
    setAttachmentFile(f)
    setError(null)
    e.target.value = ''
  }

  function removeAttachment() {
    setAttachmentFile(null)
    setAttachmentUrl('')
    setAttachmentName('')
  }

  async function uploadAttachment() {
    const path = `${session.user.id}/${Date.now()}-${attachmentFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error: upErr } = await supabase.storage
      .from('job-attachments')
      .upload(path, attachmentFile, { upsert: false, contentType: 'application/pdf' })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('job-attachments').getPublicUrl(path)
    return data.publicUrl
  }

  async function submit() {
    if (!form.title.trim() || !form.company.trim() || !form.location.trim() || !hasText(form.description)) {
      setError('Title, company, location and description are required.'); return
    }
    if (form.apply_method === 'email' && !form.contact_email.trim()) {
      setError('Please provide an email address for candidates to apply to.'); return
    }
    if (form.apply_method === 'site' && !form.apply_url.trim()) {
      setError('Please provide a link candidates can apply through.'); return
    }
    setBusy(true); setError(null)
    try {
      const finalLogoUrl = logoFile ? await uploadLogo() : logoUrl
      const finalAttachmentUrl = attachmentFile ? await uploadAttachment() : attachmentUrl
      const finalAttachmentName = attachmentFile ? attachmentFile.name : attachmentName

      // Prefer coordinates from an actual picked suggestion — precise, and
      // free (no extra Nominatim call). Only trusted while the location
      // text still matches what was picked; otherwise (free-typed text
      // like "Remote", or an edit since the last pick) fall back to
      // geocoding the text, same "don't hit Nominatim on every unrelated
      // edit" rule BusinessDirectory follows for its city/country pin.
      let coords = { lat: initial?.lat ?? null, lng: initial?.lng ?? null }
      const locationChanged = !isEdit || form.location !== initial?.location
      if (pickedCoords && form.location.trim() === pickedLabel.trim()) {
        coords = pickedCoords
      } else if (locationChanged && form.location.trim()) {
        const geo = await geocodeCity(form.location, '')
        coords = { lat: geo?.lat ?? null, lng: geo?.lng ?? null }
      } else if (locationChanged && !form.location.trim()) {
        coords = { lat: null, lng: null }
      }

      const payload = {
        title: form.title.trim(),
        company: form.company.trim(),
        location: form.location.trim(),
        employment_type: form.employment_type,
        industry: form.industry.trim(),
        description: trimTrailingHtml(sanitizeHtml(form.description)),
        apply_url: form.apply_method === 'site' ? form.apply_url.trim() : '',
        contact_email: form.apply_method === 'email' ? form.contact_email.trim() : '',
        additional_email: form.apply_method === 'email' ? form.additional_email.trim() : '',
        company_website: form.company_website.trim(),
        closing_date: form.closing_date || null,
        logo_url: finalLogoUrl,
        attachment_url: finalAttachmentUrl,
        attachment_name: finalAttachmentName,
        ...coords,
      }
      const { error } = isEdit
        ? await supabase.from('jobs').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', initial.id)
        : await supabase.from('jobs').insert({ ...payload, posted_by: session.user.id })
      if (error) {
        setError(error.message.includes('policy')
          ? 'Posting jobs unlocks once your account is approved.'
          : error.message)
        setBusy(false)
      } else {
        if (!isEdit) { try { localStorage.removeItem(draftKey) } catch { /* ignore */ } }
        onCreated()
      }
    } catch (e) {
      setError(e.message || 'Upload failed.')
      setBusy(false)
    }
  }

  const logoPreview = logoFile ? URL.createObjectURL(logoFile) : logoUrl
  const attachmentPreviewName = attachmentFile ? attachmentFile.name : attachmentName

  return (
    <div className={isEdit ? '' : `create-panel-backdrop ${isClosing ? 'closing' : ''}`} onClick={isEdit ? undefined : (e) => e.target === e.currentTarget && handleCancel()}>
      <div className={isEdit ? 'create-panel inline' : `create-panel ${isClosing ? 'closing' : ''}`}>
        <h3>{isEdit ? 'Edit role' : 'Post a role'}</h3>
        <div className="create-panel-content">
          <p className="form-hint">
            Takes about two minutes — the more specific the listing, the more likely a fellow Eendragter applies.
          </p>
          <div className="field-row">
            <label className="field"><span>Title *</span>
              <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Junior software engineer" />
            </label>
            <label className="field"><span>Company *</span>
              <input value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="Naspers" />
            </label>
          </div>

          <label className="field"><span>Company / role logo (optional)</span></label>
          <div className="job-logo-picker">
            {logoPreview ? (
              <img className="job-logo job-logo-preview" src={logoPreview} alt="Logo preview" />
            ) : (
              <div className="job-logo job-logo-fallback" aria-hidden="true">
                {(form.company || '?').trim().charAt(0).toUpperCase()}
              </div>
            )}
            <div className="job-logo-picker-actions">
              <button type="button" className="btn ghost small" onClick={() => logoRef.current?.click()}>
                {logoPreview ? 'Replace image' : 'Upload image'}
              </button>
              {logoPreview && (
                <button type="button" className="btn ghost small" onClick={removeLogo}>Remove</button>
              )}
            </div>
            <input
              ref={logoRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={pickLogo}
            />
          </div>

          <div className="field-row">
            <label className="field"><span>Location *</span>
              <CityAutocomplete
                value={form.location}
                onChange={(v) => set('location', v)}
                onSelectCoords={handleLocationCoords}
                placeholder="Cape Town / Remote"
                strict={false}
              />
            </label>
            <label className="field"><span>Type</span>
              <div className="select-wrap">
                <select value={form.employment_type} onChange={(e) => set('employment_type', e.target.value)}>
                  {TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
            </label>
          </div>

          <div className="field-row">
            <label className="field"><span>Industry</span>
              <ListAutocomplete
                value={form.industry}
                onChange={(v) => set('industry', v)}
                options={INDUSTRIES}
                placeholder="Search or type an industry"
                clearable
              />
            </label>
            <label className="field"><span>Company website</span>
              <input
                type="url"
                value={form.company_website}
                onChange={(e) => set('company_website', e.target.value)}
                placeholder="https://company.com"
              />
            </label>
          </div>
          <p className="form-hint" style={{ marginTop: -6 }}>
            The company's general site — not where candidates apply.
          </p>

          <label className="field"><span>Description *</span></label>
          <div className="rte-box">
            <RichTextEditor
              value={form.description}
              onChange={(v) => set('description', v)}
              placeholder="Role, requirements, why you'd want a fellow Eendragter…"
            />
          </div>

          <label className="field"><span>Attachment — job description PDF (optional)</span></label>
          <div className="job-attachment-picker">
            {attachmentPreviewName ? (
              <span className="job-attachment-chip"><PdfIcon /> {attachmentPreviewName}</span>
            ) : (
              <span className="job-attachment-chip empty">No file attached</span>
            )}
            <div className="job-logo-picker-actions">
              <button type="button" className="btn ghost small" onClick={() => attachmentRef.current?.click()}>
                {attachmentPreviewName ? 'Replace PDF' : 'Upload PDF'}
              </button>
              {attachmentPreviewName && (
                <button type="button" className="btn ghost small" onClick={removeAttachment}>Remove</button>
              )}
            </div>
            <input
              ref={attachmentRef}
              type="file"
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={pickAttachment}
            />
          </div>

          <label className="field" style={{ marginTop: 14 }}><span>Please select how you would like candidates to apply *</span></label>
          <div className="filter-radio-row">
            <button
              type="button"
              className={form.apply_method === 'email' ? 'on' : ''}
              onClick={() => set('apply_method', 'email')}
            >
              Email
            </button>
            <button
              type="button"
              className={form.apply_method === 'site' ? 'on' : ''}
              onClick={() => set('apply_method', 'site')}
            >
              Through your site
            </button>
          </div>

          {form.apply_method === 'email' ? (
            <div className="field-row" style={{ marginTop: 10 }}>
              <label className="field"><span>Email *</span>
                <input type="email" value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)} placeholder="you@company.com" />
              </label>
              <label className="field"><span>Additional email</span>
                <input type="email" value={form.additional_email} onChange={(e) => set('additional_email', e.target.value)} placeholder="optional second recipient" />
              </label>
            </div>
          ) : (
            <div className="field-row" style={{ marginTop: 10 }}>
              <label className="field"><span>Application link *</span>
                <input type="url" value={form.apply_url} onChange={(e) => set('apply_url', e.target.value)} placeholder="https://…" />
              </label>
            </div>
          )}

          <div className="field-row" style={{ marginTop: 14 }}>
            <label className="field"><span>Closing date for applications</span>
              <input type="date" value={form.closing_date} onChange={(e) => set('closing_date', e.target.value)} />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="btn-row">
          <button className="btn ghost" onClick={handleCancel} disabled={isClosing}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Post job')}
          </button>
        </div>
      </div>
    </div>
  )
}
