import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import RichTextEditor from './RichTextEditor.jsx'
import EmptyState from './EmptyState.jsx'
import { sanitizeHtml } from '../sanitizeHtml.js'

const MAX_IMAGES = 4
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
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

export default function Feed({ session, profile }) {
  const [posts, setPosts] = useState([])
  const [myLikes, setMyLikes] = useState(new Set())
  const [lightbox, setLightbox] = useState(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  async function load() {
    const { data, error } = await supabase
      .from('posts')
      .select(`
        id, title, content, image_urls, created_at, author_id,
        profiles!posts_author_id_fkey ( full_name, grad_year, occupation, avatar_url ),
        likes:post_likes(count),
        comments:post_comments(count)
      `)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) { console.error(error); return }
    setPosts(data || [])

    const { data: mine } = await supabase
      .from('post_likes')
      .select('post_id')
      .eq('user_id', session.user.id)
    setMyLikes(new Set((mine || []).map((r) => r.post_id)))
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
    if (!confirm('Delete this post?')) return
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
      <h2 className="panel-title">House feed</h2>
      <p className="panel-sub">News, wins, and everything in between.</p>

      <Composer session={session} profile={profile} onPosted={() => { load(); setVisibleCount(PAGE_SIZE) }} />

      {posts.length === 0 && (
        <EmptyState icon="feed" message="No posts yet." subMessage="Be the first Eendragter to break the silence." />
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
function Composer({ session, profile, onPosted }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const canPost = profile?.approved
  const canSubmit = canPost && (hasText(body) || files.length > 0)

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

  function removeFile(idx) {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
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

  async function publish() {
    if (!canSubmit) return
    setBusy(true); setError(null)
    try {
      const image_urls = files.length ? await uploadAll() : []
      const { error } = await supabase
        .from('posts')
        .insert({
          author_id: session.user.id,
          title: title.trim(),
          content: hasText(body) ? sanitizeHtml(body) : '(no text)',
          image_urls,
        })
      if (error) {
        setError(error.message.includes('policy')
          ? 'Posting unlocks once your account is approved.'
          : error.message)
      } else {
        setTitle(''); setBody(''); setFiles([])
        onPosted?.()
      }
    } catch (e) {
      setError(e.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const photoButton = (
    <>
      <button
        type="button"
        className="composer-photo-btn"
        onClick={() => fileRef.current?.click()}
        disabled={!canPost || files.length >= MAX_IMAGES}
      >
        📷 Photo {files.length > 0 && `(${files.length}/${MAX_IMAGES})`}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={pickFiles}
      />
      <span className="toolbar-divider" />
      {error && <span className="form-error">{error}</span>}
      <button className="btn primary" onClick={publish} disabled={busy || !canSubmit}>
        {busy ? 'Posting…' : 'Post'}
      </button>
    </>
  )

  return (
    <div className="composer">
      <input
        className="composer-title"
        placeholder="Post title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={!canPost}
        maxLength={200}
      />
      <RichTextEditor
        value={body}
        onChange={setBody}
        placeholder={canPost ? 'Share news with the house…' : 'Posting unlocks after approval'}
        disabled={!canPost}
        toolbarExtra={photoButton}
      />
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
    </div>
  )
}

/* ---------- Post item ---------- */
function PostItem({ post: p, session, profile, liked, onLike, onDelete, onImageClick }) {
  const [showComments, setShowComments] = useState(false)
  const likeCount = p.likes?.[0]?.count ?? 0
  const commentCount = p.comments?.[0]?.count ?? 0
  const canInteract = profile?.approved
  const images = p.image_urls || []

  return (
    <li className="post">
      <div className="post-head">
        <Avatar url={p.profiles?.avatar_url} name={p.profiles?.full_name} size={34} />
        <span className="post-author">{p.profiles?.full_name || 'Alumnus'}</span>
        <span className="post-meta">
          {p.profiles?.grad_year ? `’${String(p.profiles.grad_year).slice(-2)}` : ''}
          {p.profiles?.occupation ? ` · ${p.profiles.occupation}` : ''}
          {' · '}{timeAgo(p.created_at)}
        </span>
        {p.author_id === session.user.id && (
          <button className="link-btn small" onClick={onDelete}>Delete</button>
        )}
      </div>

      {p.title && <h3 className="post-title">{p.title}</h3>}
      {p.content && p.content !== '(no text)' && (
        <div className="post-body rendered-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(p.content) }} />
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
                <button className="comment-delete" onClick={() => remove(c.id)}>Delete</button>
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
