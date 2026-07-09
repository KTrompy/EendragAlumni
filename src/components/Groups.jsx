import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import { useToast } from './Toast.jsx'

const MAX_COVER_SIZE = 5 * 1024 * 1024

const GROUPS_SELECT = 'id, name, description, cover_image_url, created_at, members:group_members(count)'

// Groups list — "Your Groups" (cards, for groups you've already joined) +
// "More Groups" (everything else, one-click join) — same split the
// reference uses instead of one undifferentiated list, since "groups I'm
// already in" and "groups I might want to browse into" are different
// questions.
export default function Groups({ session }) {
  const [groups, setGroups] = useState([])
  const [myGroupIds, setMyGroupIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  const showToast = useToast()

  async function load() {
    setLoading(true)
    const [{ data: g }, { data: mine }] = await Promise.all([
      supabase.from('groups').select(GROUPS_SELECT).order('created_at', { ascending: false }),
      supabase.from('group_members').select('group_id').eq('user_id', session.user.id),
    ])
    setGroups(g || [])
    setMyGroupIds(new Set((mine || []).map((r) => r.group_id)))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function joinGroup(id) {
    setMyGroupIds((prev) => new Set(prev).add(id))
    const { error } = await supabase.from('group_members').insert({ group_id: id, user_id: session.user.id })
    if (error) {
      setMyGroupIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      showToast(error.message.includes('policy') ? 'Joining unlocks once your account is approved.' : 'Could not join group.', { type: 'error' })
      return
    }
    setGroups((prev) => prev.map((g) => g.id === id
      ? { ...g, members: [{ count: (g.members?.[0]?.count ?? 0) + 1 }] }
      : g))
  }

  const myGroups = groups.filter((g) => myGroupIds.has(g.id))
  const otherGroups = groups.filter((g) => !myGroupIds.has(g.id))

  return (
    <section className="panel">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">Groups</h2>
          <p className="panel-sub">Shared interests, committees and cohorts — inclusive, dedicated spaces to network and share resources.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>+ Create group</button>
      </div>

      {loading ? (
        <LoadingState message="Loading groups…" />
      ) : groups.length === 0 && (
        <EmptyState
          icon="groups"
          message="No groups yet."
          subMessage="Start one for a committee, a cohort, or a shared interest."
          actionLabel="Create the first group"
          onAction={() => setCreating(true)}
        />
      )}

      {myGroups.length > 0 && (
        <div className="groups-section">
          <h3 className="feed-section-label">Your Groups</h3>
          <div className="group-card-grid">
            {myGroups.map((g) => (
              <GroupCard key={g.id} group={g} joined onClick={() => navigate(`/groups/${g.id}`)} />
            ))}
          </div>
        </div>
      )}

      {otherGroups.length > 0 && (
        <div className="groups-section">
          <h3 className="feed-section-label">More Groups</h3>
          <ul className="group-row-list">
            {otherGroups.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                onOpen={() => navigate(`/groups/${g.id}`)}
                onJoin={() => joinGroup(g.id)}
              />
            ))}
          </ul>
        </div>
      )}

      {creating && (
        <CreateGroupModal
          session={session}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); load(); navigate(`/groups/${id}`) }}
        />
      )}
    </section>
  )
}

function GroupCard({ group: g, joined, onClick }) {
  const count = g.members?.[0]?.count ?? 0
  return (
    <button className="group-card" onClick={onClick}>
      <div className="group-card-cover">
        {g.cover_image_url
          ? <img src={g.cover_image_url} alt="" loading="lazy" />
          : <GroupPlaceholderIcon />}
      </div>
      <div className="group-card-body">
        <span className="group-card-name">{g.name}</span>
        <span className="group-card-meta">{count} {count === 1 ? 'member' : 'members'}{joined ? ' · Joined' : ''}</span>
      </div>
    </button>
  )
}

function GroupRow({ group: g, onOpen, onJoin }) {
  const count = g.members?.[0]?.count ?? 0
  return (
    <li>
      <div className="group-row" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
        <div className="group-row-cover">
          {g.cover_image_url
            ? <img src={g.cover_image_url} alt="" loading="lazy" />
            : <GroupPlaceholderIcon />}
        </div>
        <div className="group-row-info">
          <span className="group-row-name">{g.name}</span>
          <span className="group-row-meta">{count} {count === 1 ? 'member' : 'members'}</span>
          {g.description && <p className="group-row-desc">{g.description}</p>}
        </div>
        <button className="btn ghost" onClick={(e) => { e.stopPropagation(); onJoin() }}>Join</button>
      </div>
    </li>
  )
}

function CreateGroupModal({ session, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [cover, setCover] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  function pickCover(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_COVER_SIZE) { setError('Cover image is over 5MB.'); return }
    setCover(f)
    setError(null)
  }

  async function submit() {
    if (!name.trim()) { setError('Give the group a name.'); return }
    setBusy(true); setError(null)
    try {
      let cover_image_url = null
      if (cover) {
        const ext = cover.name.split('.').pop().toLowerCase()
        const path = `${session.user.id}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('group-covers').upload(path, cover, { contentType: cover.type })
        if (upErr) throw upErr
        cover_image_url = supabase.storage.from('group-covers').getPublicUrl(path).data.publicUrl
      }
      const { data, error: insErr } = await supabase
        .from('groups')
        .insert({ name: name.trim(), description: description.trim(), cover_image_url, created_by: session.user.id })
        .select('id')
        .single()
      if (insErr) throw insErr
      onCreated(data.id)
    } catch (e) {
      setError(e.message?.includes('policy') ? 'Creating a group unlocks once your account is approved.' : (e.message || 'Could not create group.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Create group">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>Create a group</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Global Alumni Group" maxLength={80} />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's this group for?" rows={3} maxLength={400} />
          </label>
          <label className="field">
            <span>Cover image (optional)</span>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={pickCover} />
          </label>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create group'}</button>
        </div>
      </div>
    </div>
  )
}

export function GroupPlaceholderIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3" />
      <path d="M2.5 20c0-3.5 2.9-6 6.5-6s6.5 2.5 6.5 6" />
      <circle cx="17" cy="8.5" r="2.4" />
      <path d="M15.7 14c2.6.4 4.3 2.3 4.3 6" />
    </svg>
  )
}
