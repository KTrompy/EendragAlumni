import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import RichTextEditor from './RichTextEditor.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import { Avatar } from './Directory.jsx'
import ProfileModal from './ProfileModal.jsx'
import { buildIcebreaker, matchReason } from '../icebreaker.js'
import { sanitizeHtml, trimTrailingHtml } from '../sanitizeHtml.js'

const NEW_WINDOW_MS = 48 * 60 * 60 * 1000 // how recent counts as "New"

// Fields needed for the poster's profile modal + "in common with you" badge —
// same shape Directory/Events already pull for the same purpose.
const POSTER_FIELDS =
  'id, full_name, avatar_url, grad_year, degree, industry, occupation, company, city, country, ' +
  'is_current_resident, available_for_mentorship, mentorship_description, linkedin_url, bio'

const TYPES = ['Full-time', 'Part-time', 'Internship', 'Contract', 'Bursary']

const EMPTY_FILTERS = {
  type: '',
  remoteOnly: false,
  company: '',
  location: '',
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
  const [openProfile, setOpenProfile] = useState(null)
  const [copiedId, setCopiedId] = useState(null)
  const [editingId, setEditingId] = useState(null)

  async function load() {
    const { data } = await supabase
      .from('jobs')
      .select(
        `id, title, company, location, employment_type, description, apply_url, contact_email, created_at, posted_by,
         profiles!jobs_posted_by_fkey ( ${POSTER_FIELDS} )`
      )
      .order('created_at', { ascending: false })
      .limit(50)
    setJobs(data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
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

  async function removeJob(id) {
    await supabase.from('jobs').delete().eq('id', id)
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

  function set(k, v) { setFilters((f) => ({ ...f, [k]: v })) }
  function clearFilters() { setFilters(EMPTY_FILTERS); setQ('') }

  const canPost = profile?.approved

  const needle = q.trim().toLowerCase()
  const shown = jobs.filter((j) => {
    if (needle) {
      const hay = [j.title, j.company, j.location, j.profiles?.full_name, plainText(j.description)]
        .join(' ').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    if (filters.type && j.employment_type !== filters.type) return false
    if (filters.remoteOnly && !(j.location || '').toLowerCase().includes('remote')) return false
    if (filters.company && j.company !== filters.company) return false
    if (filters.location && j.location !== filters.location) return false
    if (filters.postedWithin) {
      const cutoff = Date.now() - Number(filters.postedWithin) * 86400000
      if (new Date(j.created_at).getTime() < cutoff) return false
    }
    return true
  })

  const activeFilterCount = Object.values(filters).filter((v) => v !== '' && v !== false).length

  return (
    <section className="panel">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">Job board</h2>
          <p className="panel-sub">Roles and internships posted by Eendragters, for Eendragters.</p>
        </div>
      </div>

      {showForm && (
        <JobForm
          session={session}
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load() }}
        />
      ) || null}

      {/* Social proof + a standing nudge to post, visible on every visit
          (not just when the board is empty) — the header button is easy to
          miss, this repeats the ask with a reason attached. */}
      {!showForm && jobs.length > 0 && (
        <div className="jobs-encourage-banner">
          <span>
            🎓 {jobs.length} {jobs.length === 1 ? 'role has' : 'roles have'} been shared by fellow Eendragters.{' '}
            {canPost
              ? 'Know of an opening? Add yours — it takes about two minutes.'
              : "Once your account's approved, you'll be able to post one too."}
          </span>
          {canPost && (
            <button className="btn primary small" onClick={() => setShowForm(true)}>Post a role</button>
          )}
        </div>
      )}

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
        <button className="filters-toggle-btn" onClick={() => setFilterOpen(true)}>
          <FilterIcon />
          Filters
          {activeFilterCount > 0 && <span className="filters-toggle-badge">{activeFilterCount}</span>}
        </button>
      </div>

      <p className="result-count">
        Showing {shown.length} of {jobs.length} {jobs.length === 1 ? 'role' : 'roles'}
      </p>

      {loading ? (
        <LoadingState message="Loading roles…" />
      ) : shown.length === 0 && (
        <EmptyState
          icon="jobs"
          message={jobs.length === 0 ? 'No listings yet.' : 'No matching roles found.'}
          subMessage={jobs.length === 0 ? 'Be the first to post a role.' : 'Try widening a filter or clearing them all.'}
          actionLabel={jobs.length === 0 ? (canPost && !showForm ? 'Post a role' : undefined) : 'Clear filters'}
          onAction={jobs.length === 0 ? () => setShowForm(true) : clearFilters}
        />
      )}

      {filterOpen && (
        <>
          <div className="filter-backdrop" onClick={() => setFilterOpen(false)} />
          <aside className="filter-panel open" aria-label="Filter roles">
            <div className="filter-panel-header">
              <h3>Filter · {activeFilterCount || 'none'}</h3>
              <button className="modal-close" onClick={() => setFilterOpen(false)} aria-label="Close filters">×</button>
            </div>

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
              <div className="filter-radio-row">
                <button className={filters.postedWithin === '' ? 'on' : ''} onClick={() => set('postedWithin', '')}>Any time</button>
                <button className={filters.postedWithin === '7' ? 'on' : ''} onClick={() => set('postedWithin', '7')}>Past week</button>
                <button className={filters.postedWithin === '30' ? 'on' : ''} onClick={() => set('postedWithin', '30')}>Past month</button>
              </div>
            </FilterSection>

            <FilterSection title="Company">
              <div className="select-wrap">
                <select value={filters.company} onChange={(e) => set('company', e.target.value)}>
                  <option value="">All companies</option>
                  {companyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </FilterSection>

            <FilterSection title="Location">
              <div className="select-wrap">
                <select value={filters.location} onChange={(e) => set('location', e.target.value)}>
                  <option value="">All locations</option>
                  {locationOptions.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </FilterSection>

            <div className="filter-panel-footer">
              <button className="filter-clear" onClick={clearFilters}>Clear all filters</button>
              <button className="btn primary wide" onClick={() => setFilterOpen(false)}>
                Show {shown.length} {shown.length === 1 ? 'result' : 'results'}
              </button>
            </div>
          </aside>
        </>
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
                  onCreated={() => { setEditingId(null); load() }}
                />
              </li>
            )
          }

          return (
            <li className="job-card" key={j.id}>
              <div>
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
                <div className="job-poster-row">
                  <button className="job-poster" onClick={() => setOpenProfile(j.profiles)}>
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
                <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
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
                  {isMine && (
                    <button className="btn ghost small" onClick={() => setEditingId(j.id)}>
                      Edit
                    </button>
                  )}
                </div>
              </div>
              {isMine && (
                <DeleteButton
                  onConfirm={() => removeJob(j.id)}
                  label="Delete listing"
                  message="This removes the job listing. This can't be undone."
                />
              )}
            </li>
          )
        })}
      </ul>

      {/* End-of-list nudge — a second, quieter chance to post once someone's
          actually scrolled through what's here, rather than the ask only
          ever living above the fold. */}
      {shown.length > 0 && (
        <p className="jobs-end-nudge">
          That's every open role right now.{' '}
          {canPost
            ? <button className="link-btn" onClick={() => setShowForm(true)}>Post one</button>
            : 'Check back soon for more.'}
        </p>
      )}

      {openProfile && (
        <ProfileModal
          person={openProfile}
          isMe={openProfile.id === session.user.id}
          onClose={() => setOpenProfile(null)}
          onMessage={() => {
            const p = openProfile
            setOpenProfile(null)
            onMessage({ id: p.id, full_name: p.full_name }, buildIcebreaker(profile, p))
          }}
        />
      )}
    </section>
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

function JobForm({ session, onCancel, onCreated, initial = null }) {
  const isEdit = !!initial
  const [form, setForm] = useState({
    title: initial?.title || '',
    company: initial?.company || '',
    location: initial?.location || '',
    employment_type: initial?.employment_type || 'Full-time',
    description: initial?.description || '',
    apply_url: initial?.apply_url || '',
    contact_email: initial?.contact_email || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [isClosing, setIsClosing] = useState(false)

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  function handleCancel() {
    if (isEdit) { onCancel(); return }
    setIsClosing(true)
    setTimeout(onCancel, 200)
  }

  async function submit() {
    if (!form.title.trim() || !form.company.trim() || !form.location.trim() || !hasText(form.description)) {
      setError('Title, company, location and description are required.'); return
    }
    if (!form.apply_url.trim() && !form.contact_email.trim()) {
      setError('Please provide at least one way to apply — either an Apply URL or Contact email.'); return
    }
    setBusy(true); setError(null)
    const payload = {
      ...form,
      title: form.title.trim(),
      company: form.company.trim(),
      description: trimTrailingHtml(sanitizeHtml(form.description)),
      apply_url: form.apply_url.trim(),
      contact_email: form.contact_email.trim(),
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
      onCreated()
    }
  }

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
          <div className="field-row">
            <label className="field"><span>Location *</span>
              <input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Cape Town / Remote" />
            </label>
            <label className="field"><span>Type</span>
              <div className="select-wrap">
                <select value={form.employment_type} onChange={(e) => set('employment_type', e.target.value)}>
                  {TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
            </label>
          </div>
          <label className="field"><span>Description *</span></label>
          <div className="rte-box">
            <RichTextEditor
              value={form.description}
              onChange={(v) => set('description', v)}
              placeholder="Role, requirements, why you'd want a fellow Eendragter…"
            />
          </div>
          <div className="field-row" style={{ marginTop: 14 }}>
            <label className="field"><span>Apply URL</span>
              <input type="url" value={form.apply_url} onChange={(e) => set('apply_url', e.target.value)} placeholder="https://…" />
            </label>
            <label className="field"><span>Contact email</span>
              <input type="email" value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)} placeholder="you@company.com" />
            </label>
          </div>
          <p className="form-hint">At least one of these is required so people can actually apply.</p>
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
