import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const TYPES = ['Full-time', 'Part-time', 'Internship', 'Contract', 'Bursary']

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

export default function Jobs({ session, profile }) {
  const [jobs, setJobs] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [typeFilter, setTypeFilter] = useState('')

  async function load() {
    const { data } = await supabase
      .from('jobs')
      .select('id, title, company, location, employment_type, description, apply_url, contact_email, created_at, posted_by, profiles ( full_name )')
      .order('created_at', { ascending: false })
      .limit(50)
    setJobs(data || [])
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function removeJob(id) {
    if (!confirm('Remove this listing?')) return
    await supabase.from('jobs').delete().eq('id', id)
  }

  const canPost = profile?.approved
  const shown = typeFilter ? jobs.filter((j) => j.employment_type === typeFilter) : jobs

  return (
    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
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

      <div className="filter-radio-row" style={{ margin: '0 0 16px', maxWidth: 480 }}>
        <button className={typeFilter === '' ? 'on' : ''} onClick={() => setTypeFilter('')}>All</button>
        {TYPES.map((t) => (
          <button key={t} className={typeFilter === t ? 'on' : ''} onClick={() => setTypeFilter(t)}>{t}</button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="empty">
          {typeFilter ? `No ${typeFilter.toLowerCase()} listings right now.` : 'No listings yet. Be the first to post a role.'}
        </p>
      )}

      <ul className="job-list">
        {shown.map((j) => (
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
              <p className="job-desc">{j.description}</p>
              <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {j.apply_url && (
                  <a className="btn primary small" href={j.apply_url} target="_blank" rel="noopener noreferrer">
                    Apply
                  </a>
                )}
                {j.contact_email && (
                  <a className="btn ghost small" href={`mailto:${j.contact_email}`}>
                    Email {j.contact_email}
                  </a>
                )}
              </div>
            </div>
            {j.posted_by === session.user.id && (
              <button className="btn ghost small" onClick={() => removeJob(j.id)}>Delete</button>
            )}
          </li>
        ))}
      </ul>
    </section>
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
    if (!form.title.trim() || !form.company.trim() || !form.description.trim()) {
      setError('Title, company and description are required.'); return
    }
    setBusy(true); setError(null)
    const { error } = await supabase.from('jobs').insert({
      ...form,
      title: form.title.trim(),
      company: form.company.trim(),
      description: form.description.trim(),
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
          <select value={form.employment_type} onChange={(e) => set('employment_type', e.target.value)}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <label className="field"><span>Description</span>
        <textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Role, requirements, why you'd want a fellow Eendragter…" />
      </label>
      <div className="field-row">
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
