import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import RichTextEditor from './RichTextEditor.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import { sanitizeHtml } from '../sanitizeHtml.js'

const MAX_IMAGES = 4
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_VIDEO_SIZE = 100 * 1024 * 1024
const PAGE_SIZE = 10

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

// Does the HTML contain anything besides whitespace/empty tags? Used so an
// empty WYSIWYG editor (e.g. "<div><br></div>") doesn't count as content.
function hasText(html) {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  return div.textContent.trim().length > 0
}

// Turns a pasted YouTube/Vimeo link into an embeddable player URL, or null
// if it isn't one — used both for the composer's live preview and for
// rendering the video in a published post.
function videoEmbedUrl(raw) {
  if (!raw) return null
  let url
  try { url = new URL(raw.trim()) } catch { return null }

  if (url.hostname.includes('youtu')) {
    let id = ''
    if (url.hostname.includes('youtu.be')) id = url.pathname.slice(1)
    else if (url.pathname.startsWith('/embed/')) id = url.pathname.split('/embed/')[1]
    else if (url.pathname.startsWith('/shorts/')) id = url.pathname.split('/shorts/')[1]
    else id = url.searchParams.get('v') || ''
    id = id.split('/')[0]
    return id ? `https://www.youtube.com/embed/${id}` : null
  }
  if (url.hostname.includes('vimeo.com')) {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null
  }
  return null
}

export default function Feed({ session, profile, onMessage }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [myLikes, setMyLikes] = useState(new Set())
  const [lightbox, setLightbox] = useState(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const composerOpenRef = useRef(null)

  async function load() {
    const { data, error } = await supabase
      .from('posts')
      .select(`
        id, title, content, image_urls, video_url, created_at, author_id,
        profiles!posts_author_id_fkey ( full_name, grad_year, occupation, avatar_url ),
        likes:post_likes(count),
        comments:post_comments(count)
      `)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) { console.error(error); setLoading(false); return }
    setPosts(data || [])

    const { data: mine } = await supabase
      .from('post_likes')
      .select('post_id')
      .eq('user_id', session.user.id)
    setMyLikes(new Set((mine || []).map((r) => r.post_id)))
    setLoading(false)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, load)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function removePost(id) {
    await supabase.from('posts').delete().eq('id', id)
  }

  async function toggleLike(postId) {
    const liked = myLikes.has(postId)
    setMyLikes((prev) => {
      const next = new Set(prev)
      if (liked) next.delete(postId); else next.add(postId)
      return next
    })
    setPosts((prev) => prev.map((p) => {
      if (p.id !== postId) return p
      const cur = p.likes?.[0]?.count ?? 0
      return { ...p, likes: [{ count: cur + (liked ? -1 : 1) }] }
    }))

    if (liked) {
      await supabase.from('post_likes').delete()
        .match({ post_id: postId, user_id: session.user.id })
    } else {
      const { error } = await supabase.from('post_likes')
        .insert({ post_id: postId, user_id: session.user.id })
      if (error) {
        setMyLikes((prev) => { const n = new Set(prev); n.delete(postId); return n })
        setPosts((prev) => prev.map((p) =>
          p.id === postId ? { ...p, likes: [{ count: (p.likes?.[0]?.count ?? 1) - 1 }] } : p
        ))
      }
    }
  }

  const shown = posts.slice(0, visibleCount)
  const hasMore = visibleCount < posts.length

  return (
    <section className="panel">
      <h2 className="panel-title">Feed</h2>
      <p className="panel-sub">Photos, updates, shoutouts — what the house is up to.</p>

      <Composer session={session} profile={profile} onPosted={() => { load(); setVisibleCount(PAGE_SIZE) }} openRef={composerOpenRef} />

      {loading ? (
        <LoadingState message="Loading feed…" />
      ) : posts.length === 0 && (
        <EmptyState
          icon="feed"
          message="No posts yet."
          subMessage="Be the first Eendragter to break the silence."
          actionLabel={profile?.approved ? 'Write the first post' : undefined}
          onAction={() => composerOpenRef.current?.()}
        />
      )}

      <ul className="post-list">
        {shown.map((p) => (
          <PostItem
            key={p.id}
            post={p}
            session={session}
            profile={profile}
            liked={myLikes.has(p.id)}
            onLike={() => toggleLike(p.id)}
            onDelete={() => removePost(p.id)}
            onImageClick={(src) => setLightbox(src)}
            onMessage={() => onMessage?.(
              { id: p.author_id, full_name: p.profiles?.full_name },
              'Hi! I saw your post on the feed and wanted to reach out.'
            )}
          />
        ))}
      </ul>

      {hasMore && (
        <div className="load-more-row">
          <button className="btn ghost" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
            Load more ({posts.length - shown.length} remaining)
          </button>
        </div>
      )}

      {lightbox && (
        <div className="lightbox-backdrop" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </section>
  )
}

/* ---------- Composer ---------- */
function Composer({ session, profile, onPosted, openRef }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState([])
  const [videoFile, setVideoFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const videoFileRef = useRef(null)
  const titleRef = useRef(null)

  const canPost = profile?.approved
  const canSubmit = canPost && (hasText(body) || files.length > 0 || videoFile)

  function openModal() {
    if (!canPost) return
    setOpen(true)
    setTimeout(() => titleRef.current?.focus(), 50)
  }

  function closeModal() {
    if (busy) return
    setOpen(false)
    setTitle(''); setBody(''); setFiles([]); setError(null)
    setVideoFile(null)
  }

  // Lets a CTA outside this component (the Feed empty state) trigger the
  // same "start a post" flow as clicking the prompt.
  if (openRef) openRef.current = () => openModal()

  function pickFiles(e) {
    const chosen = Array.from(e.target.files || [])
    if (chosen.length === 0) return
    for (const f of chosen) {
      if (f.size > MAX_IMAGE_SIZE) {
        setError(`"${f.name}" is over 5MB.`)
        return
      }
    }
    setFiles((prev) => [...prev, ...chosen].slice(0, MAX_IMAGES))
    setError(null)
    e.target.value = ''
  }

  function pickVideo(e) {
    const chosen = e.target.files?.[0]
    if (!chosen) return
    if (chosen.size > MAX_VIDEO_SIZE) {
      setError(`Video is over 100MB.`)
      e.target.value = ''
      return
    }
    setVideoFile(chosen)
    setError(null)
    e.target.value = ''
  }

  function removeFile(idx) {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  function removeVideo() {
    setVideoFile(null)
  }

  async function uploadAll() {
    const urls = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const ext = f.name.split('.').pop().toLowerCase()
      const path = `${session.user.id}/${Date.now()}-${i}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('post-images')
        .upload(path, f, { upsert: false, contentType: f.type })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('post-images').getPublicUrl(path)
      urls.push(data.publicUrl)
    }
    return urls
  }

  async function uploadVideo() {
    if (!videoFile) return null
    const ext = videoFile.name.split('.').pop().toLowerCase()
    const path = `${session.user.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('post-videos')
      .upload(path, videoFile, { upsert: false, contentType: videoFile.type })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('post-videos').getPublicUrl(path)
    return data.publicUrl
  }

  async function publish() {
    if (!canSubmit) return
    setBusy(true); setError(null)
    try {
      const image_urls = files.length ? await uploadAll() : []
      const video_url = videoFile ? await uploadVideo() : null
      const { error } = await supabase
        .from('posts')
        .insert({
          author_id: session.user.id,
          title: title.trim(),
          content: hasText(body) ? sanitizeHtml(body) : '(no text)',
          image_urls,
          video_url,
        })
      if (error) {
        setError(error.message.includes('policy')
          ? 'Posting unlocks once your account is approved.'
          : error.message)
      } else {
        setTitle(''); setBody(''); setFiles([])
        setVideoFile(null)
        setOpen(false)
        onPosted?.()
      }
    } catch (e) {
      setError(e.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  /* ---- Collapsed prompt (always visible) ---- */
  const prompt = (
    <div className="composer-prompt" onClick={openModal}>
      <Avatar url={profile?.avatar_url} name={profile?.full_name} size={44} />
      <button className="composer-prompt-input" disabled={!canPost}>
        {canPost ? 'Start a post' : 'Posting unlocks after approval'}
      </button>
    </div>
  )

  function openModalWithPhoto() {
    openModal()
    setTimeout(() => fileRef.current?.click(), 50)
  }

  function openModalWithVideo() {
    openModal()
    setTimeout(() => videoFileRef.current?.click(), 50)
  }

  /* ---- Quick-action buttons below the prompt ---- */
  const quickActions = (
    <div className="composer-quick-actions">
      <button className="composer-quick-btn" onClick={openModalWithPhoto} disabled={!canPost}>
        <PhotoIcon /> Photo
      </button>
      <button className="composer-quick-btn" onClick={openModalWithVideo} disabled={!canPost}>
        <VideoIcon /> Video
      </button>
    </div>
  )

  /* ---- Toolbar inside the modal editor ---- */
  const mediaButtons = (
    <>
      <button
        type="button"
        className="composer-photo-btn"
        onClick={() => fileRef.current?.click()}
        disabled={!canPost || files.length >= MAX_IMAGES}
        title="Add photo"
      >
        <PhotoIcon />
        {files.length > 0 && <span className="composer-photo-count">{files.length}/{MAX_IMAGES}</span>}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={pickFiles}
      />
      <button
        type="button"
        className="composer-photo-btn"
        onClick={() => videoFileRef.current?.click()}
        disabled={!canPost || !!videoFile}
        title="Add video"
      >
        <VideoIcon />
      </button>
      <input
        ref={videoFileRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        style={{ display: 'none' }}
        onChange={pickVideo}
      />
    </>
  )

  return (
    <>
      <div className="composer-card">
        {prompt}
        {quickActions}
      </div>

      {open && (
        <div className="composer-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="composer-modal">
            {/* Header */}
            <div className="composer-modal-header">
              <div className="composer-modal-user">
                <Avatar url={profile?.avatar_url} name={profile?.full_name} size={44} />
                <div>
                  <span className="composer-modal-name">{profile?.full_name || 'Alumnus'}</span>
                  <span className="composer-modal-audience">Post to Everyone</span>
                </div>
              </div>
              <button className="composer-modal-close" onClick={closeModal} aria-label="Close">×</button>
            </div>

            {/* Title */}
            <input
              ref={titleRef}
              className="composer-modal-title"
              placeholder="Post title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />

            {/* Body */}
            <div className="composer-modal-body">
              <RichTextEditor
                value={body}
                onChange={setBody}
                placeholder="What do you want to talk about?"
                toolbarExtra={mediaButtons}
              />
            </div>

            {/* Video preview */}
            {videoFile && (
              <div className="composer-video-row">
                <div className="composer-video-preview-wrap">
                  <video controls width="100%">
                    <source src={URL.createObjectURL(videoFile)} />
                    Your browser doesn't support video playback
                  </video>
                  <button
                    type="button"
                    className="search-clear"
                    onClick={removeVideo}
                    aria-label="Remove video"
                  >×</button>
                </div>
              </div>
            )}

            {/* Image previews */}
            {files.length > 0 && (
              <div className="composer-previews">
                {files.map((f, i) => (
                  <div className="composer-preview" key={i}>
                    <img src={URL.createObjectURL(f)} alt="" />
                    <button onClick={() => removeFile(i)} aria-label="Remove image">×</button>
                  </div>
                ))}
              </div>
            )}

            {error && <p className="form-error" style={{ margin: '8px 20px' }}>{error}</p>}

            {/* Footer */}
            <div className="composer-modal-footer">
              <button className="btn primary" onClick={publish} disabled={busy || !canSubmit}>
                {busy ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ---------- Post item ---------- */
function PostItem({ post: p, session, profile, liked, onLike, onDelete, onImageClick, onMessage }) {
  const [showComments, setShowComments] = useState(false)
  const likeCount = p.likes?.[0]?.count ?? 0
  const commentCount = p.comments?.[0]?.count ?? 0
  const canInteract = profile?.approved
  const images = p.image_urls || []

  return (
    <li className="post">
      <div className="post-head">
        <Avatar url={p.profiles?.avatar_url} name={p.profiles?.full_name} size={40} />
        <div className="post-head-info">
          <span className="post-author">{p.profiles?.full_name || 'Alumnus'}</span>
          <span className="post-meta">
            {p.profiles?.grad_year ? "Class of '" + String(p.profiles.grad_year).slice(-2) : ''}
            {p.profiles?.occupation ? ` · ${p.profiles.occupation}` : ''}
          </span>
          <span className="post-time">{timeAgo(p.created_at)}</span>
        </div>
        {p.author_id === session.user.id && (
          <DeleteButton
            onConfirm={onDelete}
            label="Delete post"
            message="This can't be undone."
            className="icon-btn-delete post-delete-btn"
          />
        )}
      </div>

      {p.title && <h3 className="post-title">{p.title}</h3>}
      {p.content && p.content !== '(no text)' && (
        <div className="post-body rendered-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(p.content) }} />
      )}

      {p.video_url && (
        <div className="post-video">
          <video controls style={{ width: '100%' }}>
            <source src={p.video_url} />
            Your browser doesn't support video playback
          </video>
        </div>
      )}

      {images.length > 0 && (
        <div className={`post-images count-${Math.min(images.length, 4)}`}>
          {images.slice(0, 4).map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" onClick={() => onImageClick(src)} />
          ))}
        </div>
      )}

      <div className="post-actions">
        <button
          className={liked ? 'post-action liked' : 'post-action'}
          onClick={onLike}
          disabled={!canInteract}
          title={canInteract ? (liked ? 'Unlike' : 'Like') : 'Liking unlocks after approval'}
        >
          <HeartIcon filled={liked} /> {likeCount}
        </button>
        <button
          className="post-action"
          onClick={() => setShowComments((s) => !s)}
        >
          <CommentIcon /> {commentCount}
        </button>
        {p.author_id !== session.user.id && (
          <button
            className="post-action"
            onClick={onMessage}
            disabled={!canInteract}
            title={canInteract ? 'Message the author' : 'Messaging unlocks after approval'}
          >
            <MessageIcon /> Message
          </button>
        )}
      </div>

      {showComments && (
        <Comments postId={p.id} session={session} profile={profile} />
      )}
    </li>
  )
}

/* ---------- Comments ---------- */
function Comments({ postId, session, profile }) {
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)
  const canPost = profile?.approved

  async function load() {
    const { data } = await supabase
      .from('post_comments')
      .select('id, content, created_at, author_id, profiles!post_comments_author_id_fkey ( full_name, avatar_url )')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
    setItems(data || [])
  }

  useEffect(() => { load() }, [postId])

  async function send() {
    if (!draft.trim()) return
    setError(null)
    const { error } = await supabase
      .from('post_comments')
      .insert({ post_id: postId, author_id: session.user.id, content: draft.trim() })
    if (error) {
      setError(error.message.includes('policy')
        ? 'Commenting unlocks once your account is approved.'
        : error.message)
    } else {
      setDraft(''); load()
    }
  }

  async function remove(id) {
    await supabase.from('post_comments').delete().eq('id', id)
    load()
  }

  return (
    <div className="post-comments">
      {items.length === 0 && <p className="empty small">No comments yet.</p>}
      <ul className="comment-list">
        {items.map((c) => (
          <li className="comment" key={c.id}>
            <Avatar url={c.profiles?.avatar_url} name={c.profiles?.full_name} size={30} />
            <div className="comment-body">
              <span className="comment-author">{c.profiles?.full_name || 'Alumnus'}</span>
              <span className="comment-meta">{timeAgo(c.created_at)}</span>
              {c.author_id === session.user.id && (
                <DeleteButton
                  onConfirm={() => remove(c.id)}
                  label="Delete comment"
                  message="This can't be undone."
                  className="icon-btn-delete small"
                />
              )}
              <p className="comment-text">{c.content}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="comment-form">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={canPost ? 'Write a comment…' : 'Commenting unlocks after approval'}
          disabled={!canPost}
          maxLength={2000}
        />
        <button className="btn primary small" onClick={send} disabled={!canPost || !draft.trim()}>
          Reply
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}

/* ---------- Icons ---------- */
function HeartIcon({ filled }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  )
}
function CommentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  )
}
function MessageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  )
}
function PhotoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}
function VideoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="6" width="14" height="12" rx="2" />
      <path d="M16.5 10.5l5-3v9l-5-3z" />
    </svg>
  )
}
