import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { Avatar } from './Directory.jsx'

const SUBTABS = [
  { id: 'pending', label: 'Pending approval' },
  { id: 'reports', label: 'Reports' },
  { id: 'members', label: 'Members' },
  { id: 'posts', label: 'Posts' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'events', label: 'Events' },
  { id: 'businesses', label: 'Businesses' },
  { id: 'merch', label: 'Merchandise' },
  { id: 'groups', label: 'Groups' },
  { id: 'photos', label: 'Photos' },
  { id: 'mentoring', label: 'Mentoring' },
]

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

// Strips HTML down to plain text for short previews in moderation lists —
// same trick Jobs.jsx uses for search, just reused here for post/job bodies.
function plainText(html) {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  return div.textContent || ''
}

function truncate(text, n = 140) {
  const t = text.trim()
  return t.length > n ? t.slice(0, n).trimEnd() + '…' : t
}

function formatPrice(price) {
  const n = Number(price)
  return `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const COUNT_TABLES = [
  ['posts', 'posts'],
  ['jobs', 'jobs'],
  ['events', 'events'],
  ['businesses', 'businesses'],
  ['merch', 'merchandise'],
  ['groups', 'groups'],
  ['photos', 'photo_albums'],
  ['mentoring', 'mentoring_programs'],
]

export default function Admin({ session }) {
  const [subtab, setSubtab] = useState('pending')
  const [members, setMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [memberError, setMemberError] = useState(null)
  const [counts, setCounts] = useState({})
  const [openReportsCount, setOpenReportsCount] = useState(0)

  async function loadOpenReportsCount() {
    const { count } = await supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open')
    setOpenReportsCount(count || 0)
  }

  async function loadMembers() {
    setLoadingMembers(true)
    const { data, error } = await supabase.rpc('admin_list_members')
    if (error) setMemberError(error.message)
    else { setMembers(data || []); setMemberError(null) }
    setLoadingMembers(false)
  }

  async function loadCounts() {
    const results = await Promise.all(
      COUNT_TABLES.map(([, table]) => supabase.from(table).select('*', { count: 'exact', head: true }))
    )
    const next = {}
    COUNT_TABLES.forEach(([key], i) => { next[key] = results[i].count })
    setCounts(next)
  }

  useEffect(() => {
    loadMembers()
    loadCounts()
    loadOpenReportsCount()
  }, [])

  // Optimistic toggle, rolled back (via a full reload) if the write fails —
  // e.g. the schema-update-8.sql migration hasn't been run yet, so the
  // is_admin column or RLS policy doesn't exist.
  async function setApproved(id, approved) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, approved } : m)))
    const { error } = await supabase.from('profiles').update({ approved }).eq('id', id)
    if (error) { setMemberError(error.message); loadMembers() }
  }

  async function setAdmin(id, is_admin) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, is_admin } : m)))
    const { error } = await supabase.from('profiles').update({ is_admin }).eq('id', id)
    if (error) { setMemberError(error.message); loadMembers() }
  }

  const pending = useMemo(() => members.filter((m) => !m.approved), [members])
  const needsSetup = !!memberError && (memberError.includes('does not exist') || memberError.includes('function'))

  return (
    <section className="panel">
      <h2 className="panel-title">Admin</h2>
      <p className="panel-sub">Approve new Eendragters and keep an eye on what's being posted.</p>

      <div className="admin-stats-row">
        <StatCard label="Members" value={members.length} />
        <StatCard label="Pending" value={pending.length} highlight={pending.length > 0} />
        <StatCard label="Open reports" value={openReportsCount} highlight={openReportsCount > 0} />
        <StatCard label="Posts" value={counts.posts} />
        <StatCard label="Jobs" value={counts.jobs} />
        <StatCard label="Events" value={counts.events} />
        <StatCard label="Businesses" value={counts.businesses} />
        <StatCard label="Merchandise" value={counts.merch} />
        <StatCard label="Groups" value={counts.groups} />
        <StatCard label="Photo albums" value={counts.photos} />
        <StatCard label="Mentoring" value={counts.mentoring} />
      </div>

      <div className="admin-subtabs" role="tablist" aria-label="Admin sections">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={subtab === t.id}
            className={subtab === t.id ? 'on' : ''}
            onClick={() => setSubtab(t.id)}
          >
            {t.label}
            {t.id === 'pending' && pending.length > 0 && (
              <span className="admin-subtab-badge">{pending.length}</span>
            )}
            {t.id === 'reports' && openReportsCount > 0 && (
              <span className="admin-subtab-badge">{openReportsCount}</span>
            )}
          </button>
        ))}
      </div>

      {needsSetup ? (
        <div className="admin-setup-banner">
          <strong>One-time setup needed</strong>
          <p>
            The admin tools (approving members, granting admin access) rely on a database migration
            that hasn't been run yet. Open the Supabase dashboard for this project, go to the
            <strong> SQL Editor</strong>, and run <code>schema-update-8.sql</code> from the project
            folder — it's safe to re-run if you're not sure whether it already went through.
          </p>
          <p className="admin-setup-banner-detail">Error detail: {memberError}</p>
        </div>
      ) : memberError && (
        <p className="form-error">{memberError}</p>
      )}

      {subtab === 'pending' && (
        <PendingList loading={loadingMembers} pending={pending} onApprove={(id) => setApproved(id, true)} />
      )}
      {subtab === 'reports' && <ReportsModeration onCountChange={setOpenReportsCount} />}
      {subtab === 'members' && (
        <MembersTable
          loading={loadingMembers}
          members={members}
          myId={session.user.id}
          onSetApproved={setApproved}
          onSetAdmin={setAdmin}
        />
      )}
      {subtab === 'posts' && <PostsModeration />}
      {subtab === 'jobs' && <JobsModeration />}
      {subtab === 'events' && <EventsModeration />}
      {subtab === 'businesses' && <BusinessesModeration />}
      {subtab === 'merch' && <MerchModeration />}
      {subtab === 'groups' && <GroupsModeration />}
      {subtab === 'photos' && <PhotosModeration />}
      {subtab === 'mentoring' && <MentoringModeration />}
    </section>
  )
}

/* ---------- Stat card ---------- */
function StatCard({ label, value, highlight }) {
  return (
    <div className={highlight ? 'admin-stat-card highlight' : 'admin-stat-card'}>
      <span className="admin-stat-value">{value === null || value === undefined ? '–' : value}</span>
      <span className="admin-stat-label">{label}</span>
    </div>
  )
}

/* ---------- Pending approvals ---------- */
function PendingList({ loading, pending, onApprove }) {
  if (loading) return <LoadingState message="Loading pending signups…" />
  if (pending.length === 0) {
    return (
      <EmptyState
        icon="feed"
        message="No one's waiting on approval."
        subMessage="New signups will show up here as soon as they create an account."
      />
    )
  }
  return (
    <ul className="admin-list">
      {pending.map((m) => (
        <li className="admin-row" key={m.id}>
          <Avatar url={null} name={m.full_name} size={40} />
          <div className="admin-row-info">
            <span className="admin-row-name">{m.full_name || 'Name not set yet'}</span>
            <span className="admin-row-meta">
              {m.email}
              {m.grad_year ? ` · Class of '${String(m.grad_year).slice(-2)}` : ''}
              {m.city ? ` · ${m.city}` : ''}
            </span>
            <span className="admin-row-meta">Signed up {timeAgo(m.created_at)}</span>
          </div>
          <button className="btn primary small" onClick={() => onApprove(m.id)}>Approve</button>
        </li>
      ))}
    </ul>
  )
}

/* ---------- Reports (member-filed flags on posts/jobs/businesses/profiles) ---------- */
const REPORT_ENTITY_LABELS = { post: 'Feed post', job: 'Job listing', business: 'Business listing', profile: 'Member profile', group_post: 'Group post' }
// Group posts don't have their own standalone route (they only exist
// nested inside a group's detail page, and the report doesn't carry which
// group), so there's no "View" link for that one entity type — the
// reason/detail text is still enough for an admin to know what to look
// for. Every other type maps straight to the same route the rest of the
// app already uses for it.
const REPORT_ENTITY_PATH = {
  post: (id) => `/feed/${id}`,
  job: (id) => `/jobs/${id}`,
  business: (id) => `/businesses/${id}`,
  profile: (id) => `/people/${id}`,
}
const REPORT_REASON_LABELS = { spam: 'Spam or misleading', harassment: 'Harassment or abuse', inappropriate: 'Inappropriate content', scam: 'Scam or fraud', other: 'Something else' }

function ReportsModeration({ onCountChange }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  async function load() {
    const { data } = await supabase
      .from('reports')
      .select('id, entity_type, entity_id, reason, details, status, created_at, reporter:profiles!reports_reporter_id_fkey ( full_name )')
      .order('created_at', { ascending: false })
      .limit(200)
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function setStatus(id, status) {
    const { error } = await supabase.from('reports').update({ status }).eq('id', id)
    if (error) { load(); return }
    setItems((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, status } : r))
      onCountChange?.(next.filter((r) => r.status === 'open').length)
      return next
    })
  }

  if (loading) return <LoadingState message="Loading reports…" />
  if (items.length === 0) {
    return (
      <EmptyState
        icon="feed"
        message="No reports filed."
        subMessage="Flags members submit on posts, jobs, businesses and profiles will show up here."
      />
    )
  }

  const open = items.filter((r) => r.status === 'open')
  const resolved = items.filter((r) => r.status !== 'open')

  return (
    <>
      {open.length > 0 && (
        <>
          <h3 className="admin-list-heading">Needs review</h3>
          <ReportList items={open} onSetStatus={setStatus} navigate={navigate} />
        </>
      )}
      {resolved.length > 0 && (
        <>
          <h3 className="admin-list-heading">Resolved</h3>
          <ReportList items={resolved} onSetStatus={setStatus} navigate={navigate} />
        </>
      )}
    </>
  )
}

function ReportList({ items, onSetStatus, navigate }) {
  return (
    <ul className="admin-list">
      {items.map((r) => {
        const path = REPORT_ENTITY_PATH[r.entity_type]?.(r.entity_id)
        return (
          <li className="admin-row" key={r.id}>
            <div className="admin-row-info">
              <span className="admin-row-name">
                {REPORT_ENTITY_LABELS[r.entity_type] || r.entity_type}
                <span
                  className={r.status === 'open' ? 'admin-badge pending' : r.status === 'dismissed' ? 'admin-badge' : 'admin-badge approved'}
                  style={{ marginLeft: 8 }}
                >
                  {r.status === 'open' ? 'Open' : r.status === 'dismissed' ? 'Dismissed' : 'Reviewed'}
                </span>
              </span>
              <span className="admin-row-meta">
                {REPORT_REASON_LABELS[r.reason] || r.reason} · Reported by {r.reporter?.full_name || 'a member'} · {timeAgo(r.created_at)}
              </span>
              {r.details && <p className="admin-row-preview">{truncate(r.details)}</p>}
            </div>
            <div className="admin-row-actions">
              {path && <button className="btn ghost small" onClick={() => navigate(path)}>View</button>}
              {r.status !== 'reviewed' && (
                <button className="btn ghost small" onClick={() => onSetStatus(r.id, 'reviewed')}>Mark reviewed</button>
              )}
              {r.status !== 'dismissed' && (
                <button className="btn ghost small" onClick={() => onSetStatus(r.id, 'dismissed')}>Dismiss</button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- Members table ---------- */
function MembersTable({ loading, members, myId, onSetApproved, onSetAdmin }) {
  const [confirmTarget, setConfirmTarget] = useState(null) // { member, action: 'revoke' | 'promote' | 'demote' }
  const [q, setQ] = useState('')

  if (loading) return <LoadingState message="Loading members…" />

  const needle = q.trim().toLowerCase()
  const shown = members.filter((m) => {
    if (!needle) return true
    return [m.full_name, m.email, m.city].filter(Boolean).join(' ').toLowerCase().includes(needle)
  })

  function askRevoke(m) { setConfirmTarget({ member: m, action: 'revoke' }) }
  function askPromote(m) { setConfirmTarget({ member: m, action: 'promote' }) }
  function askDemote(m) { setConfirmTarget({ member: m, action: 'demote' }) }

  function runConfirmed() {
    const { member, action } = confirmTarget
    if (action === 'revoke') onSetApproved(member.id, false)
    if (action === 'promote') onSetAdmin(member.id, true)
    if (action === 'demote') onSetAdmin(member.id, false)
    setConfirmTarget(null)
  }

  return (
    <>
      <input
        className="search"
        style={{ marginBottom: 14 }}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, email, city…"
      />
      {shown.length === 0 ? (
        <EmptyState icon="search" message="No matching members." />
      ) : (
        <ul className="admin-list">
          {shown.map((m) => {
            const isMe = m.id === myId
            return (
              <li className="admin-row" key={m.id}>
                <Avatar url={null} name={m.full_name} size={40} />
                <div className="admin-row-info">
                  <span className="admin-row-name">
                    {m.full_name || 'Name not set yet'}
                    {isMe && <span className="person-name-you">You</span>}
                  </span>
                  <span className="admin-row-meta">
                    {m.email}
                    {m.grad_year ? ` · Class of '${String(m.grad_year).slice(-2)}` : ''}
                    {m.city ? ` · ${m.city}` : ''}
                  </span>
                  <span className="admin-row-badges">
                    <span className={m.approved ? 'admin-badge approved' : 'admin-badge pending'}>
                      {m.approved ? 'Approved' : 'Pending'}
                    </span>
                    {m.is_admin && <span className="admin-badge admin">Admin</span>}
                  </span>
                </div>
                <div className="admin-row-actions">
                  {m.approved ? (
                    <button className="btn ghost small" onClick={() => askRevoke(m)}>Revoke</button>
                  ) : (
                    <button className="btn primary small" onClick={() => onSetApproved(m.id, true)}>Approve</button>
                  )}
                  {m.is_admin ? (
                    <button className="btn ghost small" onClick={() => askDemote(m)} disabled={isMe} title={isMe ? "Can't remove your own admin rights" : undefined}>
                      Remove admin
                    </button>
                  ) : (
                    <button className="btn ghost small" onClick={() => askPromote(m)}>Make admin</button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {confirmTarget && (
        <ConfirmDialog
          title={
            confirmTarget.action === 'revoke' ? 'Revoke approval?'
              : confirmTarget.action === 'promote' ? 'Grant admin access?'
              : 'Remove admin access?'
          }
          message={
            confirmTarget.action === 'revoke'
              ? `${confirmTarget.member.full_name || 'This member'} will lose the ability to post and message until re-approved.`
              : confirmTarget.action === 'promote'
              ? `${confirmTarget.member.full_name || 'This member'} will be able to approve members and moderate posts, jobs and events — the same access you have.`
              : `${confirmTarget.member.full_name || 'This member'} will lose admin access.`
          }
          confirmLabel={confirmTarget.action === 'revoke' ? 'Revoke' : confirmTarget.action === 'promote' ? 'Make admin' : 'Remove admin'}
          onConfirm={runConfirmed}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </>
  )
}

/* ---------- Posts moderation ---------- */
function PostsModeration() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase
      .from('posts')
      .select('id, title, content, created_at, author_id, profiles!posts_author_id_fkey ( full_name )')
      .order('created_at', { ascending: false })
      .limit(100)
    setPosts(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    await supabase.from('posts').delete().eq('id', id)
    setPosts((prev) => prev.filter((p) => p.id !== id))
  }

  if (loading) return <LoadingState message="Loading posts…" />
  if (posts.length === 0) return <EmptyState icon="feed" message="No posts yet." />

  return (
    <ul className="admin-list">
      {posts.map((p) => (
        <li className="admin-row" key={p.id}>
          <div className="admin-row-info">
            <span className="admin-row-name">{p.title || 'Untitled post'}</span>
            <span className="admin-row-meta">By {p.profiles?.full_name || 'a member'} · {timeAgo(p.created_at)}</span>
            {p.content && p.content !== '(no text)' && (
              <p className="admin-row-preview">{truncate(plainText(p.content))}</p>
            )}
          </div>
          <DeleteButton onConfirm={() => remove(p.id)} label="Delete post" message="This removes the post for everyone. This can't be undone." />
        </li>
      ))}
    </ul>
  )
}

/* ---------- Jobs moderation ---------- */
function JobsModeration() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase
      .from('jobs')
      .select('id, title, company, location, created_at, posted_by, profiles!jobs_posted_by_fkey ( full_name )')
      .order('created_at', { ascending: false })
      .limit(100)
    setJobs(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    await supabase.from('jobs').delete().eq('id', id)
    setJobs((prev) => prev.filter((j) => j.id !== id))
  }

  if (loading) return <LoadingState message="Loading job listings…" />
  if (jobs.length === 0) return <EmptyState icon="jobs" message="No job listings yet." />

  return (
    <ul className="admin-list">
      {jobs.map((j) => (
        <li className="admin-row" key={j.id}>
          <div className="admin-row-info">
            <span className="admin-row-name">{j.title} — {j.company}</span>
            <span className="admin-row-meta">
              Posted by {j.profiles?.full_name || 'a member'} · {timeAgo(j.created_at)}
              {j.location ? ` · ${j.location}` : ''}
            </span>
          </div>
          <DeleteButton onConfirm={() => remove(j.id)} label="Delete listing" message="This removes the job listing. This can't be undone." />
        </li>
      ))}
    </ul>
  )
}

/* ---------- Events moderation ---------- */
function EventsModeration() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase
      .from('events')
      .select('id, title, event_date, location, created_by, profiles!events_created_by_fkey ( full_name )')
      .order('event_date', { ascending: false })
      .limit(100)
    setEvents(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    await supabase.from('events').delete().eq('id', id)
    setEvents((prev) => prev.filter((e) => e.id !== id))
  }

  if (loading) return <LoadingState message="Loading events…" />
  if (events.length === 0) return <EmptyState icon="events" message="No events yet." />

  return (
    <ul className="admin-list">
      {events.map((e) => (
        <li className="admin-row" key={e.id}>
          <div className="admin-row-info">
            <span className="admin-row-name">{e.title}</span>
            <span className="admin-row-meta">
              {new Date(e.event_date).toLocaleString()} · Posted by {e.profiles?.full_name || 'a member'}
              {e.location ? ` · ${e.location}` : ''}
            </span>
          </div>
          <DeleteButton onConfirm={() => remove(e.id)} label="Delete event" message="This removes the event and everyone's RSVPs. This can't be undone." />
        </li>
      ))}
    </ul>
  )
}

/* ---------- Businesses moderation ---------- */
function BusinessesModeration() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase
      .from('businesses')
      .select('id, name, category, city, country, promoted, created_at, profiles!businesses_owner_id_fkey ( full_name )')
      .order('created_at', { ascending: false })
      .limit(200)
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    await supabase.from('businesses').delete().eq('id', id)
    setItems((prev) => prev.filter((b) => b.id !== id))
  }

  async function togglePromote(b) {
    const next = !b.promoted
    setItems((prev) => prev.map((x) => (x.id === b.id ? { ...x, promoted: next } : x)))
    const { error } = await supabase.from('businesses').update({ promoted: next }).eq('id', b.id)
    if (error) setItems((prev) => prev.map((x) => (x.id === b.id ? { ...x, promoted: !next } : x)))
  }

  if (loading) return <LoadingState message="Loading businesses…" />
  if (items.length === 0) return <EmptyState icon="business" message="No businesses listed yet." />

  return (
    <ul className="admin-list">
      {items.map((b) => (
        <li className="admin-row" key={b.id}>
          <div className="admin-row-info">
            <span className="admin-row-name">
              {b.name}
              {b.promoted && <span className="admin-badge admin" style={{ marginLeft: 8 }}>Featured</span>}
            </span>
            <span className="admin-row-meta">
              {b.category} · Listed by {b.profiles?.full_name || 'a member'}
              {(b.city || b.country) ? ` · ${[b.city, b.country].filter(Boolean).join(', ')}` : ''}
              {' · '}{timeAgo(b.created_at)}
            </span>
          </div>
          <div className="admin-row-actions">
            <button className="btn ghost small" onClick={() => togglePromote(b)}>
              {b.promoted ? 'Unfeature' : 'Feature'}
            </button>
            <DeleteButton onConfirm={() => remove(b.id)} label="Delete business" message="This removes the business listing. This can't be undone." />
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ---------- Merchandise moderation ---------- */
function MerchModeration() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase
      .from('merchandise')
      .select('id, name, price, category, is_available, created_at, profiles!merchandise_created_by_fkey ( full_name )')
      .order('created_at', { ascending: false })
      .limit(200)
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    await supabase.from('merchandise').delete().eq('id', id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  async function toggleAvailable(item) {
    const next = !item.is_available
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_available: next } : i)))
    const { error } = await supabase.from('merchandise').update({ is_available: next }).eq('id', item.id)
    if (error) setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_available: !next } : i)))
  }

  if (loading) return <LoadingState message="Loading merchandise…" />
  if (items.length === 0) return <EmptyState icon="merch" message="No merchandise listed yet." />

  return (
    <ul className="admin-list">
      {items.map((i) => (
        <li className="admin-row" key={i.id}>
          <div className="admin-row-info">
            <span className="admin-row-name">
              {i.name}
              {!i.is_available && <span className="admin-badge pending" style={{ marginLeft: 8 }}>Sold out</span>}
            </span>
            <span className="admin-row-meta">
              {i.category} · {formatPrice(i.price)} · Added by {i.profiles?.full_name || 'an admin'} · {timeAgo(i.created_at)}
            </span>
          </div>
          <div className="admin-row-actions">
            <button className="btn ghost small" onClick={() => toggleAvailable(i)}>
              {i.is_available ? 'Mark sold out' : 'Mark available'}
            </button>
            <DeleteButton onConfirm={() => remove(i.id)} label="Delete item" message="This removes the item from the store. This can't be undone." />
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ---------- Groups moderation ---------- */
function GroupsModeration() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase
      .from('groups')
      .select('id, name, description, created_at, profiles!groups_created_by_fkey ( full_name ), members:group_members(count)')
      .order('created_at', { ascending: false })
      .limit(200)
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    await supabase.from('groups').delete().eq('id', id)
    setItems((prev) => prev.filter((g) => g.id !== id))
  }

  if (loading) return <LoadingState message="Loading groups…" />
  if (items.length === 0) return <EmptyState icon="groups" message="No groups yet." />

  return (
    <ul className="admin-list">
      {items.map((g) => {
        const memberCount = g.members?.[0]?.count ?? 0
        return (
          <li className="admin-row" key={g.id}>
            <div className="admin-row-info">
              <span className="admin-row-name">{g.name}</span>
              <span className="admin-row-meta">
                {memberCount} {memberCount === 1 ? 'member' : 'members'} · Created by {g.profiles?.full_name || 'a member'} · {timeAgo(g.created_at)}
              </span>
              {g.description && <p className="admin-row-preview">{truncate(g.description)}</p>}
            </div>
            <DeleteButton onConfirm={() => remove(g.id)} label="Delete group" message="This removes the group, its posts and its member list. This can't be undone." />
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- Photos moderation ---------- */
function PhotosModeration() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase
      .from('photo_albums')
      .select('id, title, description, created_at, profiles!photo_albums_created_by_fkey ( full_name ), photos(count)')
      .order('created_at', { ascending: false })
      .limit(200)
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    await supabase.from('photo_albums').delete().eq('id', id)
    setItems((prev) => prev.filter((a) => a.id !== id))
  }

  if (loading) return <LoadingState message="Loading albums…" />
  if (items.length === 0) return <EmptyState icon="feed" message="No photo albums yet." />

  return (
    <ul className="admin-list">
      {items.map((a) => {
        const photoCount = a.photos?.[0]?.count ?? 0
        return (
          <li className="admin-row" key={a.id}>
            <div className="admin-row-info">
              <span className="admin-row-name">{a.title}</span>
              <span className="admin-row-meta">
                {photoCount} {photoCount === 1 ? 'photo' : 'photos'} · Created by {a.profiles?.full_name || 'a member'} · {timeAgo(a.created_at)}
              </span>
            </div>
            <DeleteButton onConfirm={() => remove(a.id)} label="Delete album" message="This removes the album and every photo in it. This can't be undone." />
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- Mentoring moderation ---------- */
function MentoringModeration() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase
      .from('mentoring_programs')
      .select('id, title, description, status, start_date, end_date, created_at, profiles!mentoring_programs_owner_id_fkey ( full_name )')
      .order('created_at', { ascending: false })
      .limit(200)
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    await supabase.from('mentoring_programs').delete().eq('id', id)
    setItems((prev) => prev.filter((p) => p.id !== id))
  }

  async function toggleStatus(program) {
    const next = program.status === 'active' ? 'closed' : 'active'
    setItems((prev) => prev.map((p) => (p.id === program.id ? { ...p, status: next } : p)))
    const { error } = await supabase.from('mentoring_programs').update({ status: next }).eq('id', program.id)
    if (error) setItems((prev) => prev.map((p) => (p.id === program.id ? { ...p, status: program.status } : p)))
  }

  if (loading) return <LoadingState message="Loading mentoring programs…" />
  if (items.length === 0) return <EmptyState icon="groups" message="No mentoring programs yet." />

  return (
    <ul className="admin-list">
      {items.map((p) => (
        <li className="admin-row" key={p.id}>
          <div className="admin-row-info">
            <span className="admin-row-name">
              {p.title}
              <span className={p.status === 'active' ? 'admin-badge approved' : 'admin-badge pending'} style={{ marginLeft: 8 }}>
                {p.status === 'active' ? 'Active' : 'Closed'}
              </span>
            </span>
            <span className="admin-row-meta">
              Run by {p.profiles?.full_name || 'an admin'}
              {p.start_date ? ` · Starts ${new Date(p.start_date).toLocaleDateString()}` : ''}
              {p.end_date ? ` · Ends ${new Date(p.end_date).toLocaleDateString()}` : ''}
            </span>
            {p.description && <p className="admin-row-preview">{truncate(p.description)}</p>}
          </div>
          <div className="admin-row-actions">
            <button className="btn ghost small" onClick={() => toggleStatus(p)}>
              {p.status === 'active' ? 'Close program' : 'Reopen program'}
            </button>
            <DeleteButton onConfirm={() => remove(p.id)} label="Delete program" message="This removes the program and its participant sign-ups. This can't be undone." />
          </div>
        </li>
      ))}
    </ul>
  )
}
