import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { PhotoPlaceholderIcon } from './Photos.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import { useToast } from './Toast.jsx'

const MAX_PHOTO_SIZE = 15 * 1024 * 1024
const MAX_PER_UPLOAD = 20

export default function AlbumDetail({ session, profile }) {
  const { albumId } = useParams()
  const navigate = useNavigate()
  const showToast = useToast()
  const [album, setAlbum] = useState(null)
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [editing, setEditing] = useState(false)
  const fileRef = useRef(null)
  const isSiteAdmin = !!profile?.is_admin

  async function load() {
    setLoading(true)
    const [{ data: a }, { data: p }] = await Promise.all([
      supabase.from('photo_albums').select('id, title, description, created_by, created_at').eq('id', albumId).single(),
      supabase.from('photos').select('id, url, caption, uploaded_by, created_at').eq('album_id', albumId).order('created_at', { ascending: false }),
    ])
    setAlbum(a || null)
    setPhotos(p || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [albumId])

  const isOwner = album?.created_by === session.user.id
  const canManageAlbum = isOwner || isSiteAdmin

  async function uploadPhotos(e) {
    const chosen = Array.from(e.target.files || [])
    e.target.value = ''
    if (chosen.length === 0) return
    if (chosen.length > MAX_PER_UPLOAD) {
      showToast(`Pick up to ${MAX_PER_UPLOAD} photos at a time.`, { type: 'error' })
      return
    }
    for (const f of chosen) {
      if (f.size > MAX_PHOTO_SIZE) {
        showToast(`"${f.name}" is over ${MAX_PHOTO_SIZE / (1024 * 1024)}MB.`, { type: 'error' })
        return
      }
    }
    setUploading(true)
    try {
      const rows = []
      for (let i = 0; i < chosen.length; i++) {
        const f = chosen[i]
        const ext = f.name.split('.').pop().toLowerCase()
        const path = `${session.user.id}/${albumId}/${Date.now()}-${i}.${ext}`
        const { error: upErr } = await supabase.storage.from('album-photos').upload(path, f, { contentType: f.type })
        if (upErr) throw upErr
        const url = supabase.storage.from('album-photos').getPublicUrl(path).data.publicUrl
        rows.push({ album_id: albumId, url, uploaded_by: session.user.id })
      }
      const { error: insErr } = await supabase.from('photos').insert(rows)
      if (insErr) throw insErr
      showToast(`${rows.length} photo${rows.length === 1 ? '' : 's'} added`)
      load()
    } catch (err) {
      showToast(err.message?.includes('policy') ? 'Adding photos unlocks once your account is approved.' : (err.message || 'Upload failed.'), { type: 'error' })
    } finally {
      setUploading(false)
    }
  }

  async function removePhoto(id) {
    const { error } = await supabase.from('photos').delete().eq('id', id)
    if (error) { showToast('Could not delete photo.', { type: 'error' }); return }
    setPhotos((prev) => prev.filter((p) => p.id !== id))
    setLightboxIndex(null)
    showToast('Photo deleted')
  }

  async function deleteAlbum() {
    const { error } = await supabase.from('photo_albums').delete().eq('id', albumId)
    if (error) { showToast('Could not delete album.', { type: 'error' }); return }
    showToast('Album deleted')
    navigate('/photos')
  }

  if (loading) return <section className="panel"><LoadingState message="Loading album…" /></section>
  if (!album) {
    return (
      <section className="panel">
        <EmptyState icon="feed" message="Album not found." subMessage="It may have been removed." actionLabel="Back to Photos" onAction={() => navigate('/photos')} />
      </section>
    )
  }

  return (
    <section className="panel">
      <button className="profile-back-btn" onClick={() => navigate('/photos')}>‹ All albums</button>

      <div className="panel-header-row album-header-row">
        <div>
          <h2 className="panel-title">{album.title}</h2>
          {album.description && <p className="panel-sub">{album.description}</p>}
          <p className="result-count">{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</p>
        </div>
        <div className="album-header-actions">
          <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={uploading || !profile?.approved}>
            {uploading ? 'Uploading…' : '+ Add Photos'}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }} onChange={uploadPhotos} />
          <span className="album-max-size">Max {MAX_PHOTO_SIZE / (1024 * 1024)}MB per photo</span>
          {canManageAlbum && (
            <div className="album-owner-actions">
              <button className="header-icon-btn album-edit-btn" onClick={() => setEditing(true)} aria-label="Edit album" title="Edit album">
                <EditIcon />
              </button>
              <DeleteButton onConfirm={deleteAlbum} label="Delete album" message="This will remove the album and every photo in it. This can't be undone." className="icon-btn-delete post-delete-btn delete-danger" />
            </div>
          )}
        </div>
      </div>

      {photos.length === 0 && (
        <EmptyState icon="feed" message="No photos yet." subMessage="Be the first to add one." actionLabel={profile?.approved ? 'Add photos' : undefined} onAction={() => fileRef.current?.click()} />
      )}

      <div className="photo-grid">
        {photos.map((p, i) => (
          <button key={p.id} className="photo-grid-item" onClick={() => setLightboxIndex(i)}>
            <img src={p.url} alt="" loading="lazy" />
          </button>
        ))}
      </div>

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          canDelete={(p) => p.uploaded_by === session.user.id || canManageAlbum}
          onDelete={removePhoto}
        />
      )}

      {editing && (
        <EditAlbumModal
          album={album}
          onClose={() => setEditing(false)}
          onSaved={(updated) => { setAlbum((a) => ({ ...a, ...updated })); setEditing(false) }}
        />
      )}
    </section>
  )
}

function EditAlbumModal({ album, onClose, onSaved }) {
  const [title, setTitle] = useState(album.title)
  const [description, setDescription] = useState(album.description || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    if (!title.trim()) { setError('Give the album a name.'); return }
    setBusy(true); setError(null)
    const { error: err } = await supabase.from('photo_albums').update({ title: title.trim(), description: description.trim() }).eq('id', album.id)
    setBusy(false)
    if (err) { setError(err.message); return }
    onSaved({ title: title.trim(), description: description.trim() })
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Edit album">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h2>Edit album</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <label className="field"><span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          </label>
          <label className="field"><span>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={400} />
          </label>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  )
}

/* ---------- Lightbox with prev/next ---------- */
function PhotoLightbox({ photos, index, onClose, onIndexChange, canDelete, onDelete }) {
  const photo = photos[index]

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') onIndexChange((i) => (i + 1) % photos.length)
      else if (e.key === 'ArrowLeft') onIndexChange((i) => (i - 1 + photos.length) % photos.length)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length])

  if (!photo) return null

  return (
    <div className="lightbox-backdrop photo-lightbox" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close">×</button>
      {photos.length > 1 && (
        <button
          className="lightbox-nav lightbox-prev"
          onClick={(e) => { e.stopPropagation(); onIndexChange((index - 1 + photos.length) % photos.length) }}
          aria-label="Previous photo"
        >
          <ChevronIcon flip />
        </button>
      )}
      <img src={photo.url} alt="" onClick={(e) => e.stopPropagation()} />
      {photos.length > 1 && (
        <button
          className="lightbox-nav lightbox-next"
          onClick={(e) => { e.stopPropagation(); onIndexChange((index + 1) % photos.length) }}
          aria-label="Next photo"
        >
          <ChevronIcon />
        </button>
      )}
      <div className="lightbox-footer" onClick={(e) => e.stopPropagation()}>
        <span>{index + 1} / {photos.length}</span>
        {canDelete(photo) && (
          <DeleteButton onConfirm={() => onDelete(photo.id)} label="Delete photo" message="This can't be undone." className="icon-btn-delete delete-danger lightbox-delete" />
        )}
      </div>
    </div>
  )
}

function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  )
}
function ChevronIcon({ flip }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}
