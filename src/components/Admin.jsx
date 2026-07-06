import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { Avatar } from './Directory.jsx'

const SUBTABS = [
  { id: 'pending', label: 'Pending approval' },
  { id: 'members', label: 'Members' },
  { id: 'posts', label: 'Posts' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'events', label: 'Events' },
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

export default function Admin({ session }) {
  const [subtab, setSubtab] = useState('pending')
  const [members, setMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [memberError, setMemberError] = useState(null)
  const [counts, setCounts] = useState({ posts: null, jobs: null, events: null })

  async function loadMembers() {
    setLoadingMembers(true)
    const { data, error } = await supabase.rpc('admin_list_members')
    if (error) setMemberError(error.message)
    else { setMembers(data || []); setMemberError(null) }
    setLoadingMembers(false)
  }

  useEffect(() => {
    loadMembers()
    Promise.all([
      supabase.from('posts').select('*', { count: 'exact', head: true }),
      supabase.from('jobs').select('*', { count: 'exact', head: true }),
      supabase.from('events').select('*', { count: 'exact', head: true }),
    ]).then(([p, j, e]) => setCounts({ posts: p.count, jobs: j.count, events: e.count }))
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

  return (
    <section className="panel">
      <h2 className="panel-title">Admin</h2>
      <p className="panel-sub">Approve new Eendragters and keep an eye on what's being posted.</p>

      <div className="admin-stats-row">
        <StatCard label="Members" value={members.length} />
        <StatCard label="Pending" value={pending.length} highlight={pending.length > 0} />
        <StatCard label="Posts" value={counts.posts} />
        <StatCard label="Jobs" value={counts.jobs} />
        <StatCard label="Events" value={counts.events} />
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
          </button>
        ))}
      </div>

      {memberError && (
        <p className="form-error">
          {memberError.includes('does not exist') || memberError.includes('function')
            ? "Couldn't load members — run schema-update-8.sql in the Supabase SQL Editor first."
            : memberError}
        </p>
      )}

      {subtab === 'pending' && (
        <PendingList loading={loadingMembers} pending={pending} onApprove={(id) => setApproved(id, true)} />
      )}
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
    </section>
  )
}

/* ---------- Stat card ---------- */
function StatCard({ label, value, highlight }) {
  return (
    <div className={highlight ? 'admin-stat-card highlight' : 'admin-stat-card'}>
      <span className="admin-stat-value">{value === null ? '–' : value}</span>
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
