import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import RichTextEditor from './RichTextEditor.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import { sanitizeHtml, trimTrailingHtml } from '../sanitizeHtml.js'

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

  async function load() {
    const { data } = await supabase
      .from('jobs')
      .select('id, title, company, location, employment_type, description, apply_url, contact_email, created_at, posted_by, profiles!jobs_posted_by_fkey ( full_name )')
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
        {canPost && !showForm && (
          <button className="btn primary" onClick={() => setShowForm(true)}>Post a role</button>
        )}
      </div>

      {showForm && (
        <JobForm
          session={session}
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load() }}
        />
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
          return (
            <li className="job-card" key={j.id}>
              <div>
                <h3 className="job-title">
                  {j.title}
                  {j.employment_type && <span className="job-badge">{j.employment_type}</span>}
                </h3>
                <p className="job-meta">
                  <strong>{j.company}</strong>
                  {j.location && ` · ${j.location}`}
                  {' · '}
                  Posted by {j.profiles?.full_name || 'a member'}, {timeAgo(j.created_at)}
                </p>
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

function JobForm({ session, onCancel, onCreated }) {
  const [form, setForm] = useState({
    title: '', company: '', location: '', employment_type: 'Full-time',
    description: '', apply_url: '', contact_email: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  async function submit() {
    if (!form.title.trim() || !form.company.trim() || !hasText(form.description)) {
      setError('Title, company and description are required.'); return
    }
    setBusy(true); setError(null)
    const { error } = await supabase.from('jobs').insert({
      ...form,
      title: form.title.trim(),
      company: form.company.trim(),
      description: trimTrailingHtml(sanitizeHtml(form.description)),
      apply_url: form.apply_url.trim(),
      contact_email: form.contact_email.trim(),
      posted_by: session.user.id,
    })
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
    <div className="create-panel">
      <h3>Post a role</h3>
      <div className="field-row">
        <label className="field"><span>Title</span>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Junior software engineer" />
        </label>
        <label className="field"><span>Company</span>
          <input value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="Naspers" />
        </label>
      </div>
      <div className="field-row">
        <label className="field"><span>Location</span>
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
      <label className="field"><span>Description</span></label>
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
      {error && <p className="form-error">{error}</p>}
      <div className="btn-row">
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={busy}>
          {busy ? 'Posting…' : 'Post job'}
        </button>
      </div>
    </div>
  )
}
