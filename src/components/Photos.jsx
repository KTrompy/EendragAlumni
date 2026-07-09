import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import { useToast } from './Toast.jsx'

// Albums list — each card shows a 2x2 collage of its most recent photos
// (falling back to a single placeholder tile for a brand new album) so you
// get a sense of what's inside before opening it, same idea as the
// reference's album thumbnails.
const ALBUMS_SELECT = 'id, title, description, created_at, photos(count)'

export default function Photos({ session }) {
  const [albums, setAlbums] = useState([])
  const [covers, setCovers] = useState({}) // album id -> [url, url, url, url]
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('photo_albums').select(ALBUMS_SELECT).order('created_at', { ascending: false })
    setAlbums(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (albums.length === 0) return
    let cancelled = false
    Promise.all(albums.map(async (a) => {
      const { data } = await supabase
        .from('photos')
        .select('url')
        .eq('album_id', a.id)
        .order('created_at', { ascending: false })
        .limit(4)
      return [a.id, (data || []).map((p) => p.url)]
    })).then((pairs) => {
      if (cancelled) return
      setCovers(Object.fromEntries(pairs))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albums.map((a) => a.id).join(',')])

  return (
    <section className="panel">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">Photos</h2>
          <p className="panel-sub">Campus life, events, reunions — shared albums the whole house can add to.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>+ New album</button>
      </div>

      {loading ? (
        <LoadingState message="Loading albums…" />
      ) : albums.length === 0 && (
        <EmptyState
          icon="feed"
          message="No albums yet."
          subMessage="Start one for a reunion, an event, or just campus life."
          actionLabel="Create the first album"
          onAction={() => setCreating(true)}
        />
      )}

      <div className="album-grid">
        {albums.map((a) => (
          <AlbumCard key={a.id} album={a} coverUrls={covers[a.id] || []} onClick={() => navigate(`/photos/${a.id}`)} />
        ))}
      </div>

      {creating && (
        <CreateAlbumModal
          session={session}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); load(); navigate(`/photos/${id}`) }}
        />
      )}
    </section>
  )
}

function AlbumCard({ album: a, coverUrls, onClick }) {
  const count = a.photos?.[0]?.count ?? coverUrls.length
  return (
    <button className="album-card" onClick={onClick}>
      <div className={`album-card-collage tiles-${Math.min(coverUrls.length, 4) || 1}`}>
        {coverUrls.length === 0 ? (
          <PhotoPlaceholderIcon />
        ) : (
          coverUrls.slice(0, 4).map((src, i) => <img key={i} src={src} alt="" loading="lazy" />)
        )}
      </div>
      <div className="album-card-body">
        <span className="album-card-title">{a.title}</span>
        <span className="album-card-meta">{count} {count === 1 ? 'photo' : 'photos'}</span>
      </div>
    </button>
  )
}

function CreateAlbumModal({ session, onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    if (!title.trim()) { setError('Give the album a name.'); return }
    setBusy(true); setError(null)
    const { data, error: err } = await supabase
      .from('photo_albums')
      .insert({ title: title.trim(), description: description.trim(), created_by: session.user.id })
      .select('id')
      .single()
    setBusy(false)
    if (err) { setError(err.message.includes('policy') ? 'Creating an album unlocks once your account is approved.' : err.message); return }
    onCreated(data.id)
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Create album">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h2>New album</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <label className="field"><span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Reunion 2026" maxLength={80} />
          </label>
          <label className="field"><span>Description (optional)</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={400} />
          </label>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create album'}</button>
        </div>
      </div>
    </div>
  )
}

export function PhotoPlaceholderIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}
